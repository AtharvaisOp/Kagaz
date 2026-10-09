import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import type {
  EditorHistoryBridge,
  EditorHistoryParticipant,
} from '../../editor-history/types';
import type {
  WorkspacePage,
  WorkspacePageId,
} from '../../pdf-workspace/model/types';
import { createBrowserIdFactory } from '../../pdf-workspace/runtime/ids';
import { boxWithinPage } from '../model/geometry';
import {
  createRedactionHistory,
  redactionReducer,
  type RedactionAction,
} from '../model/reducer';
import type {
  RedactionBox,
  RedactionHistoryState,
  RedactionRegion,
} from '../model/types';

const EMPTY_REGIONS: readonly RedactionRegion[] = Object.freeze([]);

export interface PdfRedactionController {
  readonly state: RedactionHistoryState;
  readonly active: boolean;
  readonly setActive: (active: boolean) => void;
  readonly selectionId: string | null;
  readonly select: (id: string | null) => void;
  readonly hasUnsavedWork: boolean;
  readonly error: string | null;
  readonly announcement: string | null;
  readonly add: (pageId: WorkspacePageId, box: RedactionBox) => void;
  readonly replace: (region: RedactionRegion) => void;
  readonly remove: (id: string) => void;
  readonly removeSelected: () => void;
  readonly getRegionsForPage: (
    pageId: WorkspacePageId,
  ) => readonly RedactionRegion[];
  readonly registerPageBounds: (
    pageId: WorkspacePageId,
    bounds: RedactionBox,
  ) => void;
  readonly getPageBounds: (pageId: WorkspacePageId) => RedactionBox | undefined;
  readonly reset: () => void;
  readonly historyParticipant: EditorHistoryParticipant;
}

/** Proposals have their own geometry and history, never annotation style or finalization. */
export function usePdfRedactions(
  pages: readonly WorkspacePage[],
  history?: EditorHistoryBridge,
): PdfRedactionController {
  const [state, dispatch] = useReducer(
    redactionReducer,
    undefined,
    createRedactionHistory,
  );
  const [active, setActive] = useState(false);
  const [selectionId, setSelection] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState<string | null>(null);
  const [, boundsChanged] = useReducer((version: number) => version + 1, 0);
  const boundsRef = useRef(new Map<WorkspacePageId, RedactionBox>());
  const stateRef = useRef(state);
  const pageIdsRef = useRef(new Set<WorkspacePageId>());
  const createId = useMemo(() => createBrowserIdFactory('redaction'), []);
  const apply = useCallback((action: RedactionAction) => {
    const next = redactionReducer(stateRef.current, action);
    if (next === stateRef.current) return false;
    stateRef.current = next;
    dispatch(action);
    return true;
  }, []);

  useLayoutEffect(() => {
    pageIdsRef.current = new Set(pages.map((page) => page.id));
    const removed = new Set<string>();
    for (const regions of [
      stateRef.current.present,
      ...stateRef.current.past,
      ...stateRef.current.future,
    ]) {
      for (const region of regions)
        if (!pageIdsRef.current.has(region.pageId)) removed.add(region.pageId);
    }
    for (const id of boundsRef.current.keys())
      if (!pageIdsRef.current.has(id)) boundsRef.current.delete(id);
    if (removed.size) {
      apply({ type: 'PRUNE', pageIds: [...removed] });
      history?.prune([...removed]);
    }
  }, [apply, history, pages]);

  const validatedCommit = useCallback(
    (region: RedactionRegion, type: 'ADD' | 'REPLACE') => {
      const bounds = boundsRef.current.get(region.pageId);
      if (!pageIdsRef.current.has(region.pageId)) return;
      if (
        type === 'REPLACE' &&
        !stateRef.current.present.some(
          (candidate) =>
            candidate.id === region.id && candidate.pageId === region.pageId,
        )
      )
        return;
      if (!bounds || !boxWithinPage(region.box, bounds)) {
        setError(
          'Use finite, positive dimensions entirely inside the visible page bounds.',
        );
        return;
      }
      const proposal = Object.freeze({
        ...region,
        box: Object.freeze({ ...region.box }),
      });
      if (apply({ type, region: proposal })) {
        history?.record([region.pageId]);
        setAnnouncement(
          type === 'ADD'
            ? 'Pending redaction added.'
            : 'Pending redaction geometry updated.',
        );
      }
      setSelection(region.id);
      setError(null);
    },
    [apply, history],
  );

  const add = useCallback(
    (pageId: WorkspacePageId, box: RedactionBox) =>
      validatedCommit({ id: createId(), pageId, box }, 'ADD'),
    [createId, validatedCommit],
  );
  const replace = useCallback(
    (region: RedactionRegion) => validatedCommit(region, 'REPLACE'),
    [validatedCommit],
  );
  const remove = useCallback(
    (id: string) => {
      const region = stateRef.current.present.find(
        (candidate) => candidate.id === id,
      );
      if (!region) return;
      if (apply({ type: 'REMOVE', id })) {
        history?.record([region.pageId]);
        setAnnouncement('Pending redaction removed.');
      }
      setSelection((current) => (current === id ? null : current));
      setError(null);
    },
    [apply, history],
  );
  const visibleSelection = state.present.some(
    (region) =>
      region.id === selectionId &&
      pages.some((page) => page.id === region.pageId),
  )
    ? selectionId
    : null;
  const removeSelected = useCallback(() => {
    if (visibleSelection) remove(visibleSelection);
  }, [remove, visibleSelection]);
  const registerPageBounds = useCallback(
    (pageId: WorkspacePageId, bounds: RedactionBox) => {
      if (!pageIdsRef.current.has(pageId)) return;
      const existing = boundsRef.current.get(pageId);
      if (
        existing?.x === bounds.x &&
        existing.y === bounds.y &&
        existing.width === bounds.width &&
        existing.height === bounds.height
      )
        return;
      boundsRef.current.set(pageId, bounds);
      boundsChanged();
    },
    [],
  );
  const getPageBounds = useCallback(
    (pageId: WorkspacePageId) => boundsRef.current.get(pageId),
    [],
  );
  const indexed = useMemo(() => {
    const byPage = new Map<WorkspacePageId, RedactionRegion[]>();
    for (const region of state.present) {
      const regions = byPage.get(region.pageId) ?? [];
      regions.push(region);
      byPage.set(region.pageId, regions);
    }
    return byPage;
  }, [state.present]);
  const getRegionsForPage = useCallback(
    (pageId: WorkspacePageId) => indexed.get(pageId) ?? EMPTY_REGIONS,
    [indexed],
  );
  const reset = useCallback(() => {
    apply({ type: 'RESET' });
    boundsRef.current.clear();
    setSelection(null);
    setError(null);
    setAnnouncement(null);
    setActive(false);
  }, [apply]);
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
    active,
    setActive,
    selectionId: visibleSelection,
    select: setSelection,
    hasUnsavedWork: state.present.length > 0,
    error,
    announcement,
    add,
    replace,
    remove,
    removeSelected,
    getRegionsForPage,
    registerPageBounds,
    getPageBounds,
    reset,
    historyParticipant,
  };
}
