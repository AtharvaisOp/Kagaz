import { describe, expect, it, vi } from 'vitest';

import { discoverPdfForms } from './discoverPdfForms';
import type { PDFDocumentProxy } from 'pdfjs-dist';

function widget(overrides: Record<string, unknown>) {
  return {
    subtype: 'Widget',
    id: 'widget-1',
    fieldName: 'profile.name',
    fieldType: 'Tx',
    fieldValue: 'Ada',
    defaultFieldValue: 'Default',
    fieldFlags: 0,
    readOnly: false,
    required: true,
    alternativeText: 'Full name',
    rect: [10, 20, 110, 50],
    rotation: 0,
    ...overrides,
  };
}

function fakeDocument(
  pages: readonly unknown[][],
  metadataInfo: Record<string, unknown> = {},
) {
  const pageProxies = pages.map((annotations) => ({
    getAnnotations: vi.fn(() => Promise.resolve(annotations)),
    cleanup: vi.fn(),
  }));
  const getMetadata = vi.fn(() => Promise.resolve({ info: metadataInfo }));
  const getPage = vi.fn((pageNumber: number) =>
    Promise.resolve(pageProxies[pageNumber - 1]),
  );
  const document = {
    numPages: pageProxies.length,
    isPureXfa: false,
    allXfaHtml: null,
    getMetadata,
    getPage,
  } as unknown as PDFDocumentProxy;
  return { document, pageProxies, getPage };
}

describe('discoverPdfForms', () => {
  it('uses page annotations, merges repeated widgets, and cleans borrowed pages', async () => {
    const second = widget({ id: 'widget-2', rect: [10, 60, 110, 90] });
    const { document, pageProxies } = fakeDocument([[widget({})], [second]]);

    const result = await discoverPdfForms('source-a', document);

    expect(result.status).toBe('acroform');
    expect(result.fields).toHaveLength(1);
    expect(result.fields[0]?.widgetIds).toHaveLength(2);
    expect(result.widgets.map((entry) => entry.sourcePageIndex)).toEqual([
      0, 1,
    ]);
    expect(result.fields[0]?.name).toBe('profile.name');
    expect(result.fields[0]?.required).toBe(true);
    expect(result.widgets[0]?.geometry.origin).toEqual({ x: 10, y: 20 });
    expect(
      pageProxies.every((page) => page?.cleanup.mock.calls.length === 1),
    ).toBe(true);
  });

  it('returns none for a document without Widget annotations', async () => {
    const { document } = fakeDocument([
      [{ subtype: 'Link', rect: [0, 0, 10, 10] }],
    ]);
    await expect(discoverPdfForms('plain', document)).resolves.toMatchObject({
      status: 'none',
      fields: [],
      widgets: [],
    });
  });

  it('stops ordinary form discovery for hybrid XFA markers', async () => {
    const { document, getPage } = fakeDocument([[widget({})]], {
      IsXFAPresent: true,
    });
    const result = await discoverPdfForms('xfa', document);
    expect(result.status).toBe('unsupported-xfa');
    expect(getPage).not.toHaveBeenCalled();
  });

  it('preserves classification details across supported native kinds', async () => {
    const annotations = [
      widget({ id: 'text', fieldName: 'text', fieldType: 'Tx' }),
      widget({
        id: 'multi',
        fieldName: 'multi',
        fieldType: 'Tx',
        multiLine: true,
      }),
      widget({
        id: 'password',
        fieldName: 'password',
        fieldType: 'Tx',
        password: true,
      }),
      widget({
        id: 'check',
        fieldName: 'check',
        fieldType: 'Btn',
        checkBox: true,
        fieldValue: 'Yes',
        exportValue: 'Yes',
      }),
      widget({
        id: 'radio',
        fieldName: 'radio',
        fieldType: 'Btn',
        radioButton: true,
        fieldValue: 'a',
        buttonValue: 'a',
      }),
      widget({
        id: 'dropdown',
        fieldName: 'dropdown',
        fieldType: 'Ch',
        combo: true,
        options: [{ exportValue: 'a', displayValue: 'Alpha' }],
      }),
      widget({
        id: 'list',
        fieldName: 'list',
        fieldType: 'Ch',
        combo: false,
        multiSelect: true,
      }),
      widget({
        id: 'button',
        fieldName: 'button',
        fieldType: 'Btn',
        pushButton: true,
      }),
      widget({ id: 'signature', fieldName: 'signature', fieldType: 'Sig' }),
    ];
    const { document } = fakeDocument([annotations]);
    const result = await discoverPdfForms('source', document);
    expect(result.fields.map((field) => field.kind)).toEqual([
      'text',
      'multiline-text',
      'password',
      'checkbox',
      'radio',
      'dropdown',
      'option-list',
      'button',
      'signature',
    ]);
  });
});
