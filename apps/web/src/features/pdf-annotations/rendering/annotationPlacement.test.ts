import { describe, expect, it } from 'vitest';

import type { CoordinateViewport } from '../geometry/coordinateTransforms';
import {
  createImagePlacementBox,
  createTextPlacementBox,
} from './annotationPlacement';

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

describe('text and image placement geometry', () => {
  it('creates and clamps a default text box for a click', () => {
    const box = createTextPlacementBox(
      { x: 580, y: 790 },
      { x: 580, y: 790 },
      viewport,
    );
    expect(box).toMatchObject({ width: 240, height: 96, rotation: 0 });
    expect(box.origin).toEqual({ x: 360, y: 0 });
  });

  it('uses a dragged text rectangle in canonical units', () => {
    const box = createTextPlacementBox(
      { x: 220, y: 260 },
      { x: 100, y: 120 },
      viewport,
    );
    expect(box).toEqual({
      origin: { x: 100, y: 540 },
      width: 120,
      height: 140,
      rotation: 0,
    });
  });

  it('preserves image aspect ratio for click and drag placement', () => {
    const clicked = createImagePlacementBox(
      { x: 10, y: 20 },
      { x: 10, y: 20 },
      2,
      viewport,
    );
    const dragged = createImagePlacementBox(
      { x: 20, y: 30 },
      { x: 180, y: 90 },
      2,
      viewport,
    );
    expect(clicked.width / clicked.height).toBeCloseTo(2, 6);
    expect(dragged.width / dragged.height).toBeCloseTo(2, 6);
  });

  it('converts image placement through UserUnit and a nonzero page origin', () => {
    const scaledViewport: CoordinateViewport = {
      width: 1200,
      height: 1600,
      viewBox: [10, 20, 610, 820],
      userUnit: 2,
      rotation: 0,
      transform: [2, 0, 0, -2, -20, 1640],
      convertToPdfPoint: (x, y) => [10 + x / 2, 820 - y / 2],
      convertToViewportPoint: (x, y) => [(x - 10) * 2, (820 - y) * 2],
    };
    const box = createImagePlacementBox(
      { x: 200, y: 300 },
      { x: 600, y: 500 },
      2,
      scaledViewport,
    );
    expect(box).toEqual({
      origin: { x: 110, y: 570 },
      width: 200,
      height: 100,
      rotation: 0,
    });
  });
});
