import { open } from 'node:fs/promises';
import { checkAbort, HeavyToolError } from './errors.js';
import type { NativeResult } from './nativeRunner.js';
export type PdfCommand = (
  executable: string,
  args: string[],
) => Promise<NativeResult>;

export async function pdfHeader(
  path: string,
  maximum: number,
): Promise<number> {
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

export async function validatePdf(
  path: string,
  signal: AbortSignal,
  run: PdfCommand,
  qpdf: string,
  maximumPages = 300,
): Promise<number> {
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
  if (count > maximumPages) throw new HeavyToolError('unsupported-pdf');
  return count;
}

export async function validateFlattenedPdf(
  path: string,
  run: PdfCommand,
  qpdf: string,
): Promise<void> {
  // This route accepts the flattened browser export, never interactive sources.
  const inventory = await run(qpdf, ['--json', '--json-key=acroform', path]);
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
}
