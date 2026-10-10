import { describe, expect, it } from 'vitest';
import { createDefaultWatermark } from '../../../features/pdf-watermarks/model/watermark';
import { assertWatermarkGeometry, watermarkPlacement } from './geometry';

const config = createDefaultWatermark('watermark');

describe('final oriented watermark geometry', () => {
  it.each([0, 90, 180, 270])(
    'maps centered placement back into cropped raw space at %i°',
    (rotation) => {
      const placement = watermarkPlacement(
        { ...config, rotation: 0, scale: 1 },
        { viewBox: [10, 20, 310, 220], userUnit: 2, rotation },
        100,
        40,
      );
      const expected =
        rotation === 0
          ? { x: 110, y: 100 }
          : rotation === 90
            ? { x: 180, y: 70 }
            : rotation === 180
              ? { x: 210, y: 140 }
              : { x: 140, y: 170 };
      expect(placement.origin).toEqual(expected);
      expect(placement.rotation).toBe(rotation);
    },
  );
  it.each(['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const)(
    'fits the complete rotated AABB before anchoring %s',
    (position) => {
      const placement = watermarkPlacement(
        { ...config, position, rotation: 35, scale: 1 },
        { viewBox: [0, 0, 300, 200], userUnit: 1, rotation: 90 },
        2000,
        40,
      );
      const bounds = placement.orientedBounds;
      expect(bounds.x).toBeGreaterThanOrEqual(10 - 1e-7);
      expect(bounds.y).toBeGreaterThanOrEqual(15 - 1e-7);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(190 + 1e-7);
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(285 + 1e-7);
      expect(
        position.endsWith('left') ? bounds.x : bounds.x + bounds.width,
      ).toBeCloseTo(position.endsWith('left') ? 10 : 190);
      expect(
        position.startsWith('top') ? bounds.y + bounds.height : bounds.y,
      ).toBeCloseTo(position.startsWith('top') ? 285 : 15);
    },
  );
  it('uses normalized custom positions within the remaining span, with Y from bottom', () => {
    const placement = watermarkPlacement(
      {
        ...config,
        position: 'custom',
        customPosition: { x: 0.25, y: 0.75 },
        rotation: 0,
        scale: 1,
      },
      { viewBox: [0, 0, 300, 200], userUnit: 1, rotation: 0 },
      100,
      40,
    );
    expect(placement.orientedBounds).toEqual({
      x: 57.5,
      y: 115,
      width: 100,
      height: 40,
    });
  });
  it('preserves aspect ratio and scales both dimensions together', () => {
    const first = watermarkPlacement(
      { ...config, rotation: -67, scale: 1 },
      { viewBox: [0, 0, 300, 200], userUnit: 1, rotation: 270 },
      1200,
      400,
    );
    const second = watermarkPlacement(
      { ...config, rotation: -67, scale: 0.25 },
      { viewBox: [0, 0, 300, 200], userUnit: 1, rotation: 270 },
      1200,
      400,
    );
    expect(first.width / first.height).toBeCloseTo(3);
    expect(second.width).toBeCloseTo(first.width / 4);
    expect(second.height).toBeCloseTo(first.height / 4);
  });
  it.each([
    { viewBox: [0, 0, Infinity, 200], userUnit: 1, rotation: 0 },
    { viewBox: [0, 0, 300, 200], userUnit: NaN, rotation: 0 },
    { viewBox: [0, 0, 300, 200], userUnit: 75001, rotation: 0 },
    { viewBox: [0, 0, 300, 200], userUnit: 75000, rotation: 0 },
    { viewBox: [0, 0, 300, 200], userUnit: 1, rotation: 45 },
    { viewBox: [0, 0, 300, 200], userUnit: 1, rotation: Infinity },
    { viewBox: [0, 0, 300, 0], userUnit: 1, rotation: 0 },
    { viewBox: [0, 0, 14401, 200], userUnit: 1, rotation: 0 },
  ])(
    'rejects unsafe page geometry %j without allocating a bitmap',
    (geometry) => {
      expect(() => assertWatermarkGeometry(geometry)).toThrowError(
        expect.objectContaining({ code: 'watermark-invalid' }),
      );
    },
  );
});
