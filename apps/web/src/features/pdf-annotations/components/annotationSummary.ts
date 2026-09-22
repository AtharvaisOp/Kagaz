import type {
  AnnotationId,
  PdfAnnotation,
  PdfOrientedBox,
} from '../model/types';
import type { WorkspacePageId } from '../../pdf-workspace/model/types';

export type AnnotationMoveDirection = 'left' | 'right' | 'up' | 'down';
export type AnnotationResizeAction =
  'increase-width' | 'decrease-width' | 'increase-height' | 'decrease-height';

export const ANNOTATION_KEYBOARD_STEP_USER_UNITS = 5;
export const MIN_ANNOTATION_BOX_SIZE_USER_UNITS = 5;

export function annotationsForCurrentPage(
  annotations: readonly PdfAnnotation[],
  pageId: WorkspacePageId,
): readonly PdfAnnotation[] {
  return annotations.filter(
    (annotation) => annotation.workspacePageId === pageId,
  );
}

function textPreview(text: string): string {
  const compact = text.replace(/\s+/g, ' ').trim();
  return compact.length > 48 ? `${compact.slice(0, 45)}…` : compact;
}

export function annotationSummaryLabel(
  annotation: PdfAnnotation,
  fileName?: string | null,
): string {
  switch (annotation.kind) {
    case 'text':
      return textPreview(annotation.text) || 'Text annotation';
    case 'image':
      return fileName ? `Image: ${fileName}` : 'Image';
    case 'signature':
      return `${annotation.method === 'draw' ? 'Drawn' : annotation.method === 'type' ? 'Typed' : 'Uploaded'} signature`;
    case 'highlight':
      return 'Highlight';
    case 'rectangle':
      return 'Rectangle';
    case 'ellipse':
      return 'Ellipse';
    case 'line':
      return 'Line';
    case 'freehand':
      return 'Freehand';
  }
}

export function moveAnnotationByKeyboard(
  annotation: PdfAnnotation,
  direction: AnnotationMoveDirection,
  step = ANNOTATION_KEYBOARD_STEP_USER_UNITS,
): PdfAnnotation {
  const delta = {
    x: direction === 'left' ? -step : direction === 'right' ? step : 0,
    y: direction === 'down' ? -step : direction === 'up' ? step : 0,
  };

  if (annotation.kind === 'line') {
    return {
      ...annotation,
      start: {
        x: annotation.start.x + delta.x,
        y: annotation.start.y + delta.y,
      },
      end: {
        x: annotation.end.x + delta.x,
        y: annotation.end.y + delta.y,
      },
    };
  }
  if (annotation.kind === 'freehand') {
    const [first, second, ...rest] = annotation.points;
    const translate = (point: typeof first) => ({
      x: point.x + delta.x,
      y: point.y + delta.y,
    });
    return {
      ...annotation,
      points: [translate(first), translate(second), ...rest.map(translate)],
    };
  }
  return {
    ...annotation,
    box: {
      ...annotation.box,
      origin: {
        x: annotation.box.origin.x + delta.x,
        y: annotation.box.origin.y + delta.y,
      },
    },
  };
}

export function canResizeAnnotation(
  annotation: PdfAnnotation,
): annotation is Exclude<
  PdfAnnotation,
  Extract<PdfAnnotation, { kind: 'line' | 'freehand' }>
> {
  return annotation.kind !== 'line' && annotation.kind !== 'freehand';
}

function resizeImageBox(
  box: PdfOrientedBox,
  action: AnnotationResizeAction,
  step: number,
): PdfOrientedBox {
  const isWidth = action.endsWith('width');
  const increasing = action.startsWith('increase');
  const currentAxis = isWidth ? box.width : box.height;
  const targetAxis = Math.max(
    MIN_ANNOTATION_BOX_SIZE_USER_UNITS,
    currentAxis + (increasing ? step : -step),
  );
  const requestedScale = targetAxis / currentAxis;
  const minimumScale = Math.max(
    MIN_ANNOTATION_BOX_SIZE_USER_UNITS / box.width,
    MIN_ANNOTATION_BOX_SIZE_USER_UNITS / box.height,
  );
  const scale = Math.max(requestedScale, minimumScale);
  if (scale === 1) return box;
  return { ...box, width: box.width * scale, height: box.height * scale };
}

export function resizeAnnotationByKeyboard(
  annotation: PdfAnnotation,
  action: AnnotationResizeAction,
  step = ANNOTATION_KEYBOARD_STEP_USER_UNITS,
): PdfAnnotation {
  if (!canResizeAnnotation(annotation)) return annotation;
  const box = annotation.box;
  if (annotation.kind === 'image' || annotation.kind === 'signature') {
    const resized = resizeImageBox(box, action, step);
    return resized === box ? annotation : { ...annotation, box: resized };
  }

  const dimension = action.endsWith('width') ? 'width' : 'height';
  const current = box[dimension];
  const next = Math.max(
    MIN_ANNOTATION_BOX_SIZE_USER_UNITS,
    current + (action.startsWith('increase') ? step : -step),
  );
  return next === current
    ? annotation
    : { ...annotation, box: { ...box, [dimension]: next } };
}

export function canResizeAnnotationByKeyboard(
  annotation: PdfAnnotation,
  action: AnnotationResizeAction,
): boolean {
  return resizeAnnotationByKeyboard(annotation, action) !== annotation;
}

export function adjacentAnnotationIdAfterDelete(
  annotations: readonly PdfAnnotation[],
  deletedIndex: number,
): AnnotationId | null {
  return (
    annotations[deletedIndex + 1]?.id ??
    annotations[deletedIndex - 1]?.id ??
    null
  );
}
