import { useCallback, useEffect, useReducer, useRef, useState } from 'react';

import {
  loadSourceBatch,
  type SourceBatchResult,
} from '../loading/sourceBatch';
import { deleteWorkspacePage } from '../editing';
import type { FileLoadIssue, LoadingProgress } from '../loading/types';
import { createBrowserIdFactory } from '../runtime/ids';
import { SourceDocumentRegistry } from '../runtime/sourceDocumentRegistry';
import { createEmptyWorkspaceState, workspaceReducer } from '../model/reducer';

import type { PdfWorkspaceState, WorkspacePageId } from '../model/types';

export interface WorkspaceLoadingState {
  readonly status: 'idle' | 'loading';
  readonly currentIndex: number;
  readonly total: number;
  readonly fileName: string | null;
}

export interface PdfWorkspaceController {
  readonly workspace: PdfWorkspaceState;
  readonly registry: SourceDocumentRegistry;
  readonly loading: WorkspaceLoadingState;
  readonly issues: readonly FileLoadIssue[];
  readonly openInitialFiles: (
    files: readonly File[],
    initialIssues?: readonly FileLoadIssue[],
  ) => void;
  readonly addFiles: (
    files: readonly File[],
    initialIssues?: readonly FileLoadIssue[],
  ) => void;
  readonly startOver: () => boolean;
  readonly selectPage: (pageId: WorkspacePageId) => void;
  readonly movePage: (pageId: WorkspacePageId, toIndex: number) => void;
  readonly deletePage: (pageId: WorkspacePageId) => void;
  readonly rotatePage: (pageId: WorkspacePageId, delta?: number) => void;
}

const IDLE_LOADING: WorkspaceLoadingState = {
  status: 'idle',
  currentIndex: 0,
  total: 0,
  fileName: null,
};

function progressToState(progress: LoadingProgress): WorkspaceLoadingState {
  return { status: 'loading', ...progress };
}

function isCurrentResult(
  generationRef: { current: number },
  generation: number,
  controller: AbortController,
): boolean {
  return generationRef.current === generation && !controller.signal.aborted;
}

export function usePdfWorkspace(): PdfWorkspaceController {
  const [workspace, dispatch] = useReducer(
    workspaceReducer,
    undefined,
    createEmptyWorkspaceState,
  );
  const [registry] = useState(() => new SourceDocumentRegistry());
  const generationRef = useRef(0);
  const batchControllerRef = useRef<AbortController | null>(null);
  const [loading, setLoading] = useState<WorkspaceLoadingState>(IDLE_LOADING);
  const [issues, setIssues] = useState<readonly FileLoadIssue[]>([]);

  const invalidateSession = useCallback(() => {
    generationRef.current += 1;
    batchControllerRef.current?.abort();
    batchControllerRef.current = null;
    void registry.destroyAll();
  }, [registry]);

  const finishBatch = useCallback(
    (
      generation: number,
      controller: AbortController,
      result: SourceBatchResult,
      initialIssues: readonly FileLoadIssue[],
    ) => {
      if (!isCurrentResult(generationRef, generation, controller)) {
        return;
      }

      setLoading(IDLE_LOADING);
      setIssues([...initialIssues, ...result.issues]);
      batchControllerRef.current = null;
    },
    [],
  );

  const openInitialFiles = useCallback(
    (files: readonly File[], initialIssues: readonly FileLoadIssue[] = []) => {
      invalidateSession();
      dispatch({ type: 'RESET_WORKSPACE' });
      setIssues(initialIssues);

      if (files.length === 0) {
        setLoading(IDLE_LOADING);
        return;
      }

      const generation = generationRef.current;
      const controller = new AbortController();
      batchControllerRef.current = controller;
      setLoading({
        status: 'loading',
        currentIndex: 0,
        total: files.length,
        fileName: files[0]?.name ?? null,
      });

      void loadSourceBatch(files, {
        registry,
        signal: controller.signal,
        isCurrent: () => generationRef.current === generation,
        onProgress: (progress) => {
          if (isCurrentResult(generationRef, generation, controller)) {
            setLoading(progressToState(progress));
          }
        },
      })
        .then((result) => {
          if (!isCurrentResult(generationRef, generation, controller)) {
            return;
          }

          if (!result.cancelled && result.pages.length > 0) {
            dispatch({
              type: 'INITIALIZE_WORKSPACE',
              sources: result.sources,
              sourceOrder: result.sourceOrder,
              pages: result.pages,
            });
          }
          finishBatch(generation, controller, result, initialIssues);
        })
        .catch((error: unknown) => {
          if (!isCurrentResult(generationRef, generation, controller)) {
            return;
          }

          setLoading(IDLE_LOADING);
          setIssues([
            ...initialIssues,
            {
              fileName: 'PDF batch',
              message:
                error instanceof Error
                  ? error.message
                  : 'Kagaz could not open the selected PDFs.',
            },
          ]);
          batchControllerRef.current = null;
        });
    },
    [finishBatch, invalidateSession, registry],
  );

  const addFiles = useCallback(
    (files: readonly File[], initialIssues: readonly FileLoadIssue[] = []) => {
      if (
        files.length === 0 ||
        workspace.sessionStatus !== 'active' ||
        loading.status === 'loading'
      ) {
        setIssues(initialIssues);
        return;
      }

      const generation = generationRef.current;
      const controller = new AbortController();
      batchControllerRef.current = controller;
      setIssues(initialIssues);
      setLoading({
        status: 'loading',
        currentIndex: 0,
        total: files.length,
        fileName: files[0]?.name ?? null,
      });

      void loadSourceBatch(files, {
        registry,
        signal: controller.signal,
        isCurrent: () => generationRef.current === generation,
        createSourceId: createBrowserIdFactory('source'),
        createPageId: (sourceId, sourcePageIndex) =>
          `${sourceId}-page-${sourcePageIndex}-${createBrowserIdFactory('workspace')()}`,
        onProgress: (progress) => {
          if (isCurrentResult(generationRef, generation, controller)) {
            setLoading(progressToState(progress));
          }
        },
        onSourceRegistered: (source) => {
          dispatch({ type: 'REGISTER_SOURCE', source });
        },
        onSourceReady: (sourceId, pageCount) => {
          dispatch({ type: 'SOURCE_READY', sourceId, pageCount });
        },
        onSourceFailed: (sourceId, message) => {
          dispatch({ type: 'SOURCE_FAILED', sourceId, error: message });
        },
        onPagesReady: (pages) => {
          dispatch({ type: 'APPEND_SOURCE_PAGES', pages });
        },
      })
        .then((result) =>
          finishBatch(generation, controller, result, initialIssues),
        )
        .catch((error: unknown) => {
          if (!isCurrentResult(generationRef, generation, controller)) {
            return;
          }

          setLoading(IDLE_LOADING);
          setIssues([
            ...initialIssues,
            {
              fileName: 'PDF batch',
              message:
                error instanceof Error
                  ? error.message
                  : 'Kagaz could not add the selected PDFs.',
            },
          ]);
          batchControllerRef.current = null;
        });
    },
    [finishBatch, loading.status, registry, workspace.sessionStatus],
  );

  const startOver = useCallback(() => {
    if (
      workspace.dirty &&
      !window.confirm('Discard your current PDF workspace and start over?')
    ) {
      return false;
    }

    invalidateSession();
    dispatch({ type: 'RESET_WORKSPACE' });
    setLoading(IDLE_LOADING);
    setIssues([]);
    return true;
  }, [invalidateSession, workspace.dirty]);

  const selectPage = useCallback((pageId: WorkspacePageId) => {
    dispatch({ type: 'SELECT_PAGE', pageId });
  }, []);

  const movePage = useCallback((pageId: WorkspacePageId, toIndex: number) => {
    dispatch({ type: 'MOVE_PAGE', pageId, toIndex });
  }, []);

  const deletePage = useCallback(
    (pageId: WorkspacePageId) => {
      deleteWorkspacePage(workspace, pageId, dispatch, registry);
    },
    [registry, workspace],
  );

  const rotatePage = useCallback((pageId: WorkspacePageId, delta?: number) => {
    dispatch({ type: 'ROTATE_PAGE', pageId, delta });
  }, []);

  useEffect(() => {
    return () => {
      generationRef.current += 1;
      batchControllerRef.current?.abort();
      void registry.destroyAll();
    };
  }, [registry]);

  return {
    workspace,
    registry,
    loading,
    issues,
    openInitialFiles,
    addFiles,
    startOver,
    selectPage,
    movePage,
    deletePage,
    rotatePage,
  };
}
