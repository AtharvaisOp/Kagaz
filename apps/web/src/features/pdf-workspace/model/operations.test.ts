import { describe, expect, it } from 'vitest';

import {
  deletePage,
  movePage,
  normalizeRotation,
  rotatePage,
} from './operations';

import type { WorkspacePage } from './types';

const pages: WorkspacePage[] = [
  {
    id: 'page-a-0',
    sourceDocumentId: 'source-a',
    sourcePageIndex: 0,
    rotationDelta: 0,
  },
  {
    id: 'page-a-1',
    sourceDocumentId: 'source-a',
    sourcePageIndex: 1,
    rotationDelta: 90,
  },
  {
    id: 'page-b-0',
    sourceDocumentId: 'source-b',
    sourcePageIndex: 0,
    rotationDelta: 180,
  },
];

describe('movePage', () => {
  it('moves a page without changing its identity or metadata', () => {
    const original = pages.map((page) => ({ ...page }));
    const moved = movePage(pages, 2, 0);

    expect(moved.map((page) => page.id)).toEqual([
      'page-b-0',
      'page-a-0',
      'page-a-1',
    ]);
    expect(moved[0]).toEqual(pages[2]);
    expect(pages).toEqual(original);
  });

  it('supports moving the first page to the last position', () => {
    expect(movePage(pages, 0, 2).map((page) => page.id)).toEqual([
      'page-a-1',
      'page-b-0',
      'page-a-0',
    ]);
  });

  it('safely no-ops for invalid or same positions', () => {
    expect(movePage(pages, -1, 0)).toBe(pages);
    expect(movePage(pages, 0, -1)).toBe(pages);
    expect(movePage(pages, 3, 0)).toBe(pages);
    expect(movePage(pages, 0, 3)).toBe(pages);
    expect(movePage(pages, 1, 1)).toBe(pages);
  });
});

describe('deletePage', () => {
  it('removes only the requested page and preserves the others', () => {
    const remaining = deletePage(pages, 'page-a-1');

    expect(remaining.map((page) => page.id)).toEqual(['page-a-0', 'page-b-0']);
    expect(remaining[1]).toEqual(pages[2]);
    expect(pages).toHaveLength(3);
  });

  it('safely no-ops for an unknown or final page', () => {
    expect(deletePage(pages, 'missing')).toBe(pages);
    expect(deletePage([pages[0]!], pages[0]!.id)).toEqual([pages[0]]);
  });
});

describe('rotation', () => {
  it('normalizes positive and negative multiples of 90 degrees', () => {
    expect(normalizeRotation(-90)).toBe(270);
    expect(normalizeRotation(360)).toBe(0);
    expect(normalizeRotation(450)).toBe(90);
  });

  it('rejects non-right-angle rotation values', () => {
    expect(() => normalizeRotation(45)).toThrow(RangeError);
  });

  it('rotates only the requested page and safely no-ops when invalid', () => {
    const rotated = rotatePage(pages, 'page-a-0');

    expect(rotated[0]?.rotationDelta).toBe(90);
    expect(rotated[1]).toEqual(pages[1]);
    expect(pages[0]?.rotationDelta).toBe(0);
    expect(rotatePage(pages, 'missing')).toBe(pages);
    expect(rotatePage(pages, 'page-a-0', 45)).toBe(pages);
  });
});
