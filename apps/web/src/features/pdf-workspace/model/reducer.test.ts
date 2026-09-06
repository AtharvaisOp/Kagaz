import { describe, expect, it } from 'vitest';

import { createEmptyWorkspaceState, workspaceReducer } from './reducer';

import type {
  SourceDocumentSummary,
  WorkspacePage,
  WorkspaceAction,
} from './types';

const sourceA: SourceDocumentSummary = {
  id: 'source-a',
  fileName: 'a.pdf',
  status: 'ready',
  pageCount: 2,
  error: null,
};

const sourceB: SourceDocumentSummary = {
  id: 'source-b',
  fileName: 'b.pdf',
  status: 'ready',
  pageCount: 2,
  error: null,
};

const pageA0: WorkspacePage = {
  id: 'page-a-0',
  sourceDocumentId: 'source-a',
  sourcePageIndex: 0,
  rotationDelta: 0,
};

const pageA1: WorkspacePage = {
  id: 'page-a-1',
  sourceDocumentId: 'source-a',
  sourcePageIndex: 1,
  rotationDelta: 0,
};

const pageB0: WorkspacePage = {
  id: 'page-b-0',
  sourceDocumentId: 'source-b',
  sourcePageIndex: 0,
  rotationDelta: 0,
};

const pageB1: WorkspacePage = {
  id: 'page-b-1',
  sourceDocumentId: 'source-b',
  sourcePageIndex: 1,
  rotationDelta: 0,
};

function initialize(
  pages: readonly WorkspacePage[] = [pageA0, pageA1],
): ReturnType<typeof createEmptyWorkspaceState> {
  return workspaceReducer(createEmptyWorkspaceState(), {
    type: 'INITIALIZE_WORKSPACE',
    sources: [sourceA, sourceB],
    sourceOrder: ['source-a', 'source-b'],
    pages,
  });
}

describe('workspaceReducer', () => {
  it('starts as a valid empty, clean session', () => {
    const state = createEmptyWorkspaceState();

    expect(state.sessionStatus).toBe('empty');
    expect(state.pages).toEqual([]);
    expect(state.selectedPageId).toBeNull();
    expect(state.baseline).toBeNull();
    expect(state.dirty).toBe(false);
  });

  it('initializes one or more sources and preserves stable IDs', () => {
    const inputPages = [pageA0, pageA1];
    const state = initialize(inputPages);

    expect(state.sessionStatus).toBe('active');
    expect(state.sourceOrder).toEqual(['source-a', 'source-b']);
    expect(Object.keys(state.sources)).toEqual(['source-a', 'source-b']);
    expect(state.pages).toEqual(inputPages);
    expect(state.pages[0]).not.toBe(inputPages[0]);
    expect(state.selectedPageId).toBe('page-a-0');
    expect(state.baseline?.pages).toEqual(inputPages);
    expect(state.baseline?.pages).not.toBe(state.pages);
    expect(state.dirty).toBe(false);
  });

  it('uses a valid requested selection and falls back from an unknown ID', () => {
    const selected = workspaceReducer(createEmptyWorkspaceState(), {
      type: 'INITIALIZE_WORKSPACE',
      sources: [sourceA],
      sourceOrder: ['source-a'],
      pages: [pageA0, pageA1],
      selectedPageId: 'page-a-1',
    });
    const fallback = workspaceReducer(createEmptyWorkspaceState(), {
      type: 'INITIALIZE_WORKSPACE',
      sources: [sourceA],
      sourceOrder: ['source-a'],
      pages: [pageA0],
      selectedPageId: 'missing',
    });

    expect(selected.selectedPageId).toBe('page-a-1');
    expect(fallback.selectedPageId).toBe('page-a-0');
  });

  it('tracks source metadata without dirtying logical pages', () => {
    let state = createEmptyWorkspaceState();
    state = workspaceReducer(state, {
      type: 'REGISTER_SOURCE',
      source: { id: 'source-a', fileName: 'a.pdf' },
    });
    expect(state.sources['source-a']).toMatchObject({
      status: 'loading',
      pageCount: null,
      error: null,
    });
    expect(state.dirty).toBe(false);

    state = workspaceReducer(state, {
      type: 'SOURCE_READY',
      sourceId: 'source-a',
      pageCount: 2,
    });
    expect(state.sources['source-a']).toMatchObject({
      status: 'ready',
      pageCount: 2,
      error: null,
    });
    expect(state.dirty).toBe(false);

    state = workspaceReducer(state, {
      type: 'SOURCE_FAILED',
      sourceId: 'source-a',
      error: 'Could not parse PDF.',
    });
    expect(state.sources['source-a']).toMatchObject({
      status: 'error',
      pageCount: null,
      error: 'Could not parse PDF.',
    });
    expect(state.pages).toEqual([]);
    expect(state.dirty).toBe(false);
  });

  it('moves by stable page ID and preserves metadata and selection', () => {
    let state = initialize([pageA0, pageA1, pageB0]);
    state = workspaceReducer(state, {
      type: 'SELECT_PAGE',
      pageId: 'page-a-1',
    });
    state = workspaceReducer(state, {
      type: 'MOVE_PAGE',
      pageId: 'page-b-0',
      toIndex: 0,
    });

    expect(state.pages.map((page) => page.id)).toEqual([
      'page-b-0',
      'page-a-0',
      'page-a-1',
    ]);
    expect(state.pages[0]).toMatchObject({
      sourceDocumentId: 'source-b',
      sourcePageIndex: 0,
      rotationDelta: 0,
    });
    expect(state.selectedPageId).toBe('page-a-1');
    expect(state.dirty).toBe(true);

    const unchanged = workspaceReducer(state, {
      type: 'MOVE_PAGE',
      pageId: 'page-b-0',
      toIndex: 3,
    });
    expect(unchanged).toBe(state);
  });

  it('returns clean after reordering back to the baseline', () => {
    let state = initialize([pageA0, pageA1]);
    state = workspaceReducer(state, {
      type: 'MOVE_PAGE',
      pageId: 'page-a-1',
      toIndex: 0,
    });
    state = workspaceReducer(state, {
      type: 'MOVE_PAGE',
      pageId: 'page-a-1',
      toIndex: 1,
    });

    expect(state.pages.map((page) => page.id)).toEqual([
      'page-a-0',
      'page-a-1',
    ]);
    expect(state.dirty).toBe(false);
  });

  it('deletes a selected middle page and selects the next page', () => {
    let state = initialize([pageA0, pageA1, pageB0]);
    state = workspaceReducer(state, {
      type: 'SELECT_PAGE',
      pageId: 'page-a-1',
    });
    state = workspaceReducer(state, {
      type: 'DELETE_PAGE',
      pageId: 'page-a-1',
    });

    expect(state.pages.map((page) => page.id)).toEqual([
      'page-a-0',
      'page-b-0',
    ]);
    expect(state.selectedPageId).toBe('page-b-0');
    expect(state.dirty).toBe(true);
  });

  it('deletes a selected last page and selects the previous page', () => {
    let state = initialize([pageA0, pageA1, pageB0]);
    state = workspaceReducer(state, {
      type: 'SELECT_PAGE',
      pageId: 'page-b-0',
    });
    state = workspaceReducer(state, {
      type: 'DELETE_PAGE',
      pageId: 'page-b-0',
    });

    expect(state.pages.map((page) => page.id)).toEqual([
      'page-a-0',
      'page-a-1',
    ]);
    expect(state.selectedPageId).toBe('page-a-1');
  });

  it('preserves selection when deleting an unrelated page', () => {
    let state = initialize([pageA0, pageA1, pageB0]);
    state = workspaceReducer(state, {
      type: 'SELECT_PAGE',
      pageId: 'page-b-0',
    });
    state = workspaceReducer(state, {
      type: 'DELETE_PAGE',
      pageId: 'page-a-0',
    });

    expect(state.selectedPageId).toBe('page-b-0');
  });

  it('refuses to delete the final page', () => {
    const state = initialize([pageA0]);
    const next = workspaceReducer(state, {
      type: 'DELETE_PAGE',
      pageId: 'page-a-0',
    });

    expect(next).toBe(state);
    expect(next.pages).toEqual([pageA0]);
    expect(next.dirty).toBe(false);
  });

  it('keeps a source while one of its pages remains', () => {
    let state = initialize([pageA0, pageB0, pageB1]);
    state = workspaceReducer(state, {
      type: 'DELETE_PAGE',
      pageId: 'page-b-0',
    });

    expect(state.pages.map((page) => page.id)).toEqual([
      'page-a-0',
      'page-b-1',
    ]);
    expect(state.sources['source-b']).toBeDefined();
    expect(state.sourceOrder).toEqual(['source-a', 'source-b']);
  });

  it('prunes a source after sequential deletes remove its final page', () => {
    let state = initialize([pageA0, pageB0, pageB1]);
    state = workspaceReducer(state, {
      type: 'DELETE_PAGE',
      pageId: 'page-b-0',
    });
    state = workspaceReducer(state, {
      type: 'DELETE_PAGE',
      pageId: 'page-b-1',
    });

    expect(state.pages).toEqual([pageA0]);
    expect(Object.keys(state.sources)).toEqual(['source-a']);
    expect(state.sourceOrder).toEqual(['source-a']);
    expect(state.selectedPageId).toBe('page-a-0');
  });

  it('rotates through a full cycle and returns clean', () => {
    let state = initialize([pageA0]);
    for (let index = 0; index < 4; index += 1) {
      state = workspaceReducer(state, {
        type: 'ROTATE_PAGE',
        pageId: 'page-a-0',
      });
    }

    expect(state.pages[0]?.rotationDelta).toBe(0);
    expect(state.dirty).toBe(false);
  });

  it('selects only existing pages and does not dirty the document', () => {
    const state = initialize([pageA0, pageA1]);
    const selected = workspaceReducer(state, {
      type: 'SELECT_PAGE',
      pageId: 'page-a-1',
    });
    const unchanged = workspaceReducer(selected, {
      type: 'SELECT_PAGE',
      pageId: 'missing',
    });

    expect(selected.selectedPageId).toBe('page-a-1');
    expect(selected.dirty).toBe(false);
    expect(unchanged).toBe(selected);
  });

  it('appends pages in order, keeps selection, and can return clean after removal', () => {
    let state = initialize([pageA0, pageA1]);
    state = workspaceReducer(state, {
      type: 'REGISTER_SOURCE',
      source: { id: sourceB.id, fileName: sourceB.fileName },
    });
    state = workspaceReducer(state, {
      type: 'APPEND_SOURCE_PAGES',
      pages: [pageB0],
    });

    expect(state.pages.map((page) => page.id)).toEqual([
      'page-a-0',
      'page-a-1',
      'page-b-0',
    ]);
    expect(state.selectedPageId).toBe('page-a-0');
    expect(state.dirty).toBe(true);

    state = workspaceReducer(state, {
      type: 'DELETE_PAGE',
      pageId: 'page-b-0',
    });
    expect(state.dirty).toBe(false);
    expect(state.sources['source-b']).toBeUndefined();
    expect(state.sourceOrder).not.toContain('source-b');
  });

  it('requires explicit initialization for an empty session append', () => {
    const state = createEmptyWorkspaceState();
    const next = workspaceReducer(state, {
      type: 'APPEND_SOURCE_PAGES',
      pages: [pageA0],
    });

    expect(next).toBe(state);
  });

  it('resets to the valid empty session', () => {
    const state = initialize();
    const reset = workspaceReducer(state, { type: 'RESET_WORKSPACE' });

    expect(reset).toEqual(createEmptyWorkspaceState());
    expect(reset.sources).toEqual({});
    expect(reset.pages).toEqual([]);
    expect(reset.selectedPageId).toBeNull();
    expect(reset.baseline).toBeNull();
    expect(reset.dirty).toBe(false);
  });

  it('validates impossible initialization input', () => {
    const action: WorkspaceAction = {
      type: 'INITIALIZE_WORKSPACE',
      sources: [sourceA],
      sourceOrder: ['source-a'],
      pages: [],
    };

    expect(() => workspaceReducer(createEmptyWorkspaceState(), action)).toThrow(
      'at least one page',
    );
  });
});
