import { describe, expect, it } from 'vitest';

import type { CoordinateViewport } from '../geometry/coordinateTransforms';
import {
  captureAnnotationGesture,
  constrainedTransformBox,
  gestureMatchesViewport,
  transformedAnnotationBox,
} from './annotationGesture';

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

const annotation = {
  id: 'rectangle-1',
  workspacePageId: 'page-1',
  kind: 'rectangle' as const,
  box: {
    origin: { x: 100, y: 500 },
    width: 120,
    height: 80,
    rotation: 0 as const,
  },
  stroke: null,
  fill: null,
};

describe('annotation transform gesture boundary', () => {
  it('captures ownership and rejects a stale viewport', () => {
    const gesture = captureAnnotationGesture(annotation, 'page-1:100', {
      x: 100,
      y: 200,
      width: 120,
      height: 80,
      scaleX: 1,
      scaleY: 1,
    });

    expect(gesture.start.width).toBe(120);
    expect(gestureMatchesViewport(gesture, 'page-1:100')).toBe(true);
    expect(gestureMatchesViewport(gesture, 'page-1:110')).toBe(false);
  });

  it('converts the final scaled node geometry once into canonical PDF space', () => {
    const box = transformedAnnotationBox(
      annotation,
      {
        x: 100,
        y: 200,
        width: 120,
        height: 80,
        scaleX: 1.5,
        scaleY: 0.5,
      },
      viewport,
    );

    expect(box).toEqual({
      origin: { x: 100, y: 560 },
      width: 180,
      height: 40,
      rotation: 0,
    });
  });

  it('rejects non-positive scale and prevents small or flipped boxes', () => {
    expect(
      transformedAnnotationBox(
        annotation,
        {
          x: 100,
          y: 200,
          width: 120,
          height: 80,
          scaleX: -1,
          scaleY: 1,
        },
        viewport,
      ),
    ).toBeNull();

    const oldBox = {
      x: 10,
      y: 10,
      width: 40,
      height: 40,
      scaleX: 1,
      scaleY: 1,
    };
    expect(constrainedTransformBox(oldBox, { ...oldBox, width: 7 })).toBe(
      oldBox,
    );
    expect(constrainedTransformBox(oldBox, { ...oldBox, width: -20 })).toBe(
      oldBox,
    );
    expect(constrainedTransformBox(oldBox, { ...oldBox, width: 50 })).toEqual({
      ...oldBox,
      width: 50,
    });
  });
});
