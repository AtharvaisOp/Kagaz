import type { WorkspacePage } from '../../pdf-workspace/model/types';

import type { FormSourceDefinition } from './types';

export const ACROFORM_EXPORT_BLOCK_MESSAGE =
  'This PDF contains form fields. Form-safe Download and Extract are still being added.';
export const XFA_EXPORT_BLOCK_MESSAGE =
  'This PDF uses XFA forms, which Kagaz cannot support yet.';
export const FORM_DISCOVERY_EXPORT_BLOCK_MESSAGE =
  'Kagaz is still checking this PDF for form fields. Try again in a moment.';

export function getFormExportBlockReason(
  pages: readonly WorkspacePage[],
  sources: ReadonlyMap<string, FormSourceDefinition>,
): string | null {
  for (const page of pages) {
    const source = sources.get(page.sourceDocumentId);
    if (
      !source ||
      source.status === 'idle' ||
      source.status === 'discovering'
    ) {
      return FORM_DISCOVERY_EXPORT_BLOCK_MESSAGE;
    }
    if (source.status === 'unsupported-xfa') return XFA_EXPORT_BLOCK_MESSAGE;
    if (source.status === 'acroform') return ACROFORM_EXPORT_BLOCK_MESSAGE;
    if (source.status === 'error') {
      return source.error ?? FORM_DISCOVERY_EXPORT_BLOCK_MESSAGE;
    }
  }
  return null;
}
