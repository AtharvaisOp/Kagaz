import type { FillStyle, RgbColor, StrokeStyle } from './types';
import type { DocumentFontId } from '../../../lib/fonts/fontCatalog';

export type AnnotationTool =
  | 'select'
  | 'text'
  | 'highlight'
  | 'rectangle'
  | 'ellipse'
  | 'line'
  | 'freehand'
  | 'image'
  | 'signature';

export interface AnnotationStyleDefaults {
  readonly strokeColor: RgbColor;
  readonly fillColor: RgbColor;
  readonly strokeWidth: number;
  readonly opacity: number;
  readonly fontSize: number;
  readonly fontFamily?: DocumentFontId;
  readonly lineHeight?: number;
  readonly textAlign: 'left' | 'center' | 'right';
}

export const DEFAULT_ANNOTATION_STYLE: AnnotationStyleDefaults = {
  strokeColor: { r: 0.06, g: 0.73, b: 0.82 },
  fillColor: { r: 1, g: 0.84, b: 0.12 },
  strokeWidth: 2,
  opacity: 0.35,
  fontSize: 14,
  fontFamily: 'helvetica',
  lineHeight: 1.2,
  textAlign: 'left',
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
