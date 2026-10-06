import { stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import type {
  CompressionMetadata,
  CompressionPreset,
} from '@kagaz/shared-types';
import { checkAbort, HeavyToolError } from './errors.js';
import {
  DEFAULT_NATIVE_POLICY,
  runNative,
  type NativeRunner,
} from './nativeRunner.js';
import { MAX_INPUT_BYTES } from './upload.js';
import {
  pdfHeader,
  validatePdf,
  validateFlattenedPdf,
  validateSafePdf,
} from './pdfValidation.js';

const SETTINGS: Record<CompressionPreset, string> = {
  'high-quality': '/printer',
  balanced: '/ebook',
  maximum: '/screen',
};
export const COMPRESSION_POLICY = {
  inputBytes: MAX_INPUT_BYTES,
  outputBytes: DEFAULT_NATIVE_POLICY.limits.fileBytes,
  pages: 300,
  timeoutMs: DEFAULT_NATIVE_POLICY.timeoutMs,
  requestTimeoutMs: 120_000,
  workspaceBytes: 128 * 1024 * 1024,
  limits: DEFAULT_NATIVE_POLICY.limits,
} as const;
export interface CompressionEngineOptions {
  readonly gs?: string;
  readonly qpdf?: string;
  readonly python?: string;
  readonly runner?: NativeRunner;
}

export async function compressPdf(
  input: string,
  output: string,
  preset: CompressionPreset,
  signal: AbortSignal,
  options: CompressionEngineOptions = {},
): Promise<{ path: string; metadata: CompressionMetadata }> {
  const runner = options.runner ?? runNative;
  const cwd = dirname(input);
  const qpdf = options.qpdf ?? 'qpdf';
  const originalBytes = await pdfHeader(input, COMPRESSION_POLICY.inputBytes);
  const run = (executable: string, args: string[]) =>
    runner({
      executable,
      args,
      cwd,
      signal,
      timeoutMs: COMPRESSION_POLICY.timeoutMs,
      limits: COMPRESSION_POLICY.limits,
    });
  const validate = (path: string) =>
    validatePdf(path, signal, run, qpdf, COMPRESSION_POLICY.pages);
  const pages = await validate(input);
  await validateFlattenedPdf(input, run, qpdf);
  await validateSafePdf(input, pages, run, options.python ?? 'python3');
  const result = await run(options.gs ?? 'gs', [
    '-dSAFER',
    '-dBATCH',
    '-dNOPAUSE',
    '-dQUIET',
    '-sDEVICE=pdfwrite',
    '-dPDFSTOPONERROR',
    '-dPDFSTOPONWARNING',
    '-dCompatibilityLevel=1.7',
    `-dPDFSETTINGS=${SETTINGS[preset]}`,
    '-dAutoRotatePages=/None',
    '-dDetectDuplicateImages=true',
    '-dCompressFonts=true',
    '-dCompressStreams=true',
    `-sOutputFile=${output}`,
    '-f',
    input,
  ]);
  if (result.exitCode !== 0) throw new HeavyToolError('processing-failed');
  let compressedBytes: number;
  try {
    compressedBytes = await pdfHeader(output, COMPRESSION_POLICY.outputBytes);
    if ((await validate(output)) !== pages)
      throw new HeavyToolError('processing-failed');
    await validateSafePdf(output, pages, run, options.python ?? 'python3');
  } catch (error) {
    if (
      error instanceof HeavyToolError &&
      (error.code === 'cancelled' || error.code === 'processing-timeout')
    )
      throw error;
    throw new HeavyToolError('processing-failed');
  }
  checkAbort(signal);
  const unchanged = compressedBytes >= originalBytes;
  if (unchanged) compressedBytes = originalBytes;
  const savedBytes = originalBytes - compressedBytes;
  // stat also guards against a disappearing result before handing it to the route.
  const path = unchanged ? input : output;
  if ((await stat(path)).size !== compressedBytes)
    throw new HeavyToolError('processing-failed');
  return {
    path,
    metadata: {
      originalBytes,
      compressedBytes,
      savedBytes,
      savedPercent: (savedBytes / originalBytes) * 100,
      preset,
      outcome: unchanged ? 'unchanged' : 'compressed',
    },
  };
}
