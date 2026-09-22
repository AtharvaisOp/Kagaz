import { describe, expect, it } from 'vitest';

import {
  ACTIVE_FORM_DRAFT_EXPORT_BLOCK_MESSAGE,
  BUTTON_EXPORT_BLOCK_MESSAGE,
  PASSWORD_EXPORT_BLOCK_MESSAGE,
  SIGNATURE_EXPORT_BLOCK_MESSAGE,
  UNSUPPORTED_FIELD_EXPORT_BLOCK_MESSAGE,
  XFA_EXPORT_BLOCK_MESSAGE,
  getFormExportCapability,
  getFormExportBlockReason,
} from './exportSafety';
import type {
  FormFieldDefinition,
  FormFieldKind,
  FormSourceDefinition,
} from './types';
import type { WorkspacePage } from '../../pdf-workspace/model/types';

const page = (
  sourceDocumentId: string,
  sourcePageIndex = 0,
): WorkspacePage => ({
  id: `${sourceDocumentId}-page-${sourcePageIndex}`,
  sourceDocumentId,
  sourcePageIndex,
  rotationDelta: 0,
});

const source = (
  sourceDocumentId: string,
  status: FormSourceDefinition['status'],
  fields: readonly FormFieldDefinition[] = [],
): FormSourceDefinition => ({
  sourceDocumentId,
  status,
  fields,
  widgets: [],
  error: null,
});

const field = (kind: FormFieldKind): FormFieldDefinition => ({
  id: `field-${kind}`,
  sourceDocumentId: 'form',
  name: kind,
  fieldType: null,
  kind,
  initialValue: { kind: 'none', current: null, defaultValue: null },
  readOnly: false,
  required: false,
  alternativeText: null,
  options: [],
  multiSelect: false,
  maxLength: null,
  widgetIds: [],
  metadataWarnings: [],
});

describe('form export safety', () => {
  it('allows pages from a completed no-form source', () => {
    const sources = new Map([['plain', source('plain', 'none')]]);
    expect(getFormExportBlockReason([page('plain')], sources)).toBeNull();
  });

  it('allows supported AcroForms and blocks XFA with an explicit reason', () => {
    expect(
      getFormExportBlockReason(
        [page('acro')],
        new Map([['acro', source('acro', 'acroform', [field('text')])]]),
      ),
    ).toBeNull();
    expect(
      getFormExportBlockReason(
        [page('xfa')],
        new Map([['xfa', source('xfa', 'unsupported-xfa')]]),
      ),
    ).toBe(XFA_EXPORT_BLOCK_MESSAGE);
  });

  it.each([
    ['signature', 'unsupported-signature', SIGNATURE_EXPORT_BLOCK_MESSAGE],
    ['password', 'unsupported-password', PASSWORD_EXPORT_BLOCK_MESSAGE],
    ['button', 'unsupported-button', BUTTON_EXPORT_BLOCK_MESSAGE],
    [
      'unsupported',
      'unsupported-field',
      UNSUPPORTED_FIELD_EXPORT_BLOCK_MESSAGE,
    ],
  ] as const)('blocks unsafe %s fields', (kind, capability, message) => {
    const definition = source('form', 'acroform', [field(kind)]);
    expect(getFormExportCapability(definition)).toBe(capability);
    expect(
      getFormExportBlockReason([page('form')], new Map([['form', definition]])),
    ).toBe(message);
  });

  it('allows plain-only Extract from a mixed workspace and safe form pages', () => {
    const sources = new Map([
      ['plain', source('plain', 'none')],
      ['form', source('form', 'acroform', [field('checkbox')])],
    ]);
    expect(getFormExportBlockReason([page('plain')], sources)).toBeNull();
    expect(getFormExportBlockReason([page('form')], sources)).toBeNull();
  });

  it('blocks a changed active draft before discovery checks', () => {
    expect(
      getFormExportBlockReason(
        [page('plain')],
        new Map([['plain', source('plain', 'none')]]),
        true,
      ),
    ).toBe(ACTIVE_FORM_DRAFT_EXPORT_BLOCK_MESSAGE);
  });
});
