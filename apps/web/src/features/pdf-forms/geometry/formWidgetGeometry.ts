import type { PageRotation } from '../../pdf-workspace/model/types';
import type {
  PdfOrientedBox,
  PdfPoint,
} from '../../pdf-annotations/model/types';

import type { FormRawRect } from '../model/types';

function normalizeRotation(value: number | null | undefined): PageRotation {
  const normalized = ((Math.round(value ?? 0) % 360) + 360) % 360;
  return normalized === 90 || normalized === 180 || normalized === 270
    ? normalized
    : 0;
}

export function normalizeRawRect(rect: readonly number[]): FormRawRect | null {
  if (rect.length !== 4 || rect.some((value) => !Number.isFinite(value))) {
    return null;
  }

  const [firstX, firstY, secondX, secondY] = rect;
  if (
    firstX === undefined ||
    firstY === undefined ||
    secondX === undefined ||
    secondY === undefined
  ) {
    return null;
  }

  const left = Math.min(firstX, secondX);
  const right = Math.max(firstX, secondX);
  const bottom = Math.min(firstY, secondY);
  const top = Math.max(firstY, secondY);
  return right > left && top > bottom ? [left, bottom, right, top] : null;
}

/** Maps an annotation rect to the existing raw PDF oriented-box contract. */
export function formWidgetRectToOrientedBox(
  rect: FormRawRect,
  rotationValue: number | null | undefined,
): PdfOrientedBox {
  const [left, bottom, right, top] = rect;
  const rotation = normalizeRotation(rotationValue);
  const width = right - left;
  const height = top - bottom;

  switch (rotation) {
    case 90:
      return {
        origin: { x: right, y: bottom },
        width: height,
        height: width,
        rotation,
      };
    case 180:
      return {
        origin: { x: right, y: top },
        width,
        height,
        rotation,
      };
    case 270:
      return {
        origin: { x: left, y: top },
        width: height,
        height: width,
        rotation,
      };
    case 0:
      return {
        origin: { x: left, y: bottom },
        width,
        height,
        rotation,
      };
  }
}

export function formWidgetRectCorners(
  rect: FormRawRect,
  rotationValue: number | null | undefined,
): readonly [PdfPoint, PdfPoint, PdfPoint, PdfPoint] {
  const box = formWidgetRectToOrientedBox(rect, rotationValue);
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
