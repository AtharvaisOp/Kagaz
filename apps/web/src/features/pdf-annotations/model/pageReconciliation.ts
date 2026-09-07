import type { WorkspacePageId } from '../../pdf-workspace/model/types';

import { annotationReducer } from './reducer';

import type { AnnotationHistoryState } from './types';

export function findRemovedWorkspacePageIds(
  state: AnnotationHistoryState,
  committedPageIds: readonly WorkspacePageId[],
): readonly string[] {
  const committed = new Set(committedPageIds);
  const removed = new Set<string>();

  for (const document of [
    state.present,
    state.baseline,
    ...state.past,
    ...state.future,
  ]) {
    for (const pageId of Object.keys(document.byPage)) {
      if (!committed.has(pageId)) {
        removed.add(pageId);
      }
    }
  }

  return [...removed];
}

export function reconcileRemovedWorkspacePages(
  state: AnnotationHistoryState,
  committedPageIds: readonly WorkspacePageId[],
): AnnotationHistoryState {
  const removed = findRemovedWorkspacePageIds(state, committedPageIds);
  if (removed.length === 0) {
    return state;
  }

  return annotationReducer(state, {
    type: 'PRUNE_REMOVED_PAGES',
    pageIds: removed,
  });
}

export const pruneRemovedWorkspacePages = reconcileRemovedWorkspacePages;
