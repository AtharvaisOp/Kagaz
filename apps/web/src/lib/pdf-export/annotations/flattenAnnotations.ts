import {
  degrees,
  LineCapStyle,
  type PDFImage,
  type PDFPage,
  type PDFDocument,
  type PDFFont,
  rgb,
  pushGraphicsState,
  popGraphicsState,
  moveTo,
  lineTo,
  closePath,
  clip,
  endPath,
} from 'pdf-lib';
import { preparePdfFont, type PdfFontContext } from '../../fonts/pdfFont';
import type { DocumentFontId } from '../../fonts/fontCatalog';
import type { FontAssetSnapshot } from '../../fonts/fontAssets';
import { FontTextError } from '../../fonts/fontErrors';

import {
  pdfOrientedBoxCenter,
  localPointToPdf,
} from './annotationExportGeometry';
import { layoutText } from './textLayout';
import type {
  EllipseAnnotation,
  FillStyle,
  FreehandAnnotation,
  HighlightAnnotation,
  LineAnnotation,
  PdfAnnotation,
  RectangleAnnotation,
  RgbColor,
  StrokeStyle,
  TextAnnotation,
} from '../../../features/pdf-annotations/model/types';
import {
  AnnotationExportError,
  type AnnotationImageExportSource,
  type AnnotationImageResolver,
} from './exportContracts';

export type ExportablePdfAnnotation = PdfAnnotation;

export type {
  AnnotationExportErrorCode,
  AnnotationImageExportSource,
  AnnotationImageResolver,
} from './exportContracts';
export { AnnotationExportError } from './exportContracts';

export interface AnnotationExportContext {
  readonly font: PDFFont;
  readonly fontContexts: Map<DocumentFontId, PdfFontContext>;
  readonly fontAssets?: FontAssetSnapshot;
  readonly document: PDFDocument;
  readonly imageCache: Map<string, PDFImage>;
  readonly imageResolver: AnnotationImageResolver | null;
}

export async function createAnnotationExportContext(
  document: PDFDocument,
  imageResolver: AnnotationImageResolver | null = null,
  fontAssets?: FontAssetSnapshot,
): Promise<AnnotationExportContext> {
  const helvetica = await preparePdfFont(document, 'helvetica');
  return {
    document,
    font: helvetica.font,
    fontContexts: new Map([['helvetica', helvetica]]),
    fontAssets,
    imageCache: new Map(),
    imageResolver,
  };
}

export function createAnnotationImageResolver(
  sources: ReadonlyMap<string, AnnotationImageExportSource>,
): AnnotationImageResolver {
  return {
    resolve: (assetId) => sources.get(assetId) ?? null,
  };
}

function pdfColor(color: RgbColor) {
  return rgb(color.r, color.g, color.b);
}

function fillOptions(fill: FillStyle | null) {
  return fill ? { color: pdfColor(fill.color), opacity: fill.opacity } : {};
}

function strokeOptions(stroke: StrokeStyle | null) {
  return stroke
    ? {
        borderColor: pdfColor(stroke.color),
        borderWidth: stroke.widthUserUnits,
        borderOpacity: stroke.opacity,
        borderLineCap: LineCapStyle.Round,
      }
    : {};
}

function drawHighlight(page: PDFPage, annotation: HighlightAnnotation): void {
  page.drawRectangle({
    x: annotation.box.origin.x,
    y: annotation.box.origin.y,
    width: annotation.box.width,
    height: annotation.box.height,
    rotate: degrees(annotation.box.rotation),
    ...fillOptions(annotation.fill),
  });
}

function drawRectangle(page: PDFPage, annotation: RectangleAnnotation): void {
  if (!annotation.fill && !annotation.stroke) return;
  page.drawRectangle({
    x: annotation.box.origin.x,
    y: annotation.box.origin.y,
    width: annotation.box.width,
    height: annotation.box.height,
    rotate: degrees(annotation.box.rotation),
    ...fillOptions(annotation.fill),
    ...strokeOptions(annotation.stroke),
  });
}

function drawEllipse(page: PDFPage, annotation: EllipseAnnotation): void {
  if (!annotation.fill && !annotation.stroke) return;
  const center = pdfOrientedBoxCenter(annotation.box);
  page.drawEllipse({
    x: center.x,
    y: center.y,
    xScale: annotation.box.width / 2,
    yScale: annotation.box.height / 2,
    rotate: degrees(annotation.box.rotation),
    ...fillOptions(annotation.fill),
    ...strokeOptions(annotation.stroke),
  });
}

function drawLine(page: PDFPage, annotation: LineAnnotation): void {
  page.drawLine({
    start: annotation.start,
    end: annotation.end,
    thickness: annotation.stroke.widthUserUnits,
    color: pdfColor(annotation.stroke.color),
    opacity: annotation.stroke.opacity,
    lineCap: LineCapStyle.Round,
  });
}

function drawFreehand(page: PDFPage, annotation: FreehandAnnotation): void {
  for (let index = 1; index < annotation.points.length; index += 1) {
    const start = annotation.points[index - 1];
    const end = annotation.points[index];
    if (!start || !end) continue;
    page.drawLine({
      start,
      end,
      thickness: annotation.stroke.widthUserUnits,
      color: pdfColor(annotation.stroke.color),
      opacity: annotation.stroke.opacity,
      lineCap: LineCapStyle.Round,
    });
  }
}

function drawText(
  page: PDFPage,
  annotation: TextAnnotation,
  context: AnnotationExportContext,
): void {
  const fontContext = context.fontContexts.get(annotation.fontFamily);
  if (!fontContext)
    throw new AnnotationExportError(
      'unsupported-text-font',
      'The selected text font was not prepared for export.',
      annotation.id,
    );
  let lines: ReturnType<typeof layoutText>;
  try {
    lines = layoutText({
      text: annotation.text,
      font: fontContext.font,
      fontContext,
      fontSize: annotation.fontSizeUserUnits,
      lineHeight: annotation.lineHeight,
      maxWidth: annotation.box.width,
      maxHeight: annotation.box.height,
      align: annotation.align,
    });
  } catch (error: unknown) {
    if (error instanceof FontTextError)
      throw new AnnotationExportError(
        error.code === 'text-overflow'
          ? 'text-overflow'
          : 'unsupported-text-font',
        error.message,
        annotation.id,
      );
    throw error;
  }
  if (annotation.fontFamily === 'noto-sans') {
    const corners = [
      [0, 0],
      [annotation.box.width, 0],
      [annotation.box.width, annotation.box.height],
      [0, annotation.box.height],
    ] as const;
    const points = corners.map(([x, y]) =>
      localPointToPdf(annotation.box, x, y),
    );
    const first = points[0];
    if (!first) return;
    page.pushOperators(
      pushGraphicsState(),
      moveTo(first.x, first.y),
      ...points.slice(1).map((point) => lineTo(point.x, point.y)),
      closePath(),
      clip(),
      endPath(),
    );
  }
  for (const line of lines) {
    const baseline = localPointToPdf(
      annotation.box,
      line.xOffset,
      line.baselineY,
    );
    page.drawText(line.text, {
      x: baseline.x,
      y: baseline.y,
      size: annotation.fontSizeUserUnits,
      font: fontContext.font,
      color: pdfColor(annotation.color),
      opacity: annotation.opacity,
      rotate: degrees(annotation.box.rotation),
    });
  }
  if (annotation.fontFamily === 'noto-sans')
    page.pushOperators(popGraphicsState());
}

export async function prepareAnnotationFonts(
  annotations: readonly PdfAnnotation[],
  context: AnnotationExportContext,
): Promise<void> {
  for (const annotation of annotations) {
    if (
      annotation.kind !== 'text' ||
      context.fontContexts.has(annotation.fontFamily)
    )
      continue;
    try {
      const prepared = await preparePdfFont(
        context.document,
        annotation.fontFamily,
        context.fontAssets,
      );
      context.fontContexts.set(annotation.fontFamily, prepared);
    } catch (error: unknown) {
      throw new AnnotationExportError(
        'unsupported-text-font',
        error instanceof FontTextError
          ? error.message
          : 'The selected document font could not be loaded.',
        annotation.id,
      );
    }
  }
}

interface VisualAssetUse {
  readonly annotationId: string;
  readonly kind: 'image' | 'signature';
}

function visualAnnotationByAssetId(
  annotations: readonly PdfAnnotation[],
): ReadonlyMap<string, VisualAssetUse> {
  const result = new Map<string, VisualAssetUse>();
  for (const annotation of annotations) {
    if (
      (annotation.kind === 'image' || annotation.kind === 'signature') &&
      !result.has(annotation.assetId)
    ) {
      result.set(annotation.assetId, {
        annotationId: annotation.id,
        kind: annotation.kind,
      });
    }
  }
  return result;
}

export async function prepareImageResources(
  annotations: readonly PdfAnnotation[],
  context: AnnotationExportContext,
  resolver: AnnotationImageResolver | null = context.imageResolver,
): Promise<void> {
  const annotationUses = visualAnnotationByAssetId(annotations);
  for (const [assetId, use] of annotationUses) {
    if (context.imageCache.has(assetId)) continue;
    if (!resolver) {
      throw new AnnotationExportError(
        use.kind === 'signature'
          ? 'missing-signature-asset'
          : 'missing-image-asset',
        `The ${use.kind === 'signature' ? 'visual signature' : 'image annotation'} asset is not available for export.`,
        use.annotationId,
        assetId,
      );
    }

    let source: AnnotationImageExportSource | null;
    try {
      source = await resolver.resolve(assetId);
    } catch {
      throw new AnnotationExportError(
        'image-read-failed',
        'Kagaz could not read the image annotation asset for export.',
        use.annotationId,
        assetId,
      );
    }
    if (!source) {
      throw new AnnotationExportError(
        use.kind === 'signature'
          ? 'missing-signature-asset'
          : 'missing-image-asset',
        `The ${use.kind === 'signature' ? 'visual signature' : 'image annotation'} asset is not available for export.`,
        use.annotationId,
        assetId,
      );
    }
    if (source.assetId !== assetId) {
      throw new AnnotationExportError(
        'image-read-failed',
        'The resolved image annotation asset did not match its requested ID.',
        use.annotationId,
        assetId,
      );
    }
    if (source.mimeType !== 'image/png' && source.mimeType !== 'image/jpeg') {
      throw new AnnotationExportError(
        'unsupported-image-format',
        'Only PNG and JPEG image annotation assets can be exported.',
        use.annotationId,
        assetId,
      );
    }

    try {
      const image =
        source.mimeType === 'image/png'
          ? await context.document.embedPng(source.bytes)
          : await context.document.embedJpg(source.bytes);
      context.imageCache.set(assetId, image);
    } catch {
      throw new AnnotationExportError(
        'image-embed-failed',
        'The image annotation asset could not be embedded into the PDF.',
        use.annotationId,
        assetId,
      );
    }
  }
}

function validateAnnotations(
  annotations: readonly PdfAnnotation[],
  context: AnnotationExportContext,
): void {
  for (const annotation of annotations) {
    if (annotation.kind !== 'text') continue;
    try {
      const prepared = context.fontContexts.get(annotation.fontFamily);
      if (!prepared)
        throw new FontTextError(
          'font-load-failed',
          'The selected document font was not prepared for export.',
        );
      prepared.validate(annotation.text);
    } catch (error: unknown) {
      throw new AnnotationExportError(
        'unsupported-text-font',
        error instanceof FontTextError
          ? error.message
          : 'Text contains characters unsupported by the selected document font.',
        annotation.id,
      );
    }
  }
}

/** Draws page-local annotations in their existing array order. */
export function drawAnnotationsOnPage(
  page: PDFPage,
  annotations: readonly PdfAnnotation[],
  context: AnnotationExportContext,
): void {
  validateAnnotations(annotations, context);
  for (const annotation of annotations) {
    switch (annotation.kind) {
      case 'highlight':
        drawHighlight(page, annotation);
        break;
      case 'rectangle':
        drawRectangle(page, annotation);
        break;
      case 'ellipse':
        drawEllipse(page, annotation);
        break;
      case 'line':
        drawLine(page, annotation);
        break;
      case 'freehand':
        drawFreehand(page, annotation);
        break;
      case 'text':
        drawText(page, annotation, context);
        break;
      case 'image':
      case 'signature':
        {
          const image = context.imageCache.get(annotation.assetId);
          if (!image) {
            throw new AnnotationExportError(
              annotation.kind === 'signature'
                ? 'missing-signature-asset'
                : 'missing-image-asset',
              `The ${annotation.kind === 'signature' ? 'visual signature' : 'image annotation'} asset was not prepared for export.`,
              annotation.id,
              annotation.assetId,
            );
          }
          page.drawImage(image, {
            x: annotation.box.origin.x,
            y: annotation.box.origin.y,
            width: annotation.box.width,
            height: annotation.box.height,
            rotate: degrees(annotation.box.rotation),
            opacity: annotation.opacity,
          });
        }
        break;
    }
  }
}

/**
 * Convenience boundary for callers copying one page. The context should be
 * reused for every page in one export so Helvetica is embedded once.
 */
export async function flattenAnnotationsOntoCopiedPage(
  page: PDFPage,
  annotations: readonly PdfAnnotation[],
  document: PDFDocument,
  context?: AnnotationExportContext,
  imageResolver?: AnnotationImageResolver | null,
): Promise<AnnotationExportContext> {
  const exportContext =
    context ?? (await createAnnotationExportContext(document, imageResolver));
  await prepareImageResources(annotations, exportContext, imageResolver);
  await prepareAnnotationFonts(annotations, exportContext);
  drawAnnotationsOnPage(page, annotations, exportContext);
  return exportContext;
}
