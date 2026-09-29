import type { PdfOrientedBox } from '../../pdf-annotations/model/types';
import type {
  SourceDocumentId,
  WorkspacePage,
} from '../../pdf-workspace/model/types';

export type FormFieldId = string;
export type FormWidgetId = string;

export type FormValue = string | boolean | readonly string[] | null;

export interface FormValueDocument {
  readonly byField: Partial<Record<FormFieldId, FormValue>>;
}

export interface FormHistoryState {
  readonly past: readonly FormValueDocument[];
  readonly present: FormValueDocument;
  readonly future: readonly FormValueDocument[];
  readonly baseline: FormValueDocument;
  readonly dirty: boolean;
}

export type FormFieldKind =
  | 'text'
  | 'multiline-text'
  | 'password'
  | 'checkbox'
  | 'radio'
  | 'dropdown'
  | 'option-list'
  | 'button'
  | 'signature'
  | 'unsupported';

export type FormDiscoveryStatus =
  'idle' | 'discovering' | 'none' | 'acroform' | 'unsupported-xfa' | 'error';

export interface FormChoiceOption {
  readonly exportValue: string;
  readonly displayValue: string;
}

export type FormFieldInitialValue =
  | {
      readonly kind: 'text';
      readonly current: string;
      readonly defaultValue: string | null;
    }
  | {
      readonly kind: 'checkbox';
      readonly current: boolean;
      readonly defaultValue: boolean | null;
    }
  | {
      readonly kind: 'radio';
      readonly current: string | null;
      readonly defaultValue: string | null;
    }
  | {
      readonly kind: 'choice';
      readonly current: readonly string[];
      readonly defaultValue: readonly string[];
    }
  | {
      readonly kind: 'none';
      readonly current: null;
      readonly defaultValue: null;
    };

export interface FormFieldDefinition {
  readonly id: FormFieldId;
  readonly sourceDocumentId: SourceDocumentId;
  readonly name: string;
  readonly fieldType: string | null;
  readonly kind: FormFieldKind;
  readonly initialValue: FormFieldInitialValue;
  readonly readOnly: boolean;
  readonly required: boolean;
  readonly alternativeText: string | null;
  readonly options: readonly FormChoiceOption[];
  readonly multiSelect: boolean;
  readonly maxLength: number | null;
  readonly widgetIds: readonly FormWidgetId[];
  readonly metadataWarnings: readonly string[];
}

export type FormRawRect = readonly [
  left: number,
  bottom: number,
  right: number,
  top: number,
];

export interface FormWidgetDefinition {
  readonly id: FormWidgetId;
  readonly fieldId: FormFieldId;
  readonly sourceDocumentId: SourceDocumentId;
  readonly sourcePageIndex: number;
  readonly pdfAnnotationId: string;
  readonly rawRect: FormRawRect;
  readonly geometry: PdfOrientedBox;
  readonly rotation: 0 | 90 | 180 | 270;
  readonly widgetValue: string | null;
  readonly alternativeText: string | null;
}

export interface FormSourceDefinition {
  readonly sourceDocumentId: SourceDocumentId;
  readonly status: FormDiscoveryStatus;
  /** PDF.js found a signed byte-range structure; no certificate validation. */
  readonly hasDigitalSignature: boolean;
  readonly fields: readonly FormFieldDefinition[];
  readonly widgets: readonly FormWidgetDefinition[];
  readonly error: string | null;
}

export interface FormWidgetProjection {
  readonly page: WorkspacePage;
  readonly widget: FormWidgetDefinition;
  readonly field: FormFieldDefinition;
}
