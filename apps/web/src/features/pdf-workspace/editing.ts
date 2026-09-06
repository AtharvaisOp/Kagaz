import { workspaceReducer } from './model/reducer';

import type {
  PdfWorkspaceState,
  SourceDocumentId,
  WorkspaceAction,
  WorkspacePageId,
} from './model/types';

export type WorkspaceDispatch = (action: WorkspaceAction) => void;

export interface SourceCleanupRegistry {
  destroySource(sourceId: SourceDocumentId): Promise<void>;
}

/**
 * Applies a delete through the reducer and removes a source only after its
 * final workspace reference has actually disappeared.
 */
export function deleteWorkspacePage(
  state: PdfWorkspaceState,
  pageId: WorkspacePageId,
  dispatch: WorkspaceDispatch,
  registry: SourceCleanupRegistry,
): boolean {
  const page = state.pages.find((candidate) => candidate.id === pageId);
  if (!page) {
    return false;
  }

  const nextState = workspaceReducer(state, {
    type: 'DELETE_PAGE',
    pageId,
  });
  if (nextState === state) {
    return false;
  }

  dispatch({ type: 'DELETE_PAGE', pageId });

  const hasRemainingReference = nextState.pages.some(
    (candidate) => candidate.sourceDocumentId === page.sourceDocumentId,
  );
  if (!hasRemainingReference) {
    dispatch({ type: 'REMOVE_SOURCE', sourceId: page.sourceDocumentId });
    void registry.destroySource(page.sourceDocumentId);
  }

  return true;
}
