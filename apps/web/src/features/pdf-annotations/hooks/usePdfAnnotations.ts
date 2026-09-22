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
  UnsupportedJpegOrientationError,
  UNSUPPORTED_JPEG_ORIENTATION_MESSAGE,
} from '../runtime/jpegExifOrientation';
import {
  canRetainTextEditSession,
  createTextEditBoundary,
  textAnnotationFromSession,
  type TextEditSession,
  type TextEditSessionPatch,
} from '../model/textEditSession';
import { hasUnsavedAnnotationWork } from '../model/unsavedWork';
import type {
  EditorHistoryBridge,
  EditorHistoryParticipant,
} from '../../editor-history/types';

import type {
  AnnotationHistoryState,
  AnnotationId,
  AnnotationSelection,
  PdfOrientedBox,
  PdfAnnotation,
  SignatureMethod,
  TextAnnotation,
} from '../model/types';

export interface PendingImagePlacement {
  readonly assetId: string;
  readonly width: number;
  readonly height: number;
}

export interface PendingSignaturePlacement extends PendingImagePlacement {
  readonly method: SignatureMethod;
}

export interface PdfAnnotationController {
  readonly state: AnnotationHistoryState;
  readonly hasUnsavedWork: boolean;
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
  readonly deleteAnnotation: (
    pageId: WorkspacePageId,
    annotationId: AnnotationId,
  ) => void;
  readonly deleteSelected: () => void;
  readonly clearSelection: () => void;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly createAnnotationId: () => string;
  readonly assetRegistry: AnnotationAssetRegistry;
  readonly pendingImage: PendingImagePlacement | null;
  readonly pendingSignature: PendingSignaturePlacement | null;
  readonly signatureCreatorOpen: boolean;
  readonly openSignatureCreator: () => void;
  readonly closeSignatureCreator: () => void;
  readonly beginSignatureAsset: (
    blob: Blob,
    method: SignatureMethod,
  ) => Promise<void>;
  readonly chooseSignatureUpload: (file: File) => Promise<void>;
  readonly imageError: string | null;
  readonly chooseImage: (file: File) => Promise<void>;
  readonly cancelPendingImage: () => void;
  readonly placePendingImage: (
    pageId: WorkspacePageId,
    box: PdfOrientedBox,
  ) => void;
  readonly placePendingSignature: (
    pageId: WorkspacePageId,
    box: PdfOrientedBox,
  ) => void;
  readonly getExportBlockReason: (
    pages: readonly WorkspacePage[],
  ) => string | null;
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
  readonly historyParticipant: EditorHistoryParticipant;
}

export function usePdfAnnotations(
  pages: readonly WorkspacePage[],
  history?: EditorHistoryBridge,
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
  const [pendingSignature, setPendingSignature] =
    useState<PendingSignaturePlacement | null>(null);
  const [signatureCreatorOpen, setSignatureCreatorOpen] = useState(false);
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
  const pendingSignatureRef = useRef(pendingSignature);
  const stateRef = useRef(state);
  const committedPageIdsRef = useRef<readonly WorkspacePageId[]>([]);
  useLayoutEffect(() => {
    stateRef.current = state;
    presentRef.current = state.present;
    styleDefaultsRef.current = styleDefaults;
    textEditSessionRef.current = textEditSession;
    pendingImageRef.current = pendingImage;
    pendingSignatureRef.current = pendingSignature;
    activeToolRef.current = activeTool;
  }, [
    activeTool,
    pendingImage,
    pendingSignature,
    state,
    styleDefaults,
    textEditSession,
  ]);

  const dispatchTracked = useCallback(
    (action: AnnotationAction) => {
      const next = annotationReducer(stateRef.current, action);
      if (next === stateRef.current) return;
      dispatch(action);
      if (
        action.type !== 'UNDO' &&
        action.type !== 'REDO' &&
        action.type !== 'PRUNE_REMOVED_PAGES' &&
        action.type !== 'RESET_ANNOTATIONS'
      ) {
        history?.record();
      }
    },
    [history],
  );
  const committedPageIds = useMemo(() => pages.map((page) => page.id), [pages]);
  useLayoutEffect(() => {
    committedPageIdsRef.current = committedPageIds;
  }, [committedPageIds]);

  useEffect(() => {
    const removedPageIds = findRemovedWorkspacePageIds(state, committedPageIds);
    if (removedPageIds.length > 0) {
      dispatch({ type: 'PRUNE_REMOVED_PAGES', pageIds: removedPageIds });
      history?.prune();
    }
  }, [committedPageIds, history, state]);

  useEffect(() => {
    assetRegistry.reconcile(
      collectReachableAnnotationAssetIds(
        state,
        pendingImage?.assetId ?? pendingSignature?.assetId ?? null,
      ),
    );
  }, [assetRegistry, pendingImage?.assetId, pendingSignature?.assetId, state]);

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

  const commitAnnotation = useCallback(
    (annotation: PdfAnnotation) => {
      dispatchTracked({ type: 'REPLACE_ANNOTATION', annotation });
    },
    [dispatchTracked],
  );

  const addAnnotation = useCallback(
    (annotation: PdfAnnotation) => {
      dispatchTracked({ type: 'ADD_ANNOTATION', annotation });
      setSelection({
        workspacePageId: annotation.workspacePageId,
        annotationId: annotation.id,
      });
    },
    [dispatchTracked],
  );

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
      dispatchTracked({
        type: 'UPDATE_ANNOTATION',
        pageId: currentSelection.workspacePageId,
        annotationId: currentSelection.annotationId,
        update: next,
      });
    },
    [dispatchTracked, selection, styleDefaults],
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
    pendingSignatureRef.current = null;
    setPendingSignature(null);
    setSignatureCreatorOpen(false);
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
      if (tool !== 'signature') {
        imageRequestVersionRef.current += 1;
        pendingSignatureRef.current = null;
        setPendingSignature(null);
        setSignatureCreatorOpen(false);
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
      } catch (error) {
        if (requestVersion !== imageRequestVersionRef.current) return;
        setImageError(
          error instanceof UnsupportedJpegOrientationError
            ? UNSUPPORTED_JPEG_ORIENTATION_MESSAGE
            : 'That image could not be opened. Choose a PNG or JPEG.',
        );
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

  const openSignatureCreator = useCallback(() => {
    setImageError(null);
    setSignatureCreatorOpen(true);
    activeToolRef.current = 'signature';
    setActiveToolState('signature');
  }, []);

  const closeSignatureCreator = useCallback(() => {
    setSignatureCreatorOpen(false);
    if (!pendingSignatureRef.current) {
      activeToolRef.current = 'select';
      setActiveToolState('select');
    }
  }, []);

  const beginSignatureAsset = useCallback(
    async (blob: Blob, method: SignatureMethod) => {
      const requestVersion = ++imageRequestVersionRef.current;
      setImageError(null);
      try {
        const asset = await assetRegistry.register(blob);
        if (requestVersion !== imageRequestVersionRef.current) {
          assetRegistry.destroy(asset.assetId);
          return;
        }
        pendingImageRef.current = null;
        setPendingImage(null);
        const next: PendingSignaturePlacement = {
          assetId: asset.assetId,
          width: asset.width,
          height: asset.height,
          method,
        };
        pendingSignatureRef.current = next;
        setPendingSignature(next);
        setSignatureCreatorOpen(false);
        activeToolRef.current = 'signature';
        setActiveToolState('signature');
      } catch (error) {
        if (requestVersion !== imageRequestVersionRef.current) return;
        setImageError(
          error instanceof UnsupportedJpegOrientationError
            ? UNSUPPORTED_JPEG_ORIENTATION_MESSAGE
            : 'That signature image could not be opened. Choose a PNG or JPEG.',
        );
      }
    },
    [assetRegistry],
  );

  const chooseSignatureUpload = useCallback(
    (file: File) => beginSignatureAsset(file, 'upload'),
    [beginSignatureAsset],
  );

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
      dispatchTracked({ type: 'ADD_ANNOTATION', annotation });
      setSelection({ workspacePageId: pageId, annotationId: annotation.id });
      pendingImageRef.current = null;
      setPendingImage(null);
      activeToolRef.current = 'select';
      setActiveToolState('select');
    },
    [createAnnotationId, dispatchTracked],
  );

  const placePendingSignature = useCallback(
    (pageId: WorkspacePageId, box: PdfOrientedBox) => {
      const pending = pendingSignatureRef.current;
      if (!pending || !committedPageIdsRef.current.includes(pageId)) return;
      const annotation: PdfAnnotation = {
        id: createAnnotationId(),
        workspacePageId: pageId,
        kind: 'signature',
        box,
        assetId: pending.assetId,
        method: pending.method,
        opacity: 1,
      };
      dispatchTracked({ type: 'ADD_ANNOTATION', annotation });
      setSelection({ workspacePageId: pageId, annotationId: annotation.id });
      pendingSignatureRef.current = null;
      setPendingSignature(null);
      activeToolRef.current = 'select';
      setActiveToolState('select');
    },
    [createAnnotationId, dispatchTracked],
  );

  const getExportBlockReason = useCallback(
    (exportPages: readonly WorkspacePage[]) => {
      if (pendingSignatureRef.current) {
        return 'Finish placing or cancel the pending visual signature before exporting.';
      }
      const exportPageIds = new Set(exportPages.map((page) => page.id));
      const hasSignature = Object.values(stateRef.current.present.byPage).some(
        (annotations) =>
          annotations?.some(
            (annotation) =>
              annotation.kind === 'signature' &&
              exportPageIds.has(annotation.workspacePageId),
          ),
      );
      return hasSignature
        ? 'Visual signatures cannot be included in PDF export yet. Remove the signature or keep this workspace in the browser.'
        : null;
    },
    [],
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

  const commitTextEdit = useCallback(
    (sessionId: string) => {
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
        dispatchTracked({ type: 'ADD_ANNOTATION', annotation });
      } else {
        const exists = selectPageAnnotations(
          presentRef.current,
          session.workspacePageId,
        ).some(
          (candidate) =>
            candidate.id === session.annotationId && candidate.kind === 'text',
        );
        if (!exists) return;
        dispatchTracked({ type: 'REPLACE_ANNOTATION', annotation });
      }
      setSelection({
        workspacePageId: annotation.workspacePageId,
        annotationId: annotation.id,
      });
    },
    [dispatchTracked],
  );

  const deleteAnnotation = useCallback(
    (pageId: WorkspacePageId, annotationId: AnnotationId) => {
      const exists = selectPageAnnotations(presentRef.current, pageId).some(
        (annotation) => annotation.id === annotationId,
      );
      if (!exists) return;
      dispatchTracked({
        type: 'DELETE_ANNOTATION',
        pageId,
        annotationId,
      });
      if (
        selection?.workspacePageId === pageId &&
        selection.annotationId === annotationId
      ) {
        setSelection(null);
      }
    },
    [dispatchTracked, selection],
  );

  const deleteSelected = useCallback(() => {
    const currentSelection = selection;
    if (!currentSelection) return;
    const exists = selectPageAnnotations(
      presentRef.current,
      currentSelection.workspacePageId,
    ).some((annotation) => annotation.id === currentSelection.annotationId);
    if (!exists) {
      setSelection(null);
      return;
    }
    deleteAnnotation(
      currentSelection.workspacePageId,
      currentSelection.annotationId,
    );
  }, [deleteAnnotation, selection]);

  const clearSelection = useCallback(() => setSelection(null), []);

  const domainUndo = useCallback(() => {
    if (stateRef.current.past.length === 0) return false;
    dispatch({ type: 'UNDO' });
    return true;
  }, []);

  const domainRedo = useCallback(() => {
    if (stateRef.current.future.length === 0) return false;
    dispatch({ type: 'REDO' });
    return true;
  }, []);

  const historyParticipant = useMemo<EditorHistoryParticipant>(
    () => ({
      get canUndo() {
        return stateRef.current.past.length > 0;
      },
      get canRedo() {
        return stateRef.current.future.length > 0;
      },
      undo: domainUndo,
      redo: domainRedo,
      discardFuture: () => dispatch({ type: 'DISCARD_FUTURE' }),
    }),
    [domainRedo, domainUndo],
  );

  const undo = useMemo(
    () => history?.undo ?? (() => void domainUndo()),
    [domainUndo, history],
  );
  const redo = useMemo(
    () => history?.redo ?? (() => void domainRedo()),
    [domainRedo, history],
  );
  const historyCanUndo = history?.canUndo;
  const historyCanRedo = history?.canRedo;

  return useMemo(
    () => ({
      state,
      hasUnsavedWork: hasUnsavedAnnotationWork(
        state.dirty,
        textEditSession,
        pendingImage !== null,
        pendingSignature !== null,
      ),
      selection: visibleSelection,
      getAnnotationsForPage,
      selectedAnnotationIdForPage,
      selectAnnotation,
      commitAnnotation,
      addAnnotation,
      undo,
      redo,
      resetAnnotations,
      dispatch: dispatchTracked,
      activeTool,
      setActiveTool,
      styleDefaults,
      updateStyleDefaults,
      updateSelectedStyle,
      deleteAnnotation,
      deleteSelected,
      clearSelection,
      canUndo: historyCanUndo ?? state.past.length > 0,
      canRedo: historyCanRedo ?? state.future.length > 0,
      createAnnotationId,
      assetRegistry,
      pendingImage,
      pendingSignature,
      signatureCreatorOpen,
      openSignatureCreator,
      closeSignatureCreator,
      beginSignatureAsset,
      chooseSignatureUpload,
      imageError,
      chooseImage,
      cancelPendingImage,
      placePendingImage,
      placePendingSignature,
      getExportBlockReason,
      textEditSession,
      beginTextCreation,
      editSelectedText,
      editTextAnnotation,
      updateTextEditSession,
      commitTextEdit,
      cancelTextEdit: cancelTextSession,
      historyParticipant,
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
      deleteAnnotation,
      dispatchTracked,
      getAnnotationsForPage,
      imageError,
      editSelectedText,
      editTextAnnotation,
      pendingImage,
      pendingSignature,
      signatureCreatorOpen,
      openSignatureCreator,
      closeSignatureCreator,
      beginSignatureAsset,
      chooseSignatureUpload,
      placePendingImage,
      placePendingSignature,
      getExportBlockReason,
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
      historyParticipant,
      historyCanUndo,
      historyCanRedo,
    ],
  );
}
