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
  type AnnotationStyleDefaults,
  type AnnotationTool,
} from '../model/editorTypes';
import { applyAnnotationStyleDefaults } from '../model/annotationStyle';
import {
  createBrowserAnnotationAssetRegistry,
  type AnnotationAssetRegistry,
} from '../runtime/annotationAssetRegistry';
import { collectReachableAnnotationAssetIds } from '../runtime/assetReachability';
import {
  canRetainTextEditSession,
  createTextEditBoundary,
  textAnnotationFromSession,
  type TextEditSession,
  type TextEditSessionPatch,
} from '../model/textEditSession';

import type {
  AnnotationHistoryState,
  AnnotationId,
  AnnotationSelection,
  PdfOrientedBox,
  PdfAnnotation,
  TextAnnotation,
} from '../model/types';

export interface PendingImagePlacement {
  readonly assetId: string;
  readonly width: number;
  readonly height: number;
}

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
  readonly resetAnnotations: () => void;
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
  readonly assetRegistry: AnnotationAssetRegistry;
  readonly pendingImage: PendingImagePlacement | null;
  readonly imageError: string | null;
  readonly chooseImage: (file: File) => Promise<void>;
  readonly cancelPendingImage: () => void;
  readonly placePendingImage: (
    pageId: WorkspacePageId,
    box: PdfOrientedBox,
  ) => void;
  readonly textEditSession: TextEditSession | null;
  readonly beginTextCreation: (
    pageId: WorkspacePageId,
    box: PdfOrientedBox,
  ) => void;
  readonly editSelectedText: () => void;
  readonly editTextAnnotation: (annotation: TextAnnotation) => void;
  readonly updateTextEditSession: (
    sessionId: string,
    patch: TextEditSessionPatch,
  ) => void;
  readonly commitTextEdit: (sessionId: string) => void;
  readonly cancelTextEdit: (sessionId: string) => void;
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
  const [activeTool, setActiveToolState] = useState<AnnotationTool>('select');
  const [styleDefaults, setStyleDefaults] = useState(DEFAULT_ANNOTATION_STYLE);
  const [pendingImage, setPendingImage] =
    useState<PendingImagePlacement | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [textEditSession, setTextEditSession] =
    useState<TextEditSession | null>(null);
  const createAnnotationId = useMemo(
    () => createBrowserIdFactory('annotation'),
    [],
  );
  const createAssetId = useMemo(
    () => createBrowserIdFactory('annotation-asset'),
    [],
  );
  const createTextSessionId = useMemo(
    () => createBrowserIdFactory('text-edit'),
    [],
  );
  const assetRegistry = useMemo(
    () => createBrowserAnnotationAssetRegistry(createAssetId),
    [createAssetId],
  );
  const textEditBoundaryRef = useRef(createTextEditBoundary());
  const activeToolRef = useRef(activeTool);
  const imageRequestVersionRef = useRef(0);
  const presentRef = useRef(state.present);
  const styleDefaultsRef = useRef(styleDefaults);
  const textEditSessionRef = useRef(textEditSession);
  const pendingImageRef = useRef(pendingImage);
  const committedPageIdsRef = useRef<readonly WorkspacePageId[]>([]);
  useLayoutEffect(() => {
    presentRef.current = state.present;
    styleDefaultsRef.current = styleDefaults;
    textEditSessionRef.current = textEditSession;
    pendingImageRef.current = pendingImage;
    activeToolRef.current = activeTool;
  }, [activeTool, pendingImage, state.present, styleDefaults, textEditSession]);
  const committedPageIds = useMemo(() => pages.map((page) => page.id), [pages]);
  useLayoutEffect(() => {
    committedPageIdsRef.current = committedPageIds;
  }, [committedPageIds]);

  useEffect(() => {
    const removedPageIds = findRemovedWorkspacePageIds(state, committedPageIds);
    if (removedPageIds.length > 0) {
      dispatch({ type: 'PRUNE_REMOVED_PAGES', pageIds: removedPageIds });
    }
  }, [committedPageIds, state]);

  useEffect(() => {
    assetRegistry.reconcile(
      collectReachableAnnotationAssetIds(state, pendingImage?.assetId ?? null),
    );
  }, [assetRegistry, pendingImage?.assetId, state]);

  useEffect(
    () => () => {
      imageRequestVersionRef.current += 1;
      assetRegistry.destroyAll();
    },
    [assetRegistry],
  );

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

  useEffect(() => {
    const session = textEditSessionRef.current;
    if (!session) return;
    if (
      !canRetainTextEditSession(
        session,
        committedPageIds,
        selectPageAnnotations(state.present, session.workspacePageId),
      )
    ) {
      textEditBoundaryRef.current.cancel();
      textEditSessionRef.current = null;
      setTextEditSession(null);
    }
  }, [committedPageIds, state.present]);

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
      const next = applyAnnotationStyleDefaults(current, nextStyle, patch);
      dispatch({
        type: 'UPDATE_ANNOTATION',
        pageId: currentSelection.workspacePageId,
        annotationId: currentSelection.annotationId,
        update: next,
      });
    },
    [selection, styleDefaults],
  );

  const cancelTextSession = useCallback((sessionId?: string) => {
    const session = textEditSessionRef.current;
    if (!session || (sessionId && session.sessionId !== sessionId)) return;
    textEditBoundaryRef.current.cancel();
    textEditSessionRef.current = null;
    setTextEditSession(null);
  }, []);

  const resetAnnotations = useCallback(() => {
    imageRequestVersionRef.current += 1;
    pendingImageRef.current = null;
    setPendingImage(null);
    textEditBoundaryRef.current.cancel();
    textEditSessionRef.current = null;
    setTextEditSession(null);
    setSelection(null);
    activeToolRef.current = 'select';
    setActiveToolState('select');
    setImageError(null);
    dispatch({ type: 'RESET_ANNOTATIONS' });
  }, []);

  const setActiveTool = useCallback(
    (tool: AnnotationTool) => {
      if (tool !== activeToolRef.current) cancelTextSession();
      if (tool !== 'image') {
        imageRequestVersionRef.current += 1;
        pendingImageRef.current = null;
        setPendingImage(null);
      }
      setImageError(null);
      activeToolRef.current = tool;
      setActiveToolState(tool);
    },
    [cancelTextSession],
  );

  const chooseImage = useCallback(
    async (file: File) => {
      const requestVersion = ++imageRequestVersionRef.current;
      setImageError(null);
      try {
        const asset = await assetRegistry.register(file);
        if (requestVersion !== imageRequestVersionRef.current) {
          assetRegistry.destroy(asset.assetId);
          return;
        }
        const next = {
          assetId: asset.assetId,
          width: asset.width,
          height: asset.height,
        };
        pendingImageRef.current = next;
        setPendingImage(next);
        activeToolRef.current = 'image';
        setActiveToolState('image');
      } catch {
        if (requestVersion !== imageRequestVersionRef.current) return;
        setImageError('That image could not be opened. Choose a PNG or JPEG.');
      }
    },
    [assetRegistry],
  );

  const cancelPendingImage = useCallback(() => {
    imageRequestVersionRef.current += 1;
    pendingImageRef.current = null;
    setPendingImage(null);
    activeToolRef.current = 'select';
    setActiveToolState('select');
  }, []);

  const placePendingImage = useCallback(
    (pageId: WorkspacePageId, box: PdfOrientedBox) => {
      const pending = pendingImageRef.current;
      if (!pending || !committedPageIdsRef.current.includes(pageId)) return;
      const annotation: PdfAnnotation = {
        id: createAnnotationId(),
        workspacePageId: pageId,
        kind: 'image',
        box,
        assetId: pending.assetId,
        opacity: styleDefaultsRef.current.opacity,
      };
      dispatch({ type: 'ADD_ANNOTATION', annotation });
      setSelection({ workspacePageId: pageId, annotationId: annotation.id });
      pendingImageRef.current = null;
      setPendingImage(null);
      activeToolRef.current = 'select';
      setActiveToolState('select');
    },
    [createAnnotationId],
  );

  const beginTextCreation = useCallback(
    (pageId: WorkspacePageId, box: PdfOrientedBox) => {
      if (!committedPageIdsRef.current.includes(pageId)) return;
      const session: TextEditSession = {
        sessionId: createTextSessionId(),
        mode: 'create',
        workspacePageId: pageId,
        annotationId: createAnnotationId(),
        box,
        text: '',
        fontSizeUserUnits: styleDefaultsRef.current.fontSize,
        lineHeight: 1.2,
        align: styleDefaultsRef.current.textAlign,
        color: styleDefaultsRef.current.strokeColor,
        opacity: styleDefaultsRef.current.opacity,
        original: null,
      };
      textEditBoundaryRef.current.begin(session.sessionId);
      textEditSessionRef.current = session;
      setTextEditSession(session);
      setSelection(null);
      activeToolRef.current = 'select';
      setActiveToolState('select');
    },
    [createAnnotationId, createTextSessionId],
  );

  const editTextAnnotation = useCallback(
    (annotation: TextAnnotation) => {
      const exists = selectPageAnnotations(
        presentRef.current,
        annotation.workspacePageId,
      ).some(
        (candidate) =>
          candidate.id === annotation.id && candidate.kind === 'text',
      );
      if (!exists) return;
      const session: TextEditSession = {
        sessionId: createTextSessionId(),
        mode: 'edit',
        workspacePageId: annotation.workspacePageId,
        annotationId: annotation.id,
        box: annotation.box,
        text: annotation.text,
        fontSizeUserUnits: annotation.fontSizeUserUnits,
        lineHeight: annotation.lineHeight,
        align: annotation.align,
        color: annotation.color,
        opacity: annotation.opacity,
        original: annotation,
      };
      textEditBoundaryRef.current.begin(session.sessionId);
      textEditSessionRef.current = session;
      setTextEditSession(session);
      setSelection({
        workspacePageId: annotation.workspacePageId,
        annotationId: annotation.id,
      });
      activeToolRef.current = 'select';
      setActiveToolState('select');
    },
    [createTextSessionId],
  );

  const editSelectedText = useCallback(() => {
    const currentSelection = selection;
    if (!currentSelection) return;
    const annotation = selectPageAnnotations(
      presentRef.current,
      currentSelection.workspacePageId,
    ).find(
      (candidate): candidate is TextAnnotation =>
        candidate.id === currentSelection.annotationId &&
        candidate.kind === 'text',
    );
    if (annotation) editTextAnnotation(annotation);
  }, [editTextAnnotation, selection]);

  const updateTextEditSession = useCallback(
    (sessionId: string, patch: TextEditSessionPatch) => {
      const current = textEditSessionRef.current;
      if (!current || current.sessionId !== sessionId) return;
      const next = { ...current, ...patch, sessionId: current.sessionId };
      textEditSessionRef.current = next;
      setTextEditSession(next);
    },
    [],
  );

  const commitTextEdit = useCallback((sessionId: string) => {
    const session = textEditSessionRef.current;
    if (
      !session ||
      session.sessionId !== sessionId ||
      !textEditBoundaryRef.current.complete(sessionId) ||
      !committedPageIdsRef.current.includes(session.workspacePageId)
    ) {
      return;
    }
    textEditSessionRef.current = null;
    setTextEditSession(null);
    const annotation = textAnnotationFromSession(session);
    if (!annotation) return;
    if (session.mode === 'create') {
      dispatch({ type: 'ADD_ANNOTATION', annotation });
    } else {
      const exists = selectPageAnnotations(
        presentRef.current,
        session.workspacePageId,
      ).some(
        (candidate) =>
          candidate.id === session.annotationId && candidate.kind === 'text',
      );
      if (!exists) return;
      dispatch({ type: 'REPLACE_ANNOTATION', annotation });
    }
    setSelection({
      workspacePageId: annotation.workspacePageId,
      annotationId: annotation.id,
    });
  }, []);

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
      resetAnnotations,
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
      assetRegistry,
      pendingImage,
      imageError,
      chooseImage,
      cancelPendingImage,
      placePendingImage,
      textEditSession,
      beginTextCreation,
      editSelectedText,
      editTextAnnotation,
      updateTextEditSession,
      commitTextEdit,
      cancelTextEdit: cancelTextSession,
    }),
    [
      commitAnnotation,
      addAnnotation,
      activeTool,
      assetRegistry,
      beginTextCreation,
      cancelPendingImage,
      cancelTextSession,
      chooseImage,
      clearSelection,
      createAnnotationId,
      deleteSelected,
      dispatch,
      getAnnotationsForPage,
      imageError,
      editSelectedText,
      editTextAnnotation,
      pendingImage,
      placePendingImage,
      redo,
      resetAnnotations,
      selectAnnotation,
      selectedAnnotationIdForPage,
      visibleSelection,
      styleDefaults,
      state,
      setActiveTool,
      textEditSession,
      undo,
      updateSelectedStyle,
      updateStyleDefaults,
      updateTextEditSession,
      commitTextEdit,
    ],
  );
}
