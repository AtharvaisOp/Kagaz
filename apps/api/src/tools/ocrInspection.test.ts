import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { PDFDocument, PDFName, PDFString } from 'pdf-lib';

const python = process.env.OCR_PYTHON_PATH ?? 'python3';
const inspector = fileURLToPath(
  new URL('../../native/inspect_ocr.py', import.meta.url),
);
const safety = fileURLToPath(
  new URL('../../native/inspect_pdf.py', import.meta.url),
);
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
async function fixture(kind: string) {
  const doc = await PDFDocument.create();
  const page = doc.addPage(kind === 'dimensions' ? [1009, 540] : [960, 540]);
  if (
    [
      'digital',
      'mixed-page',
      'uri-link',
      'local-link',
      'passive-note',
      'tagged',
    ].includes(kind)
  )
    page.drawText('Synthetic presentation heading with selectable characters', {
      x: 30,
      y: 490,
      size: 18,
    });
  if (['scan', 'mixed-page', 'mixed-document'].includes(kind)) {
    const image = await doc.embedPng(
      await readFile(new URL('./fixtures/english-scan.png', import.meta.url)),
    );
    page.drawImage(image, { x: 30, y: 20, width: 576, height: 432 });
    if (kind === 'mixed-document')
      doc.addPage([960, 540]).drawText('Digital slide', { x: 30, y: 490 });
  }
  if (kind === 'outlined')
    page.drawSvgPath('M 30 30 L 30 80 L 60 30 L 60 80', {
      x: 0,
      y: 120,
      borderWidth: 3,
    });
  if (kind === 'tagged')
    doc.catalog.set(
      PDFName.of('SyntheticMetadata'),
      doc.context.obj({ Type: 'StructElem', S: 'P', A: { O: 'Layout' } }),
    );
  if (['uri-link', 'local-link', 'passive-note'].includes(kind))
    page.node.set(
      PDFName.of('Annots'),
      doc.context.obj([
        {
          Type: 'Annot',
          Subtype: kind === 'passive-note' ? 'Text' : 'Link',
          Rect: [30, 480, 500, 510],
          ...(kind === 'uri-link'
            ? {
                A: {
                  S: 'URI',
                  URI: PDFString.of('https://example.invalid/synthetic'),
                },
              }
            : kind === 'local-link'
              ? { A: { S: 'GoTo', D: [page.ref, 'Fit'] } }
              : { Contents: PDFString.of('private synthetic annotation') }),
        },
      ]),
    );
  if (kind === 'image-budget') {
    const image = doc.context.register(
      doc.context.stream(new Uint8Array(), {
        Type: 'XObject',
        Subtype: 'Image',
        Width: 4001,
        Height: 4000,
        BitsPerComponent: 8,
        ColorSpace: 'DeviceGray',
      }),
    );
    page.node.set(
      PDFName.of('Resources'),
      doc.context.obj({ XObject: { Huge: image } }),
    );
  }
  if (kind === 'raster-budget') {
    const image = await doc.embedPng(
      await readFile(new URL('./fixtures/english-scan.png', import.meta.url)),
    );
    page.drawImage(image, { x: 30, y: 20, width: 10, height: 10 });
  }
  if (kind === 'javascript')
    doc.catalog.set(
      PDFName.of('OpenAction'),
      doc.context.obj({
        S: 'JavaScript',
        JS: PDFString.of('private synthetic script'),
      }),
    );
  return doc;
}
async function inspect(doc: PDFDocument, script = inspector) {
  const root = await mkdtemp(join(tmpdir(), 'kagaz-ocr-inventory-'));
  roots.push(root);
  const path = join(root, 'private-filename.pdf');
  await writeFile(path, await doc.save());
  const result = spawnSync(
    python,
    [script, path, ...(script === safety ? ['20'] : [])],
    {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 30_000,
      maxBuffer: 16 * 1024,
    },
  );
  if (result.error) throw result.error;
  expect(result.stderr).toBe('');
  for (const secret of [
    root,
    'private-filename',
    'private synthetic',
    'example.invalid',
  ])
    expect(result.stdout).not.toContain(secret);
  return {
    code: result.status,
    data: result.stdout ? (JSON.parse(result.stdout) as unknown) : null,
  };
}
describe('real bounded OCR source inspection', () => {
  it.each([
    ['digital', 0, 1],
    ['mixed-page', 0, 1],
    ['scan', 1, 0],
    ['mixed-document', 1, 1],
    ['outlined', 1, 0],
    ['blank', 0, 1],
    ['tagged', 0, 1],
  ] as const)(
    'classifies %s without equating text presence with editability',
    async (kind, pagesOcred, pagesSkipped) => {
      expect(await inspect(await fixture(kind))).toEqual({
        code: 0,
        data: { pages: pagesOcred + pagesSkipped, pagesOcred, pagesSkipped },
      });
    },
  );
  it.each([
    ['uri-link', 'unsafe-structure'],
    ['javascript', 'unsafe-structure'],
    ['local-link', 'annotations'],
    ['passive-note', 'annotations'],
    ['dimensions', 'page-dimensions'],
    ['image-budget', 'image-budget'],
    ['raster-budget', 'raster-budget'],
  ])('identifies the exact rejection stage for %s', async (kind, rejection) => {
    expect(await inspect(await fixture(kind))).toEqual({
      code: 2,
      data: { rejection },
    });
  });
  it('proves the local link is structurally safe but outside OCR annotation-retention verification', async () => {
    expect(await inspect(await fixture('local-link'), safety)).toEqual({
      code: 0,
      data: { pages: 1 },
    });
  });
});
