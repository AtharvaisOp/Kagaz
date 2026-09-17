import type { FormFieldKind } from './types';

export interface PdfJsFieldMetadata {
  readonly fieldType?: string | null;
  readonly checkBox?: boolean;
  readonly radioButton?: boolean;
  readonly pushButton?: boolean;
  readonly combo?: boolean;
  readonly multiLine?: boolean;
  readonly password?: boolean;
  readonly fieldFlags?: number | null;
}

const COMBO_FLAG = 1 << 17;

function hasFlag(flags: number | null | undefined, flag: number): boolean {
  return typeof flags === 'number' && (flags & flag) !== 0;
}

export function classifyField(metadata: PdfJsFieldMetadata): FormFieldKind {
  switch (metadata.fieldType) {
    case 'Tx':
      if (metadata.password) return 'password';
      if (metadata.multiLine) return 'multiline-text';
      return 'text';
    case 'Btn':
      if (metadata.pushButton) return 'button';
      if (metadata.radioButton) return 'radio';
      if (metadata.checkBox) return 'checkbox';
      return 'unsupported';
    case 'Ch':
      return (metadata.combo ?? hasFlag(metadata.fieldFlags, COMBO_FLAG))
        ? 'dropdown'
        : 'option-list';
    case 'Sig':
      return 'signature';
    default:
      return 'unsupported';
  }
}
