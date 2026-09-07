import { describe, expect, it } from 'vitest';

import { hasUnsavedAnnotationWork } from './unsavedWork';

describe('hasUnsavedAnnotationWork', () => {
  it.each([
    [false, null, false, false],
    [true, null, false, true],
    [false, { text: '' }, false, false],
    [false, { text: 'draft' }, false, true],
    [false, { text: '  draft  ' }, false, true],
    [false, null, true, true],
  ])(
    'combines durable and meaningful transient state',
    (dirty, session, pendingImage, expected) => {
      expect(hasUnsavedAnnotationWork(dirty, session, pendingImage)).toBe(
        expected,
      );
    },
  );
});
