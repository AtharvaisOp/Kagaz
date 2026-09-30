import type { FormFieldDefinition, FormWidgetDefinition } from '../model/types';

function humanizeFieldName(name: string): string {
  if (name.startsWith('Unnamed field ')) return 'Unnamed form field';
  const humanized = name
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[._-]+/g, ' ')
    .trim();
  return humanized
    ? humanized.charAt(0).toUpperCase() + humanized.slice(1)
    : 'Form field';
}

export function getFormFieldLabel(
  field: FormFieldDefinition,
  widget: FormWidgetDefinition,
): string {
  return (
    widget.alternativeText?.trim() ||
    field.alternativeText?.trim() ||
    humanizeFieldName(field.name)
  );
}
