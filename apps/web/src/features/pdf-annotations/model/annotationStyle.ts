import type { AnnotationStyleDefaults } from './editorTypes';

import type { PdfAnnotation } from './types';

export function applyAnnotationStyleDefaults(
  annotation: PdfAnnotation,
  styles: AnnotationStyleDefaults,
  patch: Partial<AnnotationStyleDefaults>,
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
      return patch.fillColor === undefined && patch.opacity === undefined
        ? annotation
        : {
            ...annotation,
            fill: {
              color:
                patch.fillColor === undefined
                  ? annotation.fill.color
                  : styles.fillColor,
              opacity:
                patch.opacity === undefined
                  ? annotation.fill.opacity
                  : styles.opacity,
            },
          };
    case 'rectangle':
    case 'ellipse':
      if (
        patch.strokeColor === undefined &&
        patch.strokeWidth === undefined &&
        patch.fillColor === undefined &&
        patch.opacity === undefined
      ) {
        return annotation;
      }
      return {
        ...annotation,
        stroke: annotation.stroke
          ? {
              color:
                patch.strokeColor === undefined
                  ? annotation.stroke.color
                  : styles.strokeColor,
              widthUserUnits:
                patch.strokeWidth === undefined
                  ? annotation.stroke.widthUserUnits
                  : styles.strokeWidth,
              opacity:
                patch.opacity === undefined
                  ? annotation.stroke.opacity
                  : styles.opacity,
            }
          : null,
        fill: annotation.fill
          ? {
              color:
                patch.fillColor === undefined
                  ? annotation.fill.color
                  : styles.fillColor,
              opacity:
                patch.opacity === undefined
                  ? annotation.fill.opacity
                  : Math.min(styles.opacity, 0.25),
            }
          : null,
      };
    case 'line':
    case 'freehand':
      if (
        patch.strokeColor === undefined &&
        patch.strokeWidth === undefined &&
        patch.opacity === undefined
      ) {
        return annotation;
      }
      return {
        ...annotation,
        stroke: {
          color:
            patch.strokeColor === undefined
              ? annotation.stroke.color
              : styles.strokeColor,
          widthUserUnits:
            patch.strokeWidth === undefined
              ? annotation.stroke.widthUserUnits
              : styles.strokeWidth,
          opacity:
            patch.opacity === undefined
              ? annotation.stroke.opacity
              : styles.opacity,
        },
      };
    default:
      return annotation;
  }
}
