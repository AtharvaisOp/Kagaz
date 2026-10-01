import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createScan } from './fixtures/createScan.js';
import { ocrPdf } from './ocr.js';
import { runNative } from './nativeRunner.js';
import { createTempWorkspace } from './workspace.js';

const binaries = {
  qpdf: process.env.QPDF_PATH ?? 'qpdf',
  ocrmypdf: process.env.OCRMYPDF_PATH ?? 'ocrmypdf',
  python: process.env.OCR_PYTHON_PATH ?? 'python3',
};
let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'kagaz-ocr-test-'));
});
afterEach(async () => {
  expect(await readdir(root)).toEqual([]);
  await rm(root, { recursive: true, force: true });
});
describe('real OCRmyPDF searchable output', () => {
  it.each([
    { name: 'clean black text', pages: 1 },
    { name: 'slightly rotated scan', quality: 'rotated' as const },
    { name: 'ten-page scan', pages: 10 },
    { name: 'mixed digital and scanned', digital: true, pages: 2 },
    { name: 'flattened graphic annotation and signature', marks: true },
    { name: 'scan plus blank page', blank: true },
    { name: 'reasonable low-quality scan', quality: 'low-quality' as const },
    { name: 'workspace cardinal rotation', rotation: 90 },
  ])(
    'validates $name and preserves visible content',
    async (fixture) => {
      const workspace = await createTempWorkspace(root);
      try {
        const input = await createScan(fixture);
        await writeFile(workspace.input, input);
        const start = performance.now();
        const result = await ocrPdf(
          workspace.input,
          workspace.output,
          new AbortController().signal,
          binaries,
        );
        const bytes = await readFile(result.path);
        expect(
          (
            await PDFDocument.load(bytes, { throwOnInvalidObject: true })
          ).getPageCount(),
        ).toBe(result.metadata.pages);
        expect(result.metadata.pagesOcred).toBe(fixture.pages ?? 1);
        expect(result.metadata.pagesSkipped).toBe(
          Number('digital' in fixture && fixture.digital) +
            Number('blank' in fixture && fixture.blank),
        );
        console.log(
          JSON.stringify({
            fixture: fixture.name,
            input: input.length,
            output: bytes.length,
            milliseconds: Math.round(performance.now() - start),
          }),
        );
      } finally {
        await workspace.cleanup();
      }
    },
    120_000,
  );
  it.each(['digital', 'blank'])(
    'does not rewrite a wholly %s PDF',
    async (kind) => {
      const workspace = await createTempWorkspace(root);
      try {
        const doc = await PDFDocument.create();
        const page = doc.addPage();
        if (kind === 'digital') page.drawText('Usable digital text');
        await writeFile(workspace.input, await doc.save());
        await expect(
          ocrPdf(
            workspace.input,
            workspace.output,
            new AbortController().signal,
            binaries,
          ),
        ).rejects.toMatchObject({ code: 'no-ocr-needed' });
      } finally {
        await workspace.cleanup();
      }
    },
    30_000,
  );
  it('rejects malformed, encrypted and excessive-dimension inputs before OCR', async () => {
    const workspace = await createTempWorkspace(root);
    try {
      await writeFile(workspace.input, '%PDF-1.7\nmalformed');
      await expect(
        ocrPdf(
          workspace.input,
          workspace.output,
          new AbortController().signal,
          binaries,
        ),
      ).rejects.toMatchObject({ code: 'invalid-pdf' });
      const doc = await PDFDocument.create();
      doc.addPage([2000, 720]);
      await writeFile(workspace.input, await doc.save());
      await expect(
        ocrPdf(
          workspace.input,
          workspace.output,
          new AbortController().signal,
          binaries,
        ),
      ).rejects.toMatchObject({ code: 'unsupported-pdf' });
      const encrypted = await runNative({
        executable: binaries.qpdf,
        args: [
          '--encrypt',
          '',
          'owner',
          '256',
          '--',
          workspace.input,
          workspace.output,
        ],
        cwd: workspace.directory,
        signal: new AbortController().signal,
      });
      expect(encrypted.exitCode).toBe(0);
      await expect(
        ocrPdf(
          workspace.output,
          join(workspace.directory, 'encrypted-out.pdf'),
          new AbortController().signal,
          binaries,
        ),
      ).rejects.toMatchObject({ code: 'unsupported-pdf' });
    } finally {
      await workspace.cleanup();
    }
  }, 30_000);
});
