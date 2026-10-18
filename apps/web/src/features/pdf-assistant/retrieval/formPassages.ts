import type { PdfFormsController } from '../../pdf-forms/hooks/usePdfForms';
import type {
  FormChoiceOption,
  FormFieldDefinition,
  FormValue,
} from '../../pdf-forms/model/types';
import type { WorkspacePage } from '../../pdf-workspace/model/types';
import { RETRIEVAL_LIMITS, sourcePageKey } from './index';

export interface CommittedFormPassage {
  readonly id: string;
  readonly pageId: string;
  readonly sourcePageKey: string;
  readonly fieldId: string;
  readonly fieldLabel: string;
  readonly text: string;
}

const MAX_FORM_FIELD_LABEL_CHARACTERS = 120;

function displayOptionValue(
  value: string,
  options: readonly FormChoiceOption[],
): string {
  return (
    options.find((option) => option.exportValue === value)?.displayValue ??
    value
  );
}

function valueText(
  field: FormFieldDefinition | undefined,
  value: FormValue | undefined,
): string | null {
  if (
    !field ||
    !['text', 'multiline-text', 'radio', 'dropdown', 'option-list'].includes(
      field.kind,
    )
  ) {
    return null;
  }
  if (typeof value === 'string') {
    return field.kind === 'text' || field.kind === 'multiline-text'
      ? value
      : displayOptionValue(value, field.options);
  }
  if (
    field.kind === 'option-list' &&
    Array.isArray(value) &&
    value.every((entry): entry is string => typeof entry === 'string')
  ) {
    return value
      .map((entry) => displayOptionValue(entry, field.options))
      .join(', ');
  }
  return null;
}

/** Build local passages only from committed, supported AcroForm values. */
export function collectCommittedFormPassages(
  pages: readonly WorkspacePage[],
  forms: PdfFormsController,
  blockedSourcePages: ReadonlySet<string>,
): readonly CommittedFormPassage[] {
  const passages: CommittedFormPassage[] = [];
  for (const page of pages) {
    const pageKey = sourcePageKey(page);
    if (blockedSourcePages.has(pageKey)) continue;
    const seenFieldIds = new Set<string>();
    for (const widget of forms.getWidgetsForWorkspacePage(page)) {
      if (seenFieldIds.has(widget.fieldId)) continue;
      seenFieldIds.add(widget.fieldId);
      const field = forms.getField(widget.fieldId);
      const rawValue = valueText(field, forms.getValue(widget.fieldId));
      if (!field || rawValue === null) continue;
      const value = rawValue.replaceAll('\u0000', '').trim();
      if (!value) continue;
      const fieldLabel = (field.name.trim() || 'Unnamed field').slice(
        0,
        MAX_FORM_FIELD_LABEL_CHARACTERS,
      );
      passages.push({
        id: JSON.stringify(['form-value', page.id, field.id]),
        pageId: page.id,
        sourcePageKey: pageKey,
        fieldId: field.id,
        fieldLabel,
        text: `Field: ${fieldLabel}\n${value.slice(0, RETRIEVAL_LIMITS.maxCommittedFormValueCharacters)}`,
      });
    }
  }
  return passages;
}
