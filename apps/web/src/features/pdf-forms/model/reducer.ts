import {
  commitFormValue,
  initializeFormSource,
  pruneFormFields,
  redoFormEdit,
  resetFormHistory,
  undoFormEdit,
} from './history';
import type { FormFieldId, FormHistoryState, FormValue } from './types';

export type FormAction =
  | {
      readonly type: 'INITIALIZE_SOURCE';
      readonly initialValues: Readonly<Record<FormFieldId, FormValue>>;
    }
  | {
      readonly type: 'COMMIT_FIELD_VALUE';
      readonly fieldId: FormFieldId;
      readonly value: FormValue;
    }
  | { readonly type: 'UNDO' }
  | { readonly type: 'REDO' }
  | { readonly type: 'PRUNE_FIELDS'; readonly fieldIds: readonly FormFieldId[] }
  | { readonly type: 'RESET_FORMS' }
  | { readonly type: 'DISCARD_FUTURE' };

export function formReducer(
  state: FormHistoryState,
  action: FormAction,
): FormHistoryState {
  switch (action.type) {
    case 'INITIALIZE_SOURCE':
      return initializeFormSource(state, action.initialValues);
    case 'COMMIT_FIELD_VALUE':
      return commitFormValue(state, action.fieldId, action.value);
    case 'UNDO':
      return undoFormEdit(state);
    case 'REDO':
      return redoFormEdit(state);
    case 'PRUNE_FIELDS':
      return pruneFormFields(state, action.fieldIds);
    case 'RESET_FORMS':
      return resetFormHistory();
    case 'DISCARD_FUTURE':
      return state.future.length === 0 ? state : { ...state, future: [] };
  }
}

export const formHistoryReducer = formReducer;
