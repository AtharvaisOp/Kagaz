import { describe, expect, it } from 'vitest';

import {
  ACROFORM_EXPORT_BLOCK_MESSAGE,
  XFA_EXPORT_BLOCK_MESSAGE,
  getFormExportBlockReason,
} from './exportSafety';
import type { FormSourceDefinition } from './types';
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
): FormSourceDefinition => ({
  sourceDocumentId,
  status,
  fields: [],
  widgets: [],
  error: null,
});

describe('form export safety', () => {
  it('allows pages from a completed no-form source', () => {
    const sources = new Map([['plain', source('plain', 'none')]]);
    expect(getFormExportBlockReason([page('plain')], sources)).toBeNull();
  });

  it('blocks AcroForm and XFA pages with explicit reasons', () => {
    expect(
      getFormExportBlockReason(
        [page('acro')],
        new Map([['acro', source('acro', 'acroform')]]),
      ),
    ).toBe(ACROFORM_EXPORT_BLOCK_MESSAGE);
    expect(
      getFormExportBlockReason(
        [page('xfa')],
        new Map([['xfa', source('xfa', 'unsupported-xfa')]]),
      ),
    ).toBe(XFA_EXPORT_BLOCK_MESSAGE);
  });

  it('allows a plain-page Extract from a mixed workspace but blocks a form page', () => {
    const sources = new Map([
      ['plain', source('plain', 'none')],
      ['form', source('form', 'acroform')],
    ]);
    expect(getFormExportBlockReason([page('plain')], sources)).toBeNull();
    expect(getFormExportBlockReason([page('form')], sources)).toBe(
      ACROFORM_EXPORT_BLOCK_MESSAGE,
    );
  });
});
