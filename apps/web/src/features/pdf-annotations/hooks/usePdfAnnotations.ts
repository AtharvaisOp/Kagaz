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
import { createBrowserIdFactory } from '../../pdf-workspace/runtime/ids';
import {
  DEFAULT_ANNOTATION_STYLE,
  createFillStyle,
  createStrokeStyle,
  type AnnotationStyleDefaults,
  type AnnotationTool,
} from '../model/editorTypes';

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
  readonly addAnnotation: (annotation: PdfAnnotation) => void;
  readonly undo: () => void;
  readonly redo: () => void;
  readonly dispatch: Dispatch<AnnotationAction>;
  readonly activeTool: AnnotationTool;
  readonly setActiveTool: (tool: AnnotationTool) => void;
  readonly styleDefaults: AnnotationStyleDefaults;
  readonly updateStyleDefaults: (
    patch: Partial<AnnotationStyleDefaults>,
  ) => void;
  readonly updateSelectedStyle: (
    patch: Partial<AnnotationStyleDefaults>,
  ) => void;
  readonly deleteSelected: () => void;
  readonly clearSelection: () => void;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly createAnnotationId: () => string;
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
  const [activeTool, setActiveTool] = useState<AnnotationTool>('select');
  const [styleDefaults, setStyleDefaults] = useState(DEFAULT_ANNOTATION_STYLE);
  const createAnnotationId = useMemo(
    () => createBrowserIdFactory('annotation'),
    [],
  );
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
    if (!committedPageIds.includes(selection.workspacePageId)) {
      return null;
    }
    return selectPageAnnotations(state.present, selection.workspacePageId).some(
      (annotation) => annotation.id === selection.annotationId,
    )
      ? selection
      : null;
  }, [committedPageIds, selection, state.present]);

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

  const addAnnotation = useCallback((annotation: PdfAnnotation) => {
    dispatch({ type: 'ADD_ANNOTATION', annotation });
    setSelection({
      workspacePageId: annotation.workspacePageId,
      annotationId: annotation.id,
    });
  }, []);

  const updateStyleDefaults = useCallback(
    (patch: Partial<AnnotationStyleDefaults>) => {
      setStyleDefaults((current) => ({ ...current, ...patch }));
    },
    [],
  );

  const updateSelectedStyle = useCallback(
    (patch: Partial<AnnotationStyleDefaults>) => {
      const currentSelection = selection;
      if (!currentSelection) {
        return;
      }
      const current = selectPageAnnotations(
        presentRef.current,
        currentSelection.workspacePageId,
      ).find((annotation) => annotation.id === currentSelection.annotationId);
      if (!current) {
        return;
      }
      const nextStyle = { ...styleDefaults, ...patch };
      const next = (() => {
        switch (current.kind) {
          case 'highlight':
            return {
              ...current,
              fill: createFillStyle(nextStyle),
            };
          case 'rectangle':
          case 'ellipse':
            return {
              ...current,
              stroke: createStrokeStyle(nextStyle),
              fill: current.fill
                ? createFillStyle(nextStyle, Math.min(nextStyle.opacity, 0.25))
                : null,
            };
          case 'line':
          case 'freehand':
            return {
              ...current,
              stroke: createStrokeStyle(nextStyle, nextStyle.opacity),
            };
          default:
            return current;
        }
      })();
      dispatch({
        type: 'UPDATE_ANNOTATION',
        pageId: currentSelection.workspacePageId,
        annotationId: currentSelection.annotationId,
        update: next,
      });
    },
    [selection, styleDefaults],
  );

  const deleteSelected = useCallback(() => {
    const currentSelection = selection;
    if (!currentSelection) {
      return;
    }
    const exists = selectPageAnnotations(
      presentRef.current,
      currentSelection.workspacePageId,
    ).some((annotation) => annotation.id === currentSelection.annotationId);
    if (!exists) {
      setSelection(null);
      return;
    }
    dispatch({
      type: 'DELETE_ANNOTATION',
      pageId: currentSelection.workspacePageId,
      annotationId: currentSelection.annotationId,
    });
    setSelection(null);
  }, [selection]);

  const clearSelection = useCallback(() => setSelection(null), []);

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
      addAnnotation,
      undo,
      redo,
      dispatch,
      activeTool,
      setActiveTool,
      styleDefaults,
      updateStyleDefaults,
      updateSelectedStyle,
      deleteSelected,
      clearSelection,
      canUndo: state.past.length > 0,
      canRedo: state.future.length > 0,
      createAnnotationId,
    }),
    [
      commitAnnotation,
      addAnnotation,
      activeTool,
      clearSelection,
      createAnnotationId,
      deleteSelected,
      dispatch,
      getAnnotationsForPage,
      redo,
      selectAnnotation,
      selectedAnnotationIdForPage,
      visibleSelection,
      styleDefaults,
      state,
      undo,
      updateSelectedStyle,
      updateStyleDefaults,
    ],
  );
}
