import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  PDFDocument,
  PDFName,
  PDFString,
  concatTransformationMatrix,
  drawObject,
  popGraphicsState,
  pushGraphicsState,
} from 'pdf-lib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CompressionPreset } from '@kagaz/shared-types';
import { compressPdf } from './compress.js';
import { createTempWorkspace } from './workspace.js';
import { runNative } from './nativeRunner.js';

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'kagaz-integration-'));
});
afterEach(async () => {
  expect(await readdir(root)).toEqual([]);
  await rm(root, { recursive: true, force: true });
});
const binaries = {
  gs: process.env.GHOSTSCRIPT_PATH ?? 'gs',
  qpdf: process.env.QPDF_PATH ?? 'qpdf',
  python: process.env.OCR_PYTHON_PATH ?? 'python3',
};

describe('real Ghostscript and qpdf', () => {
  it.each(['JavaScript', 'URI'])(
    'rejects a direct nested %s action before compression or unchanged fallback',
    async (action) => {
      const workspace = await createTempWorkspace(root);
      try {
        const doc = await PDFDocument.create();
        doc.addPage().drawText('Safe visual content with unsafe hidden action');
        doc.catalog.set(
          PDFName.of('OpenAction'),
          doc.context.obj({
            S: action,
            ...(action === 'JavaScript'
              ? { JS: PDFString.of('app.alert("synthetic fixture")') }
              : { URI: PDFString.of('https://example.invalid/fixture') }),
          }),
        );
        await writeFile(workspace.input, await doc.save());
        await expect(
          compressPdf(
            workspace.input,
            workspace.output,
            'high-quality',
            new AbortController().signal,
            binaries,
          ),
        ).rejects.toMatchObject({ code: 'unsupported-pdf' });
        expect(await readdir(workspace.directory)).toEqual(['input.pdf']);
      } finally {
        await workspace.cleanup();
      }
    },
    15_000,
  );
  it.each<CompressionPreset>(['high-quality', 'balanced', 'maximum'])(
    'validates and compresses image content using %s',
    async (preset) => {
      const workspace = await createTempWorkspace(root);
      try {
        const doc = await PDFDocument.create();
        const page = doc.addPage([500, 400]);
        page.drawText('Current flattened PDF', { x: 30, y: 360 });
        const pixels = new Uint8Array(900 * 900 * 3);
        let seed = 12345;
        for (let index = 0; index < pixels.length; index++) {
          seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
          pixels[index] = seed >>> 24;
        }
        const ref = doc.context.register(
          doc.context.stream(pixels, {
            Type: 'XObject',
            Subtype: 'Image',
            Width: 900,
            Height: 900,
            ColorSpace: 'DeviceRGB',
            BitsPerComponent: 8,
          }),
        );
        const name = page.node.newXObject('Photo', ref);
        page.pushOperators(
          pushGraphicsState(),
          concatTransformationMatrix(420, 0, 0, 300, 30, 30),
          drawObject(name),
          popGraphicsState(),
        );
        const input = await doc.save();
        await writeFile(workspace.input, input);
        const started = performance.now();
        const result = await compressPdf(
          workspace.input,
          workspace.output,
          preset,
          new AbortController().signal,
          binaries,
        );
        const output = await readFile(result.path);
        expect(
          (
            await PDFDocument.load(output, { throwOnInvalidObject: true })
          ).getPageCount(),
        ).toBe(1);
        expect(output.length).toBeLessThanOrEqual(input.length);
        if (preset !== 'high-quality')
          expect(result.metadata.outcome).toBe('compressed');
        // Inspect the real derivative even if the policy returns the smaller input.
        expect(
          (
            await PDFDocument.load(await readFile(workspace.output), {
              throwOnInvalidObject: true,
            })
          ).getPageCount(),
        ).toBe(1);
        console.log(
          JSON.stringify({
            preset,
            input: input.length,
            output: output.length,
            milliseconds: Math.round(performance.now() - started),
          }),
        );
      } finally {
        await workspace.cleanup();
      }
    },
    15_000,
  );
  it('rejects malformed real PDF structures and encrypted PDFs including empty-password encryption', async () => {
    const workspace = await createTempWorkspace(root);
    try {
      await writeFile(workspace.input, '%PDF-1.7\ninvalid structure\n%%EOF');
      await expect(
        compressPdf(
          workspace.input,
          workspace.output,
          'balanced',
          new AbortController().signal,
          binaries,
        ),
      ).rejects.toMatchObject({ code: 'invalid-pdf' });
      const doc = await PDFDocument.create();
      doc.addPage();
      await writeFile(workspace.input, await doc.save());
      const encryption = await runNative({
        executable: binaries.qpdf,
        args: [
          '--encrypt',
          '',
          'owner-password',
          '256',
          '--',
          workspace.input,
          workspace.output,
        ],
        cwd: workspace.directory,
        signal: new AbortController().signal,
      });
      expect(encryption.exitCode).toBe(0);
      await expect(
        compressPdf(
          workspace.output,
          join(workspace.directory, 'derivative.pdf'),
          'balanced',
          new AbortController().signal,
          binaries,
        ),
      ).rejects.toMatchObject({ code: 'unsupported-pdf' });
    } finally {
      await workspace.cleanup();
    }
  }, 15_000);
});
