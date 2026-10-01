import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { OcrMetadata } from '@kagaz/shared-types';
import { checkAbort, HeavyToolError } from './errors.js';
import { runNative, type NativeRunner } from './nativeRunner.js';
import {
  pdfHeader,
  validateFlattenedPdf,
  validatePdf,
} from './pdfValidation.js';
import { MAX_OCR_INPUT_BYTES } from './upload.js';

export const OCR_POLICY = {
  pages: 20,
  outputBytes: 40 * 1024 * 1024,
  timeoutMs: 240_000,
  requestTimeoutMs: 300_000,
  limits: {
    addressSpace: 768 * 1024 * 1024,
    cpuSeconds: 240,
    fileBytes: 40 * 1024 * 1024,
  },
} as const;
export interface OcrEngineOptions {
  readonly ocrmypdf?: string;
  readonly python?: string;
  readonly qpdf?: string;
  readonly runner?: NativeRunner;
}
const inspector = fileURLToPath(
  new URL('../../native/inspect_ocr.py', import.meta.url),
);

function readInventory(text: string, pages: number) {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new HeavyToolError('ocr-failed');
  }
  if (
    typeof data !== 'object' ||
    data === null ||
    !('pages' in data) ||
    data.pages !== pages ||
    !('pagesOcred' in data) ||
    typeof data.pagesOcred !== 'number' ||
    !Number.isInteger(data.pagesOcred) ||
    data.pagesOcred < 0 ||
    data.pagesOcred > pages ||
    !('pagesSkipped' in data) ||
    data.pagesSkipped !== pages - data.pagesOcred
  )
    throw new HeavyToolError('ocr-failed');
  return { pagesOcred: data.pagesOcred, pagesSkipped: pages - data.pagesOcred };
}

export async function ocrPdf(
  input: string,
  output: string,
  signal: AbortSignal,
  options: OcrEngineOptions = {},
): Promise<{ path: string; metadata: OcrMetadata }> {
  const runner = options.runner ?? runNative;
  const run = (executable: string, args: string[]) =>
    runner({
      executable,
      args,
      cwd: dirname(input),
      signal,
      timeoutMs: OCR_POLICY.timeoutMs,
      limits: OCR_POLICY.limits,
    });
  const qpdf = options.qpdf ?? 'qpdf';
  const originalBytes = await pdfHeader(input, MAX_OCR_INPUT_BYTES);
  const pages = await validatePdf(input, signal, run, qpdf, OCR_POLICY.pages);
  await validateFlattenedPdf(input, run, qpdf);
  const inspect = async (paths: string[]) => {
    const result = await run(options.python ?? 'python3', [
      inspector,
      ...paths,
    ]);
    if (result.exitCode === 2) throw new HeavyToolError('unsupported-pdf');
    if (result.exitCode !== 0) throw new HeavyToolError('ocr-failed');
    return readInventory(result.stdout, pages);
  };
  const inventory = await inspect([input]);
  if (inventory.pagesOcred === 0) throw new HeavyToolError('no-ocr-needed');
  const result = await run(options.ocrmypdf ?? 'ocrmypdf', [
    '--language',
    'eng',
    '--skip-text',
    '--output-type',
    'pdf',
    '--optimize',
    '0',
    '--pdf-renderer',
    'hocr',
    '--jobs',
    '1',
    '--tesseract-timeout',
    '60',
    '--max-image-mpixels',
    '16',
    '--fast-web-view',
    '0',
    '--quiet',
    input,
    output,
  ]);
  if (result.exitCode !== 0) throw new HeavyToolError('ocr-failed');
  let outputBytes: number;
  try {
    outputBytes = await pdfHeader(output, OCR_POLICY.outputBytes);
    if (
      (await validatePdf(output, signal, run, qpdf, OCR_POLICY.pages)) !== pages
    )
      throw new HeavyToolError('ocr-failed');
    await validateFlattenedPdf(output, run, qpdf);
    const verified = await inspect([input, output]);
    if (verified.pagesOcred !== inventory.pagesOcred)
      throw new HeavyToolError('ocr-failed');
  } catch (error) {
    if (
      error instanceof HeavyToolError &&
      (error.code === 'cancelled' || error.code === 'processing-timeout')
    )
      throw error;
    throw new HeavyToolError('ocr-failed');
  }
  checkAbort(signal);
  return {
    path: output,
    metadata: {
      originalBytes,
      outputBytes,
      pages,
      language: 'eng',
      ...inventory,
    },
  };
}
