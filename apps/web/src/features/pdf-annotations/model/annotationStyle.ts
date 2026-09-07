import {
  createFillStyle,
  createStrokeStyle,
  type AnnotationStyleDefaults,
} from './editorTypes';

import type { PdfAnnotation } from './types';

export function applyAnnotationStyleDefaults(
  annotation: PdfAnnotation,
  styles: AnnotationStyleDefaults,
  patch: Partial<AnnotationStyleDefaults> = styles,
): PdfAnnotation {
  switch (annotation.kind) {
    case 'text':
      return {
        ...annotation,
        color:
          patch.strokeColor === undefined
            ? annotation.color
            : styles.strokeColor,
        opacity:
          patch.opacity === undefined ? annotation.opacity : styles.opacity,
        fontSizeUserUnits:
          patch.fontSize === undefined
            ? annotation.fontSizeUserUnits
            : styles.fontSize,
        align:
          patch.textAlign === undefined ? annotation.align : styles.textAlign,
      };
    case 'image':
      return patch.opacity === undefined
        ? annotation
        : { ...annotation, opacity: styles.opacity };
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
