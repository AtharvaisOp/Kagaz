import type { WorkspacePage } from '../../pdf-workspace/model/types';
import type {
  FormExportCapability,
  FormExportFieldKind,
} from '../../../lib/pdf-export/forms/types';

import type { FormSourceDefinition } from './types';

export const XFA_EXPORT_BLOCK_MESSAGE =
  'This PDF uses XFA forms, which Kagaz cannot support yet.';
export const FORM_DISCOVERY_EXPORT_BLOCK_MESSAGE =
  'Kagaz is still checking this PDF for form fields. Try again in a moment.';
export const SIGNED_PDF_EXPORT_BLOCK_MESSAGE =
  'This PDF already contains a digital signature. Kagaz does not modify digitally signed PDFs because changes can invalidate that signature.';
export const PASSWORD_EXPORT_BLOCK_MESSAGE =
  'This PDF contains a password field, so Kagaz cannot safely flatten it for export yet.';
export const BUTTON_EXPORT_BLOCK_MESSAGE =
  'This PDF contains a push button. Button actions cannot be safely flattened for export.';
export const UNSUPPORTED_FIELD_EXPORT_BLOCK_MESSAGE =
  'This PDF contains a form field that Kagaz cannot safely flatten yet.';
export const ACTIVE_FORM_DRAFT_EXPORT_BLOCK_MESSAGE =
  'Finish or cancel the active form text edit before exporting.';

export function isFormExportFieldKind(
  kind: FormSourceDefinition['fields'][number]['kind'],
): kind is FormExportFieldKind {
  return [
    'text',
    'multiline-text',
    'checkbox',
    'radio',
    'dropdown',
    'option-list',
  ].includes(kind);
}

export function getFormExportCapability(
  source: FormSourceDefinition | undefined,
): FormExportCapability {
  if (!source || source.status === 'idle' || source.status === 'discovering')
    return 'discovering';
  if (source.hasDigitalSignature) return 'unsupported-signed-pdf';
  if (source.status === 'none') return 'plain';
  if (source.status === 'unsupported-xfa') return 'unsupported-xfa';
  if (source.status === 'error') return 'error';

  if (source.fields.some((field) => field.kind === 'password'))
    return 'unsupported-password';
  if (source.fields.some((field) => field.kind === 'button'))
    return 'unsupported-button';
  if (
    source.fields.some(
      (field) =>
        (field.kind !== 'signature' && !isFormExportFieldKind(field.kind)) ||
        field.metadataWarnings.length > 0,
    )
  )
    return 'unsupported-field';
  return 'safe-acroform';
}

export function getFormExportCapabilityMessage(
  capability: FormExportCapability,
  discoveryError: string | null = null,
): string | null {
  switch (capability) {
    case 'plain':
    case 'safe-acroform':
      return null;
    case 'unsupported-xfa':
      return XFA_EXPORT_BLOCK_MESSAGE;
    case 'unsupported-signed-pdf':
      return SIGNED_PDF_EXPORT_BLOCK_MESSAGE;
    case 'unsupported-password':
      return PASSWORD_EXPORT_BLOCK_MESSAGE;
    case 'unsupported-button':
      return BUTTON_EXPORT_BLOCK_MESSAGE;
    case 'unsupported-field':
      return UNSUPPORTED_FIELD_EXPORT_BLOCK_MESSAGE;
    case 'discovering':
      return FORM_DISCOVERY_EXPORT_BLOCK_MESSAGE;
    case 'error':
      return discoveryError ?? FORM_DISCOVERY_EXPORT_BLOCK_MESSAGE;
  }
}

export function getFormExportBlockReason(
  pages: readonly WorkspacePage[],
  sources: ReadonlyMap<string, FormSourceDefinition>,
  hasChangedTextDraft = false,
): string | null {
  if (hasChangedTextDraft) return ACTIVE_FORM_DRAFT_EXPORT_BLOCK_MESSAGE;
  const visited = new Set<string>();
  for (const page of pages) {
    if (visited.has(page.sourceDocumentId)) continue;
    visited.add(page.sourceDocumentId);
    const source = sources.get(page.sourceDocumentId);
    const message = getFormExportCapabilityMessage(
      getFormExportCapability(source),
      source?.error ?? null,
    );
    if (message) return message;
  }
  return null;
}
