import { describe, expect, it } from 'vitest';

import {
  formWidgetRectCorners,
  formWidgetRectToOrientedBox,
  normalizeRawRect,
} from './formWidgetGeometry';

describe('form widget geometry', () => {
  it('normalizes PDF.js rectangles without rebasing the page origin', () => {
    expect(normalizeRawRect([40, -20, -10, 30])).toEqual([-10, -20, 40, 30]);
  });

  it.each([
    [0, { x: 10, y: 20 }, 30, 50],
    [90, { x: 40, y: 20 }, 50, 30],
    [180, { x: 40, y: 70 }, 30, 50],
    [270, { x: 10, y: 70 }, 50, 30],
  ] as const)(
    'maps widget rotation %s to an oriented box',
    (rotation, origin, width, height) => {
      expect(
        formWidgetRectToOrientedBox([10, 20, 40, 70], rotation),
      ).toMatchObject({
        origin,
        width,
        height,
        rotation,
      });
    },
  );

  it('keeps rotated corners on the original raw rectangle', () => {
    expect(formWidgetRectCorners([10, 20, 40, 70], 90)).toEqual([
      { x: 40, y: 20 },
      { x: 40, y: 70 },
      { x: 10, y: 70 },
      { x: 10, y: 20 },
    ]);
  });
});
