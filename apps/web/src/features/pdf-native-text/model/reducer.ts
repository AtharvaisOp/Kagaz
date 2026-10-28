import type {
  NativeTextEdit,
  NativeTextEditHistoryState,
} from '../../../lib/pdf-native-text/types';

const MAX_HISTORY = 100;

export type NativeTextEditAction =
  | { readonly type: 'COMMIT'; readonly edit: NativeTextEdit }
  | { readonly type: 'REMOVE'; readonly id: string }
  | { readonly type: 'PRUNE'; readonly pageIds: readonly string[] }
  | { readonly type: 'UNDO' | 'REDO' | 'DISCARD_FUTURE' | 'RESET' };

export function createNativeTextEditHistory(): NativeTextEditHistoryState {
  return { past: [], present: [], future: [] };
}

function cloneIdentity(edit: NativeTextEdit): NativeTextEdit {
  const textMatrix: NativeTextEdit['identity']['textMatrix'] = [
    ...edit.identity.textMatrix,
  ];
  return Object.freeze({
    ...edit,
    identity: Object.freeze({
      ...edit.identity,
      textMatrix: Object.freeze(textMatrix),
    }),
  });
}

function cloneSnapshot(
  edits: readonly NativeTextEdit[],
): readonly NativeTextEdit[] {
  return Object.freeze(edits.map(cloneIdentity));
}

function sameEdit(left: NativeTextEdit, right: NativeTextEdit): boolean {
  return (
    left.id === right.id &&
    left.workspacePageId === right.workspacePageId &&
    left.sourceDocumentId === right.sourceDocumentId &&
    left.sourcePageIndex === right.sourcePageIndex &&
    left.replacementText === right.replacementText &&
    left.translationX === right.translationX &&
    left.translationY === right.translationY &&
    left.identity.sourceFileFingerprint ===
      right.identity.sourceFileFingerprint &&
    left.identity.streamFingerprint === right.identity.streamFingerprint &&
    left.identity.runOrdinal === right.identity.runOrdinal &&
    left.identity.originalText === right.identity.originalText &&
    left.identity.fontResourceName === right.identity.fontResourceName &&
    left.identity.fontBaseName === right.identity.fontBaseName &&
    left.identity.fontSize === right.identity.fontSize &&
    left.identity.textMatrix.every(
      (value, index) => value === right.identity.textMatrix[index],
    )
  );
}

function sameSnapshot(
  left: readonly NativeTextEdit[],
  right: readonly NativeTextEdit[],
): boolean {
  return (
    left.length === right.length &&
    left.every((edit, index) => {
      const candidate = right[index];
      return candidate ? sameEdit(edit, candidate) : false;
    })
  );
}

function targetsSame(left: NativeTextEdit, right: NativeTextEdit): boolean {
  return (
    left.workspacePageId === right.workspacePageId &&
    left.sourceDocumentId === right.sourceDocumentId &&
    left.sourcePageIndex === right.sourcePageIndex &&
    left.identity.sourceFileFingerprint ===
      right.identity.sourceFileFingerprint &&
    left.identity.streamFingerprint === right.identity.streamFingerprint &&
    left.identity.runOrdinal === right.identity.runOrdinal
  );
}

function commit(
  state: NativeTextEditHistoryState,
  next: readonly NativeTextEdit[],
): NativeTextEditHistoryState {
  const present = cloneSnapshot(next);
  if (sameSnapshot(present, state.present)) return state;
  return {
    past: [...state.past, state.present].slice(-MAX_HISTORY),
    present,
    future: [],
  };
}

function validEdit(edit: NativeTextEdit): boolean {
  return (
    Boolean(edit.id) &&
    Boolean(edit.workspacePageId) &&
    Boolean(edit.sourceDocumentId) &&
    Number.isInteger(edit.sourcePageIndex) &&
    edit.sourcePageIndex >= 0 &&
    Boolean(edit.identity.sourceFileFingerprint) &&
    Boolean(edit.identity.streamFingerprint) &&
    Boolean(edit.identity.originalText) &&
    Number.isInteger(edit.identity.runOrdinal) &&
    edit.identity.runOrdinal >= 0 &&
    Number.isFinite(edit.translationX) &&
    Number.isFinite(edit.translationY)
  );
}

function normalizeSnapshots(
  snapshots: readonly (readonly NativeTextEdit[])[],
): readonly (readonly NativeTextEdit[])[] {
  return snapshots.filter(
    (snapshot, index) =>
      index === 0 || !sameSnapshot(snapshot, snapshots[index - 1] ?? []),
  );
}

export function nativeTextEditReducer(
  state: NativeTextEditHistoryState,
  action: NativeTextEditAction,
): NativeTextEditHistoryState {
  switch (action.type) {
    case 'COMMIT': {
      if (!validEdit(action.edit)) return state;
      const matching = state.present.findIndex((edit) =>
        targetsSame(edit, action.edit),
      );
      const next =
        matching < 0
          ? [...state.present, action.edit]
          : state.present.map((edit, index) =>
              index === matching ? action.edit : edit,
            );
      return commit(state, next);
    }
    case 'REMOVE':
      return commit(
        state,
        state.present.filter((edit) => edit.id !== action.id),
      );
    case 'UNDO': {
      const previous = state.past.at(-1);
      return previous
        ? {
            past: state.past.slice(0, -1),
            present: previous,
            future: [state.present, ...state.future],
          }
        : state;
    }
    case 'REDO': {
      const next = state.future[0];
      return next
        ? {
            past: [...state.past, state.present],
            present: next,
            future: state.future.slice(1),
          }
        : state;
    }
    case 'DISCARD_FUTURE':
      return state.future.length ? { ...state, future: [] } : state;
    case 'PRUNE': {
      const removed = new Set(action.pageIds);
      if (!removed.size) return state;
      const prune = (snapshot: readonly NativeTextEdit[]) =>
        cloneSnapshot(
          snapshot.filter((edit) => !removed.has(edit.workspacePageId)),
        );
      const present = prune(state.present);
      const past = normalizeSnapshots(state.past.map(prune));
      const future = normalizeSnapshots(state.future.map(prune));
      return {
        present,
        past:
          past.length && sameSnapshot(past.at(-1) ?? [], present)
            ? past.slice(0, -1)
            : past,
        future:
          future.length && sameSnapshot(future[0] ?? [], present)
            ? future.slice(1)
            : future,
      };
    }
    case 'RESET':
      return createNativeTextEditHistory();
  }
}

export function snapshotNativeTextEdits(
  state: NativeTextEditHistoryState,
  pageIds: ReadonlySet<string>,
): readonly NativeTextEdit[] {
  return cloneSnapshot(
    state.present.filter((edit) => pageIds.has(edit.workspacePageId)),
  );
}
