import { describe, expect, it } from 'vitest';

import { detectXfa } from './xfaDetection';

describe('detectXfa', () => {
  it('detects pure XFA from PDF.js public signals', () => {
    expect(detectXfa({ isPureXfa: true, allXfaHtml: null })).toEqual({
      detected: true,
      kind: 'pure',
    });
    expect(detectXfa({ allXfaHtml: { name: 'xfa' } })).toEqual({
      detected: true,
      kind: 'pure',
    });
  });

  it('detects a hybrid XFA marker without treating it as no form', () => {
    expect(detectXfa({ metadataInfo: { IsXFAPresent: true } })).toEqual({
      detected: true,
      kind: 'hybrid',
    });
    expect(detectXfa({ metadataInfo: { IsXFAPresent: 'true' } })).toEqual({
      detected: true,
      kind: 'hybrid',
    });
  });

  it('leaves ordinary AcroForm and non-form metadata alone', () => {
    expect(detectXfa({ metadataInfo: { IsXFAPresent: false } })).toEqual({
      detected: false,
      kind: null,
    });
    expect(detectXfa({})).toEqual({ detected: false, kind: null });
  });
});
