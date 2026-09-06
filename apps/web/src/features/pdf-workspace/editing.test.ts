import { describe, expect, it, vi } from 'vitest';

import { deleteWorkspacePage } from './editing';
import { createEmptyWorkspaceState, workspaceReducer } from './model/reducer';

import type {
  PdfWorkspaceState,
  WorkspaceAction,
  WorkspacePage,
} from './model/types';

const pages: WorkspacePage[] = [
  {
    id: 'a-0',
    sourceDocumentId: 'source-a',
    sourcePageIndex: 0,
    rotationDelta: 0,
  },
  {
    id: 'a-1',
    sourceDocumentId: 'source-a',
    sourcePageIndex: 1,
    rotationDelta: 0,
  },
  {
    id: 'b-0',
    sourceDocumentId: 'source-b',
    sourcePageIndex: 0,
    rotationDelta: 0,
  },
];

function stateWithPages(inputPages = pages): PdfWorkspaceState {
  return workspaceReducer(createEmptyWorkspaceState(), {
    type: 'INITIALIZE_WORKSPACE',
    sources: [
      {
        id: 'source-a',
        fileName: 'a.pdf',
        status: 'ready',
        pageCount: 2,
        error: null,
      },
      {
        id: 'source-b',
        fileName: 'b.pdf',
        status: 'ready',
        pageCount: 1,
        error: null,
      },
    ],
    sourceOrder: ['source-a', 'source-b'],
    pages: inputPages,
  });
}

describe('deleteWorkspacePage', () => {
  it('dispatches page deletion and source cleanup only for the final source reference', async () => {
    const dispatch = vi.fn<(action: WorkspaceAction) => void>();
    const destroySource = vi.fn().mockResolvedValue(undefined);
    const state = stateWithPages();

    expect(deleteWorkspacePage(state, 'a-0', dispatch, { destroySource })).toBe(
      true,
    );
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith({
      type: 'DELETE_PAGE',
      pageId: 'a-0',
    });
    expect(destroySource).not.toHaveBeenCalled();

    dispatch.mockClear();
    expect(deleteWorkspacePage(state, 'b-0', dispatch, { destroySource })).toBe(
      true,
    );
    expect(dispatch.mock.calls.map(([action]) => action)).toEqual([
      { type: 'DELETE_PAGE', pageId: 'b-0' },
      { type: 'REMOVE_SOURCE', sourceId: 'source-b' },
    ]);
    await vi.waitFor(() =>
      expect(destroySource).toHaveBeenCalledWith('source-b'),
    );
  });

  it('blocks deleting the final overall page', () => {
    const dispatch = vi.fn<(action: WorkspaceAction) => void>();
    const destroySource = vi.fn().mockResolvedValue(undefined);
    const state = stateWithPages([pages[0]!]);

    expect(deleteWorkspacePage(state, 'a-0', dispatch, { destroySource })).toBe(
      false,
    );
    expect(dispatch).not.toHaveBeenCalled();
    expect(destroySource).not.toHaveBeenCalled();
  });
});
