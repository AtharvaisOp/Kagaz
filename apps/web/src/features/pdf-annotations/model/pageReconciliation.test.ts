import { describe, expect, it } from 'vitest';

import { createAnnotationHistoryState } from './history';
import { reconcileRemovedWorkspacePages } from './pageReconciliation';
import { annotationReducer } from './reducer';

const pageA = 'page-a';
const pageB = 'page-b';

const annotation = {
  id: 'annotation-a',
  workspacePageId: pageA,
  kind: 'highlight' as const,
  box: {
    origin: { x: 10, y: 10 },
    width: 20,
    height: 10,
    rotation: 0 as const,
  },
  fill: { color: { r: 1, g: 1, b: 0 }, opacity: 0.35 },
};

describe('page reconciliation', () => {
  it('prunes removed pages from present, baseline, past, and future', () => {
    let state = createAnnotationHistoryState();
    state = annotationReducer(state, { type: 'ADD_ANNOTATION', annotation });
    state = annotationReducer(state, { type: 'UNDO' });
    state = annotationReducer(state, { type: 'REDO' });

    const reconciled = reconcileRemovedWorkspacePages(state, [pageA, pageB]);
    expect(reconciled.present.byPage[pageA]).toEqual([annotation]);

    const removed = reconcileRemovedWorkspacePages(reconciled, [pageB]);
    expect(removed.present.byPage[pageA]).toBeUndefined();
    expect(removed.baseline.byPage[pageA]).toBeUndefined();
    expect(removed.past.every((item) => item.byPage[pageA] === undefined)).toBe(
      true,
    );
    expect(
      removed.future.every((item) => item.byPage[pageA] === undefined),
    ).toBe(true);
  });

  it('does not mutate annotations when pages are reordered or rotated', () => {
    let state = createAnnotationHistoryState();
    state = annotationReducer(state, { type: 'ADD_ANNOTATION', annotation });
    const next = reconcileRemovedWorkspacePages(state, [pageA, pageB]);
    expect(next.present).toEqual(state.present);
  });
});
