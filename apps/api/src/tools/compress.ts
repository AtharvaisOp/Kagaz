import { open, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import type {
  CompressionMetadata,
  CompressionPreset,
} from '@kagaz/shared-types';
import { checkAbort, HeavyToolError } from './errors.js';
import { runNative, type NativeRunner } from './nativeRunner.js';
import { MAX_INPUT_BYTES } from './upload.js';

const SETTINGS: Record<CompressionPreset, string> = {
  'high-quality': '/printer',
  balanced: '/ebook',
  maximum: '/screen',
};
export interface CompressionEngineOptions {
  readonly gs?: string;
  readonly qpdf?: string;
  readonly runner?: NativeRunner;
}

async function pdfHeader(path: string, maximum: number): Promise<number> {
  try {
    const file = await open(path, 'r');
    try {
      const size = (await file.stat()).size;
      if (size < 8 || size > maximum)
        throw new HeavyToolError(
          size > maximum ? 'file-too-large' : 'invalid-pdf',
        );
      const header = Buffer.alloc(8);
      await file.read(header, 0, 8, 0);
      if (!/^%PDF-[12]\.[0-9]/.test(header.toString('ascii')))
        throw new HeavyToolError('invalid-pdf');
      return size;
    } finally {
      await file.close();
    }
  } catch (error) {
    throw error instanceof HeavyToolError
      ? error
      : new HeavyToolError('invalid-pdf');
  }
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
  const originalBytes = await pdfHeader(input, MAX_INPUT_BYTES);
  const run = (executable: string, args: string[]) =>
    runner({ executable, args, cwd, signal });
  const validate = async (path: string) => {
    checkAbort(signal);
    const encrypted = await run(qpdf, ['--is-encrypted', path]);
    if (encrypted.exitCode === 0) throw new HeavyToolError('unsupported-pdf');
    if (encrypted.exitCode !== 2) throw new HeavyToolError('invalid-pdf');
    const checked = await run(qpdf, ['--check', path]);
    // Warning/recovery status 3 is deliberately rejected, not silently repaired.
    if (checked.exitCode !== 0) throw new HeavyToolError('invalid-pdf');
    const pageInfo = await run(qpdf, ['--show-npages', path]);
    const count = Number(pageInfo.stdout.trim());
    if (pageInfo.exitCode !== 0 || !Number.isInteger(count) || count < 1)
      throw new HeavyToolError('invalid-pdf');
    if (count > 300) throw new HeavyToolError('unsupported-pdf');
    return count;
  };
  const pages = await validate(input);
  // This route accepts the flattened browser export, never interactive sources.
  const inventory = await run(qpdf, ['--json', '--json-key=acroform', input]);
  let formInfo: unknown;
  try {
    formInfo = JSON.parse(inventory.stdout);
  } catch {
    throw new HeavyToolError('invalid-pdf');
  }
  if (
    inventory.exitCode !== 0 ||
    typeof formInfo !== 'object' ||
    formInfo === null ||
    !('acroform' in formInfo) ||
    typeof formInfo.acroform !== 'object' ||
    formInfo.acroform === null ||
    !('hasacroform' in formInfo.acroform) ||
    typeof formInfo.acroform.hasacroform !== 'boolean'
  )
    throw new HeavyToolError('invalid-pdf');
  if (formInfo.acroform.hasacroform)
    throw new HeavyToolError('unsupported-pdf');
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
    compressedBytes = await pdfHeader(output, 40 * 1024 * 1024);
    if ((await validate(output)) !== pages)
      throw new HeavyToolError('processing-failed');
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
