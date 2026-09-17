import { classifyField } from '../model/fieldClassification';
import {
  createFormFieldId,
  createFormWidgetId,
  normalizeFieldName,
} from '../model/identity';
import type {
  FormChoiceOption,
  FormFieldDefinition,
  FormFieldInitialValue,
  FormFieldKind,
  FormRawRect,
  FormSourceDefinition,
  FormWidgetDefinition,
} from '../model/types';
import {
  formWidgetRectToOrientedBox,
  normalizeRawRect,
} from '../geometry/formWidgetGeometry';
import { detectXfa } from './xfaDetection';

import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';

interface UnknownRecord {
  readonly [key: string]: unknown;
}

interface NormalizedWidget {
  readonly annotation: PdfJsWidgetAnnotation;
  readonly fieldName: string;
  readonly annotationId: string;
  readonly rawRect: FormRawRect;
  readonly kind: FormFieldKind;
}

interface PdfJsWidgetAnnotation extends UnknownRecord {
  readonly subtype?: unknown;
  readonly id?: unknown;
  readonly fieldName?: unknown;
  readonly fieldType?: unknown;
  readonly fieldValue?: unknown;
  readonly defaultFieldValue?: unknown;
  readonly fieldFlags?: unknown;
  readonly readOnly?: unknown;
  readonly required?: unknown;
  readonly alternativeText?: unknown;
  readonly options?: unknown;
  readonly checkBox?: unknown;
  readonly radioButton?: unknown;
  readonly pushButton?: unknown;
  readonly combo?: unknown;
  readonly multiSelect?: unknown;
  readonly multiLine?: unknown;
  readonly password?: unknown;
  readonly maxLen?: unknown;
  readonly rotation?: unknown;
  readonly rect?: unknown;
  readonly exportValue?: unknown;
  readonly buttonValue?: unknown;
}

const EMPTY_FORM_VALUE: FormFieldInitialValue = {
  kind: 'none',
  current: null,
  defaultValue: null,
};

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null;
}

function asWidget(value: unknown): PdfJsWidgetAnnotation | null {
  return isRecord(value) ? value : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function asBoolean(value: unknown): boolean {
  return value === true;
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === 'string');
  }
  return typeof value === 'string' ? [value] : [];
}

function asOptions(value: unknown): FormChoiceOption[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (typeof entry === 'string') {
      return [{ exportValue: entry, displayValue: entry }];
    }
    if (!isRecord(entry)) return [];
    const exportValue = asString(entry.exportValue);
    const displayValue = asString(entry.displayValue);
    return exportValue !== null && displayValue !== null
      ? [{ exportValue, displayValue }]
      : [];
  });
}

function checkboxValue(value: unknown, exportValue: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return null;
  if (typeof exportValue === 'string') return value === exportValue;
  return value !== 'Off';
}

function fieldValueFor(
  annotation: PdfJsWidgetAnnotation,
  kind: FormFieldKind,
  defaultValue: boolean,
): FormFieldInitialValue {
  switch (kind) {
    case 'text':
    case 'multiline-text':
    case 'password':
      return {
        kind: 'text',
        current: asString(annotation.fieldValue) ?? '',
        defaultValue: asString(annotation.defaultFieldValue),
      };
    case 'checkbox': {
      const isChecked = checkboxValue(
        annotation.fieldValue,
        annotation.exportValue,
      );
      return {
        kind: 'checkbox',
        current: isChecked ?? false,
        defaultValue:
          checkboxValue(annotation.defaultFieldValue, annotation.exportValue) ??
          defaultValue,
      };
    }
    case 'radio': {
      const current = asString(annotation.fieldValue);
      return {
        kind: 'radio',
        current: current && current !== 'Off' ? current : null,
        defaultValue: asString(annotation.defaultFieldValue),
      };
    }
    case 'dropdown':
    case 'option-list':
      return {
        kind: 'choice',
        current: asStringArray(annotation.fieldValue),
        defaultValue: asStringArray(annotation.defaultFieldValue),
      };
    default:
      return EMPTY_FORM_VALUE;
  }
}

function valuesEqual(
  first: FormFieldInitialValue,
  second: FormFieldInitialValue,
): boolean {
  return JSON.stringify(first) === JSON.stringify(second);
}

function optionsEqual(
  first: readonly FormChoiceOption[],
  second: readonly FormChoiceOption[],
): boolean {
  return JSON.stringify(first) === JSON.stringify(second);
}

function metadataFor(annotation: PdfJsWidgetAnnotation) {
  return {
    fieldType: asString(annotation.fieldType),
    checkBox: asBoolean(annotation.checkBox),
    radioButton: asBoolean(annotation.radioButton),
    pushButton: asBoolean(annotation.pushButton),
    combo: typeof annotation.combo === 'boolean' ? annotation.combo : undefined,
    multiLine: asBoolean(annotation.multiLine),
    password: asBoolean(annotation.password),
    fieldFlags: asNumber(annotation.fieldFlags),
  };
}

function normalizedWidget(
  sourcePageIndex: number,
  annotation: PdfJsWidgetAnnotation,
  widgetIndex: number,
): NormalizedWidget | null {
  if (annotation.subtype !== 'Widget') return null;
  const rawRect = Array.isArray(annotation.rect)
    ? normalizeRawRect(
        annotation.rect.filter(
          (value): value is number => typeof value === 'number',
        ),
      )
    : null;
  if (!rawRect) return null;

  const annotationId =
    asString(annotation.id) ?? `page-${sourcePageIndex}-widget-${widgetIndex}`;
  const fieldName = normalizeFieldName(
    asString(annotation.fieldName),
    annotationId,
  );
  return {
    annotation,
    fieldName,
    annotationId,
    rawRect,
    kind: classifyField(metadataFor(annotation)),
  };
}

function createField(
  sourceDocumentId: string,
  item: NormalizedWidget,
  widgetId: string,
): FormFieldDefinition {
  const annotation = item.annotation;
  const initialValue = fieldValueFor(annotation, item.kind, false);
  return {
    id: createFormFieldId(sourceDocumentId, item.fieldName),
    sourceDocumentId,
    name: item.fieldName,
    fieldType: asString(annotation.fieldType),
    kind: item.kind,
    initialValue,
    readOnly: asBoolean(annotation.readOnly),
    required: asBoolean(annotation.required),
    alternativeText: asString(annotation.alternativeText),
    options: asOptions(annotation.options),
    multiSelect: asBoolean(annotation.multiSelect),
    maxLength: asNumber(annotation.maxLen),
    widgetIds: [widgetId],
    metadataWarnings: [],
  };
}

function addWarning(
  field: FormFieldDefinition,
  warning: string,
): FormFieldDefinition {
  return field.metadataWarnings.includes(warning)
    ? field
    : { ...field, metadataWarnings: [...field.metadataWarnings, warning] };
}

function mergeField(
  field: FormFieldDefinition,
  item: NormalizedWidget,
  widgetId: string,
): FormFieldDefinition {
  const annotation = item.annotation;
  let next = field;
  if (field.kind !== item.kind) {
    next = addWarning(
      next,
      `Repeated widget metadata classified as ${item.kind}; kept ${field.kind}.`,
    );
  }
  const incomingValue = fieldValueFor(annotation, item.kind, false);
  if (!valuesEqual(field.initialValue, incomingValue)) {
    next = addWarning(
      next,
      'Repeated widgets expose incompatible initial values.',
    );
  }
  if (field.fieldType !== asString(annotation.fieldType)) {
    next = addWarning(
      next,
      'Repeated widgets expose incompatible field types.',
    );
  }
  if (field.readOnly !== asBoolean(annotation.readOnly)) {
    next = addWarning(
      next,
      'Repeated widgets expose incompatible read-only flags.',
    );
  }
  if (field.required !== asBoolean(annotation.required)) {
    next = addWarning(
      next,
      'Repeated widgets expose incompatible required flags.',
    );
  }
  if (!optionsEqual(field.options, asOptions(annotation.options))) {
    next = addWarning(next, 'Repeated widgets expose incompatible options.');
  }
  if (field.multiSelect !== asBoolean(annotation.multiSelect)) {
    next = addWarning(
      next,
      'Repeated widgets expose incompatible choice flags.',
    );
  }
  if (field.maxLength !== asNumber(annotation.maxLen)) {
    next = addWarning(
      next,
      'Repeated widgets expose incompatible max lengths.',
    );
  }
  return next.widgetIds.includes(widgetId)
    ? next
    : { ...next, widgetIds: [...next.widgetIds, widgetId] };
}

function widgetDefinition(
  sourceDocumentId: string,
  sourcePageIndex: number,
  item: NormalizedWidget,
): FormWidgetDefinition {
  const rotation = item.annotation.rotation;
  const normalizedRotation = typeof rotation === 'number' ? rotation : 0;
  return {
    id: createFormWidgetId(
      sourceDocumentId,
      sourcePageIndex,
      item.annotationId,
    ),
    fieldId: createFormFieldId(sourceDocumentId, item.fieldName),
    sourceDocumentId,
    sourcePageIndex,
    pdfAnnotationId: item.annotationId,
    rawRect: item.rawRect,
    geometry: formWidgetRectToOrientedBox(item.rawRect, normalizedRotation),
    rotation: formWidgetRectToOrientedBox(item.rawRect, normalizedRotation)
      .rotation,
    widgetValue:
      asString(item.annotation.buttonValue) ??
      asString(item.annotation.exportValue),
    alternativeText: asString(item.annotation.alternativeText),
  };
}

function sourceResult(
  sourceDocumentId: string,
  fields: readonly FormFieldDefinition[],
  widgets: readonly FormWidgetDefinition[],
): FormSourceDefinition {
  return {
    sourceDocumentId,
    status: widgets.length > 0 ? 'acroform' : 'none',
    fields,
    widgets,
    error: null,
  };
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('Form discovery was cancelled.', 'AbortError');
  }
}

async function readMetadataInfo(
  document: PDFDocumentProxy,
): Promise<Readonly<Record<string, unknown>> | null> {
  const metadata = await document.getMetadata();
  return isRecord(metadata.info) ? metadata.info : null;
}

export async function discoverPdfForms(
  sourceDocumentId: string,
  document: PDFDocumentProxy,
  options: { readonly signal?: AbortSignal } = {},
): Promise<FormSourceDefinition> {
  throwIfAborted(options.signal);
  const initialXfa = detectXfa({
    isPureXfa: document.isPureXfa,
    allXfaHtml: document.allXfaHtml,
  });
  if (initialXfa.detected) {
    return {
      sourceDocumentId,
      status: 'unsupported-xfa',
      fields: [],
      widgets: [],
      error: null,
    };
  }

  const metadataInfo = await readMetadataInfo(document);
  const xfa = detectXfa({ metadataInfo });
  if (xfa.detected) {
    return {
      sourceDocumentId,
      status: 'unsupported-xfa',
      fields: [],
      widgets: [],
      error: null,
    };
  }

  const fields = new Map<string, FormFieldDefinition>();
  const widgets: FormWidgetDefinition[] = [];
  for (
    let sourcePageIndex = 0;
    sourcePageIndex < document.numPages;
    sourcePageIndex += 1
  ) {
    throwIfAborted(options.signal);
    let page: PDFPageProxy | null = null;
    try {
      page = await document.getPage(sourcePageIndex + 1);
      throwIfAborted(options.signal);
      const annotations = await page.getAnnotations({ intent: 'display' });
      for (const [widgetIndex, candidate] of annotations.entries()) {
        const annotation = asWidget(candidate);
        if (!annotation) continue;
        const item = normalizedWidget(sourcePageIndex, annotation, widgetIndex);
        if (!item) continue;
        const widget = widgetDefinition(
          sourceDocumentId,
          sourcePageIndex,
          item,
        );
        widgets.push(widget);
        const existing = fields.get(widget.fieldId);
        fields.set(
          widget.fieldId,
          existing
            ? mergeField(existing, item, widget.id)
            : createField(sourceDocumentId, item, widget.id),
        );
      }
    } finally {
      page?.cleanup();
    }
  }

  return sourceResult(sourceDocumentId, [...fields.values()], widgets);
}

export function createDiscoveryError(
  sourceDocumentId: string,
  error: unknown,
): FormSourceDefinition {
  return {
    sourceDocumentId,
    status: 'error',
    fields: [],
    widgets: [],
    error:
      error instanceof Error
        ? error.message
        : 'Kagaz could not inspect this PDF form.',
  };
}
