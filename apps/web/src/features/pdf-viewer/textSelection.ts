import {
  viewportRectToPdfOrientedBox,
  type CoordinateViewport,
  type ViewportRect,
} from '../pdf-annotations/geometry/coordinateTransforms';
import type { PdfOrientedBox } from '../pdf-annotations/model/types';

/** Browser rectangles are CSS pixels, never canvas/device pixels. */
export function selectionRectToPdfBox(
  rect: Pick<DOMRectReadOnly, 'left' | 'top' | 'width' | 'height'>,
  surface: Pick<DOMRectReadOnly, 'left' | 'top' | 'width' | 'height'>,
  viewport: CoordinateViewport,
): PdfOrientedBox | null {
  if (surface.width <= 0 || surface.height <= 0) return null;
  const x = Math.max(0, rect.left - surface.left);
  const y = Math.max(0, rect.top - surface.top);
  const right = Math.min(surface.width, rect.left - surface.left + rect.width);
  const bottom = Math.min(surface.height, rect.top - surface.top + rect.height);
  if (right - x < 0.5 || bottom - y < 0.5) return null;
  return viewportRectToPdfOrientedBox(
    {
      x: (x * viewport.width) / surface.width,
      y: (y * viewport.height) / surface.height,
      width: ((right - x) * viewport.width) / surface.width,
      height: ((bottom - y) * viewport.height) / surface.height,
    },
    viewport,
  );
}

/** Intersect each text run separately: Range.getBoundingClientRect bridges lines. */
export function selectedTextRects(
  layer: HTMLElement,
  selection: Selection,
): ViewportRect[] {
  const rectangles: ViewportRect[] = [];
  if (selection.isCollapsed) return rectangles;
  const seen = new Set<string>();
  for (let index = 0; index < selection.rangeCount; index++) {
    const selected = selection.getRangeAt(index);
    for (const span of layer.querySelectorAll<HTMLSpanElement>(
      'span[role="presentation"]',
    )) {
      const text = span.firstChild;
      if (
        !text ||
        text.nodeType !== Node.TEXT_NODE ||
        !selected.intersectsNode(text)
      )
        continue;
      const part = document.createRange();
      part.selectNodeContents(text);
      if (selected.compareBoundaryPoints(Range.START_TO_START, part) > 0)
        part.setStart(selected.startContainer, selected.startOffset);
      if (selected.compareBoundaryPoints(Range.END_TO_END, part) < 0)
        part.setEnd(selected.endContainer, selected.endOffset);
      if (part.collapsed || !part.toString().trim()) continue;
      for (const rect of part.getClientRects()) {
        const key = [rect.x, rect.y, rect.width, rect.height]
          .map((value) => value.toFixed(2))
          .join(':');
        if (seen.has(key) || rect.width < 0.5 || rect.height < 0.5) continue;
        seen.add(key);
        rectangles.push({
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
        });
      }
    }
  }
  return rectangles;
}
