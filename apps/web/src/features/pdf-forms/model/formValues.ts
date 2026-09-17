import type { FormFieldDefinition, FormValue } from './types';

export function initialFormValue(field: FormFieldDefinition): FormValue {
  switch (field.initialValue.kind) {
    case 'text':
      return field.initialValue.current;
    case 'checkbox':
      return field.initialValue.current;
    case 'radio':
      return field.initialValue.current;
    case 'choice':
      return field.kind === 'dropdown' || !field.multiSelect
        ? (field.initialValue.current[0] ?? null)
        : [...field.initialValue.current];
    case 'none':
      return null;
  }
}

export function formValuesEqual(left: FormValue, right: FormValue): boolean {
  if (Array.isArray(left) || Array.isArray(right)) {
    if (
      !Array.isArray(left) ||
      !Array.isArray(right) ||
      left.length !== right.length
    ) {
      return false;
    }
    return left.every((value, index) => value === right[index]);
  }
  return left === right;
}

export function cloneFormValue(value: FormValue): FormValue {
  return Array.isArray(value) ? [...(value as readonly string[])] : value;
}
