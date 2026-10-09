import {
  clientPointToViewportPoint,
  viewportPointToPdfPoint,
  pdfPointToViewportPoint,
  type CoordinateViewport,
} from '../../pdf-annotations/geometry/coordinateTransforms';
import type { RedactionBox } from './types';

export function isRedactionBox(box: RedactionBox): boolean {
  return (
    [
      box.x,
      box.y,
      box.width,
      box.height,
      box.x + box.width,
      box.y + box.height,
    ].every(Number.isFinite) &&
    box.width > 0 &&
    box.height > 0
  );
}

export function boxWithinPage(
  box: RedactionBox,
  bounds: RedactionBox,
): boolean {
  const epsilon = 1e-6;
  return (
    isRedactionBox(box) &&
    isRedactionBox(bounds) &&
    box.x >= bounds.x - epsilon &&
    box.y >= bounds.y - epsilon &&
    box.x + box.width <= bounds.x + bounds.width + epsilon &&
    box.y + box.height <= bounds.y + bounds.height + epsilon
  );
}

export function viewportPageBounds(viewport: CoordinateViewport): RedactionBox {
  const [x, y, right, top] = viewport.viewBox;
  if (
    x === undefined ||
    y === undefined ||
    right === undefined ||
    top === undefined
  )
    throw new RangeError('The page bounds are unavailable.');
  const box = { x, y, width: right - x, height: top - y };
  if (!isRedactionBox(box))
    throw new RangeError('The page bounds are invalid.');
  return box;
}

export function clientToRedactionPoint(
  client: { x: number; y: number },
  bounds: Pick<DOMRectReadOnly, 'left' | 'top' | 'width' | 'height'>,
  viewport: CoordinateViewport,
): { x: number; y: number } {
  const point = viewportPointToPdfPoint(
    clientPointToViewportPoint(client, bounds, viewport),
    viewport,
  );
  const page = viewportPageBounds(viewport);
  return {
    x: Math.min(page.x + page.width, Math.max(page.x, point.x)),
    y: Math.min(page.y + page.height, Math.max(page.y, point.y)),
  };
}

export function redactionBoxFromPoints(
  start: { x: number; y: number },
  end: { x: number; y: number },
): RedactionBox {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  };
}

export function projectRedactionBox(
  box: RedactionBox,
  viewport: CoordinateViewport,
): RedactionBox {
  const first = pdfPointToViewportPoint({ x: box.x, y: box.y }, viewport);
  const second = pdfPointToViewportPoint(
    { x: box.x + box.width, y: box.y + box.height },
    viewport,
  );
  return redactionBoxFromPoints(first, second);
}

export function moveRedactionBox(
  box: RedactionBox,
  dx: number,
  dy: number,
  bounds: RedactionBox,
): RedactionBox {
  return {
    ...box,
    x: Math.max(
      bounds.x,
      Math.min(bounds.x + bounds.width - box.width, box.x + dx),
    ),
    y: Math.max(
      bounds.y,
      Math.min(bounds.y + bounds.height - box.height, box.y + dy),
    ),
  };
}
