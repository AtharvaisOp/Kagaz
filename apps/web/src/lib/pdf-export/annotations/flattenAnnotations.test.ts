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
  createAnnotationExportContext,
  drawAnnotationsOnPage,
  flattenAnnotationsOntoCopiedPage,
} from './flattenAnnotations';
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
    expect(lines.map((line) => line.text)).toEqual(['alpha', 'beta', 'gamma']);
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

  it('rejects unsupported Unicode and image annotations explicitly', async () => {
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
    ).toThrowError(
      expect.objectContaining({ code: 'image-annotation-unsupported' }),
    );
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
      [
        annotation('highlight', {
          box: { ...box, origin: { x: -5, y: -4 } },
          fill,
        }),
      ],
      output,
    );
    expect(context.font).toBeDefined();
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
});
