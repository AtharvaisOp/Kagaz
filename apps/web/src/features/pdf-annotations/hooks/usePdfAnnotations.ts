import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type Dispatch,
} from 'react';

import type {
  WorkspacePage,
  WorkspacePageId,
} from '../../pdf-workspace/model/types';
import { selectPageAnnotations } from '../model/selectors';
import { createAnnotationHistoryState } from '../model/history';
import { annotationReducer, type AnnotationAction } from '../model/reducer';
import { findRemovedWorkspacePageIds } from '../model/pageReconciliation';

import type {
  AnnotationHistoryState,
  AnnotationId,
  AnnotationSelection,
  PdfAnnotation,
} from '../model/types';

export interface PdfAnnotationController {
  readonly state: AnnotationHistoryState;
  readonly selection: AnnotationSelection | null;
  readonly getAnnotationsForPage: (
    pageId: WorkspacePageId,
  ) => readonly PdfAnnotation[];
  readonly selectedAnnotationIdForPage: (
    pageId: WorkspacePageId,
  ) => AnnotationId | null;
  readonly selectAnnotation: (
    pageId: WorkspacePageId,
    annotationId: AnnotationId | null,
  ) => void;
  readonly commitAnnotation: (annotation: PdfAnnotation) => void;
  readonly undo: () => void;
  readonly redo: () => void;
  readonly dispatch: Dispatch<AnnotationAction>;
}

export function usePdfAnnotations(
  pages: readonly WorkspacePage[],
): PdfAnnotationController {
  const [state, dispatch] = useReducer(
    annotationReducer,
    undefined,
    createAnnotationHistoryState,
  );
  const [selection, setSelection] = useState<AnnotationSelection | null>(null);
  const presentRef = useRef(state.present);
  useLayoutEffect(() => {
    presentRef.current = state.present;
  }, [state.present]);
  const committedPageIds = useMemo(() => pages.map((page) => page.id), [pages]);

  useEffect(() => {
    const removedPageIds = findRemovedWorkspacePageIds(state, committedPageIds);
    if (removedPageIds.length > 0) {
      dispatch({ type: 'PRUNE_REMOVED_PAGES', pageIds: removedPageIds });
    }
  }, [committedPageIds, state]);

  const visibleSelection = useMemo(() => {
    if (!selection) {
      return null;
    }
    return committedPageIds.includes(selection.workspacePageId)
      ? selection
      : null;
  }, [committedPageIds, selection]);

  const getAnnotationsForPage = useCallback(
    (pageId: WorkspacePageId) => selectPageAnnotations(state.present, pageId),
    [state.present],
  );

  const selectedAnnotationIdForPage = useCallback(
    (pageId: WorkspacePageId) =>
      visibleSelection?.workspacePageId === pageId
        ? visibleSelection.annotationId
        : null,
    [visibleSelection],
  );

  const selectAnnotation = useCallback(
    (pageId: WorkspacePageId, annotationId: AnnotationId | null) => {
      if (annotationId === null) {
        setSelection(null);
        return;
      }

      const annotation = selectPageAnnotations(presentRef.current, pageId).find(
        (candidate) => candidate.id === annotationId,
      );
      setSelection(
        annotation ? { workspacePageId: pageId, annotationId } : null,
      );
    },
    [],
  );

  const commitAnnotation = useCallback((annotation: PdfAnnotation) => {
    dispatch({ type: 'REPLACE_ANNOTATION', annotation });
  }, []);

  const undo = useCallback(() => {
    dispatch({ type: 'UNDO' });
  }, []);

  const redo = useCallback(() => {
    dispatch({ type: 'REDO' });
  }, []);

  return useMemo(
    () => ({
      state,
      selection: visibleSelection,
      getAnnotationsForPage,
      selectedAnnotationIdForPage,
      selectAnnotation,
      commitAnnotation,
      undo,
      redo,
      dispatch,
    }),
    [
      commitAnnotation,
      dispatch,
      getAnnotationsForPage,
      redo,
      selectAnnotation,
      selectedAnnotationIdForPage,
      visibleSelection,
      state,
      undo,
    ],
  );
}
