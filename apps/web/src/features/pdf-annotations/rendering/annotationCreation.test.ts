import { describe, expect, it } from 'vitest';

import type { CoordinateViewport } from '../geometry/coordinateTransforms';
import { DEFAULT_ANNOTATION_STYLE } from '../model/editorTypes';
import {
  createAnnotationFromDraft,
  normalizeViewportRect,
} from './annotationCreation';
import { dedupeViewportPoints, simplifyRdp } from './simplifyFreehand';

const viewport: CoordinateViewport = {
  width: 600,
  height: 800,
  viewBox: [0, 0, 600, 800],
  userUnit: 1,
  rotation: 0,
  transform: [1, 0, 0, -1, 0, 800],
  convertToPdfPoint: (x, y) => [x, 800 - y],
  convertToViewportPoint: (x, y) => [x, 800 - y],
};

function draft(
  tool: 'highlight' | 'rectangle' | 'ellipse' | 'line' | 'freehand',
) {
  return {
    tool,
    workspacePageId: 'page-1',
    viewportSignature: 'page-1:1',
    viewport,
    start: { x: 100, y: 120 },
    current: { x: 220, y: 240 },
    points: [
      { x: 100, y: 120 },
      { x: 140, y: 150 },
      { x: 220, y: 240 },
    ],
  } as const;
}

describe('annotation creation boundary', () => {
  it('normalizes rectangles drawn in any direction', () => {
    expect(
      normalizeViewportRect({ x: 220, y: 240 }, { x: 100, y: 120 }),
    ).toEqual({
      x: 100,
      y: 120,
      width: 120,
      height: 120,
    });
  });

  it('creates each vector kind in canonical PDF coordinates', () => {
    for (const tool of [
      'highlight',
      'rectangle',
      'ellipse',
      'line',
      'freehand',
    ] as const) {
      const annotation = createAnnotationFromDraft(
        draft(tool),
        DEFAULT_ANNOTATION_STYLE,
        `${tool}-1`,
      );
      expect(annotation?.kind).toBe(tool);
      expect(annotation?.workspacePageId).toBe('page-1');
    }
    const rectangle = createAnnotationFromDraft(
      draft('rectangle'),
      DEFAULT_ANNOTATION_STYLE,
      'r',
    );
    expect(rectangle && 'box' in rectangle ? rectangle.box.width : 0).toBe(120);
  });

  it('rejects tiny shape gestures', () => {
    const tiny = { ...draft('ellipse'), current: { x: 103, y: 104 } };
    expect(
      createAnnotationFromDraft(tiny, DEFAULT_ANNOTATION_STYLE, 'tiny'),
    ).toBeNull();
  });

  it('deduplicates samples and simplifies a near-straight stroke', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 0.2, y: 0.1 },
      { x: 10, y: 10 },
      { x: 20, y: 20 },
    ];
    expect(dedupeViewportPoints(points, 1)).toHaveLength(3);
    expect(simplifyRdp(points, 1)).toEqual([
      { x: 0, y: 0 },
      { x: 20, y: 20 },
    ]);
  });
});
