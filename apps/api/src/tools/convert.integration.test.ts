import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { OfficeFormat } from '@kagaz/shared-types';
import { describe, expect, it } from 'vitest';
import { officeFixture } from '../../../../scripts/office-fixtures.mjs';
import { convertToPdf } from './convert.js';

const python = process.env.OCR_PYTHON_PATH ?? 'python3';
const libreoffice =
  process.env.LIBREOFFICE_PATH ?? '/usr/lib/libreoffice/program/soffice.bin';
const qpdf = process.env.QPDF_PATH ?? 'qpdf';
const cases: readonly {
  readonly name: string;
  readonly format: OfficeFormat;
  readonly pages: number;
}[] = [
  { name: 'paragraphs.docx', format: 'docx', pages: 1 },
  { name: 'image-page-break.docx', format: 'docx', pages: 2 },
  { name: 'slides.pptx', format: 'pptx', pages: 3 },
  { name: 'sheet.xlsx', format: 'xlsx', pages: 1 },
  { name: 'sheets.xlsx', format: 'xlsx', pages: 2 },
];

describe.skipIf(process.platform !== 'linux')(
  'real headless Office conversion',
  () => {
    it.each(cases)(
      '$name converts to a validated PDF with the expected page count',
      async ({ name, format, pages }) => {
        const root = await mkdtemp(join(tmpdir(), 'kagaz-convert-native-'));
        try {
          const input = join(root, 'input.pdf');
          const source = await officeFixture(name);
          await writeFile(input, source);
          const result = await convertToPdf(
            input,
            format,
            new AbortController().signal,
            {
              python,
              libreoffice,
              qpdf,
            },
          );
          const output = await readFile(result.path);
          expect(output.subarray(0, 5).toString('ascii')).toBe('%PDF-');
          expect(result.metadata).toMatchObject({
            inputFormat: format,
            originalBytes: source.byteLength,
            outputBytes: output.byteLength,
            pages,
          });
          expect((await stat(result.path)).size).toBeLessThanOrEqual(
            40 * 1024 * 1024,
          );
        } finally {
          await rm(root, {
            recursive: true,
            force: true,
            maxRetries: 3,
            retryDelay: 100,
          });
        }
      },
      180_000,
    );
  },
);
