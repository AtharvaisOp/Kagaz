import { describe, expect, it } from 'vitest';

import { shouldConfirmStartOver } from './usePdfWorkspace';

describe('shouldConfirmStartOver', () => {
  it.each([
    [false, false, false],
    [true, false, true],
    [false, true, true],
    [true, true, true],
  ])(
    'returns the combined unsaved truth table',
    (workspace, extra, expected) => {
      expect(shouldConfirmStartOver(workspace, extra)).toBe(expected);
    },
  );
});
