import { describe, expect, it, vi } from 'vitest';
import {
  degrees,
  PDFDocument,
  PDFName,
  PDFNumber,
  StandardFonts,
} from 'pdf-lib';

import type { PdfAnnotation } from '../../../features/pdf-annotations/model/types';
import { normalizeRotation } from '../../../features/pdf-workspace/model/operations';
import {
  createAnnotationImageResolver,
  createAnnotationExportContext,
  drawAnnotationsOnPage,
  flattenAnnotationsOntoCopiedPage,
  prepareImageResources,
} from './flattenAnnotations';
import { snapshotAnnotationImageAssets } from './imageAssets';
import { layoutText } from './textLayout';

const color = { r: 0.2, g: 0.4, b: 0.8 } as const;
const fill = { color, opacity: 0.35 } as const;
const stroke = { color, widthUserUnits: 3, opacity: 0.7 } as const;
const box = {
  origin: { x: 20, y: 30 },
  width: 80,
  height: 40,
  rotation: 90,
} as const;

const pngBytes = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  ),
  (character) => character.charCodeAt(0),
);
const jpegBytes = Uint8Array.from(
  atob(
    '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAABAAIDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD50ooor8MP9Uz/2Q==',
  ),
  (character) => character.charCodeAt(0),
);

function annotation<K extends PdfAnnotation['kind']>(
  kind: K,
  fields: Record<string, unknown> = {},
): PdfAnnotation {
  return {
    id: `${kind}-1`,
    workspacePageId: 'page-1',
    kind,
    ...fields,
  } as PdfAnnotation;
}

function imageAnnotation(
  id: string,
  assetId: string,
  rotation: 0 | 90 | 180 | 270 = 0,
  opacity = 1,
  origin = { x: 30, y: 40 },
): PdfAnnotation {
  return annotation('image', {
    id,
    assetId,
    box: { origin, width: 80, height: 50, rotation },
    opacity,
  });
}

function signatureAnnotation(
  id: string,
  assetId: string,
  method: 'draw' | 'type' | 'upload' = 'draw',
  rotation: 0 | 90 | 180 | 270 = 0,
): PdfAnnotation {
  return annotation('signature', {
    id,
    assetId,
    method,
    box: {
      origin: { x: 45, y: 55 },
      width: 120,
      height: 48,
      rotation,
    },
    opacity: 1,
  });
}

async function pageWithContext() {
  const document = await PDFDocument.create();
  const page = document.addPage([400, 300]);
  const context = await createAnnotationExportContext(document);
  return { document, page, context };
}

describe('annotation PDF flattening', () => {
  it('draws all supported vector kinds in array order with canonical geometry', async () => {
    const { page, context } = await pageWithContext();
    const order: string[] = [];
    vi.spyOn(page, 'drawRectangle').mockImplementation(() => {
      order.push('rectangle');
    });
    vi.spyOn(page, 'drawEllipse').mockImplementation(() => {
      order.push('ellipse');
    });
    vi.spyOn(page, 'drawLine').mockImplementation(() => {
      order.push('line');
    });
    vi.spyOn(page, 'drawText').mockImplementation(() => {
      order.push('text');
    });

    drawAnnotationsOnPage(
      page,
      [
        annotation('highlight', { box, fill }),
        annotation('rectangle', { box, stroke, fill }),
        annotation('ellipse', { box, stroke, fill }),
        annotation('line', {
          start: { x: 10, y: 11 },
          end: { x: 90, y: 91 },
          stroke,
        }),
        annotation('freehand', {
          points: [
            { x: 1, y: 2 },
            { x: 4, y: 6 },
            { x: 8, y: 10 },
          ],
          stroke,
        }),
        annotation('text', {
          box,
          text: 'hello',
          fontFamily: 'helvetica',
          fontSizeUserUnits: 12,
          lineHeight: 1.2,
          align: 'left',
          color,
          opacity: 0.8,
        }),
      ],
      context,
    );

    expect(order).toEqual([
      'rectangle',
      'rectangle',
      'ellipse',
      'line',
      'line',
      'line',
      'text',
    ]);
  });

  it.each([0, 90, 180, 270] as const)(
    'uses the oriented box origin and cardinal rotation %s for rectangles and ellipses',
    async (rotation) => {
      const { page, context } = await pageWithContext();
      const rectangle = vi.spyOn(page, 'drawRectangle');
      const ellipse = vi.spyOn(page, 'drawEllipse');
      drawAnnotationsOnPage(
        page,
        [
          annotation('rectangle', { box: { ...box, rotation }, stroke, fill }),
          annotation('ellipse', { box: { ...box, rotation }, stroke, fill }),
        ],
        context,
      );

      expect(rectangle).toHaveBeenCalledWith(
        expect.objectContaining({
          x: 20,
          y: 30,
          width: 80,
          height: 40,
          rotate: degrees(rotation),
          opacity: fill.opacity,
          borderOpacity: stroke.opacity,
        }),
      );
      const centers = {
        0: { x: 60, y: 50 },
        90: { x: 0, y: 70 },
        180: { x: -20, y: 10 },
        270: { x: 40, y: -10 },
      } as const;
      expect(ellipse).toHaveBeenCalledWith(
        expect.objectContaining({
          ...centers[rotation],
          xScale: 40,
          yScale: 20,
          rotate: degrees(rotation),
        }),
      );
    },
  );

  it('supports fill-only, stroke-only, and combined rectangle styles', async () => {
    const { page, context } = await pageWithContext();
    const rectangle = vi.spyOn(page, 'drawRectangle');
    const plainBox = { ...box, rotation: 0 };
    drawAnnotationsOnPage(
      page,
      [
        annotation('rectangle', { box: plainBox, fill, stroke: null }),
        annotation('rectangle', { box: plainBox, fill: null, stroke }),
        annotation('rectangle', { box: plainBox, fill, stroke }),
      ],
      context,
    );
    expect(rectangle).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ opacity: fill.opacity }),
    );
    expect(rectangle).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ borderOpacity: stroke.opacity }),
    );
    expect(rectangle).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        opacity: fill.opacity,
        borderOpacity: stroke.opacity,
      }),
    );
  });

  it('preserves line and freehand style without raster dependencies', async () => {
    const { page, context } = await pageWithContext();
    const drawLine = vi.spyOn(page, 'drawLine');
    drawAnnotationsOnPage(
      page,
      [
        annotation('line', {
          start: { x: 10, y: 11 },
          end: { x: 90, y: 91 },
          stroke,
        }),
        annotation('freehand', {
          points: [
            { x: 1, y: 2 },
            { x: 4, y: 6 },
            { x: 8, y: 10 },
          ],
          stroke,
        }),
      ],
      context,
    );
    expect(drawLine).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        start: { x: 10, y: 11 },
        end: { x: 90, y: 91 },
        thickness: 3,
        opacity: 0.7,
      }),
    );
    expect(drawLine).toHaveBeenCalledTimes(3);
  });

  it('lays out wrapped, explicitly multiline text using font metrics and alignment', async () => {
    const document = await PDFDocument.create();
    const font = await document.embedFont(StandardFonts.Helvetica);
    const lines = layoutText({
      text: 'alpha beta\ngamma',
      font,
      fontSize: 10,
      lineHeight: 1.5,
      maxWidth: 45,
      maxHeight: 40,
      align: 'center',
    });
    expect(lines.map((line) => line.text)).toEqual(['alpha ', 'beta', 'gamma']);
    expect(lines[0]?.xOffset).toBeGreaterThan(0);
    expect(lines.map((line) => line.baselineY)).toEqual([30, 15, 0]);
  });

  it('truncates text at the box height and retains opacity/rotation', async () => {
    const { page, context } = await pageWithContext();
    const drawText = vi.spyOn(page, 'drawText');
    drawAnnotationsOnPage(
      page,
      [
        annotation('text', {
          box: { ...box, rotation: 270, height: 24 },
          text: 'one two three four',
          fontFamily: 'helvetica',
          fontSizeUserUnits: 10,
          lineHeight: 1,
          align: 'right',
          color,
          opacity: 0.4,
        }),
      ],
      context,
    );
    expect(drawText).toHaveBeenCalledTimes(2);
    expect(drawText).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        size: 10,
        opacity: 0.4,
        rotate: degrees(270),
      }),
    );
  });

  it.each([0, 90, 180, 270] as const)(
    'places text using the canonical local basis at rotation %s',
    async (rotation) => {
      const { page, context } = await pageWithContext();
      const drawText = vi.spyOn(page, 'drawText');
      drawAnnotationsOnPage(
        page,
        [
          annotation('text', {
            box: { ...box, rotation },
            text: 'hello',
            fontFamily: 'helvetica',
            fontSizeUserUnits: 10,
            lineHeight: 1,
            align: 'left',
            color,
            opacity: 1,
          }),
        ],
        context,
      );
      expect(drawText).toHaveBeenCalledWith(
        'hello',
        expect.objectContaining({ rotate: degrees(rotation) }),
      );
    },
  );

  it('rejects unsupported Unicode and missing visual assets explicitly', async () => {
    const { page, context } = await pageWithContext();
    expect(() =>
      drawAnnotationsOnPage(
        page,
        [
          annotation('text', {
            box,
            text: 'snowman ☃',
            fontFamily: 'helvetica',
            fontSizeUserUnits: 12,
            lineHeight: 1,
            align: 'left',
            color,
            opacity: 1,
          }),
        ],
        context,
      ),
    ).toThrowError(expect.objectContaining({ code: 'unsupported-text-font' }));
    expect(() =>
      drawAnnotationsOnPage(
        page,
        [annotation('image', { box, assetId: 'asset-1', opacity: 1 })],
        context,
      ),
    ).toThrowError(expect.objectContaining({ code: 'missing-image-asset' }));
    expect(() =>
      drawAnnotationsOnPage(
        page,
        [signatureAnnotation('signature-1', 'asset-signature')],
        context,
      ),
    ).toThrowError(
      expect.objectContaining({ code: 'missing-signature-asset' }),
    );
  });

  it.each([
    ['draw', 'image/png', pngBytes],
    ['type', 'image/png', pngBytes],
    ['upload', 'image/png', pngBytes],
    ['upload', 'image/jpeg', jpegBytes],
  ] as const)(
    'exports %s visual signatures from %s bytes',
    async (method, mimeType, bytes) => {
      const document = await PDFDocument.create();
      const page = document.addPage([300, 200]);
      const drawImage = vi.spyOn(page, 'drawImage');
      await flattenAnnotationsOntoCopiedPage(
        page,
        [signatureAnnotation('signature-1', 'signature-asset', method)],
        document,
        undefined,
        createAnnotationImageResolver(
          new Map([
            [
              'signature-asset',
              { assetId: 'signature-asset', mimeType, bytes },
            ],
          ]),
        ),
      );
      expect(drawImage).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          x: 45,
          y: 55,
          width: 120,
          height: 48,
          opacity: 1,
        }),
      );
      await expect(
        PDFDocument.load(await document.save()),
      ).resolves.toBeDefined();
    },
  );

  it.each([0, 90, 180, 270] as const)(
    'exports visual-signature geometry once at rotation %s',
    async (rotation) => {
      const document = await PDFDocument.create();
      const page = document.addPage([300, 200]);
      const drawImage = vi.spyOn(page, 'drawImage');
      await flattenAnnotationsOntoCopiedPage(
        page,
        [
          signatureAnnotation(
            'signature-1',
            'signature-asset',
            'draw',
            rotation,
          ),
        ],
        document,
        undefined,
        createAnnotationImageResolver(
          new Map([
            [
              'signature-asset',
              {
                assetId: 'signature-asset',
                mimeType: 'image/png',
                bytes: pngBytes,
              },
            ],
          ]),
        ),
      );
      expect(drawImage).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ rotate: degrees(rotation) }),
      );
    },
  );

  it('embeds PNG bytes, preserves image opacity/rotation, and reopens the PDF', async () => {
    const document = await PDFDocument.create();
    const page = document.addPage([300, 200]);
    const drawImage = vi.spyOn(page, 'drawImage');
    const resolver = createAnnotationImageResolver(
      new Map([
        [
          'png-1',
          { assetId: 'png-1', mimeType: 'image/png' as const, bytes: pngBytes },
        ],
      ]),
    );
    const context = await flattenAnnotationsOntoCopiedPage(
      page,
      [imageAnnotation('image-1', 'png-1', 90, 0.5)],
      document,
      undefined,
      resolver,
    );
    expect(context.imageCache.size).toBe(1);
    expect(drawImage).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        x: 30,
        y: 40,
        width: 80,
        height: 50,
        rotate: degrees(90),
        opacity: 0.5,
      }),
    );
    const reopened = await PDFDocument.load(await document.save());
    expect(reopened.getPageCount()).toBe(1);
  });

  it('embeds JPEG bytes and reuses one PDF image for multiple placements', async () => {
    const document = await PDFDocument.create();
    const page = document.addPage([300, 200]);
    const embedJpg = vi.spyOn(document, 'embedJpg');
    const drawImage = vi.spyOn(page, 'drawImage');
    const resolver = createAnnotationImageResolver(
      new Map([
        [
          'jpg-1',
          {
            assetId: 'jpg-1',
            mimeType: 'image/jpeg' as const,
            bytes: jpegBytes,
          },
        ],
      ]),
    );
    const context = await createAnnotationExportContext(document, resolver);
    await flattenAnnotationsOntoCopiedPage(
      page,
      [
        imageAnnotation('image-1', 'jpg-1', 0, 1),
        imageAnnotation('image-2', 'jpg-1', 180, 0.5),
        imageAnnotation('image-3', 'jpg-1', 270, 0.1),
      ],
      document,
      context,
    );
    expect(embedJpg).toHaveBeenCalledOnce();
    expect(drawImage).toHaveBeenCalledTimes(3);
    expect(drawImage.mock.calls.map(([, options]) => options?.opacity)).toEqual(
      [1, 0.5, 0.1],
    );
    expect(context.imageCache.size).toBe(1);
  });

  it('embeds distinct PNG and JPEG assets as distinct resources', async () => {
    const document = await PDFDocument.create();
    const page = document.addPage([300, 200]);
    const embedPng = vi.spyOn(document, 'embedPng');
    const embedJpg = vi.spyOn(document, 'embedJpg');
    const resolver = createAnnotationImageResolver(
      new Map([
        [
          'png-1',
          { assetId: 'png-1', mimeType: 'image/png' as const, bytes: pngBytes },
        ],
        [
          'jpg-1',
          {
            assetId: 'jpg-1',
            mimeType: 'image/jpeg' as const,
            bytes: jpegBytes,
          },
        ],
      ]),
    );
    const context = await createAnnotationExportContext(document, resolver);
    await flattenAnnotationsOntoCopiedPage(
      page,
      [
        imageAnnotation('image-1', 'png-1'),
        imageAnnotation('image-2', 'jpg-1'),
        signatureAnnotation('signature-1', 'png-1'),
        signatureAnnotation('signature-2', 'jpg-1', 'upload'),
      ],
      document,
      context,
    );
    expect(embedPng).toHaveBeenCalledOnce();
    expect(embedJpg).toHaveBeenCalledOnce();
    expect(context.imageCache.size).toBe(2);
  });

  it.each([0, 90, 180, 270] as const)(
    'draws image geometry in raw coordinates at box rotation %s',
    async (rotation) => {
      const document = await PDFDocument.create();
      const page = document.addPage([300, 200]);
      const drawImage = vi.spyOn(page, 'drawImage');
      const resolver = createAnnotationImageResolver(
        new Map([
          [
            'png-1',
            {
              assetId: 'png-1',
              mimeType: 'image/png' as const,
              bytes: pngBytes,
            },
          ],
        ]),
      );
      await flattenAnnotationsOntoCopiedPage(
        page,
        [imageAnnotation('image-1', 'png-1', rotation)],
        document,
        undefined,
        resolver,
      );
      expect(drawImage).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ x: 30, y: 40, rotate: degrees(rotation) }),
      );
    },
  );

  it('preserves z-order while preparing image resources', async () => {
    const document = await PDFDocument.create();
    const page = document.addPage([300, 200]);
    const order: string[] = [];
    vi.spyOn(page, 'drawRectangle').mockImplementation(() =>
      order.push('rectangle'),
    );
    vi.spyOn(page, 'drawImage').mockImplementation(() => order.push('image'));
    vi.spyOn(page, 'drawText').mockImplementation(() => order.push('text'));
    const resolver = createAnnotationImageResolver(
      new Map([
        [
          'png-1',
          { assetId: 'png-1', mimeType: 'image/png' as const, bytes: pngBytes },
        ],
      ]),
    );
    const context = await createAnnotationExportContext(document, resolver);
    await prepareImageResources([imageAnnotation('image-1', 'png-1')], context);
    drawAnnotationsOnPage(
      page,
      [
        annotation('rectangle', { box, fill, stroke }),
        imageAnnotation('image-1', 'png-1'),
        annotation('text', {
          box,
          text: 'top',
          fontFamily: 'helvetica',
          fontSizeUserUnits: 12,
          lineHeight: 1,
          align: 'left',
          color,
          opacity: 1,
        }),
      ],
      context,
    );
    expect(order).toEqual(['rectangle', 'image', 'text']);
  });

  it.each([false, true])(
    'keeps Rectangle / Signature / Text overlap order (reverse=%s)',
    async (reverse) => {
      const document = await PDFDocument.create();
      const page = document.addPage([300, 200]);
      const order: string[] = [];
      vi.spyOn(page, 'drawRectangle').mockImplementation(() =>
        order.push('rectangle'),
      );
      vi.spyOn(page, 'drawImage').mockImplementation(() =>
        order.push('signature'),
      );
      vi.spyOn(page, 'drawText').mockImplementation(() => order.push('text'));
      const signature = signatureAnnotation('signature-1', 'signature-asset');
      const rectangle = annotation('rectangle', { box, fill, stroke });
      const context = await createAnnotationExportContext(
        document,
        createAnnotationImageResolver(
          new Map([
            [
              'signature-asset',
              {
                assetId: 'signature-asset',
                mimeType: 'image/png',
                bytes: pngBytes,
              },
            ],
          ]),
        ),
      );
      await prepareImageResources([signature], context);
      const text = annotation('text', {
        box,
        text: 'top',
        fontFamily: 'helvetica',
        fontSizeUserUnits: 12,
        lineHeight: 1,
        align: 'left',
        color,
        opacity: 1,
      });
      const annotations = [rectangle, signature, text];
      drawAnnotationsOnPage(
        page,
        reverse ? annotations.reverse() : annotations,
        context,
      );
      expect(order).toEqual(
        reverse
          ? ['text', 'signature', 'rectangle']
          : ['rectangle', 'signature', 'text'],
      );
    },
  );

  it('fails explicitly for missing, unsupported, and corrupt assets', async () => {
    const missing = await pageWithContext();
    await expect(
      flattenAnnotationsOntoCopiedPage(
        missing.page,
        [imageAnnotation('image-1', 'missing')],
        missing.document,
        undefined,
        createAnnotationImageResolver(new Map()),
      ),
    ).rejects.toMatchObject({
      code: 'missing-image-asset',
      assetId: 'missing',
    });

    const unsupported = await pageWithContext();
    await expect(
      flattenAnnotationsOntoCopiedPage(
        unsupported.page,
        [imageAnnotation('image-1', 'gif-1')],
        unsupported.document,
        undefined,
        createAnnotationImageResolver(
          new Map([
            [
              'gif-1',
              {
                assetId: 'gif-1',
                mimeType: 'image/gif' as never,
                bytes: pngBytes,
              },
            ],
          ]),
        ),
      ),
    ).rejects.toMatchObject({ code: 'unsupported-image-format' });

    const corrupt = await pageWithContext();
    await expect(
      flattenAnnotationsOntoCopiedPage(
        corrupt.page,
        [imageAnnotation('image-1', 'bad')],
        corrupt.document,
        undefined,
        createAnnotationImageResolver(
          new Map([
            [
              'bad',
              {
                assetId: 'bad',
                mimeType: 'image/png' as const,
                bytes: new Uint8Array([1, 2, 3]),
              },
            ],
          ]),
        ),
      ),
    ).rejects.toMatchObject({ code: 'image-embed-failed', assetId: 'bad' });

    const corruptJpeg = await pageWithContext();
    await expect(
      flattenAnnotationsOntoCopiedPage(
        corruptJpeg.page,
        [imageAnnotation('image-1', 'bad-jpeg')],
        corruptJpeg.document,
        undefined,
        createAnnotationImageResolver(
          new Map([
            [
              'bad-jpeg',
              {
                assetId: 'bad-jpeg',
                mimeType: 'image/jpeg' as const,
                bytes: new Uint8Array([1, 2, 3]),
              },
            ],
          ]),
        ),
      ),
    ).rejects.toMatchObject({
      code: 'image-embed-failed',
      assetId: 'bad-jpeg',
    });
  });

  it('snapshots original Blob bytes so registry cleanup cannot affect export', async () => {
    let available = true;
    const blob = new Blob([pngBytes], { type: 'image/png' });
    const snapshot = await snapshotAnnotationImageAssets(
      {
        get: () =>
          available
            ? {
                assetId: 'png-1',
                blob,
                fileName: null,
                mimeType: 'image/png' as const,
                objectUrl: 'blob:test',
                width: 1,
                height: 1,
                image: {} as CanvasImageSource,
              }
            : null,
      },
      ['png-1'],
    );
    available = false;
    const document = await PDFDocument.create();
    const page = document.addPage([100, 100]);
    await flattenAnnotationsOntoCopiedPage(
      page,
      [imageAnnotation('image-1', 'png-1')],
      document,
      undefined,
      createAnnotationImageResolver(snapshot),
    );
    expect(snapshot.get('png-1')?.bytes).toBeInstanceOf(ArrayBuffer);
  });

  it('reports Blob read failures as typed export errors', async () => {
    await expect(
      snapshotAnnotationImageAssets(
        {
          get: () =>
            ({
              assetId: 'broken',
              blob: {
                arrayBuffer: () => Promise.reject(new Error('read failed')),
              },
              fileName: null,
              mimeType: 'image/png' as const,
              objectUrl: 'blob:test',
              width: 1,
              height: 1,
              image: {} as CanvasImageSource,
            }) as never,
        },
        ['broken'],
      ),
    ).rejects.toMatchObject({ code: 'image-read-failed', assetId: 'broken' });
  });

  it('copies and reopens a page without changing boxes or applying user-unit scaling', async () => {
    const source = await PDFDocument.create();
    const sourcePage = source.addPage([200, 100]);
    sourcePage.setMediaBox(-20, -10, 200, 100);
    sourcePage.setCropBox(-10, 0, 180, 80);
    sourcePage.node.set(PDFName.of('UserUnit'), PDFNumber.of(2));
    sourcePage.setRotation(degrees(90));
    const sourceBytes = await source.save();

    const loaded = await PDFDocument.load(sourceBytes);
    const output = await PDFDocument.create();
    const [copied] = await output.copyPages(loaded, [0]);
    if (!copied) throw new Error('copy failed');
    const context = await flattenAnnotationsOntoCopiedPage(
      copied,
      [imageAnnotation('image-1', 'png-1', 270, 1, { x: -5, y: -4 })],
      output,
      undefined,
      createAnnotationImageResolver(
        new Map([
          [
            'png-1',
            {
              assetId: 'png-1',
              mimeType: 'image/png' as const,
              bytes: pngBytes,
            },
          ],
        ]),
      ),
    );
    expect(context.font).toBeDefined();
    expect(context.imageCache.size).toBe(1);
    copied.setRotation(degrees(180));
    output.addPage(copied);
    const reopened = await PDFDocument.load(await output.save());
    const page = reopened.getPage(0);
    expect(page.getRotation().angle).toBe(180);
    expect(page.getMediaBox()).toEqual({
      x: -20,
      y: -10,
      width: 200,
      height: 100,
    });
    expect(page.getCropBox()).toEqual({ x: -10, y: 0, width: 180, height: 80 });
    expect(page.node.get(PDFName.of('UserUnit'))).toEqual(PDFNumber.of(2));
  });

  it.each([
    [0, 0, 0],
    [0, 90, 90],
    [90, 0, 90],
    [90, 90, 180],
    [270, 90, 0],
  ] as const)(
    'draws in raw coordinates before applying intrinsic %s + delta %s = %s rotation',
    async (intrinsicRotation, rotationDelta, expectedRotation) => {
      const source = await PDFDocument.create();
      const sourcePage = source.addPage([200, 100]);
      sourcePage.setRotation(degrees(intrinsicRotation));
      const loaded = await PDFDocument.load(await source.save());
      const output = await PDFDocument.create();
      const [copied] = await output.copyPages(loaded, [0]);
      if (!copied) throw new Error('copy failed');
      const context = await createAnnotationExportContext(output);
      const rectangle = vi.spyOn(copied, 'drawRectangle');
      drawAnnotationsOnPage(
        copied,
        [annotation('highlight', { box: { ...box, rotation: 0 }, fill })],
        context,
      );
      copied.setRotation(
        degrees(normalizeRotation(intrinsicRotation + rotationDelta)),
      );
      output.addPage(copied);
      const reopened = await PDFDocument.load(await output.save());
      expect(reopened.getPage(0).getRotation().angle).toBe(expectedRotation);
      expect(rectangle).toHaveBeenCalledWith(
        expect.objectContaining({ x: 20, y: 30, rotate: degrees(0) }),
      );
      expect((intrinsicRotation + rotationDelta) % 360).toBe(expectedRotation);
    },
  );

  it.each([
    [0, 0, 0],
    [0, 90, 90],
    [90, 0, 90],
    [90, 90, 180],
    [270, 90, 0],
  ] as const)(
    'keeps image coordinates raw for intrinsic %s + delta %s = %s',
    async (intrinsicRotation, rotationDelta, expectedRotation) => {
      const source = await PDFDocument.create();
      const sourcePage = source.addPage([200, 100]);
      sourcePage.setRotation(degrees(intrinsicRotation));
      const loaded = await PDFDocument.load(await source.save());
      const output = await PDFDocument.create();
      const [copied] = await output.copyPages(loaded, [0]);
      if (!copied) throw new Error('copy failed');
      const drawImage = vi.spyOn(copied, 'drawImage');
      await flattenAnnotationsOntoCopiedPage(
        copied,
        [imageAnnotation('image-1', 'png-1', 180)],
        output,
        undefined,
        createAnnotationImageResolver(
          new Map([
            [
              'png-1',
              {
                assetId: 'png-1',
                mimeType: 'image/png' as const,
                bytes: pngBytes,
              },
            ],
          ]),
        ),
      );
      copied.setRotation(
        degrees(normalizeRotation(intrinsicRotation + rotationDelta)),
      );
      output.addPage(copied);
      const reopened = await PDFDocument.load(await output.save());
      expect(reopened.getPage(0).getRotation().angle).toBe(expectedRotation);
      expect(drawImage).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ x: 30, y: 40, rotate: degrees(180) }),
      );
    },
  );
});
