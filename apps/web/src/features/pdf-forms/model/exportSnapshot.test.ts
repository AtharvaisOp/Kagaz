import { describe, expect, it } from 'vitest';

import { snapshotFormsForPages } from './exportSnapshot';
import { createFormHistoryState } from './history';
import type {
  FormFieldDefinition,
  FormHistoryState,
  FormSourceDefinition,
} from './types';

const page = {
  id: 'workspace-page',
  sourceDocumentId: 'source-a',
  sourcePageIndex: 0,
  rotationDelta: 0,
} as const;

function textField(): FormFieldDefinition {
  return {
    id: 'opaque-field-identity-that-does-not-contain-the-name',
    sourceDocumentId: 'source-a',
    name: 'profile.name',
    fieldType: 'Tx',
    kind: 'text',
    initialValue: { kind: 'text', current: 'Original', defaultValue: null },
    readOnly: false,
    required: false,
    alternativeText: null,
    options: [],
    multiSelect: false,
    maxLength: null,
    widgetIds: ['widget-a'],
    metadataWarnings: [],
  };
}

function sourceWith(
  fields: readonly FormFieldDefinition[],
): FormSourceDefinition {
  return {
    sourceDocumentId: 'source-a',
    status: 'acroform',
    hasDigitalSignature: false,
    fields,
    widgets: [],
    error: null,
  };
}

describe('form export snapshots', () => {
  it('copies committed values and direct field names once per source', () => {
    const field = textField();
    const state: FormHistoryState = {
      ...createFormHistoryState(),
      present: { byField: { [field.id]: 'ALPHA' } },
      baseline: { byField: { [field.id]: 'Original' } },
      dirty: true,
    };
    const snapshot = snapshotFormsForPages(
      [page, { ...page, id: 'duplicate-page' }],
      new Map([['source-a', sourceWith([field])]]),
      state,
      null,
    );

    expect(snapshot.sources).toHaveLength(1);
    expect(snapshot.sources[0]?.fields).toEqual([
      expect.objectContaining({
        name: 'profile.name',
        value: 'ALPHA',
        changed: true,
      }),
    ]);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.sources)).toBe(true);
    expect(Object.isFrozen(snapshot.sources[0]?.fields)).toBe(true);
  });

  it('copies array values and option metadata without sharing references', () => {
    const field: FormFieldDefinition = {
      ...textField(),
      id: 'choice-id',
      name: 'profile.skills',
      fieldType: 'Ch',
      kind: 'option-list',
      initialValue: {
        kind: 'choice',
        current: ['TypeScript'],
        defaultValue: [],
      },
      options: [
        { exportValue: 'ts', displayValue: 'TypeScript' },
        { exportValue: 'react', displayValue: 'React' },
      ],
      multiSelect: true,
    };
    const current = ['ts', 'react'];
    const state: FormHistoryState = {
      ...createFormHistoryState(),
      present: { byField: { [field.id]: current } },
      baseline: { byField: { [field.id]: ['ts'] } },
      dirty: true,
    };
    const snapshot = snapshotFormsForPages(
      [page],
      new Map([['source-a', sourceWith([field])]]),
      state,
      null,
    );
    const result = snapshot.sources[0]?.fields[0];

    expect(result?.value).toEqual(current);
    expect(result?.value).not.toBe(current);
    expect(result?.options).toEqual(field.options);
    expect(result?.options).not.toBe(field.options);
  });

  it('omits unsafe field values and records a changed active draft', () => {
    const password: FormFieldDefinition = {
      ...textField(),
      kind: 'password',
      name: 'secret',
    };
    const snapshot = snapshotFormsForPages(
      [page],
      new Map([['source-a', sourceWith([password])]]),
      {
        ...createFormHistoryState(),
        present: { byField: { [password.id]: 'do-not-copy' } },
      },
      { draft: 'changed', initial: 'original' },
    );

    expect(snapshot.sources[0]).toMatchObject({
      capability: 'unsupported-password',
      fields: [],
    });
    expect(snapshot.hasChangedTextDraft).toBe(true);
  });
});
