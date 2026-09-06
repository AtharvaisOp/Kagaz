import { describe, expect, it } from 'vitest';

import { parsePageRange } from './rangeParser';

describe('parsePageRange', () => {
  it.each([
    ['1', [0]],
    ['1-3', [0, 1, 2]],
    ['1-3,5', [0, 1, 2, 4]],
    ['1-3,5,8-10', [0, 1, 2, 4, 7, 8, 9]],
    ['1 - 3, 5', [0, 1, 2, 4]],
    ['  1-3 , 5 , 8-10  ', [0, 1, 2, 4, 7, 8, 9]],
    ['1-1', [0]],
    ['10', [9]],
    ['9-10', [8, 9]],
  ])('parses %s as zero-based indexes', (expression, indexes) => {
    expect(parsePageRange(expression, 10)).toEqual({ ok: true, indexes });
  });

  it('preserves expression order instead of sorting', () => {
    expect(parsePageRange('3,1-2', 10)).toEqual({
      ok: true,
      indexes: [2, 0, 1],
    });
  });

  it('deduplicates while preserving first occurrence order', () => {
    expect(parsePageRange('1-3,3,1', 10)).toEqual({
      ok: true,
      indexes: [0, 1, 2],
    });
    expect(parsePageRange('3,1-2,3', 10)).toEqual({
      ok: true,
      indexes: [2, 0, 1],
    });
  });

  it.each([
    ['', 'empty'],
    ['   ', 'empty'],
    ['0', 'invalid-page'],
    ['-1', 'invalid-page'],
    ['abc', 'invalid-token'],
    ['1,,3', 'invalid-token'],
    [',1', 'invalid-token'],
    ['1,', 'invalid-token'],
    ['5-2', 'descending-range'],
    ['999', 'out-of-bounds'],
  ])('rejects %s with %s', (expression, error) => {
    expect(parsePageRange(expression, 10)).toEqual({ ok: false, error });
  });

  it.each([
    ['11', 'out-of-bounds'],
    ['9-11', 'out-of-bounds'],
  ])('rejects out-of-bounds input %s', (expression, error) => {
    expect(parsePageRange(expression, 10)).toEqual({ ok: false, error });
  });

  it.each([0, -1, 1.5, Number.NaN])(
    'rejects invalid page count %s',
    (pageCount) => {
      expect(parsePageRange('1', pageCount)).toEqual({
        ok: false,
        error: 'invalid-page-count',
      });
    },
  );
});
