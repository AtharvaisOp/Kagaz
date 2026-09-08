import { pdfUserLengthToViewportPixels } from '../geometry/coordinateTransforms';
import { TEXT_BOX_INSET_USER_UNITS } from '../model/textLayoutPolicy';

import type { AnnotationViewport } from './annotationProjection';

export function projectTextFontSize(
  fontSizeUserUnits: number,
  viewport: AnnotationViewport,
): number {
  return pdfUserLengthToViewportPixels(fontSizeUserUnits, viewport);
}

export function projectTextBoxInset(viewport: AnnotationViewport): number {
  return pdfUserLengthToViewportPixels(TEXT_BOX_INSET_USER_UNITS, viewport);
}
