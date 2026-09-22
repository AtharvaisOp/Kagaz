import type { SourceDocumentId } from '../../../features/pdf-workspace/model/types';

export type FormExportCapability =
  | 'plain'
  | 'safe-acroform'
  | 'unsupported-xfa'
  | 'unsupported-signature'
  | 'unsupported-password'
  | 'unsupported-button'
  | 'unsupported-field'
  | 'discovering'
  | 'error';

export type FormExportFieldKind =
  'text' | 'multiline-text' | 'checkbox' | 'radio' | 'dropdown' | 'option-list';

export type FormExportValue = string | boolean | readonly string[] | null;

export interface FormExportChoiceOption {
  readonly exportValue: string;
  readonly displayValue: string;
}

export interface FormExportFieldSnapshot {
  readonly name: string;
  readonly kind: FormExportFieldKind;
  readonly value: FormExportValue;
  readonly changed: boolean;
  readonly readOnly: boolean;
  readonly options: readonly FormExportChoiceOption[];
  readonly multiSelect: boolean;
}

export interface FormExportSourceSnapshot {
  readonly sourceDocumentId: SourceDocumentId;
  readonly capability: FormExportCapability;
  readonly fields: readonly FormExportFieldSnapshot[];
}

export interface FormExportSnapshot {
  readonly sources: readonly FormExportSourceSnapshot[];
  readonly hasChangedTextDraft: boolean;
}

export type FormExportErrorCode =
  | 'active-draft'
  | 'unsupported-source'
  | 'missing-source-snapshot'
  | 'missing-field'
  | 'field-type-mismatch'
  | 'invalid-choice'
  | 'invalid-value'
  | 'unsupported-text-font'
  | 'appearance-update-failed'
  | 'form-flatten-failed';

export class FormExportError extends Error {
  readonly code: FormExportErrorCode;
  readonly fileName: string | null;

  constructor(
    code: FormExportErrorCode,
    message: string,
    fileName: string | null = null,
  ) {
    super(message);
    this.name = 'FormExportError';
    this.code = code;
    this.fileName = fileName;
  }
}
