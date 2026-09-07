import {
  pdfOrientedBoxToViewportQuad,
  viewportPointToPdfPoint,
  type CoordinateViewport,
  type ViewportPoint,
} from './coordinateTransforms';
import { orientedBoxFromBasis } from './orientedBox';

import type { PdfOrientedBox } from '../model/types';

export interface ViewportOrientedFrame {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly angle: number;
}

export function projectPdfBoxToOrientedFrame(
  box: PdfOrientedBox,
  viewport: CoordinateViewport,
): ViewportOrientedFrame {
  const quad = pdfOrientedBoxToViewportQuad(box, viewport);
  const topLeft = quad[3];
  const topRight = quad[2];
  const bottomLeft = quad[0];
  return {
    x: topLeft.x,
    y: topLeft.y,
    width: Math.hypot(topRight.x - topLeft.x, topRight.y - topLeft.y),
    height: Math.hypot(bottomLeft.x - topLeft.x, bottomLeft.y - topLeft.y),
    angle:
      (Math.atan2(topRight.y - topLeft.y, topRight.x - topLeft.x) * 180) /
      Math.PI,
  };
}

export function viewportOrientedFrameToPdfBox(
  frame: ViewportOrientedFrame,
  viewport: CoordinateViewport,
): PdfOrientedBox | null {
  if (
    !Number.isFinite(frame.x) ||
    !Number.isFinite(frame.y) ||
    !Number.isFinite(frame.width) ||
    !Number.isFinite(frame.height) ||
    !Number.isFinite(frame.angle) ||
    frame.width <= 0 ||
    frame.height <= 0
  ) {
    return null;
  }
  const radians = (frame.angle * Math.PI) / 180;
  const right = { x: Math.cos(radians), y: Math.sin(radians) };
  const down = { x: -Math.sin(radians), y: Math.cos(radians) };
  const topLeft: ViewportPoint = { x: frame.x, y: frame.y };
  const topRight: ViewportPoint = {
    x: frame.x + right.x * frame.width,
    y: frame.y + right.y * frame.width,
  };
  const bottomLeft: ViewportPoint = {
    x: frame.x + down.x * frame.height,
    y: frame.y + down.y * frame.height,
  };
  const bottomRight: ViewportPoint = {
    x: topRight.x + down.x * frame.height,
    y: topRight.y + down.y * frame.height,
  };
  const origin = viewportPointToPdfPoint(bottomLeft, viewport);
  const rightPdf = viewportPointToPdfPoint(bottomRight, viewport);
  const upPdf = viewportPointToPdfPoint(topLeft, viewport);
  return orientedBoxFromBasis(
    origin,
    { x: rightPdf.x - origin.x, y: rightPdf.y - origin.y },
    { x: upPdf.x - origin.x, y: upPdf.y - origin.y },
  );
}
