import { describe, expect, it } from 'vitest';
import { createRedactionHistory, redactionReducer } from './reducer';
import type { RedactionRegion } from './types';

const region: RedactionRegion = {
  id: 'region-a',
  pageId: 'page-a',
  box: { x: 10, y: 20, width: 80, height: 30 },
};

describe('pending redaction history', () => {
  it('adds, moves, resizes and removes proposals through Undo/Redo without changing original geometry', () => {
    let state = redactionReducer(createRedactionHistory(), {
      type: 'ADD',
      region,
    });
    const moved = { ...region, box: { ...region.box, x: 50 } };
    state = redactionReducer(state, { type: 'REPLACE', region: moved });
    const resized = { ...moved, box: { ...moved.box, width: 110 } };
    state = redactionReducer(state, { type: 'REPLACE', region: resized });
    state = redactionReducer(state, { type: 'REMOVE', id: region.id });
    expect(state.present).toEqual([]);
    state = redactionReducer(state, { type: 'UNDO' });
    expect(state.present).toEqual([resized]);
    state = redactionReducer(state, { type: 'UNDO' });
    expect(state.present).toEqual([moved]);
    state = redactionReducer(state, { type: 'UNDO' });
    expect(state.present).toEqual([region]);
    state = redactionReducer(state, { type: 'REDO' });
    expect(state.present).toEqual([moved]);
    expect(region.box.x).toBe(10);
  });

  it.each([NaN, Infinity, -Infinity, 0, -1])(
    'rejects invalid width %s',
    (width) => {
      const empty = createRedactionHistory();
      expect(
        redactionReducer(empty, {
          type: 'ADD',
          region: { ...region, box: { ...region.box, width } },
        }),
      ).toBe(empty);
    },
  );

  it('rejects non-finite coordinates, overflow, blank identity, duplicates and cross-page replacements', () => {
    const empty = createRedactionHistory();
    for (const invalid of [
      { ...region, box: { ...region.box, x: NaN } },
      { ...region, box: { ...region.box, y: Infinity } },
      {
        ...region,
        box: { ...region.box, x: Number.MAX_VALUE, width: Number.MAX_VALUE },
      },
      { ...region, id: '' },
      { ...region, pageId: '' },
    ])
      expect(redactionReducer(empty, { type: 'ADD', region: invalid })).toBe(
        empty,
      );
    const state = redactionReducer(empty, { type: 'ADD', region });
    expect(redactionReducer(state, { type: 'ADD', region })).toBe(state);
    expect(
      redactionReducer(state, {
        type: 'REPLACE',
        region: { ...region, pageId: 'other-page' },
      }),
    ).toBe(state);
  });

  it('keeps overlapping proposals and tiny positive regions as separate canonical records', () => {
    let state = redactionReducer(createRedactionHistory(), {
      type: 'ADD',
      region,
    });
    state = redactionReducer(state, {
      type: 'ADD',
      region: { ...region, id: 'overlap' },
    });
    state = redactionReducer(state, {
      type: 'ADD',
      region: {
        ...region,
        id: 'tiny',
        box: { x: 0, y: 0, width: 0.01, height: 0.01 },
      },
    });
    expect(state.present).toHaveLength(3);
  });

  it('does not record no-op geometry edits or missing deletion/replacement', () => {
    const state = redactionReducer(createRedactionHistory(), {
      type: 'ADD',
      region,
    });
    expect(
      redactionReducer(state, {
        type: 'REPLACE',
        region: { ...region, box: { ...region.box } },
      }),
    ).toBe(state);
    expect(redactionReducer(state, { type: 'REMOVE', id: 'absent' })).toBe(
      state,
    );
    expect(
      redactionReducer(state, {
        type: 'REPLACE',
        region: { ...region, id: 'absent' },
      }),
    ).toBe(state);
  });

  it('invalidates abandoned redo after a new edit', () => {
    let state = redactionReducer(createRedactionHistory(), {
      type: 'ADD',
      region,
    });
    state = redactionReducer(state, { type: 'UNDO' });
    state = redactionReducer(state, {
      type: 'ADD',
      region: { ...region, id: 'new' },
    });
    expect(state.future).toEqual([]);
    expect(redactionReducer(state, { type: 'REDO' })).toBe(state);
  });

  it('prunes deleted pages from all snapshots without invisible Undo/Redo steps', () => {
    let state = redactionReducer(createRedactionHistory(), {
      type: 'ADD',
      region,
    });
    const second = { ...region, id: 'region-b', pageId: 'page-b' };
    state = redactionReducer(state, { type: 'ADD', region: second });
    state = redactionReducer(state, {
      type: 'REPLACE',
      region: { ...region, box: { ...region.box, width: 90 } },
    });
    state = redactionReducer(state, { type: 'PRUNE', pageIds: ['page-a'] });
    expect(state.present).toEqual([second]);
    expect(state.past).toEqual([[]]);
    state = redactionReducer(state, { type: 'UNDO' });
    expect(state.present).toEqual([]);
    state = redactionReducer(state, { type: 'REDO' });
    expect(state.present).toEqual([second]);
    expect(
      [...state.present, ...state.past.flat(), ...state.future.flat()].some(
        (proposal) => proposal.pageId === 'page-a',
      ),
    ).toBe(false);
  });

  it('prunes proposals in the redo future so deleted pages cannot reappear', () => {
    let state = redactionReducer(createRedactionHistory(), {
      type: 'ADD',
      region,
    });
    state = redactionReducer(state, { type: 'UNDO' });
    state = redactionReducer(state, {
      type: 'PRUNE',
      pageIds: [region.pageId],
    });
    expect(state).toEqual(createRedactionHistory());
  });

  it('Start Over clears present, history and future', () => {
    let state = redactionReducer(createRedactionHistory(), {
      type: 'ADD',
      region,
    });
    state = redactionReducer(state, { type: 'UNDO' });
    expect(redactionReducer(state, { type: 'RESET' })).toEqual(
      createRedactionHistory(),
    );
  });

  it('a different source page and workspace reordering require no geometry mutation', () => {
    const state = redactionReducer(createRedactionHistory(), {
      type: 'ADD',
      region,
    });
    const sameFileDifferentInstance = {
      ...region,
      id: 'region-copy',
      pageId: 'duplicate-source-page',
    };
    const next = redactionReducer(state, {
      type: 'ADD',
      region: sameFileDifferentInstance,
    });
    expect(next.present[0]).toBe(region);
    expect(next.present[1]?.pageId).not.toBe(region.pageId);
    expect(next.present[1]?.box).toEqual(region.box);
  });
});
