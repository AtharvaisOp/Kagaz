import { describe, expect, it } from 'vitest';

import type { PdfFormsController } from '../../pdf-forms/hooks/usePdfForms';
import type {
  FormFieldDefinition,
  FormValue,
  FormWidgetDefinition,
} from '../../pdf-forms/model/types';
import type { WorkspacePage } from '../../pdf-workspace/model/types';
import { sourcePageKey } from './index';
import { collectCommittedFormPassages } from './formPassages';

function page(id: string): WorkspacePage {
  return {
    id,
    sourceDocumentId: 'source-1',
    sourcePageIndex: 0,
    rotationDelta: 0,
  };
}

function field(
  id: string,
  name: string,
  kind: FormFieldDefinition['kind'],
  options: FormFieldDefinition['options'] = [],
): FormFieldDefinition {
  return {
    id,
    sourceDocumentId: 'source-1',
    name,
    fieldType: null,
    kind,
    initialValue: { kind: 'none', current: null, defaultValue: null },
    readOnly: false,
    required: false,
    alternativeText: null,
    options,
    multiSelect: false,
    maxLength: null,
    widgetIds: [`widget-${id}`],
    metadataWarnings: [],
  };
}

function controller(
  pageWidgets: ReadonlyMap<string, readonly string[]>,
  fields: ReadonlyMap<string, FormFieldDefinition>,
  values: ReadonlyMap<string, FormValue>,
): PdfFormsController {
  return {
    getWidgetsForWorkspacePage: (workspacePage: WorkspacePage) =>
      (pageWidgets.get(workspacePage.id) ?? []).map(
        (fieldId) => ({ fieldId }) as FormWidgetDefinition,
      ),
    getField: (fieldId: string) => fields.get(fieldId),
    getValue: (fieldId: string) => values.get(fieldId),
    // Deliberately provide a draft that is absent from committed values.
    // Retrieval must only call getValue and never read this session.
    textEditSession: {
      sessionId: 'draft-session',
      fieldId: 'contact',
      draft: 'FORM-DRAFT-SECRET',
      initial: 'FORM-COMMITTED-ALPHA',
    },
  } as unknown as PdfFormsController;
}

describe('committed form retrieval passages', () => {
  it('indexes only committed supported values and deduplicates repeated widgets', () => {
    const first = page('page-1');
    const duplicateOccurrence = page('page-2');
    const formController = controller(
      new Map([
        ['page-1', ['contact', 'contact', 'secret', 'choice']],
        ['page-2', ['contact']],
      ]),
      new Map([
        ['contact', field('contact', 'Contract Contact', 'text')],
        ['secret', field('secret', 'Private Password', 'password')],
        [
          'choice',
          field('choice', 'Delivery Region', 'dropdown', [
            { exportValue: 'eu', displayValue: 'Europe' },
          ]),
        ],
      ]),
      new Map([
        ['contact', 'FORM-COMMITTED-ALPHA'],
        ['secret', 'PASSWORD-DO-NOT-INDEX'],
        ['choice', 'eu'],
      ]),
    );

    const passages = collectCommittedFormPassages(
      [first, duplicateOccurrence],
      formController,
      new Set(),
    );

    expect(passages).toHaveLength(3);
    expect(passages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          pageId: 'page-1',
          fieldLabel: 'Contract Contact',
          text: 'Field: Contract Contact\nFORM-COMMITTED-ALPHA',
        }),
        expect.objectContaining({
          pageId: 'page-1',
          fieldLabel: 'Delivery Region',
          text: 'Field: Delivery Region\nEurope',
        }),
        expect.objectContaining({
          pageId: 'page-2',
          fieldLabel: 'Contract Contact',
        }),
      ]),
    );
    expect(JSON.stringify(passages)).not.toContain('FORM-DRAFT-SECRET');
    expect(JSON.stringify(passages)).not.toContain('PASSWORD-DO-NOT-INDEX');
    expect(passages[0]?.sourcePageKey).toBe(sourcePageKey(first));
  });

  it('does not return values from a page blocked by a pending redaction', () => {
    const redactedPage = page('redacted');
    const formController = controller(
      new Map([['redacted', ['contact']]]),
      new Map([['contact', field('contact', 'Contact', 'text')]]),
      new Map([['contact', 'KAGAZ-SECRET-FORM-VALUE']]),
    );

    expect(
      collectCommittedFormPassages(
        [redactedPage],
        formController,
        new Set([sourcePageKey(redactedPage)]),
      ),
    ).toEqual([]);
  });

  it('strips NUL characters and respects the bounded value length', () => {
    const target = page('bounded');
    const longValue = `A\u0000${'x'.repeat(2_100)}`;
    const formController = controller(
      new Map([['bounded', ['contact']]]),
      new Map([['contact', field('contact', 'Contact', 'text')]]),
      new Map([['contact', longValue]]),
    );
    const passage = collectCommittedFormPassages(
      [target],
      formController,
      new Set(),
    )[0];

    expect(passage?.text).not.toContain('\u0000');
    expect(passage?.text.length).toBe('Field: Contact\n'.length + 2_000);
  });
});
