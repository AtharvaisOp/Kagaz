import {
  viewportPointToPdfPoint,
  viewportRectToPdfOrientedBox,
  type ViewportPoint,
  type ViewportRect,
} from '../geometry/coordinateTransforms';
import type { AnnotationViewport } from './annotationProjection';
import { dedupeViewportPoints, simplifyRdp } from './simplifyFreehand';
import {
  createFillStyle,
  createStrokeStyle,
  type AnnotationStyleDefaults,
  type AnnotationTool,
} from '../model/editorTypes';
import type { FreehandAnnotation, PdfAnnotation } from '../model/types';

export interface CreationDraft {
  readonly tool: Exclude<AnnotationTool, 'select'>;
  readonly workspacePageId: string;
  readonly viewportSignature: string;
  readonly viewport: AnnotationViewport;
  readonly start: ViewportPoint;
  readonly current: ViewportPoint;
  readonly points: readonly ViewportPoint[];
}

export function normalizeViewportRect(
  start: ViewportPoint,
  end: ViewportPoint,
): ViewportRect {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  };
}

export function creationHasMinimumSize(draft: CreationDraft): boolean {
  if (draft.tool === 'line') {
    return (
      Math.hypot(
        draft.current.x - draft.start.x,
        draft.current.y - draft.start.y,
      ) >= 6
    );
  }
  if (draft.tool === 'freehand') return draft.points.length >= 2;
  const rect = normalizeViewportRect(draft.start, draft.current);
  return rect.width >= 6 && rect.height >= 6;
}

export function createAnnotationFromDraft(
  draft: CreationDraft,
  styles: AnnotationStyleDefaults,
  id: string,
): PdfAnnotation | null {
  if (!creationHasMinimumSize(draft)) return null;
  const base = { id, workspacePageId: draft.workspacePageId } as const;
  if (draft.tool === 'line') {
    return {
      ...base,
      kind: 'line',
      start: viewportPointToPdfPoint(draft.start, draft.viewport),
      end: viewportPointToPdfPoint(draft.current, draft.viewport),
      stroke: createStrokeStyle(styles, styles.opacity),
    };
  }
  if (draft.tool === 'freehand') {
    const simplified = simplifyRdp(dedupeViewportPoints(draft.points), 1.5);
    if (simplified.length < 2) return null;
    return {
      ...base,
      kind: 'freehand',
      points: simplified.map((point) =>
        viewportPointToPdfPoint(point, draft.viewport),
      ) as unknown as FreehandAnnotation['points'],
      stroke: createStrokeStyle(styles, styles.opacity),
    };
  }
  const box = viewportRectToPdfOrientedBox(
    normalizeViewportRect(draft.start, draft.current),
    draft.viewport,
  );
  if (draft.tool === 'highlight') {
    return { ...base, kind: 'highlight', box, fill: createFillStyle(styles) };
  }
  return {
    ...base,
    kind: draft.tool,
    box,
    stroke: createStrokeStyle(styles, styles.opacity),
    fill: createFillStyle(styles, Math.min(styles.opacity, 0.25)),
  };
}
