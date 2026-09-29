import { describe, expect, it } from 'vitest';

import { pdfOrientedBoxToCorners } from './orientedBox';
import { fitSignatureToField } from './signatureFieldFit';

describe('fitSignatureToField', () => {
  it.each([0, 90, 180, 270] as const)(
    'preserves aspect ratio and centers inside a %s-degree widget',
    (rotation) => {
      const field = {
        origin: { x: 200, y: 300 },
        width: 200,
        height: 80,
        rotation,
      } as const;
      const fitted = fitSignatureToField(field, 400, 100);
      expect(fitted.rotation).toBe(rotation);
      expect(fitted.width / fitted.height).toBeCloseTo(4);
      expect(fitted.width).toBeLessThan(field.width);
      expect(fitted.height).toBeLessThan(field.height);

      const fieldCorners = pdfOrientedBoxToCorners(field);
      const fittedCorners = pdfOrientedBoxToCorners(fitted);
      const center = (corners: typeof fieldCorners) => ({
        x: corners.reduce((sum, point) => sum + point.x, 0) / 4,
        y: corners.reduce((sum, point) => sum + point.y, 0) / 4,
      });
      expect(center(fittedCorners)).toEqual(center(fieldCorners));
    },
  );
});
