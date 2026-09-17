import {
  createEmptyAnnotationDocument,
  documentsHaveSameContent,
} from './operations';

import type { AnnotationDocument, AnnotationHistoryState } from './types';

export const MAX_ANNOTATION_HISTORY = 100;

export function createAnnotationHistoryState(
  initial: AnnotationDocument = createEmptyAnnotationDocument(),
): AnnotationHistoryState {
  return {
    past: [],
    present: initial,
    future: [],
    baseline: initial,
    dirty: false,
  };
}

export const createInitialAnnotationHistoryState = createAnnotationHistoryState;

export function commitAnnotationEdit(
  state: AnnotationHistoryState,
  next: AnnotationDocument,
): AnnotationHistoryState {
  if (next === state.present || documentsHaveSameContent(next, state.present)) {
    return state;
  }

  const past = [...state.past, state.present];
  return {
    ...state,
    past:
      past.length > MAX_ANNOTATION_HISTORY
        ? past.slice(past.length - MAX_ANNOTATION_HISTORY)
        : past,
    present: next,
    future: [],
    dirty: !documentsHaveSameContent(next, state.baseline),
  };
}

export function undoAnnotationEdit(
  state: AnnotationHistoryState,
): AnnotationHistoryState {
  const previous = state.past[state.past.length - 1];
  if (!previous) {
    return state;
  }

  return {
    ...state,
    past: state.past.slice(0, -1),
    present: previous,
    future: [state.present, ...state.future],
    dirty: !documentsHaveSameContent(previous, state.baseline),
  };
}

export function redoAnnotationEdit(
  state: AnnotationHistoryState,
): AnnotationHistoryState {
  const next = state.future[0];
  if (!next) {
    return state;
  }

  return {
    ...state,
    past: [...state.past, state.present],
    present: next,
    future: state.future.slice(1),
    dirty: !documentsHaveSameContent(next, state.baseline),
  };
}

export function resetAnnotationHistory(
  document: AnnotationDocument = createEmptyAnnotationDocument(),
): AnnotationHistoryState {
  return createAnnotationHistoryState(document);
}

export function discardAnnotationFuture(
  state: AnnotationHistoryState,
): AnnotationHistoryState {
  return state.future.length === 0 ? state : { ...state, future: [] };
}
