import { describe, expect, it } from 'vitest';

import {
  createEmptyWorkspaceState,
  workspaceReducer,
} from '../../pdf-workspace/model/reducer';
import { createAnnotationHistoryState } from './history';
import { annotationReducer } from './reducer';

describe('protected final-page deletion', () => {
  it('does not erase committed annotations when the workspace rejects deletion', () => {
    const page = {
      id: 'page-a',
      sourceDocumentId: 'source-a',
      sourcePageIndex: 0,
      rotationDelta: 0 as const,
    };
    const workspace = workspaceReducer(createEmptyWorkspaceState(), {
      type: 'INITIALIZE_WORKSPACE',
      sources: [
        {
          id: 'source-a',
          fileName: 'a.pdf',
          status: 'ready',
          pageCount: 1,
          error: null,
        },
      ],
      sourceOrder: ['source-a'],
      pages: [page],
    });
    const annotation = {
      id: 'annotation-a',
      workspacePageId: page.id,
      kind: 'highlight' as const,
      box: {
        origin: { x: 10, y: 10 },
        width: 20,
        height: 10,
        rotation: 0 as const,
      },
      fill: { color: { r: 1, g: 1, b: 0 }, opacity: 0.35 },
    };
    const annotationState = annotationReducer(createAnnotationHistoryState(), {
      type: 'ADD_ANNOTATION',
      annotation,
    });

    const nextWorkspace = workspaceReducer(workspace, {
      type: 'DELETE_PAGE',
      pageId: page.id,
    });

    expect(nextWorkspace).toBe(workspace);
    expect(annotationState.present.byPage[page.id]).toEqual([annotation]);
  });
});
