import { describe, expect, it } from 'vitest';

import { intersectPageBoxes, pageBoxContainsPoint } from './pageBoxes';

describe('page box helpers', () => {
  it('intersects nonzero and negative-origin boxes', () => {
    expect(intersectPageBoxes([-20, -10, 100, 100], [10, 20, 200, 80])).toEqual(
      [10, 20, 100, 80],
    );
    expect(intersectPageBoxes([-20, -10, 0, 0], [1, 1, 2, 2])).toBeNull();
  });

  it('rejects invalid and zero-area boxes', () => {
    expect(intersectPageBoxes([0, 0, 0, 10], [0, 0, 10, 10])).toBeNull();
    expect(
      intersectPageBoxes([0, 0, Number.NaN, 10], [0, 0, 10, 10]),
    ).toBeNull();
  });

  it('checks points against the visible page plane', () => {
    const box = [-20, 50, 180, 820] as const;
    expect(pageBoxContainsPoint(box, { x: 0, y: 100 })).toBe(true);
    expect(pageBoxContainsPoint(box, { x: -21, y: 100 })).toBe(false);
  });
});
