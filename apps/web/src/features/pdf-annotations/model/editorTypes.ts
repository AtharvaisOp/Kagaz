import type { FillStyle, RgbColor, StrokeStyle } from './types';

export type AnnotationTool =
  'select' | 'highlight' | 'rectangle' | 'ellipse' | 'line' | 'freehand';

export interface AnnotationStyleDefaults {
  readonly strokeColor: RgbColor;
  readonly fillColor: RgbColor;
  readonly strokeWidth: number;
  readonly opacity: number;
}

export const DEFAULT_ANNOTATION_STYLE: AnnotationStyleDefaults = {
  strokeColor: { r: 0.06, g: 0.73, b: 0.82 },
  fillColor: { r: 1, g: 0.84, b: 0.12 },
  strokeWidth: 2,
  opacity: 0.35,
};

export function createStrokeStyle(
  style: AnnotationStyleDefaults,
  opacity = 1,
): StrokeStyle {
  return {
    color: style.strokeColor,
    widthUserUnits: style.strokeWidth,
    opacity,
  };
}

export function createFillStyle(
  style: AnnotationStyleDefaults,
  opacity = style.opacity,
): FillStyle {
  return { color: style.fillColor, opacity };
}
