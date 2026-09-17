import { describe, expect, it } from 'vitest';

import { classifyField } from './fieldClassification';

describe('classifyField', () => {
  it.each([
    [{ fieldType: 'Tx' }, 'text'],
    [{ fieldType: 'Tx', multiLine: true }, 'multiline-text'],
    [{ fieldType: 'Tx', password: true }, 'password'],
    [{ fieldType: 'Btn', checkBox: true }, 'checkbox'],
    [{ fieldType: 'Btn', radioButton: true }, 'radio'],
    [{ fieldType: 'Btn', pushButton: true }, 'button'],
    [{ fieldType: 'Ch', combo: true }, 'dropdown'],
    [{ fieldType: 'Ch', combo: false }, 'option-list'],
    [{ fieldType: 'Sig' }, 'signature'],
    [{ fieldType: 'Btn' }, 'unsupported'],
    [{ fieldType: 'Ch', fieldFlags: 0 }, 'option-list'],
    [{ fieldType: 'Ch', fieldFlags: 1 << 17 }, 'dropdown'],
    [{ fieldType: 'Unknown' }, 'unsupported'],
  ] as const)('classifies %o as %s', (metadata, expected) => {
    expect(classifyField(metadata)).toBe(expected);
  });
});
