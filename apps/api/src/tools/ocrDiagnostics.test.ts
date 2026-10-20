import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ocrPdf } from './ocr.js';
import { readOcrRejection, type OcrDiagnostic } from './ocrDiagnostics.js';
import type { NativeRunner } from './nativeRunner.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
const good: NativeRunner = (request) =>
  Promise.resolve({
    exitCode: request.args[0] === '--is-encrypted' ? 2 : 0,
    stderr: 'private-native-dump',
    stdout:
      request.args[0] === '--show-npages'
        ? '1'
        : request.args[0] === '--json'
          ? '{"acroform":{"hasacroform":false}}'
          : '{"pages":1,"pagesOcred":0,"pagesSkipped":1}',
  });

describe('fixed OCR rejection-stage diagnostics', () => {
  it.each([
    'encrypted',
    'page-limit',
    'interactive-forms',
    'unsafe-structure',
    'annotations',
    'page-dimensions',
    'image-budget',
    'raster-budget',
    'resource-budget',
    'no-ocr-needed',
  ])(
    'identifies %s without recording document or native data',
    async (category) => {
      const root = await mkdtemp(join(tmpdir(), 'kagaz-ocr-diagnostic-'));
      roots.push(root);
      const input = join(root, 'private-filename.pdf');
      await writeFile(input, '%PDF-1.7 private synthetic text');
      const diagnostics: OcrDiagnostic[] = [];
      const runner = vi.fn<NativeRunner>(async (request) => {
        if (category === 'encrypted' && request.args[0] === '--is-encrypted')
          return { exitCode: 0, stdout: '', stderr: 'private-native-dump' };
        if (category === 'page-limit' && request.args[0] === '--show-npages')
          return { exitCode: 0, stdout: '21', stderr: '' };
        if (category === 'interactive-forms' && request.args[0] === '--json')
          return {
            exitCode: 0,
            stdout: '{"acroform":{"hasacroform":true}}',
            stderr: '',
          };
        if (
          ![
            'encrypted',
            'page-limit',
            'interactive-forms',
            'no-ocr-needed',
          ].includes(category) &&
          request.executable === 'python3'
        )
          return {
            exitCode: 2,
            stdout: JSON.stringify({
              rejection: category,
              filename: 'private-filename.pdf',
              text: 'private synthetic text',
            }),
            stderr: 'private-native-dump',
          };
        return good(request);
      });
      await expect(
        ocrPdf(input, join(root, 'output.pdf'), new AbortController().signal, {
          runner,
          ocrDiagnosticSink: (value) => diagnostics.push(value),
        }),
      ).rejects.toMatchObject({
        code:
          category === 'no-ocr-needed' ? 'no-ocr-needed' : 'unsupported-pdf',
      });
      expect(diagnostics).toEqual([
        {
          event: 'ocr.request.rejected',
          stage: ['encrypted', 'page-limit', 'interactive-forms'].includes(
            category,
          )
            ? 'input-validation'
            : 'source-inspection',
          category,
        },
      ]);
      const serialized = JSON.stringify(diagnostics);
      for (const privateValue of [
        root,
        'private-filename',
        'private synthetic text',
        'private-native-dump',
      ])
        expect(serialized).not.toContain(privateValue);
      expect(
        runner.mock.calls.some(
          ([request]) => request.executable === 'ocrmypdf',
        ),
      ).toBe(false);
    },
  );
  it.each([
    '{"rejection":"/private/path.pdf"}',
    '{"rejection":{"text":"private"}}',
    '{bad',
    'private native dump',
  ])('never promotes arbitrary native stdout into a category', (stdout) => {
    expect(readOcrRejection(stdout)).toBe('inspection-rejected');
  });
  it('a broken logger never changes rejection behavior', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kagaz-ocr-diagnostic-'));
    roots.push(root);
    const input = join(root, 'input.pdf');
    await writeFile(input, '%PDF-1.7 synthetic');
    await expect(
      ocrPdf(input, join(root, 'output.pdf'), new AbortController().signal, {
        runner: good,
        ocrDiagnosticSink: () => {
          throw new Error('private logger failure');
        },
      }),
    ).rejects.toMatchObject({ code: 'no-ocr-needed' });
  });
});
