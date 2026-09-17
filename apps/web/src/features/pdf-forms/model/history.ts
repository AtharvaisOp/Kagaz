import { cloneFormValue, formValuesEqual } from './formValues';
import type {
  FormFieldId,
  FormHistoryState,
  FormValue,
  FormValueDocument,
} from './types';

export const MAX_FORM_HISTORY = 100;

export function createEmptyFormValueDocument(): FormValueDocument {
  return { byField: {} };
}

export function createFormHistoryState(): FormHistoryState {
  const empty = createEmptyFormValueDocument();
  return {
    past: [],
    present: empty,
    future: [],
    baseline: empty,
    dirty: false,
  };
}

export function formDocumentsEqual(
  left: FormValueDocument,
  right: FormValueDocument,
): boolean {
  const ids = new Set([
    ...Object.keys(left.byField),
    ...Object.keys(right.byField),
  ]);
  for (const id of ids) {
    if (!formValuesEqual(left.byField[id] ?? null, right.byField[id] ?? null))
      return false;
  }
  return true;
}

function cloneDocument(document: FormValueDocument): FormValueDocument {
  const byField: Partial<Record<FormFieldId, FormValue>> = {};
  for (const [id, value] of Object.entries(document.byField)) {
    if (value !== undefined) byField[id] = cloneFormValue(value);
  }
  return { byField };
}

function dirty(
  present: FormValueDocument,
  baseline: FormValueDocument,
): boolean {
  return !formDocumentsEqual(present, baseline);
}

export function commitFormValue(
  state: FormHistoryState,
  fieldId: FormFieldId,
  value: FormValue,
): FormHistoryState {
  const current = state.present.byField[fieldId] ?? null;
  if (formValuesEqual(current, value)) return state;
  const nextDocument = cloneDocument(state.present);
  nextDocument.byField[fieldId] = cloneFormValue(value);
  const past = [...state.past, state.present];
  return {
    ...state,
    past: past.length > MAX_FORM_HISTORY ? past.slice(-MAX_FORM_HISTORY) : past,
    present: nextDocument,
    future: [],
    dirty: dirty(nextDocument, state.baseline),
  };
}

export function undoFormEdit(state: FormHistoryState): FormHistoryState {
  const previous = state.past[state.past.length - 1];
  if (!previous) return state;
  return {
    ...state,
    past: state.past.slice(0, -1),
    present: previous,
    future: [state.present, ...state.future],
    dirty: dirty(previous, state.baseline),
  };
}

export function redoFormEdit(state: FormHistoryState): FormHistoryState {
  const next = state.future[0];
  if (!next) return state;
  return {
    ...state,
    past: [...state.past, state.present],
    present: next,
    future: state.future.slice(1),
    dirty: dirty(next, state.baseline),
  };
}

export function initializeFormSource(
  state: FormHistoryState,
  initialValues: Readonly<Record<FormFieldId, FormValue>>,
): FormHistoryState {
  const baseline = cloneDocument(state.baseline);
  const present = cloneDocument(state.present);
  let changed = false;
  for (const [fieldId, value] of Object.entries(initialValues)) {
    if (baseline.byField[fieldId] === undefined) {
      baseline.byField[fieldId] = cloneFormValue(value);
      changed = true;
    }
    if (present.byField[fieldId] === undefined) {
      present.byField[fieldId] = cloneFormValue(
        baseline.byField[fieldId] ?? value,
      );
      changed = true;
    }
  }
  if (!changed) return state;
  return { ...state, baseline, present, dirty: dirty(present, baseline) };
}

function pruneDocument(
  document: FormValueDocument,
  active: ReadonlySet<FormFieldId>,
): FormValueDocument {
  const byField: Partial<Record<FormFieldId, FormValue>> = {};
  for (const [id, value] of Object.entries(document.byField)) {
    if (active.has(id) && value !== undefined)
      byField[id] = cloneFormValue(value);
  }
  return { byField };
}

function normalize(
  documents: readonly FormValueDocument[],
): readonly FormValueDocument[] {
  const result: FormValueDocument[] = [];
  for (const document of documents) {
    if (
      !result[0] ||
      !formDocumentsEqual(result[result.length - 1]!, document)
    ) {
      result.push(document);
    }
  }
  return result;
}

function documentListsEqual(
  left: readonly FormValueDocument[],
  right: readonly FormValueDocument[],
): boolean {
  return (
    left.length === right.length &&
    left.every((document, index) => formDocumentsEqual(document, right[index]!))
  );
}

export function pruneFormFields(
  state: FormHistoryState,
  fieldIds: readonly FormFieldId[],
): FormHistoryState {
  const active = new Set(fieldIds);
  const present = pruneDocument(state.present, active);
  const baseline = pruneDocument(state.baseline, active);
  const past = normalize(
    state.past.map((document) => pruneDocument(document, active)),
  );
  const future = normalize(
    state.future.map((document) => pruneDocument(document, active)),
  );
  const meaningfulPast =
    past.length && formDocumentsEqual(past[past.length - 1]!, present)
      ? past.slice(0, -1)
      : past;
  const meaningfulFuture =
    future.length && formDocumentsEqual(future[0]!, present)
      ? future.slice(1)
      : future;
  const next: FormHistoryState = {
    past: meaningfulPast,
    present,
    future: meaningfulFuture,
    baseline,
    dirty: dirty(present, baseline),
  };
  return formDocumentsEqual(next.present, state.present) &&
    formDocumentsEqual(next.baseline, state.baseline) &&
    documentListsEqual(next.past, state.past) &&
    documentListsEqual(next.future, state.future)
    ? state
    : next;
}

export function resetFormHistory(): FormHistoryState {
  return createFormHistoryState();
}
