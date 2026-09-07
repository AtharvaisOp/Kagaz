import type { PageRotation } from '../../pdf-workspace/model/types';

import type { PdfOrientedBox, PdfPoint } from '../model/types';

export type PdfQuad = readonly [PdfPoint, PdfPoint, PdfPoint, PdfPoint];

export function pdfOrientedBoxToCorners(box: PdfOrientedBox): PdfQuad {
  const { x, y } = box.origin;
  switch (box.rotation) {
    case 0:
      return [
        { x, y },
        { x: x + box.width, y },
        { x: x + box.width, y: y + box.height },
        { x, y: y + box.height },
      ];
    case 90:
      return [
        { x, y },
        { x, y: y + box.width },
        { x: x - box.height, y: y + box.width },
        { x: x - box.height, y },
      ];
    case 180:
      return [
        { x, y },
        { x: x - box.width, y },
        { x: x - box.width, y: y - box.height },
        { x, y: y - box.height },
      ];
    case 270:
      return [
        { x, y },
        { x, y: y - box.width },
        { x: x + box.height, y: y - box.width },
        { x: x + box.height, y },
      ];
  }
}

export function cardinalRotationFromVector(
  vector: PdfPoint,
): PageRotation | null {
  const angle = (Math.atan2(vector.y, vector.x) * 180) / Math.PI;
  const normalized = ((angle % 360) + 360) % 360;
  const cardinal = Math.round(normalized / 90) * 90;
  const normalizedCardinal = (cardinal % 360) as PageRotation;
  const difference = Math.abs(normalized - cardinal);
  return difference <= 1e-6 || Math.abs(difference - 360) <= 1e-6
    ? normalizedCardinal
    : null;
}

export function orientedBoxFromBasis(
  origin: PdfPoint,
  right: PdfPoint,
  up: PdfPoint,
): PdfOrientedBox | null {
  const width = Math.hypot(right.x, right.y);
  const height = Math.hypot(up.x, up.y);
  if (
    !Number.isFinite(width) ||
    width <= 0 ||
    !Number.isFinite(height) ||
    height <= 0
  ) {
    return null;
  }

  const rotation = cardinalRotationFromVector(right);
  if (rotation === null) {
    return null;
  }

  const expectedUp = {
    x: -Math.sin((rotation * Math.PI) / 180) * height,
    y: Math.cos((rotation * Math.PI) / 180) * height,
  };
  const upError = Math.hypot(up.x - expectedUp.x, up.y - expectedUp.y);
  if (upError > 1e-6 * Math.max(1, height)) {
    return null;
  }

  return { origin, width, height, rotation };
}
