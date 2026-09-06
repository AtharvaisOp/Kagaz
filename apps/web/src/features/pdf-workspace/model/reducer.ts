import {
  deletePage,
  movePage,
  normalizeRotation,
  rotatePage,
} from './operations';

import type {
  PdfWorkspaceState,
  SourceDocumentId,
  SourceDocumentSummary,
  WorkspaceAction,
  WorkspacePage,
  WorkspaceSnapshot,
} from './types';

const DEFAULT_SOURCE_ERROR = 'The PDF could not be loaded.';

function clonePage(page: WorkspacePage): WorkspacePage {
  return { ...page };
}

function clonePages(pages: readonly WorkspacePage[]): WorkspacePage[] {
  return pages.map(clonePage);
}

function createSnapshot(pages: readonly WorkspacePage[]): WorkspaceSnapshot {
  return Object.freeze({ pages: Object.freeze(clonePages(pages)) });
}

function createSourceRecord(
  sources: readonly SourceDocumentSummary[],
): Readonly<Record<SourceDocumentId, SourceDocumentSummary>> {
  const record: Record<SourceDocumentId, SourceDocumentSummary> = {};

  for (const source of sources) {
    record[source.id] = { ...source };
  }

  return record;
}

function pagesMatch(
  pages: readonly WorkspacePage[],
  snapshot: WorkspaceSnapshot,
): boolean {
  if (pages.length !== snapshot.pages.length) {
    return false;
  }

  return pages.every((page, index) => {
    const baselinePage = snapshot.pages[index];
    return (
      baselinePage !== undefined &&
      page.id === baselinePage.id &&
      page.sourceDocumentId === baselinePage.sourceDocumentId &&
      page.sourcePageIndex === baselinePage.sourcePageIndex &&
      page.rotationDelta === baselinePage.rotationDelta
    );
  });
}

function withPages(
  state: PdfWorkspaceState,
  pages: readonly WorkspacePage[],
): PdfWorkspaceState {
  if (!state.baseline) {
    return state;
  }

  return {
    ...state,
    pages,
    dirty: !pagesMatch(pages, state.baseline),
  };
}

function hasUniqueIds(pages: readonly WorkspacePage[]): boolean {
  const ids = new Set(pages.map((page) => page.id));
  return ids.size === pages.length;
}

function isValidPage(page: WorkspacePage): boolean {
  try {
    normalizeRotation(page.rotationDelta);
  } catch {
    return false;
  }

  return Number.isInteger(page.sourcePageIndex) && page.sourcePageIndex >= 0;
}

function validateInitialization(
  action: Extract<WorkspaceAction, { type: 'INITIALIZE_WORKSPACE' }>,
): void {
  if (action.pages.length === 0) {
    throw new Error('An active workspace must contain at least one page.');
  }

  if (
    !hasUniqueIds(action.pages) ||
    action.pages.some((page) => !isValidPage(page))
  ) {
    throw new Error('Workspace pages must have unique IDs and valid metadata.');
  }

  const sourceIds = new Set(action.sources.map((source) => source.id));
  if (sourceIds.size !== action.sources.length) {
    throw new Error('Workspace sources must have unique IDs.');
  }

  if (
    action.sourceOrder.length !== sourceIds.size ||
    new Set(action.sourceOrder).size !== action.sourceOrder.length ||
    action.sourceOrder.some((sourceId) => !sourceIds.has(sourceId))
  ) {
    throw new Error(
      'Source order must contain each initialized source exactly once.',
    );
  }

  if (action.pages.some((page) => !sourceIds.has(page.sourceDocumentId))) {
    throw new Error(
      'Each workspace page must reference an initialized source.',
    );
  }
}

function createInitializedState(
  action: Extract<WorkspaceAction, { type: 'INITIALIZE_WORKSPACE' }>,
): PdfWorkspaceState {
  validateInitialization(action);
  const pages = clonePages(action.pages);
  const selectedPageId =
    action.selectedPageId &&
    pages.some((page) => page.id === action.selectedPageId)
      ? action.selectedPageId
      : (pages[0]?.id ?? null);

  return {
    sessionStatus: 'active',
    sources: createSourceRecord(action.sources),
    sourceOrder: [...action.sourceOrder],
    pages,
    selectedPageId,
    baseline: createSnapshot(pages),
    dirty: false,
  };
}

export function createEmptyWorkspaceState(): PdfWorkspaceState {
  return {
    sessionStatus: 'empty',
    sources: {},
    sourceOrder: [],
    pages: [],
    selectedPageId: null,
    baseline: null,
    dirty: false,
  };
}

function updateSource(
  state: PdfWorkspaceState,
  sourceId: SourceDocumentId,
  update: (source: SourceDocumentSummary) => SourceDocumentSummary,
): PdfWorkspaceState {
  const source = state.sources[sourceId];
  if (!source) {
    return state;
  }

  return {
    ...state,
    sources: {
      ...state.sources,
      [sourceId]: update(source),
    },
  };
}

function removeSource(
  state: PdfWorkspaceState,
  sourceId: SourceDocumentId,
): PdfWorkspaceState {
  if (!state.sources[sourceId]) {
    return state;
  }

  if (state.pages.some((page) => page.sourceDocumentId === sourceId)) {
    return state;
  }

  const remainingSources = { ...state.sources };
  delete remainingSources[sourceId];

  return {
    ...state,
    sources: remainingSources,
    sourceOrder: state.sourceOrder.filter((id) => id !== sourceId),
  };
}

export function workspaceReducer(
  state: PdfWorkspaceState,
  action: WorkspaceAction,
): PdfWorkspaceState {
  switch (action.type) {
    case 'INITIALIZE_WORKSPACE':
      return createInitializedState(action);

    case 'REGISTER_SOURCE': {
      const source: SourceDocumentSummary = {
        id: action.source.id,
        fileName: action.source.fileName,
        status: 'loading',
        pageCount: null,
        error: null,
      };
      const alreadyRegistered = Boolean(state.sources[action.source.id]);

      return {
        ...state,
        sources: { ...state.sources, [source.id]: source },
        sourceOrder: alreadyRegistered
          ? state.sourceOrder
          : [...state.sourceOrder, source.id],
      };
    }

    case 'SOURCE_READY':
      if (!Number.isInteger(action.pageCount) || action.pageCount < 0) {
        return state;
      }
      return updateSource(state, action.sourceId, (source) => ({
        ...source,
        status: 'ready',
        pageCount: action.pageCount,
        error: null,
      }));

    case 'SOURCE_FAILED':
      return updateSource(state, action.sourceId, (source) => ({
        ...source,
        status: 'error',
        pageCount: null,
        error: action.error.trim() || DEFAULT_SOURCE_ERROR,
      }));

    case 'APPEND_SOURCE_PAGES': {
      if (
        state.sessionStatus !== 'active' ||
        action.pages.length === 0 ||
        !hasUniqueIds(action.pages) ||
        action.pages.some(
          (page) =>
            state.pages.some((existingPage) => existingPage.id === page.id) ||
            !state.sources[page.sourceDocumentId] ||
            !isValidPage(page),
        )
      ) {
        return state;
      }

      return withPages(state, [...state.pages, ...clonePages(action.pages)]);
    }

    case 'SELECT_PAGE':
      return state.pages.some((page) => page.id === action.pageId)
        ? { ...state, selectedPageId: action.pageId }
        : state;

    case 'MOVE_PAGE': {
      const fromIndex = state.pages.findIndex(
        (page) => page.id === action.pageId,
      );
      const pages = movePage(state.pages, fromIndex, action.toIndex);
      return pages === state.pages ? state : withPages(state, pages);
    }

    case 'DELETE_PAGE': {
      const pageIndex = state.pages.findIndex(
        (page) => page.id === action.pageId,
      );
      const pages = deletePage(state.pages, action.pageId);
      if (pages === state.pages) {
        return state;
      }

      const selectedPageId =
        state.selectedPageId === action.pageId
          ? (pages[Math.min(pageIndex, pages.length - 1)]?.id ?? null)
          : state.selectedPageId;

      return {
        ...withPages(state, pages),
        selectedPageId,
      };
    }

    case 'REMOVE_SOURCE':
      return removeSource(state, action.sourceId);

    case 'ROTATE_PAGE': {
      const pages = rotatePage(state.pages, action.pageId, action.delta);
      return pages === state.pages ? state : withPages(state, pages);
    }

    case 'RESET_WORKSPACE':
      return createEmptyWorkspaceState();

    default: {
      const exhaustiveAction: never = action;
      return exhaustiveAction;
    }
  }
}
