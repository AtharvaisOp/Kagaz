import { describe, expect, it, vi } from 'vitest';
import {
  PDFDocument,
  PDFArray,
  PDFDict,
  PDFName,
  PDFNumber,
  PDFRawStream,
  degrees,
  decodePDFRawStream,
} from 'pdf-lib';
import type {
  WatermarkConfig,
  TextWatermarkConfig,
} from '../../../features/pdf-watermarks/model/types';
import { createDefaultWatermark } from '../../../features/pdf-watermarks/model/watermark';
import type { ExportWorkspaceRequest } from '../types';
import { exportWorkspace } from '../exportWorkspace';
import {
  createWatermarkExportContext,
  createWatermarkGeometryValidator,
  createWatermarkPreviewPdf,
  drawWatermarkOnPage,
  validateWatermarkPageGeometry,
  validateWatermarkText,
} from './renderWatermark';
import { createAnnotationExportContext } from '../annotations/flattenAnnotations';

// Node has no image decoder/canvas. Native decode and trust/cleanup are exercised
// in nativeImage.test and the real-browser verifier; these fixtures are known PNGs.
vi.mock('./nativeImage', () => ({
  prepareWatermarkImageSource: vi.fn((source: unknown) =>
    Promise.resolve(source),
  ),
}));

const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
const textConfig = createDefaultWatermark('watermark') as TextWatermarkConfig;
const png = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAEUlEQVR4nGP4z8DQwMDwnwEADH8Cf4i6MZwAAAAASUVORK5CYII=',
  ),
  (value) => value.charCodeAt(0),
);
const asset = {
  assetId: 'watermark-image',
  mimeType: 'image/png' as const,
  bytes: png,
};

async function requestFor(
  count = 1,
  rotation = 0,
): Promise<ExportWorkspaceRequest> {
  const source = await PDFDocument.create();
  for (let index = 0; index < count; index += 1) {
    const page = source.addPage([500, 400]);
    page.setRotation(degrees(rotation));
    page.drawText(`PUBLIC-PAGE-${index}`, { x: 30, y: 20, size: 10 });
  }
  const bytes = await source.save();
  const buffer = new ArrayBuffer(bytes.length);
  new Uint8Array(buffer).set(bytes);
  const file = new File([buffer], 'watermark.pdf', { type: 'application/pdf' });
  return {
    pages: Array.from({ length: count }, (_, index) => ({
      id: `p${index}`,
      sourceDocumentId: 'source',
      sourcePageIndex: index,
      rotationDelta: 0,
    })),
    sources: new Map([['source', { id: 'source', file, fileName: file.name }]]),
    forms: {
      sources: [
        { sourceDocumentId: 'source', capability: 'plain', fields: [] },
      ],
      hasChangedTextDraft: false,
    },
    annotationsByPage: new Map(),
    imageAssets: new Map(),
  };
}

async function inspectText(bytes: Uint8Array): Promise<string[]> {
  const task = pdfjs.getDocument({ data: bytes.slice() });
  try {
    const document = await task.promise;
    const texts: string[] = [];
    for (let index = 1; index <= document.numPages; index += 1) {
      const page = await document.getPage(index);
      const content = await page.getTextContent();
      texts.push(
        content.items.map((item) => ('str' in item ? item.str : '')).join(''),
      );
      page.cleanup();
    }
    return texts;
  } finally {
    await task.destroy();
  }
}

function pageOperators(document: PDFDocument, index = 0): string {
  const contents = document.getPage(index).node.Contents();
  const streams =
    contents instanceof PDFArray
      ? contents.asArray()
      : contents
        ? [contents]
        : [];
  return streams
    .map((ref) => {
      const stream = document.context.lookup(ref);
      return stream instanceof PDFRawStream
        ? new TextDecoder().decode(decodePDFRawStream(stream).decode())
        : '';
    })
    .join('\n');
}

describe('watermark rendering and workspace export', () => {
  it('preserves ordinary source text and emits watermark as foreground text after annotations', async () => {
    const request = await requestFor();
    const output = await exportWorkspace({
      ...request,
      watermark: { ...textConfig, text: 'WATERMARK-ALPHA' },
      annotationsByPage: new Map([
        [
          'p0',
          [
            {
              id: 'ordinary',
              workspacePageId: 'p0',
              kind: 'text',
              box: {
                origin: { x: 20, y: 80 },
                width: 200,
                height: 40,
                rotation: 0,
              },
              text: 'ANNOTATION-BETA',
              fontFamily: 'helvetica',
              fontSizeUserUnits: 12,
              lineHeight: 1.2,
              align: 'left',
              color: { r: 0, g: 0, b: 0 },
              opacity: 1,
            },
          ],
        ],
      ]),
    });
    expect(await inspectText(output)).toEqual([
      'PUBLIC-PAGE-0ANNOTATION-BETAWATERMARK-ALPHA',
    ]);
    const loaded = await PDFDocument.load(output, {
      throwOnInvalidObject: true,
    });
    expect(loaded.getPage(0).node.Annots()?.size() ?? 0).toBe(0);
    expect(loaded.getForm().getFields()).toHaveLength(0);
  });
  it.each([0, 0.3, 1])(
    'exports opacity %s as an explicit graphics state without corrupting text',
    async (opacity) => {
      const bytes = await exportWorkspace({
        ...(await requestFor()),
        watermark: { ...textConfig, opacity },
      });
      const document = await PDFDocument.load(bytes);
      const states = document
        .getPage(0)
        .node.Resources()!
        .lookup(PDFName.of('ExtGState'), PDFDict);
      expect(
        states
          .values()
          .some(
            (ref) =>
              document.context
                .lookup(ref, PDFDict)
                .lookupMaybe(PDFName.of('ca'), PDFNumber)
                ?.asNumber() === opacity,
          ),
      ).toBe(true);
      expect((await inspectText(bytes))[0]).toContain('DRAFT');
    },
  );
  it.each([0, 90, 180, 270] as const)(
    'keeps foreground upright in the final oriented frame at intrinsic %i° plus every workspace rotation',
    async (intrinsic) => {
      const request = await requestFor(1, intrinsic);
      for (const delta of [0, 90, 180, 270] as const) {
        const bytes = await exportWorkspace({
          ...request,
          pages: request.pages.map((page) => ({
            ...page,
            rotationDelta: delta,
          })),
          watermark: { ...textConfig, rotation: 0, position: 'top-left' },
        });
        const document = await PDFDocument.load(bytes);
        expect(document.getPage(0).getRotation().angle).toBe(
          (intrinsic + delta) % 360,
        );
        expect((await inspectText(bytes))[0]).toContain('DRAFT');
        const task = pdfjs.getDocument({ data: bytes.slice() });
        try {
          const parsed = await task.promise;
          const page = await parsed.getPage(1);
          const items = (await page.getTextContent()).items;
          const watermark = items.find(
            (item) => 'str' in item && item.str === 'DRAFT',
          );
          if (!watermark || !('transform' in watermark))
            throw new Error('Expected watermark text item.');
          const viewport = page.getViewport({ scale: 1 });
          const baseline = viewport.convertToViewportPoint(
            Number(watermark.transform[4]),
            Number(watermark.transform[5]),
          );
          // The independently parsed watermark is near displayed top-left for all
          // sixteen rotations; raw page coordinates alone cannot prove this.
          expect(baseline[0]).toBeGreaterThan(0);
          expect(baseline[0]).toBeLessThan(viewport.width * 0.2);
          expect(baseline[1]).toBeGreaterThan(0);
          expect(baseline[1]).toBeLessThan(viewport.height * 0.2);
          page.cleanup();
        } finally {
          await task.destroy();
        }
      }
    },
  );
  it('targets stable identities after reorder and Extract, preserving untargeted content', async () => {
    const request = await requestFor(3);
    const watermark: WatermarkConfig = {
      ...textConfig,
      target: { kind: 'pages', pageIds: ['p1'] },
    };
    const reordered = await exportWorkspace({
      ...request,
      pages: [request.pages[2]!, request.pages[1]!, request.pages[0]!],
      watermark,
    });
    expect(await inspectText(reordered)).toEqual([
      'PUBLIC-PAGE-2',
      'PUBLIC-PAGE-1DRAFT',
      'PUBLIC-PAGE-0',
    ]);
    expect(
      await inspectText(
        await exportWorkspace({
          ...request,
          pages: [request.pages[1]!],
          watermark,
        }),
      ),
    ).toEqual(['PUBLIC-PAGE-1DRAFT']);
  });
  it.each([8, 48, 144])(
    'uses physical font points across UserUnit values at size %i',
    async (fontSize) => {
      const configuration = { ...textConfig, fontSize, rotation: 0, scale: 1 };
      const first = await createWatermarkPreviewPdf(
        configuration,
        { viewBox: [0, 0, 500, 400], userUnit: 1, rotation: 0 },
        new Map(),
      );
      const second = await createWatermarkPreviewPdf(
        configuration,
        { viewBox: [0, 0, 250, 200], userUnit: 2, rotation: 0 },
        new Map(),
      );
      const one = pageOperators(await PDFDocument.load(first)).match(
        /([\d.]+) Tf/,
      );
      const two = pageOperators(await PDFDocument.load(second)).match(
        /([\d.]+) Tf/,
      );
      expect(one).not.toBeNull();
      expect(two).not.toBeNull();
      expect(Number(two![1]) * 2).toBeCloseTo(Number(one![1]));
    },
  );
  it('fits long unkerned AV text and accented ink within conservative Helvetica bounds', async () => {
    const document = await PDFDocument.create();
    for (const text of ['AV'.repeat(100), 'ÉÀÂÄÖÜÇ€gyp']) {
      for (const rotation of [0, 35, -67]) {
        const context = await createWatermarkExportContext(
          document,
          {
            ...textConfig,
            text,
            fontSize: 144,
            scale: 1,
            position: 'top-right',
            rotation,
          },
          new Map(),
        );
        const placement = validateWatermarkPageGeometry(
          { viewBox: [0, 0, 500, 400], userUnit: 1, rotation: 0 },
          context,
        );
        const advance =
          [...text].reduce(
            (total, glyph) =>
              total + context.font!.widthOfTextAtSize(glyph, 144),
            0,
          ) * placement.sizingRatio;
        expect(placement.width).toBeGreaterThan(advance);
        expect(
          placement.orientedBounds.x + placement.orientedBounds.width,
        ).toBeCloseTo(475);
        expect(
          placement.orientedBounds.y + placement.orientedBounds.height,
        ).toBeCloseTo(380);
        expect(placement.height).toBeCloseTo(
          144 * 1.156 * placement.sizingRatio,
        );
      }
    }
  });
  it('reuses the existing output Helvetica context rather than embedding a second font', async () => {
    const document = await PDFDocument.create();
    const ordinary = await createAnnotationExportContext(document);
    const embed = vi.spyOn(document, 'embedFont');
    const watermark = await createWatermarkExportContext(
      document,
      textConfig,
      new Map(),
      ordinary,
    );
    expect(watermark.font).toBe(ordinary.font);
    expect(embed).not.toHaveBeenCalled();
  });
  it('embeds a transparent PNG once across ordinary pages and preserves its soft mask', async () => {
    const request = await requestFor(10);
    const bytes = await exportWorkspace({
      ...request,
      watermark: { ...textConfig, kind: 'image', assetId: asset.assetId },
      imageAssets: new Map([[asset.assetId, asset]]),
    });
    const document = await PDFDocument.load(bytes);
    const refs = document
      .getPages()
      .map((page) =>
        page.node
          .Resources()!
          .lookup(PDFName.of('XObject'), PDFDict)
          .values()[0]!
          .toString(),
      );
    expect(new Set(refs).size).toBe(1);
    const image = document.context.lookup(
      document
        .getPage(0)
        .node.Resources()!
        .lookup(PDFName.of('XObject'), PDFDict)
        .values()[0],
    );
    if (!(image instanceof PDFRawStream))
      throw new Error('Expected embedded image.');
    expect(image.dict.has(PDFName.of('SMask'))).toBe(true);
    expect(await inspectText(bytes)).toEqual(
      Array.from({ length: 10 }, (_, index) => `PUBLIC-PAGE-${index}`),
    );
  });
  it('validates all target geometries without allocating preview canvases', async () => {
    const validate = await createWatermarkGeometryValidator(
      textConfig,
      new Map(),
    );
    expect(() =>
      validate({ viewBox: [10, 20, 510, 420], userUnit: 1, rotation: 90 }),
    ).not.toThrow();
    expect(() =>
      validate({ viewBox: [0, 0, 20000, 400], userUnit: 1, rotation: 0 }),
    ).toThrowError(expect.objectContaining({ code: 'watermark-invalid' }));
  });
  it('snapshots mutable configuration and asset bytes before any asynchronous source read', async () => {
    const request = await requestFor();
    const originalFile = request.sources.get('source')!.file;
    const originalBytes = await originalFile.arrayBuffer();
    let release!: (value: ArrayBuffer) => void;
    const paused = new Promise<ArrayBuffer>((resolve) => {
      release = resolve;
    });
    vi.spyOn(originalFile, 'arrayBuffer').mockReturnValue(paused);
    const imageBytes = png.slice();
    const config = {
      ...textConfig,
      kind: 'image' as const,
      assetId: asset.assetId,
      customPosition: { x: 0, y: 0 },
      target: { kind: 'pages' as const, pageIds: ['p0'] },
    };
    const exporting = exportWorkspace({
      ...request,
      watermark: config,
      imageAssets: new Map([[asset.assetId, { ...asset, bytes: imageBytes }]]),
    });
    config.rotation = 180;
    config.customPosition.x = 1;
    config.target.pageIds[0] = 'deleted';
    imageBytes.fill(0);
    release(originalBytes);
    const bytes = await exporting;
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
    expect(pageOperators(await PDFDocument.load(bytes))).not.toContain(
      '-1 0 0 -1',
    );
  });
  it.each(['', '   ', 'line\nline', 'A'.repeat(201)])(
    'rejects invalid text %j before committing appearance',
    async (text) => {
      await expect(validateWatermarkText(text)).rejects.toMatchObject({
        code: 'watermark-invalid',
      });
    },
  );
  it.each(['🔥', 'नमस्ते', '中文'])(
    'rejects unsupported Helvetica glyphs %s visibly without replacement',
    async (text) => {
      await expect(validateWatermarkText(text)).rejects.toMatchObject({
        code: 'watermark-unsupported-text',
      });
      await expect(
        exportWorkspace({
          ...(await requestFor()),
          watermark: { ...textConfig, text },
        }),
      ).rejects.toMatchObject({ code: 'watermark-unsupported-text' });
    },
  );
  it.each([
    { opacity: NaN },
    { opacity: -1 },
    { opacity: Infinity },
    { scale: 0 },
    { fontSize: 145 },
    { rotation: 181 },
    { target: { kind: 'pages' as const, pageIds: ['p0', 'p0'] } },
    { target: { kind: 'pages' as const, pageIds: [] } },
    { target: { kind: 'pages' as const, pageIds: ['deleted'] } },
  ])(
    'fails closed on invalid or obsolete export configuration %j',
    async (patch) => {
      await expect(
        exportWorkspace({
          ...(await requestFor()),
          watermark: { ...textConfig, ...patch },
        }),
      ).rejects.toMatchObject({ code: 'watermark-invalid' });
    },
  );
  it('rejects missing image assets and malformed PNG data without partial output', async () => {
    const request = await requestFor();
    const watermark = {
      ...textConfig,
      kind: 'image' as const,
      assetId: asset.assetId,
    };
    await expect(
      exportWorkspace({ ...request, watermark }),
    ).rejects.toMatchObject({ code: 'watermark-missing-image' });
    await expect(
      exportWorkspace({
        ...request,
        watermark,
        imageAssets: new Map([
          [asset.assetId, { ...asset, bytes: new Uint8Array([1]) }],
        ]),
      }),
    ).rejects.toMatchObject({ code: 'watermark-image-invalid' });
    expect(
      await inspectText(
        await exportWorkspace({ ...request, watermark: textConfig }),
      ),
    ).toEqual(['PUBLIC-PAGE-0DRAFT']);
  });
  it('does not mutate source pages across repeated watermark exports', async () => {
    const request = await requestFor();
    for (let repeat = 0; repeat < 2; repeat += 1)
      expect(
        await inspectText(
          await exportWorkspace({ ...request, watermark: textConfig }),
        ),
      ).toEqual(['PUBLIC-PAGE-0DRAFT']);
    expect(await inspectText(await exportWorkspace(request))).toEqual([
      'PUBLIC-PAGE-0',
    ]);
  });
  it('retains source geometry and applies a shared watermark to a copied offset crop', async () => {
    const document = await PDFDocument.create();
    const page = document.addPage([500, 400]);
    page.setMediaBox(10, 20, 500, 400);
    page.setCropBox(40, 60, 300, 200);
    page.node.set(PDFName.of('UserUnit'), PDFNumber.of(2));
    const context = await createWatermarkExportContext(
      document,
      {
        ...textConfig,
        position: 'custom',
        customPosition: { x: 0, y: 0 },
        rotation: 0,
      },
      new Map(),
    );
    drawWatermarkOnPage(page, 90, context);
    expect(page.getCropBox()).toEqual({
      x: 40,
      y: 60,
      width: 300,
      height: 200,
    });
    expect(
      pageOperators(await PDFDocument.load(await document.save())),
    ).toContain('Tm');
  });
});
