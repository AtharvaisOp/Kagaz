import {
  viewportRectToPdfOrientedBox,
  type CoordinateViewport,
  type ViewportPoint,
  type ViewportRect,
} from '../geometry/coordinateTransforms';

import type { PdfOrientedBox } from '../model/types';

const MIN_DRAG_SIZE = 6;

function clampRectToViewport(
  rect: ViewportRect,
  viewport: CoordinateViewport,
): ViewportRect {
  const width = Math.min(rect.width, viewport.width);
  const height = Math.min(rect.height, viewport.height);
  return {
    x: Math.max(0, Math.min(rect.x, viewport.width - width)),
    y: Math.max(0, Math.min(rect.y, viewport.height - height)),
    width,
    height,
  };
}

export function createTextPlacementBox(
  start: ViewportPoint,
  end: ViewportPoint,
  viewport: CoordinateViewport,
): PdfOrientedBox {
  const width = Math.abs(end.x - start.x);
  const height = Math.abs(end.y - start.y);
  const dragged = width >= MIN_DRAG_SIZE && height >= MIN_DRAG_SIZE;
  const rect = dragged
    ? {
        x: Math.min(start.x, end.x),
        y: Math.min(start.y, end.y),
        width,
        height,
      }
    : {
        x: start.x,
        y: start.y,
        width: Math.min(240, viewport.width * 0.48),
        height: Math.min(96, viewport.height * 0.18),
      };
  return viewportRectToPdfOrientedBox(
    clampRectToViewport(rect, viewport),
    viewport,
  );
}

export function createImagePlacementBox(
  start: ViewportPoint,
  end: ViewportPoint,
  aspectRatio: number,
  viewport: CoordinateViewport,
): PdfOrientedBox {
  const safeAspect =
    Number.isFinite(aspectRatio) && aspectRatio > 0 ? aspectRatio : 1;
  const deltaX = end.x - start.x;
  const deltaY = end.y - start.y;
  let width = Math.abs(deltaX);
  let height = Math.abs(deltaY);
  const dragged = width >= MIN_DRAG_SIZE || height >= MIN_DRAG_SIZE;

  if (dragged) {
    if (width / Math.max(height, 1) > safeAspect) height = width / safeAspect;
    else width = height * safeAspect;
  } else {
    width = Math.min(240, viewport.width * 0.36);
    height = width / safeAspect;
    if (height > viewport.height * 0.36) {
      height = viewport.height * 0.36;
      width = height * safeAspect;
    }
  }

  const rect = clampRectToViewport(
    {
      x: dragged && deltaX < 0 ? start.x - width : start.x,
      y: dragged && deltaY < 0 ? start.y - height : start.y,
      width,
      height,
    },
    viewport,
  );
  return viewportRectToPdfOrientedBox(rect, viewport);
}
