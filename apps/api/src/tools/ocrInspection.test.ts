import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { PDFDict, PDFDocument, PDFName, PDFString } from 'pdf-lib';

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
  if (
    ['scan', 'scan-local-link', 'mixed-page', 'mixed-document'].includes(kind)
  ) {
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
  if (
    ['uri-link', 'local-link', 'scan-local-link', 'passive-note'].includes(kind)
  )
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
            : kind === 'local-link' || kind === 'scan-local-link'
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
async function inspect(
  doc: PDFDocument,
  script = inspector,
  output?: PDFDocument,
) {
  const root = await mkdtemp(join(tmpdir(), 'kagaz-ocr-inventory-'));
  roots.push(root);
  const path = join(root, 'private-filename.pdf');
  await writeFile(path, await doc.save());
  const outputPath = join(root, 'output.pdf');
  if (output) await writeFile(outputPath, await output.save());
  const result = spawnSync(
    python,
    [
      script,
      path,
      ...(script === safety ? ['20'] : output ? [outputPath] : []),
    ],
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
    ['scan-local-link', 1, 0],
    ['local-link', 0, 1],
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
  it('keeps the shared safety scanner authoritative for simple local links', async () => {
    expect(await inspect(await fixture('local-link'), safety)).toEqual({
      code: 0,
      data: { pages: 1 },
    });
  });
  it.each(['destination', 'removed', 'rectangle', 'label', 'border'])(
    'rejects output that changes local-link %s while accepting an unchanged rewrite',
    async (change) => {
      const source = await fixture('local-link');
      source.addPage([960, 540]);
      const copy = await PDFDocument.load(await source.save());
      expect((await inspect(source, inspector, copy)).code).toBe(0);
      const page = copy.getPage(0);
      const link = page.node.Annots()!.lookup(0, PDFDict);
      if (change === 'destination')
        link
          .lookup(PDFName.of('A'), PDFDict)
          .set(PDFName.of('D'), copy.context.obj([copy.getPage(1).ref, 'Fit']));
      if (change === 'removed') page.node.delete(PDFName.of('Annots'));
      if (change === 'rectangle')
        link.set(PDFName.of('Rect'), copy.context.obj([40, 480, 500, 510]));
      if (change === 'label')
        link.set(
          PDFName.of('Contents'),
          PDFString.of('private synthetic changed label'),
        );
      if (change === 'border')
        link.set(PDFName.of('Border'), copy.context.obj([0, 0, 3]));
      expect(await inspect(source, inspector, copy)).toEqual({
        code: 1,
        data: null,
      });
    },
  );
  it('normalizes equivalent GoTo actions and direct page destinations across rewriting', async () => {
    const source = await fixture('local-link');
    const copy = await PDFDocument.load(await source.save());
    const link = copy.getPage(0).node.Annots()!.lookup(0, PDFDict);
    link.set(
      PDFName.of('Dest'),
      link.lookup(PDFName.of('A'), PDFDict).get(PDFName.of('D'))!,
    );
    link.delete(PDFName.of('A'));
    expect((await inspect(source, inspector, copy)).code).toBe(0);
  });
  it('accepts a standard internal-link border style and verifies its retention', async () => {
    const source = await fixture('local-link');
    source
      .getPage(0)
      .node.Annots()!
      .lookup(0, PDFDict)
      .set(
        PDFName.of('BS'),
        source.context.obj({ Type: 'Border', W: 1, S: 'D', D: [3, 2] }),
      );
    expect((await inspect(source)).code).toBe(0);
    const copy = await PDFDocument.load(await source.save());
    expect((await inspect(source, inspector, copy)).code).toBe(0);
    copy
      .getPage(0)
      .node.Annots()!
      .lookup(0, PDFDict)
      .lookup(PDFName.of('BS'), PDFDict)
      .set(PDFName.of('W'), copy.context.obj(2));
    expect((await inspect(source, inspector, copy)).code).toBe(1);
  });
  it.each([
    { name: 'transparent', color: [] },
    { name: 'grayscale', color: [0.25] },
    { name: 'RGB', color: [0.2, 0.4, 0.6] },
    { name: 'CMYK', color: [0.1, 0.2, 0.3, 0.4] },
  ])(
    'accepts a standard $name link color and verifies its retention',
    async ({ color }) => {
      const source = await fixture('local-link');
      source
        .getPage(0)
        .node.Annots()!
        .lookup(0, PDFDict)
        .set(PDFName.of('C'), source.context.obj(color));
      expect((await inspect(source)).code).toBe(0);
      const copy = await PDFDocument.load(await source.save());
      expect((await inspect(source, inspector, copy)).code).toBe(0);
      const changed = color.length
        ? color.map((value, index) => (index === 0 ? 1 - value : value))
        : [0];
      copy
        .getPage(0)
        .node.Annots()!
        .lookup(0, PDFDict)
        .set(PDFName.of('C'), copy.context.obj(changed));
      expect((await inspect(source, inspector, copy)).code).toBe(1);
    },
  );
  it.each([
    { name: 'two components', color: [0, 0] },
    { name: 'five components', color: [0, 0, 0, 0, 0] },
    { name: 'negative component', color: [-0.1] },
    { name: 'component above one', color: [1.1] },
    { name: 'nonnumeric component', color: [0, 'Invalid', 0] },
    { name: 'boolean component', color: [true] },
    { name: 'nonarray color', color: 'DeviceRGB' },
  ])('rejects a malformed link color with $name', async ({ color }) => {
    const source = await fixture('local-link');
    source
      .getPage(0)
      .node.Annots()!
      .lookup(0, PDFDict)
      .set(PDFName.of('C'), source.context.obj(color));
    expect(await inspect(source)).toEqual({
      code: 2,
      data: { rejection: 'annotations' },
    });
  });
  it.each([
    { W: -1 },
    { S: 'Unknown' },
    { D: [-1, 2] },
    { D: [0, 0] },
    { Unknown: 'private' },
    { Type: 'NotBorder' },
  ])('rejects malformed internal-link border styles %#', async (border) => {
    const source = await fixture('local-link');
    source
      .getPage(0)
      .node.Annots()!
      .lookup(0, PDFDict)
      .set(PDFName.of('BS'), source.context.obj(border));
    expect(await inspect(source)).toEqual({
      code: 2,
      data: { rejection: 'annotations' },
    });
  });
  it.each([
    'appearance',
    'named',
    'tagged',
    'invalid-rect',
    'invalid-destination',
    'unknown-key',
  ])('does not broaden compatibility to unsupported %s links', async (kind) => {
    const doc = await fixture('local-link');
    const link = doc.getPage(0).node.Annots()!.lookup(0, PDFDict);
    if (kind === 'appearance')
      link.set(
        PDFName.of('AP'),
        doc.context.obj({
          N: doc.context.register(doc.context.stream(new Uint8Array())),
        }),
      );
    if (kind === 'named')
      link
        .lookup(PDFName.of('A'), PDFDict)
        .set(PDFName.of('D'), PDFString.of('private synthetic destination'));
    if (kind === 'tagged')
      link.set(PDFName.of('StructParent'), doc.context.obj(0));
    if (kind === 'invalid-rect')
      link.set(PDFName.of('Rect'), doc.context.obj([0, 'Invalid', 100, 100]));
    if (kind === 'invalid-destination') {
      link.delete(PDFName.of('A'));
      link.set(
        PDFName.of('Dest'),
        doc.context.obj([doc.getPage(0).ref, 'FitR', 0]),
      );
    }
    if (kind === 'unknown-key')
      link.set(PDFName.of('UnsupportedLinkData'), doc.context.obj(1));
    expect(await inspect(doc)).toEqual({
      code: 2,
      data: { rejection: 'annotations' },
    });
  });
});
