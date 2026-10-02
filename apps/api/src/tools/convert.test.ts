import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, open, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { OfficeFormat } from '@kagaz/shared-types';
import { afterEach, describe, expect, it } from 'vitest';
import {
  officeAttack,
  officeFixture,
  OFFICE_ATTACKS,
} from '../../../../scripts/office-fixtures.mjs';
import { convertToPdf } from './convert.js';
import { HeavyToolError } from './errors.js';
import type { NativeRequest, NativeRunner } from './nativeRunner.js';
import { runNative } from './nativeRunner.js';

const inspector = fileURLToPath(
  new URL('../../native/inspect_office.py', import.meta.url),
);
const python = process.env.OCR_PYTHON_PATH ?? 'python3';
let roots: string[] = [];

async function temporaryDirectory() {
  const path = await mkdtemp(join(tmpdir(), 'kagaz-convert-test-'));
  roots.push(path);
  return path;
}

afterEach(async () => {
  await Promise.all(
    roots.map((path) => rm(path, { recursive: true, force: true })),
  );
  roots = [];
});

async function inspect(bytes: Buffer) {
  const directory = await temporaryDirectory();
  const path = join(directory, 'input.docx');
  await writeFile(path, bytes);
  const result = spawnSync(python, [inspector, path], {
    encoding: 'utf8',
    timeout: 30_000,
    maxBuffer: 32 * 1024,
    windowsHide: true,
  });
  if (result.error) throw result.error;
  return {
    exitCode: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

describe('bounded OOXML structural inspection', () => {
  it.each([
    ['paragraphs.docx', 'docx', 0],
    ['image-page-break.docx', 'docx', 0],
    ['slides.pptx', 'pptx', 3],
    ['sheet.xlsx', 'xlsx', 1],
    ['sheets.xlsx', 'xlsx', 2],
  ] as const)(
    'detects the actual package family for %s',
    async (name, format, units) => {
      const result = await inspect(await officeFixture(name));
      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({ format, units });
      expect(result.stderr).toBe('');
    },
  );

  it.each(OFFICE_ATTACKS)(
    'rejects unsafe or malformed OOXML: %s',
    async (attack) => {
      const result = await inspect(await officeAttack(attack));
      expect(result.exitCode).not.toBe(0);
      expect(result.stdout).toBe('');
      expect(result.stderr).toBe('');
    },
    20_000,
  );

  it('classifies non-ZIP input as unsupported and malformed ZIP input as unsafe', async () => {
    const legacy = await inspect(await officeAttack('legacy-encryption'));
    expect(legacy.exitCode).toBe(3);
    const result = await inspect(await officeAttack('malformed-zip'));
    expect(result.exitCode).toBe(2);
  });
});

interface FakeNativeOptions {
  readonly format?: OfficeFormat;
  readonly units?: number;
  readonly pages?: number;
  readonly pdf?: Buffer;
  readonly conversionExitCode?: number;
  readonly timeout?: boolean;
  readonly omitOutput?: boolean;
  readonly encrypted?: boolean;
  readonly qpdfExitCode?: number;
  readonly independentExitCode?: number;
  readonly oversized?: boolean;
}

function nativeRunner(
  options: FakeNativeOptions = {},
  calls: NativeRequest[] = [],
): NativeRunner {
  return async (request) => {
    calls.push(request);
    const script = request.args[0] ?? '';
    if (script.endsWith('inspect_office.py')) {
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          format: options.format ?? 'docx',
          units: options.units ?? 0,
          expandedBytes: 1000,
        }),
        stderr: 'private diagnostic is not returned',
      };
    }
    if (script.endsWith('office_sandbox.py')) {
      if (options.timeout) throw new HeavyToolError('processing-timeout');
      if (!options.omitOutput && options.conversionExitCode !== 1) {
        const outputDirectory =
          request.args[request.args.indexOf('--outdir') + 1]!;
        await mkdir(outputDirectory, { recursive: true });
        const outputPath = outputDirectory + '/document.pdf';
        await writeFile(
          outputPath,
          options.pdf ?? Buffer.from('%PDF-1.7\nsynthetic'),
        );
        if (options.oversized) {
          const file = await open(outputPath, 'r+');
          await file.truncate(40 * 1024 * 1024 + 1);
          await file.close();
        }
      }
      return {
        exitCode: options.conversionExitCode ?? 0,
        stdout: '',
        stderr: 'private diagnostic',
      };
    }
    if (request.executable.endsWith('qpdf')) {
      if (request.args[0] === '--is-encrypted')
        return { exitCode: options.encrypted ? 0 : 2, stdout: '', stderr: '' };
      if (request.args[0] === '--check')
        return { exitCode: options.qpdfExitCode ?? 0, stdout: '', stderr: '' };
      if (request.args[0] === '--show-npages')
        return { exitCode: 0, stdout: `${options.pages ?? 1}\n`, stderr: '' };
    }
    if (script.endsWith('inspect_converted_pdf.py'))
      return {
        exitCode: options.independentExitCode ?? 0,
        stdout: JSON.stringify({ pages: options.pages ?? 1 }),
        stderr: '',
      };
    throw new Error('Unexpected native command');
  };
}

async function convertFixture(
  format: OfficeFormat = 'docx',
  options: FakeNativeOptions = {},
  calls: NativeRequest[] = [],
) {
  const directory = await temporaryDirectory();
  const input = join(directory, 'input.pdf');
  await writeFile(
    input,
    await officeFixture(
      format === 'docx'
        ? 'paragraphs.docx'
        : format === 'pptx'
          ? 'slides.pptx'
          : 'sheet.xlsx',
    ),
  );
  return convertToPdf(input, format, new AbortController().signal, {
    python: 'server-python',
    libreoffice: '/server/soffice.bin',
    qpdf: 'server-qpdf',
    runner: nativeRunner({ format, ...options }, calls),
  });
}

describe('LibreOffice conversion policy', () => {
  it.each([
    ['docx', 'writer_pdf_Export'],
    ['pptx', 'impress_pdf_Export'],
    ['xlsx', 'calc_pdf_Export'],
  ] as const)(
    'uses a fixed %s export filter and a fresh request profile',
    async (format, filter) => {
      const calls: NativeRequest[] = [];
      const result = await convertFixture(
        format,
        {
          units: format === 'pptx' ? 3 : format === 'xlsx' ? 1 : 0,
          pages: format === 'pptx' ? 3 : 1,
        },
        calls,
      );
      await convertFixture(
        format,
        {
          units: format === 'pptx' ? 3 : format === 'xlsx' ? 1 : 0,
          pages: format === 'pptx' ? 3 : 1,
        },
        calls,
      );
      expect(result.metadata.inputFormat).toBe(format);
      expect(result.metadata.pages).toBe(format === 'pptx' ? 3 : 1);
      const conversion = calls.find((call) =>
        call.args[0]?.endsWith('office_sandbox.py'),
      );
      expect(conversion).toBeDefined();
      expect(conversion?.executable).toBe('server-python');
      expect(conversion?.args).toContain('/server/soffice.bin');
      expect(conversion?.args).toContain('--headless');
      expect(conversion?.args).toContain('--nologo');
      expect(conversion?.args).toContain('--nodefault');
      expect(conversion?.args).toContain('--norestore');
      const filterArgument =
        conversion?.args[conversion.args.indexOf('--convert-to') + 1] ?? '';
      expect(filterArgument.startsWith(`pdf:${filter}:`)).toBe(true);
      const filterOptions = JSON.parse(
        filterArgument.slice(filterArgument.indexOf('{')),
      ) as Record<string, unknown>;
      expect(filterOptions['ExportFormFields']).toEqual({
        type: 'boolean',
        value: 'false',
      });
      expect(filterOptions['PDFViewSelection']).toEqual({
        type: 'long',
        value: '3',
      });
      expect(filterOptions['ExportHiddenSlides']).toEqual(
        format === 'pptx' ? { type: 'boolean', value: 'true' } : undefined,
      );
      const profile = calls
        .filter((call) => call.args[0]?.endsWith('office_sandbox.py'))
        .map((call) =>
          call.args.find((argument) =>
            argument.startsWith('-env:UserInstallation='),
          ),
        );
      expect(profile).toHaveLength(2);
      expect(profile[0]).toBeDefined();
      expect(profile[0]).not.toBe(profile[1]);
      expect(conversion?.args).not.toContain('--convert-to-pdf');
      expect(conversion?.limits?.addressSpace).toBe(768 * 1024 * 1024);
      expect(conversion?.limits?.fileBytes).toBe(40 * 1024 * 1024);
      expect(conversion?.timeoutMs).toBe(120_000);
      expect(conversion?.args.join(' ')).not.toContain('private diagnostic');
    },
  );

  it('does not let the filename extension override the inspected package family', async () => {
    const directory = await temporaryDirectory();
    const input = join(directory, 'input.pdf');
    await writeFile(input, await officeFixture('sheet.xlsx'));
    const calls: NativeRequest[] = [];
    await expect(
      convertToPdf(input, 'docx', new AbortController().signal, {
        runner: nativeRunner({ format: 'xlsx', units: 1 }, calls),
      }),
    ).rejects.toMatchObject({ code: 'unsupported-format' });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.args[0]).toContain('inspect_office.py');
  });

  it('fails closed on native failure, missing or corrupt output, qpdf failure, and bad independent reload', async () => {
    const cases: readonly FakeNativeOptions[] = [
      { conversionExitCode: 1 },
      { omitOutput: true },
      { pdf: Buffer.from('not a PDF file') },
      { qpdfExitCode: 3 },
      { independentExitCode: 1 },
      { pages: 51 },
      { pages: 0 },
      { encrypted: true },
    ];
    for (const nativeOptions of cases) {
      await expect(convertFixture('docx', nativeOptions)).rejects.toMatchObject(
        { code: 'conversion-failed' },
      );
    }
  });

  it('preserves the native deadline error as a typed timeout', async () => {
    await expect(
      convertFixture('docx', { timeout: true }),
    ).rejects.toMatchObject({ code: 'processing-timeout' });
  });

  it('rejects slide count mismatch and files larger than the output bound', async () => {
    await expect(
      convertFixture('pptx', { units: 3, pages: 2 }),
    ).rejects.toMatchObject({ code: 'conversion-failed' });
    await expect(
      convertFixture('docx', { oversized: true }),
    ).rejects.toMatchObject({ code: 'conversion-failed' });
  });

  it('propagates cancellation without exposing native diagnostics', async () => {
    const directory = await temporaryDirectory();
    const input = join(directory, 'input.pdf');
    await writeFile(input, await officeFixture('paragraphs.docx'));
    const controller = new AbortController();
    const runner: NativeRunner = (request) =>
      new Promise((_resolve, reject) => {
        const rejectCancelled = () => {
          const reason: unknown = request.signal.reason;
          reject(
            reason instanceof Error ? reason : new HeavyToolError('cancelled'),
          );
        };
        if (request.signal.aborted) {
          rejectCancelled();
          return;
        }
        request.signal.addEventListener('abort', rejectCancelled, {
          once: true,
        });
      });
    const work = convertToPdf(input, 'docx', controller.signal, { runner });
    controller.abort(new HeavyToolError('cancelled'));
    await expect(work).rejects.toMatchObject({ code: 'cancelled' });
  });

  it.skipIf(process.platform !== 'linux')(
    'keeps Unix profile sockets but blocks network sockets in the native sandbox',
    async () => {
      const directory = await temporaryDirectory();
      const probe = join(directory, 'socket-probe.py');
      await writeFile(
        probe,
        [
          'import socket',
          'left, right = socket.socketpair(socket.AF_UNIX, socket.SOCK_STREAM)',
          'left.close(); right.close()',
          'try:',
          '    socket.socket(socket.AF_INET, socket.SOCK_STREAM)',
          'except OSError:',
          '    print("unix-ok;internet-blocked")',
          'else:',
          '    print("internet-available")',
        ].join('\n'),
      );
      const result = await runNative({
        executable: process.env.OCR_PYTHON_PATH ?? 'python3',
        args: [
          fileURLToPath(
            new URL('../../native/office_sandbox.py', import.meta.url),
          ),
          process.env.OCR_PYTHON_PATH ?? 'python3',
          probe,
        ],
        cwd: directory,
        signal: new AbortController().signal,
        timeoutMs: 10_000,
        resourceLimits: false,
      });
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe('unix-ok;internet-blocked');
    },
  );
});
