import type { SourceDocumentId } from '../../pdf-workspace/model/types';

import type { FormFieldId, FormWidgetId } from './types';

function encodePart(value: string): string {
  return `${value.length}:${value}`;
}

function makeIdentity(prefix: string, parts: readonly string[]): string {
  return `${prefix}|${parts.map(encodePart).join('|')}`;
}

export function normalizeFieldName(
  fieldName: string | null | undefined,
  widgetIdentity: string,
): string {
  const normalized = fieldName?.trim();
  return normalized || `Unnamed field ${widgetIdentity}`;
}

export function createFormFieldId(
  sourceDocumentId: SourceDocumentId,
  fullyQualifiedName: string,
): FormFieldId {
  return makeIdentity('field', [sourceDocumentId, fullyQualifiedName]);
}

export function createFormWidgetId(
  sourceDocumentId: SourceDocumentId,
  sourcePageIndex: number,
  pdfAnnotationId: string,
): FormWidgetId {
  return makeIdentity('widget', [
    sourceDocumentId,
    String(sourcePageIndex),
    pdfAnnotationId,
  ]);
}
