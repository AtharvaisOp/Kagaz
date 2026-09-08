import { describe, expect, it } from 'vitest';

import {
  TEXT_BOX_INSET_USER_UNITS,
  textBoxContentDimensions,
} from '../model/textLayoutPolicy';
import type { AnnotationViewport } from './annotationProjection';
import { projectTextBoxInset, projectTextFontSize } from './textProjection';

function viewport(scale: number): AnnotationViewport {
  return {
    width: 612 * scale,
    height: 792 * scale,
    viewBox: [0, 0, 612, 792],
    userUnit: 1,
    rotation: 0,
    transform: [scale, 0, 0, -scale, 0, 792 * scale],
    convertToPdfPoint: (x, y) => [x / scale, 792 - y / scale],
    convertToViewportPoint: (x, y) => [x * scale, (792 - y) * scale],
  };
}

describe('annotation text projection policy', () => {
  it.each([
    [0.5, 3],
    [1, 6],
    [2, 12],
  ])(
    'projects a 6-unit font at %sx without a display clamp',
    (scale, expected) => {
      expect(projectTextFontSize(6, viewport(scale))).toBe(expected);
    },
  );

  it('uses the full canonical text box in preview, editor, and export', () => {
    expect(TEXT_BOX_INSET_USER_UNITS).toBe(0);
    expect(projectTextBoxInset(viewport(2))).toBe(0);
    expect(textBoxContentDimensions(120, 40)).toEqual({
      width: 120,
      height: 40,
    });
  });
});
