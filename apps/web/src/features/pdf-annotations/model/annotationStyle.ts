import {
  createFillStyle,
  createStrokeStyle,
  type AnnotationStyleDefaults,
} from './editorTypes';

import type { PdfAnnotation } from './types';

export function applyAnnotationStyleDefaults(
  annotation: PdfAnnotation,
  styles: AnnotationStyleDefaults,
): PdfAnnotation {
  switch (annotation.kind) {
    case 'highlight':
      return { ...annotation, fill: createFillStyle(styles) };
    case 'rectangle':
    case 'ellipse':
      return {
        ...annotation,
        stroke: createStrokeStyle(styles),
        fill: annotation.fill
          ? createFillStyle(styles, Math.min(styles.opacity, 0.25))
          : null,
      };
    case 'line':
    case 'freehand':
      return {
        ...annotation,
        stroke: createStrokeStyle(styles, styles.opacity),
      };
    default:
      return annotation;
  }
}
