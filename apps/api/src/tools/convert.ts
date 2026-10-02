import { mkdir, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { ConversionMetadata, OfficeFormat } from '@kagaz/shared-types';
import { checkAbort, HeavyToolError } from './errors.js';
import { runNative, type NativeRunner } from './nativeRunner.js';
import { pdfHeader, validatePdf } from './pdfValidation.js';

export const CONVERSION_POLICY = {
  inputBytes: 10 * 1024 * 1024,
  outputBytes: 40 * 1024 * 1024,
  pages: 50,
  timeoutMs: 120_000,
  requestTimeoutMs: 180_000,
  workspaceBytes: 128 * 1024 * 1024,
  limits: {
    addressSpace: 768 * 1024 * 1024,
    cpuSeconds: 120,
    fileBytes: 40 * 1024 * 1024,
  },
} as const;
export interface ConversionEngineOptions {
  readonly libreoffice?: string;
  readonly python?: string;
  readonly qpdf?: string;
  readonly runner?: NativeRunner;
}
const native = (name: string) =>
  fileURLToPath(new URL(`../../native/${name}`, import.meta.url));
const FILTERS: Record<OfficeFormat, string> = {
  docx: 'writer_pdf_Export',
  pptx: 'impress_pdf_Export',
  xlsx: 'calc_pdf_Export',
};
const PROFILE = `<?xml version="1.0" encoding="UTF-8"?>
<oor:items xmlns:oor="http://openoffice.org/2001/registry">
<item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop><prop oor:name="DisableMacrosExecution" oor:op="fuse"><value>true</value></prop></item>
<item oor:path="/org.openoffice.Office.Common/Security/Links"><prop oor:name="UpdateDocMode" oor:op="fuse"><value>0</value></prop></item>
<item oor:path="/org.openoffice.Office.Calc/Content/Update"><prop oor:name="Link" oor:op="fuse"><value>0</value></prop></item>
</oor:items>`;

function inventory(stdout: string): { format: OfficeFormat; units: number } {
  let data: unknown;
  try {
    data = JSON.parse(stdout);
  } catch {
    throw new HeavyToolError('unsafe-document');
  }
  if (
    typeof data !== 'object' ||
    data === null ||
    !('format' in data) ||
    (data.format !== 'docx' &&
      data.format !== 'pptx' &&
      data.format !== 'xlsx') ||
    !('units' in data) ||
    typeof data.units !== 'number' ||
    !Number.isInteger(data.units) ||
    data.units < 0 ||
    data.units > 50 ||
    !('expandedBytes' in data) ||
    typeof data.expandedBytes !== 'number' ||
    !Number.isInteger(data.expandedBytes) ||
    data.expandedBytes < 1 ||
    data.expandedBytes > 64 * 1024 * 1024 ||
    (data.format === 'pptx' && data.units < 1) ||
    (data.format === 'xlsx' && (data.units < 1 || data.units > 20))
  )
    throw new HeavyToolError('unsafe-document');
  return { format: data.format, units: data.units };
}

export async function convertToPdf(
  input: string,
  declaredFormat: OfficeFormat | null,
  signal: AbortSignal,
  options: ConversionEngineOptions = {},
): Promise<{ path: string; metadata: ConversionMetadata }> {
  checkAbort(signal);
  const originalBytes = (await stat(input)).size;
  if (originalBytes > CONVERSION_POLICY.inputBytes)
    throw new HeavyToolError('file-too-large');
  if (originalBytes < 4) throw new HeavyToolError('unsupported-format');
  const directory = dirname(input),
    runner = options.runner ?? runNative;
  const run = (
    executable: string,
    args: string[],
    timeoutMs: number = CONVERSION_POLICY.timeoutMs,
  ) =>
    runner({
      executable,
      args,
      cwd: directory,
      signal,
      timeoutMs,
      limits: CONVERSION_POLICY.limits,
    });
  const python = options.python ?? 'python3';
  const inspected = await run(
    python,
    [native('inspect_office.py'), input],
    30_000,
  );
  if (inspected.exitCode === 3) throw new HeavyToolError('unsupported-format');
  if (inspected.exitCode !== 0) throw new HeavyToolError('unsafe-document');
  const facts = inventory(inspected.stdout);
  if (declaredFormat !== facts.format)
    throw new HeavyToolError('unsupported-format');
  const source = join(directory, `document.${facts.format}`);
  const profile = join(directory, 'office-profile');
  const outputDirectory = join(directory, 'converted');
  const output = join(outputDirectory, 'document.pdf');
  await rename(input, source);
  await mkdir(join(profile, 'user'), { recursive: true, mode: 0o700 });
  await mkdir(outputDirectory, { mode: 0o700 });
  await writeFile(join(profile, 'user', 'registrymodifications.xcu'), PROFILE, {
    flag: 'wx',
    mode: 0o600,
  });
  try {
    const exportOptions = {
      ExportFormFields: { type: 'boolean', value: 'false' },
      PDFViewSelection: { type: 'long', value: '3' },
      ...(facts.format === 'pptx'
        ? { ExportHiddenSlides: { type: 'boolean', value: 'true' } }
        : {}),
    };
    // Exec soffice.bin directly: no shell launcher, global profile or client options.
    // The inherited seccomp policy denies non-Unix sockets in every descendant.
    const result = await run(python, [
      native('office_sandbox.py'),
      options.libreoffice ?? '/usr/lib/libreoffice/program/soffice.bin',
      `-env:UserInstallation=${pathToFileURL(profile).href}`,
      '--headless',
      '--nologo',
      '--nodefault',
      '--norestore',
      '--convert-to',
      `pdf:${FILTERS[facts.format]}:${JSON.stringify(exportOptions)}`,
      '--outdir',
      outputDirectory,
      source,
    ]);
    if (result.exitCode !== 0) throw new HeavyToolError('conversion-failed');
    const outputBytes = await pdfHeader(output, CONVERSION_POLICY.outputBytes);
    const pages = await validatePdf(
      output,
      signal,
      run,
      options.qpdf ?? 'qpdf',
      CONVERSION_POLICY.pages,
    );
    if (facts.format === 'pptx' && pages !== facts.units)
      throw new HeavyToolError('conversion-failed');
    const independent = await run(
      python,
      [native('inspect_converted_pdf.py'), output],
      30_000,
    );
    const data: unknown = JSON.parse(independent.stdout);
    if (
      independent.exitCode !== 0 ||
      typeof data !== 'object' ||
      data === null ||
      !('pages' in data) ||
      data.pages !== pages ||
      (await stat(output)).size !== outputBytes
    )
      throw new HeavyToolError('conversion-failed');
    checkAbort(signal);
    return {
      path: output,
      metadata: {
        inputFormat: facts.format,
        originalBytes,
        outputBytes,
        pages,
      },
    };
  } catch (error) {
    checkAbort(signal);
    if (
      error instanceof HeavyToolError &&
      (error.code === 'cancelled' || error.code === 'processing-timeout')
    )
      throw error;
    throw new HeavyToolError('conversion-failed');
  }
}
