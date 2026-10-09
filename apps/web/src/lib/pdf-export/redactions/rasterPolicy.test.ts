import { describe, expect, it } from 'vitest';
import {
  redactionPixelBounds,
  redactionRasterDimensions,
} from './rasterPolicy';

const viewport = {
  width: 600,
  height: 400,
  viewBox: [10, 20, 310, 220],
  convertToViewportPoint: (x: number, y: number) => [
    (x - 10) * 2,
    (220 - y) * 2,
  ],
};
const region = {
  id: 'r',
  pageId: 'p',
  box: { x: 40, y: 50, width: 30, height: 20 },
};

describe('redaction raster policy', () => {
  it('uses raw crop coordinates and outward rounding with one-pixel fringe', () => {
    expect(redactionPixelBounds(region, 'p', viewport)).toEqual({
      x: 59,
      y: 299,
      width: 62,
      height: 42,
    });
    expect(
      redactionPixelBounds(
        { ...region, box: { x: 10, y: 20, width: 300, height: 200 } },
        'p',
        viewport,
      ),
    ).toEqual({ x: 0, y: 0, width: 600, height: 400 });
  });
  it('overwrites a pixel for tiny valid subpixel regions', () => {
    const bounds = redactionPixelBounds(
      { ...region, box: { x: 10, y: 20, width: 0.001, height: 0.001 } },
      'p',
      viewport,
    );
    expect(bounds.width).toBeGreaterThan(0);
    expect(bounds.height).toBeGreaterThan(0);
  });
  it.each([
    { x: NaN },
    { y: Infinity },
    { width: 0 },
    { height: -1 },
    { x: 9 },
    { y: 19 },
    { width: 1000 },
    { height: Infinity },
    { x: Number.MAX_VALUE },
  ])('rejects invalid or out-of-page canonical geometry %j', (patch) => {
    expect(() =>
      redactionPixelBounds(
        { ...region, box: { ...region.box, ...patch } },
        'p',
        viewport,
      ),
    ).toThrowError(expect.objectContaining({ code: 'redaction-invalid' }));
  });
  it('rejects mismatched page identity and invalid transforms', () => {
    expect(() => redactionPixelBounds(region, 'different', viewport)).toThrow();
    expect(() =>
      redactionPixelBounds(region, 'p', {
        ...viewport,
        convertToViewportPoint: () => [Infinity, 0],
      }),
    ).toThrow();
  });
  it.each([
    { width: 8193, height: 1 },
    { width: 4001, height: 4000 },
    { width: Infinity, height: 1 },
    { width: 0, height: 1 },
  ])('bounds allocation before creating canvas %j', (dimensions) => {
    expect(() => redactionRasterDimensions(dimensions)).toThrowError(
      expect.objectContaining({ code: 'redaction-too-large' }),
    );
  });
});
