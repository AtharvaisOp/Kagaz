import { describe, expect, it } from 'vitest';

import { chooseMostVisiblePage } from './navigation';

describe('chooseMostVisiblePage', () => {
  it('returns the visible page with the greatest intersection ratio', () => {
    const visibility = new Map([
      ['page-a', { pageId: 'page-a', ratio: 0.35, isIntersecting: true }],
      ['page-b', { pageId: 'page-b', ratio: 0.8, isIntersecting: true }],
      ['page-c', { pageId: 'page-c', ratio: 0.95, isIntersecting: false }],
    ]);

    expect(
      chooseMostVisiblePage(['page-a', 'page-b', 'page-c'], visibility),
    ).toBe('page-b');
  });

  it('uses workspace order to break equal-ratio ties', () => {
    const visibility = new Map([
      ['page-b', { pageId: 'page-b', ratio: 0.5, isIntersecting: true }],
      ['page-a', { pageId: 'page-a', ratio: 0.5, isIntersecting: true }],
    ]);

    expect(chooseMostVisiblePage(['page-a', 'page-b'], visibility)).toBe(
      'page-a',
    );
  });

  it('returns null when no page intersects', () => {
    expect(chooseMostVisiblePage(['page-a'], new Map())).toBeNull();
  });
});
