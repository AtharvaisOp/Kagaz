import type {
  PdfOrientedBox,
  PdfPoint,
} from '../../../features/pdf-annotations/model/types';

import { pdfOrientedBoxToCorners } from '../../../features/pdf-annotations/geometry/orientedBox';

export interface PdfBasis {
  readonly right: PdfPoint;
  readonly up: PdfPoint;
}

/** Returns the canonical PDF-space basis for an oriented annotation box. */
export function pdfOrientedBoxBasis(box: PdfOrientedBox): PdfBasis {
  switch (box.rotation) {
    case 0:
      return { right: { x: 1, y: 0 }, up: { x: 0, y: 1 } };
    case 90:
      return { right: { x: 0, y: 1 }, up: { x: -1, y: 0 } };
    case 180:
      return { right: { x: -1, y: 0 }, up: { x: 0, y: -1 } };
    case 270:
      return { right: { x: 0, y: -1 }, up: { x: 1, y: 0 } };
  }
}

/** Maps a point in the box's local bottom-left coordinate system to PDF space. */
export function localPointToPdf(
  box: PdfOrientedBox,
  localX: number,
  localY: number,
): PdfPoint {
  const { right, up } = pdfOrientedBoxBasis(box);
  return {
    x: box.origin.x + right.x * localX + up.x * localY,
    y: box.origin.y + right.y * localX + up.y * localY,
  };
}

export function pdfOrientedBoxCenter(box: PdfOrientedBox): PdfPoint {
  const corners = pdfOrientedBoxToCorners(box);
  return {
    x: corners.reduce((sum, point) => sum + point.x, 0) / corners.length,
    y: corners.reduce((sum, point) => sum + point.y, 0) / corners.length,
  };
}
