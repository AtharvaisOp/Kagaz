import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';

import { assertValidNativeReplacementText } from '../../../lib/pdf-native-text/contentStream';
import {
  NativeTextEditError,
  type NativeTextEdit,
  type NativeTextEditHistoryState,
  type NativeTextSelectionProof,
} from '../../../lib/pdf-native-text/types';
import type {
  EditorHistoryBridge,
  EditorHistoryParticipant,
} from '../../editor-history/types';
import type { WorkspacePage } from '../../pdf-workspace/model/types';
import { createBrowserIdFactory } from '../../pdf-workspace/runtime/ids';
import type { SourceDocumentRegistry } from '../../pdf-workspace/runtime/sourceDocumentRegistry';
import {
  createNativeTextEditHistory,
  nativeTextEditReducer,
  snapshotNativeTextEdits,
  type NativeTextEditAction,
} from '../model/reducer';

export interface NativeTextDraftUpdate {
  readonly replacementText?: string;
  readonly translationX?: number;
  readonly translationY?: number;
}

export interface PdfNativeTextController {
  readonly state: NativeTextEditHistoryState;
  readonly draft: NativeTextEdit | null;
  readonly resolving: boolean;
  readonly error: string | null;
  readonly announcement: string | null;
  readonly hasUnsavedWork: boolean;
  readonly historyParticipant: EditorHistoryParticipant;
  readonly beginFromSelection: (
    page: WorkspacePage,
    selection: NativeTextSelectionProof | null,
  ) => Promise<boolean>;
  readonly updateDraft: (update: NativeTextDraftUpdate) => void;
  readonly commitDraft: () => boolean;
  readonly cancelDraft: () => void;
  readonly editExisting: (editId: string) => void;
  readonly remove: (editId: string) => void;
  readonly getForPage: (workspacePageId: string) => readonly NativeTextEdit[];
  readonly getExportBlockReason: () => string | null;
  readonly snapshotForPages: (
    pages: readonly WorkspacePage[],
  ) => readonly NativeTextEdit[];
  readonly reset: () => void;
}

function cloneEdit(edit: NativeTextEdit): NativeTextEdit {
  return {
    ...edit,
    identity: {
      ...edit.identity,
      textMatrix: [
        ...edit.identity.textMatrix,
      ] as NativeTextEdit['identity']['textMatrix'],
    },
  };
}

function matchesSourceRun(
  edit: NativeTextEdit,
  page: WorkspacePage,
  identity: NativeTextEdit['identity'],
): boolean {
  return (
    edit.workspacePageId === page.id &&
    edit.sourceDocumentId === page.sourceDocumentId &&
    edit.sourcePageIndex === page.sourcePageIndex &&
    edit.identity.sourceFileFingerprint === identity.sourceFileFingerprint &&
    edit.identity.streamFingerprint === identity.streamFingerprint &&
    edit.identity.runOrdinal === identity.runOrdinal
  );
}

/** Workspace-local state for verified source Tj edits; it never owns PDF objects. */
export function usePdfNativeText(
  pages: readonly WorkspacePage[],
  registry: SourceDocumentRegistry,
  history?: EditorHistoryBridge,
): PdfNativeTextController {
  const [state, dispatch] = useReducer(
    nativeTextEditReducer,
    undefined,
    createNativeTextEditHistory,
  );
  const stateRef = useRef(state);
  const [draft, setDraft] = useState<NativeTextEdit | null>(null);
  const draftRef = useRef(draft);
  const [resolving, setResolving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState<string | null>(null);
  const pageIdsRef = useRef(new Set(pages.map((page) => page.id)));
  const resolutionGeneration = useRef(0);
  const resolutionAbortRef = useRef<AbortController | null>(null);
  const createId = useMemo(() => createBrowserIdFactory('source-text'), []);

  const apply = useCallback((action: NativeTextEditAction) => {
    const next = nativeTextEditReducer(stateRef.current, action);
    if (next === stateRef.current) return false;
    stateRef.current = next;
    dispatch(action);
    return true;
  }, []);

  const cancelDraft = useCallback(() => {
    resolutionGeneration.current += 1;
    resolutionAbortRef.current?.abort();
    resolutionAbortRef.current = null;
    draftRef.current = null;
    setDraft(null);
    setResolving(false);
    setError(null);
  }, []);

  useLayoutEffect(() => {
    const nextIds = new Set(pages.map((page) => page.id));
    const removed = [...pageIdsRef.current].filter((id) => !nextIds.has(id));
    pageIdsRef.current = nextIds;
    if (removed.length) {
      apply({ type: 'PRUNE', pageIds: removed });
      history?.prune(removed);
      if (
        draftRef.current &&
        removed.includes(draftRef.current.workspacePageId)
      )
        cancelDraft();
    }
  }, [apply, cancelDraft, history, pages]);

  const beginFromSelection = useCallback(
    async (page: WorkspacePage, selection: NativeTextSelectionProof | null) => {
      if (draftRef.current) {
        setError('Finish or cancel the current source-text edit first.');
        return false;
      }
      if (!selection) {
        setError(
          'Select exactly one complete rendered source-text run. Partial or multi-run selections cannot be safely edited.',
        );
        return false;
      }
      const runtime = registry.get(page.sourceDocumentId);
      if (!runtime) {
        setError('This source PDF is no longer available.');
        return false;
      }
      const generation = resolutionGeneration.current + 1;
      resolutionGeneration.current = generation;
      resolutionAbortRef.current?.abort();
      const abortController = new AbortController();
      resolutionAbortRef.current = abortController;
      setResolving(true);
      setError(null);
      try {
        const { resolveNativeTextSelection } =
          await import('../../../lib/pdf-native-text/nativeTextContent');
        const { identity } = await resolveNativeTextSelection(
          runtime.file,
          page.sourcePageIndex,
          selection,
          abortController.signal,
        );
        if (
          generation !== resolutionGeneration.current ||
          !pageIdsRef.current.has(page.id)
        )
          return false;
        const existing = stateRef.current.present.find((edit) =>
          matchesSourceRun(edit, page, identity),
        );
        if (existing) {
          draftRef.current = cloneEdit(existing);
          setDraft(draftRef.current);
          setAnnouncement('Reopened the pending source-text edit.');
          return true;
        }
        const next: NativeTextEdit = {
          id: createId(),
          workspacePageId: page.id,
          sourceDocumentId: page.sourceDocumentId,
          sourcePageIndex: page.sourcePageIndex,
          identity,
          replacementText: identity.originalText,
          translationX: 0,
          translationY: 0,
        };
        draftRef.current = next;
        setDraft(next);
        setAnnouncement('Verified source text is ready to edit.');
        return true;
      } catch (reason: unknown) {
        if (generation === resolutionGeneration.current) {
          setError(
            reason instanceof NativeTextEditError
              ? reason.message
              : 'Kagaz could not verify this source-text selection.',
          );
        }
        return false;
      } finally {
        if (generation === resolutionGeneration.current) {
          resolutionAbortRef.current = null;
          setResolving(false);
        }
      }
    },
    [createId, registry],
  );

  const updateDraft = useCallback(
    (update: NativeTextDraftUpdate) => {
      const current = draftRef.current;
      if (!current || resolving) return;
      const next = {
        ...current,
        ...update,
      };
      draftRef.current = next;
      setDraft(next);
      setError(null);
    },
    [resolving],
  );

  const commitDraft = useCallback(() => {
    const current = draftRef.current;
    if (!current || resolving) return false;
    try {
      assertValidNativeReplacementText(current.replacementText);
      if (
        !Number.isFinite(current.translationX) ||
        !Number.isFinite(current.translationY)
      ) {
        throw new NativeTextEditError(
          'invalid-replacement',
          'Use finite numeric values for the text position.',
        );
      }
      if (
        current.replacementText === current.identity.originalText &&
        current.translationX === 0 &&
        current.translationY === 0
      ) {
        throw new NativeTextEditError(
          'invalid-replacement',
          'Change the text or move it before applying this source-text edit.',
        );
      }
      if (!pageIdsRef.current.has(current.workspacePageId)) {
        throw new NativeTextEditError(
          'identity-mismatch',
          'This page is no longer in the workspace.',
        );
      }
      const committed = Object.freeze(cloneEdit(current));
      if (!apply({ type: 'COMMIT', edit: committed })) return false;
      history?.record([committed.workspacePageId]);
      draftRef.current = null;
      setDraft(null);
      setError(null);
      setAnnouncement('Source-text edit staged for genuine PDF export.');
      return true;
    } catch (reason: unknown) {
      setError(
        reason instanceof NativeTextEditError
          ? reason.message
          : 'Kagaz could not stage this source-text edit.',
      );
      return false;
    }
  }, [apply, history, resolving]);

  const editExisting = useCallback((editId: string) => {
    if (draftRef.current) return;
    const existing = stateRef.current.present.find(
      (edit) => edit.id === editId,
    );
    if (!existing) return;
    const next = cloneEdit(existing);
    draftRef.current = next;
    setDraft(next);
    setError(null);
    setAnnouncement('Editing the staged source-text change.');
  }, []);

  const remove = useCallback(
    (editId: string) => {
      const existing = stateRef.current.present.find(
        (edit) => edit.id === editId,
      );
      const removed = apply({ type: 'REMOVE', id: editId });
      if (removed) {
        history?.record(existing ? [existing.workspacePageId] : undefined);
        setAnnouncement('Staged source-text edit removed.');
      }
      if (draftRef.current?.id === editId) cancelDraft();
    },
    [apply, cancelDraft, history],
  );

  const getForPage = useCallback(
    (workspacePageId: string) =>
      state.present.filter((edit) => edit.workspacePageId === workspacePageId),
    [state.present],
  );
  const getExportBlockReason = useCallback(
    () =>
      draftRef.current
        ? 'Finish or cancel the active source-text edit before exporting.'
        : null,
    [],
  );
  const snapshotForPages = useCallback(
    (targetPages: readonly WorkspacePage[]) =>
      snapshotNativeTextEdits(
        stateRef.current,
        new Set(targetPages.map((page) => page.id)),
      ),
    [],
  );
  const reset = useCallback(() => {
    cancelDraft();
    apply({ type: 'RESET' });
    setError(null);
    setAnnouncement(null);
  }, [apply, cancelDraft]);
  const historyParticipant = useMemo<EditorHistoryParticipant>(
    () => ({
      get canUndo() {
        return stateRef.current.past.length > 0;
      },
      get canRedo() {
        return stateRef.current.future.length > 0;
      },
      undo: () => apply({ type: 'UNDO' }),
      redo: () => apply({ type: 'REDO' }),
      discardFuture: () => {
        apply({ type: 'DISCARD_FUTURE' });
      },
    }),
    [apply],
  );

  return {
    state,
    draft,
    resolving,
    error,
    announcement,
    hasUnsavedWork: state.present.length > 0 || draft !== null,
    historyParticipant,
    beginFromSelection,
    updateDraft,
    commitDraft,
    cancelDraft,
    editExisting,
    remove,
    getForPage,
    getExportBlockReason,
    snapshotForPages,
    reset,
  };
}
