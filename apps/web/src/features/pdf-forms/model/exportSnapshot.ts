import type { WorkspacePage } from '../../pdf-workspace/model/types';
import type {
  FormExportFieldSnapshot,
  FormExportSnapshot,
  FormExportSourceSnapshot,
} from '../../../lib/pdf-export/forms/types';

import { getFormExportCapability, isFormExportFieldKind } from './exportSafety';
import {
  cloneFormValue,
  formValuesEqual,
  initialFormValue,
} from './formValues';
import type { FormHistoryState, FormSourceDefinition } from './types';

interface FormTextDraftSnapshot {
  readonly draft: string;
  readonly initial: string;
}

function snapshotField(
  field: FormSourceDefinition['fields'][number],
  state: FormHistoryState,
): FormExportFieldSnapshot | null {
  if (!isFormExportFieldKind(field.kind)) return null;
  const initial = initialFormValue(field);
  const current = state.present.byField[field.id] ?? initial;
  return Object.freeze({
    name: field.name,
    kind: field.kind,
    value: cloneFormValue(current),
    changed: !formValuesEqual(current, initial),
    readOnly: field.readOnly,
    options: Object.freeze(
      field.options.map((option) => Object.freeze({ ...option })),
    ),
    multiSelect: field.multiSelect,
  });
}

export function snapshotFormsForPages(
  pages: readonly WorkspacePage[],
  sources: ReadonlyMap<string, FormSourceDefinition>,
  state: FormHistoryState,
  textEditSession: FormTextDraftSnapshot | null,
): FormExportSnapshot {
  const sourceSnapshots: FormExportSourceSnapshot[] = [];
  const visited = new Set<string>();

  for (const page of pages) {
    if (visited.has(page.sourceDocumentId)) continue;
    visited.add(page.sourceDocumentId);
    const source = sources.get(page.sourceDocumentId);
    const capability = getFormExportCapability(source);
    const fields =
      capability === 'safe-acroform' && source
        ? source.fields
            .map((field) => snapshotField(field, state))
            .filter((field): field is FormExportFieldSnapshot => field !== null)
        : [];
    sourceSnapshots.push(
      Object.freeze({
        sourceDocumentId: page.sourceDocumentId,
        capability,
        fields: Object.freeze(fields),
      }),
    );
  }

  return Object.freeze({
    sources: Object.freeze(sourceSnapshots),
    hasChangedTextDraft:
      textEditSession !== null &&
      textEditSession.draft !== textEditSession.initial,
  });
}
