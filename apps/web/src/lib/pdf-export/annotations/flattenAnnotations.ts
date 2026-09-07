import {
  degrees,
  LineCapStyle,
  type PDFPage,
  type PDFDocument,
  type PDFFont,
  rgb,
  StandardFonts,
} from 'pdf-lib';

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

export type ExportablePdfAnnotation = Exclude<PdfAnnotation, { kind: 'image' }>;

export type AnnotationExportErrorCode =
  'image-annotation-unsupported' | 'unsupported-text-font';

export class AnnotationExportError extends Error {
  readonly code: AnnotationExportErrorCode;
  readonly annotationId: string | null;

  constructor(
    code: AnnotationExportErrorCode,
    message: string,
    annotationId: string | null = null,
  ) {
    super(message);
    this.name = 'AnnotationExportError';
    this.code = code;
    this.annotationId = annotationId;
  }
}

export interface AnnotationExportContext {
  readonly font: PDFFont;
}

export async function createAnnotationExportContext(
  document: PDFDocument,
): Promise<AnnotationExportContext> {
  return { font: await document.embedFont(StandardFonts.Helvetica) };
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
  const lines = layoutText({
    text: annotation.text,
    font: context.font,
    fontSize: annotation.fontSizeUserUnits,
    lineHeight: annotation.lineHeight,
    maxWidth: annotation.box.width,
    maxHeight: annotation.box.height,
    align: annotation.align,
  });
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
      font: context.font,
      color: pdfColor(annotation.color),
      opacity: annotation.opacity,
      rotate: degrees(annotation.box.rotation),
    });
  }
}

function validateAnnotations(
  annotations: readonly PdfAnnotation[],
  context: AnnotationExportContext,
): void {
  for (const annotation of annotations) {
    if (annotation.kind === 'image') {
      throw new AnnotationExportError(
        'image-annotation-unsupported',
        'Image annotations cannot be flattened until image export is implemented.',
        annotation.id,
      );
    }
    if (annotation.kind !== 'text') continue;
    try {
      for (const line of annotation.text.split(/\r\n?|\n/)) {
        context.font.encodeText(line);
      }
    } catch {
      throw new AnnotationExportError(
        'unsupported-text-font',
        'Text contains characters unsupported by PDF export font Helvetica.',
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
        throw new AnnotationExportError(
          'image-annotation-unsupported',
          'Image annotations cannot be flattened until image export is implemented.',
          annotation.id,
        );
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
): Promise<AnnotationExportContext> {
  const exportContext =
    context ?? (await createAnnotationExportContext(document));
  drawAnnotationsOnPage(page, annotations, exportContext);
  return exportContext;
}
