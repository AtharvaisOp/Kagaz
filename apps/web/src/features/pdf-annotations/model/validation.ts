import type { PageRotation } from '../../pdf-workspace/model/types';

import type {
  AnnotationDocument,
  EllipseAnnotation,
  FillStyle,
  FreehandAnnotation,
  HighlightAnnotation,
  ImageAnnotation,
  LineAnnotation,
  PdfAnnotation,
  PdfOrientedBox,
  PdfPoint,
  RectangleAnnotation,
  RgbColor,
  SignatureAnnotation,
  StrokeStyle,
  TextAnnotation,
} from './types';

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isCardinalRotation(value: unknown): value is PageRotation {
  return value === 0 || value === 90 || value === 180 || value === 270;
}

function isRgbColor(value: unknown): value is RgbColor {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isFiniteNumber(value.r) &&
    value.r >= 0 &&
    value.r <= 1 &&
    isFiniteNumber(value.g) &&
    value.g >= 0 &&
    value.g <= 1 &&
    isFiniteNumber(value.b) &&
    value.b >= 0 &&
    value.b <= 1
  );
}

function isOpacity(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0 && value <= 1;
}

function isPdfPoint(value: unknown): value is PdfPoint {
  if (!isRecord(value)) {
    return false;
  }

  return isFiniteNumber(value.x) && isFiniteNumber(value.y);
}

function isPdfOrientedBox(value: unknown): value is PdfOrientedBox {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isPdfPoint(value.origin) &&
    isFiniteNumber(value.width) &&
    value.width > 0 &&
    isFiniteNumber(value.height) &&
    value.height > 0 &&
    isCardinalRotation(value.rotation)
  );
}

function isStrokeStyle(value: unknown): value is StrokeStyle {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isRgbColor(value.color) &&
    isFiniteNumber(value.widthUserUnits) &&
    value.widthUserUnits > 0 &&
    isOpacity(value.opacity)
  );
}

function isFillStyle(value: unknown): value is FillStyle {
  if (!isRecord(value)) {
    return false;
  }

  return isRgbColor(value.color) && isOpacity(value.opacity);
}

function isTextAnnotation(value: unknown): value is TextAnnotation {
  if (!isRecord(value)) {
    return false;
  }

  return (
    value.kind === 'text' &&
    isPdfOrientedBox(value.box) &&
    typeof value.text === 'string' &&
    value.fontFamily === 'helvetica' &&
    isFiniteNumber(value.fontSizeUserUnits) &&
    value.fontSizeUserUnits > 0 &&
    isFiniteNumber(value.lineHeight) &&
    value.lineHeight > 0 &&
    (value.align === 'left' ||
      value.align === 'center' ||
      value.align === 'right') &&
    isRgbColor(value.color) &&
    isOpacity(value.opacity)
  );
}

function isHighlightAnnotation(value: unknown): value is HighlightAnnotation {
  if (!isRecord(value)) {
    return false;
  }

  return (
    value.kind === 'highlight' &&
    isPdfOrientedBox(value.box) &&
    isFillStyle(value.fill)
  );
}

function isFreehandAnnotation(value: unknown): value is FreehandAnnotation {
  if (!isRecord(value)) {
    return false;
  }

  if (value.kind !== 'freehand' || !Array.isArray(value.points)) {
    return false;
  }

  return (
    value.points.length >= 2 &&
    value.points.every(isPdfPoint) &&
    isStrokeStyle(value.stroke)
  );
}

function isRectangleAnnotation(value: unknown): value is RectangleAnnotation {
  if (!isRecord(value)) {
    return false;
  }

  return (
    value.kind === 'rectangle' &&
    isPdfOrientedBox(value.box) &&
    (value.stroke === null || isStrokeStyle(value.stroke)) &&
    (value.fill === null || isFillStyle(value.fill))
  );
}

function isEllipseAnnotation(value: unknown): value is EllipseAnnotation {
  if (!isRecord(value)) {
    return false;
  }

  return (
    value.kind === 'ellipse' &&
    isPdfOrientedBox(value.box) &&
    (value.stroke === null || isStrokeStyle(value.stroke)) &&
    (value.fill === null || isFillStyle(value.fill))
  );
}

function isLineAnnotation(value: unknown): value is LineAnnotation {
  if (!isRecord(value)) {
    return false;
  }

  return (
    value.kind === 'line' &&
    isPdfPoint(value.start) &&
    isPdfPoint(value.end) &&
    isStrokeStyle(value.stroke)
  );
}

function isImageAnnotation(value: unknown): value is ImageAnnotation {
  if (!isRecord(value)) {
    return false;
  }

  return (
    value.kind === 'image' &&
    isPdfOrientedBox(value.box) &&
    isNonEmptyString(value.assetId) &&
    isOpacity(value.opacity)
  );
}

function isSignatureAnnotation(value: unknown): value is SignatureAnnotation {
  if (!isRecord(value)) return false;
  return (
    value.kind === 'signature' &&
    isPdfOrientedBox(value.box) &&
    isNonEmptyString(value.assetId) &&
    (value.method === 'draw' ||
      value.method === 'type' ||
      value.method === 'upload') &&
    isOpacity(value.opacity)
  );
}

export function isPdfAnnotation(value: unknown): value is PdfAnnotation {
  if (!isRecord(value)) {
    return false;
  }

  if (!isNonEmptyString(value.id) || !isNonEmptyString(value.workspacePageId)) {
    return false;
  }

  switch (value.kind) {
    case 'text':
      return isTextAnnotation(value);
    case 'highlight':
      return isHighlightAnnotation(value);
    case 'freehand':
      return isFreehandAnnotation(value);
    case 'rectangle':
      return isRectangleAnnotation(value);
    case 'ellipse':
      return isEllipseAnnotation(value);
    case 'line':
      return isLineAnnotation(value);
    case 'image':
      return isImageAnnotation(value);
    case 'signature':
      return isSignatureAnnotation(value);
    default:
      return false;
  }
}

export function validateAnnotation(
  value: unknown,
): asserts value is PdfAnnotation {
  if (!isPdfAnnotation(value)) {
    throw new RangeError('Invalid annotation geometry or style.');
  }
}

export function isAnnotationDocument(
  value: unknown,
): value is AnnotationDocument {
  if (!isRecord(value) || !isRecord(value.byPage)) {
    return false;
  }

  const ids = new Set<string>();
  for (const [pageId, annotations] of Object.entries(value.byPage)) {
    if (!Array.isArray(annotations)) {
      return false;
    }

    for (const annotation of annotations) {
      if (
        !isPdfAnnotation(annotation) ||
        annotation.workspacePageId !== pageId ||
        ids.has(annotation.id)
      ) {
        return false;
      }
      ids.add(annotation.id);
    }
  }

  return true;
}

export function validateAnnotationDocument(
  value: unknown,
): asserts value is AnnotationDocument {
  if (!isAnnotationDocument(value)) {
    throw new RangeError('Invalid annotation document.');
  }
}

export {
  isCardinalRotation,
  isFiniteNumber,
  isPdfOrientedBox,
  isPdfPoint,
  isRgbColor,
};
