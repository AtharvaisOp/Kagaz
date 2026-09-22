import { describe, expect, it, vi } from 'vitest';

import { exportWorkspace } from './exportWorkspace';
import type { FormExportSnapshot } from './forms/types';
import type { ExportSource } from './types';

const pdfLib = await import('pdf-lib');
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');

function page(
  id: string,
  sourceDocumentId: string,
  sourcePageIndex: number,
  rotationDelta: 0 | 90 | 180 | 270 = 0,
) {
  return { id, sourceDocumentId, sourcePageIndex, rotationDelta } as const;
}

function source(id: string, file: File): ExportSource {
  return { id, file, fileName: file.name };
}

function fileFromBytes(bytes: Uint8Array, fileName: string): File {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return new File([buffer], fileName, { type: 'application/pdf' });
}

function safeForms(
  sourceDocumentId: string,
  fields: FormExportSnapshot['sources'][number]['fields'],
): FormExportSnapshot {
  return {
    sources: [{ sourceDocumentId, capability: 'safe-acroform', fields }],
    hasChangedTextDraft: false,
  };
}

async function exportSource(
  file: File,
  forms: FormExportSnapshot,
  pages = [page('page-1', forms.sources[0]!.sourceDocumentId, 0)],
): Promise<Uint8Array> {
  const sourceId = forms.sources[0]!.sourceDocumentId;
  return exportWorkspace({
    pages,
    sources: new Map([[sourceId, source(sourceId, file)]]),
    annotationsByPage: new Map(),
    imageAssets: new Map(),
    forms,
  });
}

async function textByPage(bytes: Uint8Array): Promise<readonly string[]> {
  const loadingTask = pdfjs.getDocument({
    data: bytes.slice(),
    useSystemFonts: true,
  });
  const document = await loadingTask.promise;
  try {
    const result: string[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const pdfPage = await document.getPage(pageNumber);
      const text = await pdfPage.getTextContent();
      result.push(
        text.items.map((item) => ('str' in item ? item.str : '')).join(' '),
      );
      pdfPage.cleanup();
    }
    return result;
  } finally {
    await loadingTask.destroy();
  }
}

async function widgetCount(bytes: Uint8Array): Promise<number> {
  const loadingTask = pdfjs.getDocument({
    data: bytes.slice(),
    useSystemFonts: true,
  });
  const document = await loadingTask.promise;
  try {
    let count = 0;
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const pdfPage = await document.getPage(pageNumber);
      const annotations = await pdfPage.getAnnotations({ intent: 'display' });
      count += (annotations as readonly unknown[]).filter(
        (annotation) =>
          typeof annotation === 'object' &&
          annotation !== null &&
          'subtype' in annotation &&
          annotation.subtype === 'Widget',
      ).length;
      pdfPage.cleanup();
    }
    return count;
  } finally {
    await loadingTask.destroy();
  }
}

async function makeCompleteForm(): Promise<File> {
  const document = await pdfLib.PDFDocument.create();
  const first = document.addPage([500, 700]);
  const second = document.addPage([500, 700]);
  const third = document.addPage([500, 700]);
  const form = document.getForm();

  const text = form.createTextField('profile.name');
  text.setText('Original');
  text.addToPage(first, { x: 30, y: 620, width: 180, height: 24 });

  const notes = form.createTextField('profile.notes');
  notes.enableMultiline();
  notes.setText('Old notes');
  notes.addToPage(first, { x: 30, y: 540, width: 220, height: 60 });

  const accepted = form.createCheckBox('profile.accepted');
  accepted.addToPage(first, { x: 30, y: 490, width: 18, height: 18 });

  const role = form.createRadioGroup('profile.role');
  role.addOptionToPage('Admin', first, {
    x: 30,
    y: 440,
    width: 18,
    height: 18,
  });
  role.addOptionToPage('Editor', first, {
    x: 70,
    y: 440,
    width: 18,
    height: 18,
  });

  const country = form.createDropdown('profile.country');
  country.addOptions(['India', 'Japan', 'United Kingdom']);
  country.select('India');
  country.addToPage(second, { x: 30, y: 620, width: 180, height: 24 });

  const color = form.createOptionList('profile.color');
  color.addOptions(['Red', 'Green', 'Blue']);
  color.select('Red');
  color.addToPage(second, { x: 30, y: 500, width: 180, height: 90 });

  const skills = form.createOptionList('profile.skills');
  skills.addOptions(['TypeScript', 'React', 'PDF']);
  skills.enableMultiselect();
  skills.select(['TypeScript']);
  skills.addToPage(second, { x: 240, y: 500, width: 180, height: 90 });

  const repeated = form.createTextField('profile.repeated');
  repeated.setText('Repeated old');
  repeated.addToPage(first, { x: 280, y: 620, width: 180, height: 24 });
  repeated.addToPage(third, { x: 30, y: 620, width: 180, height: 24 });

  return fileFromBytes(await document.save(), 'complete-form.pdf');
}

async function makeTextForm(
  fileName: string,
  fieldName = 'name',
): Promise<File> {
  const document = await pdfLib.PDFDocument.create();
  const pdfPage = document.addPage([300, 200]);
  const field = document.getForm().createTextField(fieldName);
  field.setText('Original');
  field.addToPage(pdfPage, { x: 30, y: 100, width: 220, height: 30 });
  return fileFromBytes(await document.save(), fileName);
}

async function makeRepeatedForm(): Promise<File> {
  const document = await pdfLib.PDFDocument.create();
  const first = document.addPage([300, 200]);
  document.addPage([300, 200]);
  const third = document.addPage([300, 200]);
  const field = document.getForm().createTextField('profile.repeated');
  field.setText('Repeated old');
  field.addToPage(first, { x: 30, y: 100, width: 220, height: 30 });
  field.addToPage(third, { x: 30, y: 100, width: 220, height: 30 });
  return fileFromBytes(await document.save(), 'repeated-form.pdf');
}

async function makeCheckboxForm(): Promise<File> {
  const document = await pdfLib.PDFDocument.create();
  const pdfPage = document.addPage([300, 200]);
  document
    .getForm()
    .createCheckBox('accepted')
    .addToPage(pdfPage, { x: 30, y: 100, width: 24, height: 24 });
  return fileFromBytes(await document.save(), 'checkbox.pdf');
}

async function makeDropdownForm(): Promise<File> {
  const document = await pdfLib.PDFDocument.create();
  const pdfPage = document.addPage([300, 200]);
  const dropdown = document.getForm().createDropdown('country');
  dropdown.addOptions(['India', 'Japan']);
  dropdown.select('India');
  dropdown.addToPage(pdfPage, { x: 30, y: 100, width: 220, height: 30 });
  return fileFromBytes(await document.save(), 'dropdown.pdf');
}

async function makeMappedDropdown(
  exportValue: string,
  displayValue: string,
): Promise<File> {
  const document = await pdfLib.PDFDocument.create();
  const pdfPage = document.addPage([300, 200]);
  const dropdown = document.getForm().createDropdown('mapped');
  dropdown.addToPage(pdfPage, { x: 30, y: 100, width: 220, height: 30 });
  dropdown.acroField.setOptions([
    {
      value: pdfLib.PDFHexString.fromText(exportValue),
      display: pdfLib.PDFHexString.fromText(displayValue),
    },
  ]);
  dropdown.select(displayValue);
  return fileFromBytes(
    await document.save({ updateFieldAppearances: false }),
    'mapped-dropdown.pdf',
  );
}

async function makeUnsafeField(kind: 'password' | 'button'): Promise<File> {
  const document = await pdfLib.PDFDocument.create();
  const pdfPage = document.addPage([300, 200]);
  const form = document.getForm();
  if (kind === 'password') {
    const password = form.createTextField('unsafe');
    password.enablePassword();
    password.addToPage(pdfPage, { x: 30, y: 100, width: 220, height: 30 });
  } else {
    form
      .createButton('unsafe')
      .addToPage('Run', pdfPage, { x: 30, y: 100, width: 80, height: 30 });
  }
  return fileFromBytes(await document.save(), `${kind}.pdf`);
}

describe('safe AcroForm export', () => {
  it('applies every editable field kind, flattens fields, and removes PDF.js widgets', async () => {
    const file = await makeCompleteForm();
    const fields = [
      {
        name: 'profile.name',
        kind: 'text',
        value: '  Alice  ',
        changed: true,
        readOnly: false,
        options: [],
        multiSelect: false,
      },
      {
        name: 'profile.notes',
        kind: 'multiline-text',
        value: 'Line one\nLine  two',
        changed: true,
        readOnly: false,
        options: [],
        multiSelect: false,
      },
      {
        name: 'profile.accepted',
        kind: 'checkbox',
        value: true,
        changed: true,
        readOnly: false,
        options: [],
        multiSelect: false,
      },
      {
        name: 'profile.role',
        kind: 'radio',
        value: 'Editor',
        changed: true,
        readOnly: false,
        options: [],
        multiSelect: false,
      },
      {
        name: 'profile.country',
        kind: 'dropdown',
        value: 'Japan',
        changed: true,
        readOnly: false,
        options: ['India', 'Japan', 'United Kingdom'].map((value) => ({
          exportValue: value,
          displayValue: value,
        })),
        multiSelect: false,
      },
      {
        name: 'profile.color',
        kind: 'option-list',
        value: 'Green',
        changed: true,
        readOnly: false,
        options: ['Red', 'Green', 'Blue'].map((value) => ({
          exportValue: value,
          displayValue: value,
        })),
        multiSelect: false,
      },
      {
        name: 'profile.skills',
        kind: 'option-list',
        value: ['React', 'PDF'],
        changed: true,
        readOnly: false,
        options: ['TypeScript', 'React', 'PDF'].map((value) => ({
          exportValue: value,
          displayValue: value,
        })),
        multiSelect: true,
      },
      {
        name: 'profile.repeated',
        kind: 'text',
        value: 'Repeated new',
        changed: true,
        readOnly: false,
        options: [],
        multiSelect: false,
      },
    ] as const;

    const result = await exportSource(
      file,
      safeForms('source', fields),
      [0, 1, 2].map((index) => page(`page-${index}`, 'source', index)),
    );
    const output = await pdfLib.PDFDocument.load(result);
    expect(output.getForm().getFields()).toHaveLength(0);
    for (const outputPage of output.getPages()) {
      expect(outputPage.node.Annots()?.size() ?? 0).toBe(0);
    }
    expect(await widgetCount(result)).toBe(0);
    const text = await textByPage(result);
    expect(text[0]).toContain('Alice');
    expect(text[0]).toContain('Line one');
    expect(text[0]).toContain('Line two');
    expect(text[0]).toContain('Repeated new');
    expect(text[1]).toContain('Japan');
    expect(text[2]).toContain('Repeated new');
  });

  it('prepares the full source before a repeated-widget page extract', async () => {
    const file = await makeRepeatedForm();
    const result = await exportSource(
      file,
      safeForms('source', [
        {
          name: 'profile.repeated',
          kind: 'text',
          value: 'Extracted repeated',
          changed: true,
          readOnly: false,
          options: [],
          multiSelect: false,
        },
      ]),
      [page('third', 'source', 2)],
    );
    expect(await textByPage(result)).toEqual([
      expect.stringContaining('Extracted repeated'),
    ]);
    expect(await widgetCount(result)).toBe(0);
  });

  it('keeps duplicate source instances and same-name fields independent', async () => {
    const file = await makeTextForm('duplicate.pdf');
    const fields = (value: string) => [
      {
        name: 'name',
        kind: 'text' as const,
        value,
        changed: true,
        readOnly: false,
        options: [],
        multiSelect: false,
      },
    ];
    const result = await exportWorkspace({
      pages: [page('a-page', 'a', 0), page('b-page', 'b', 0)],
      sources: new Map([
        ['a', source('a', file)],
        ['b', source('b', file)],
      ]),
      annotationsByPage: new Map(),
      imageAssets: new Map(),
      forms: {
        sources: [
          {
            sourceDocumentId: 'a',
            capability: 'safe-acroform',
            fields: fields('ALPHA'),
          },
          {
            sourceDocumentId: 'b',
            capability: 'safe-acroform',
            fields: fields('BETA'),
          },
        ],
        hasChangedTextDraft: false,
      },
    });
    expect(await textByPage(result)).toEqual([
      expect.stringContaining('ALPHA'),
      expect.stringContaining('BETA'),
    ]);
  });

  it('prepares one source once even when a workspace repeats its page', async () => {
    const file = await makeTextForm('one-source.pdf');
    const read = vi.spyOn(file, 'arrayBuffer');
    const result = await exportSource(
      file,
      safeForms('source', [
        {
          name: 'name',
          kind: 'text',
          value: 'Prepared once',
          changed: true,
          readOnly: false,
          options: [],
          multiSelect: false,
        },
      ]),
      [page('first', 'source', 0), page('second', 'source', 0)],
    );
    expect(read).toHaveBeenCalledOnce();
    expect(await textByPage(result)).toEqual([
      expect.stringContaining('Prepared once'),
      expect.stringContaining('Prepared once'),
    ]);
  });

  it('keeps Kagaz annotations above flattened form content and applies rotation once', async () => {
    const file = await makeTextForm('annotated-form.pdf');
    const pngBytes = Uint8Array.from(
      atob(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      ),
      (character) => character.charCodeAt(0),
    );
    const result = await exportWorkspace({
      pages: [page('form-page', 'source', 0, 90)],
      sources: new Map([['source', source('source', file)]]),
      forms: safeForms('source', [
        {
          name: 'name',
          kind: 'text',
          value: 'Filled form',
          changed: true,
          readOnly: false,
          options: [],
          multiSelect: false,
        },
      ]),
      annotationsByPage: new Map([
        [
          'form-page',
          [
            {
              id: 'rectangle',
              workspacePageId: 'form-page',
              kind: 'rectangle',
              box: {
                origin: { x: 20, y: 20 },
                width: 40,
                height: 30,
                rotation: 0,
              },
              stroke: null,
              fill: { color: { r: 1, g: 0, b: 0 }, opacity: 0.5 },
            },
            {
              id: 'note',
              workspacePageId: 'form-page',
              kind: 'text',
              box: {
                origin: { x: 40, y: 40 },
                width: 120,
                height: 30,
                rotation: 0,
              },
              text: 'Kagaz note',
              fontFamily: 'helvetica',
              fontSizeUserUnits: 12,
              lineHeight: 1.2,
              align: 'left',
              color: { r: 0, g: 0, b: 0 },
              opacity: 1,
            },
            {
              id: 'image',
              workspacePageId: 'form-page',
              kind: 'image',
              box: {
                origin: { x: 180, y: 40 },
                width: 30,
                height: 30,
                rotation: 0,
              },
              assetId: 'asset',
              opacity: 1,
            },
          ],
        ],
      ]),
      imageAssets: new Map([
        ['asset', { assetId: 'asset', mimeType: 'image/png', bytes: pngBytes }],
      ]),
    });
    const output = await pdfLib.PDFDocument.load(result);
    expect(output.getPage(0)?.getRotation().angle).toBe(90);
    expect(await widgetCount(result)).toBe(0);
    expect(await textByPage(result)).toEqual([
      expect.stringContaining('Filled form'),
    ]);
    expect((await textByPage(result))[0]).toContain('Kagaz note');
  });

  it('accepts WinAnsi text and rejects Devanagari and emoji with typed errors', async () => {
    const file = await makeTextForm('unicode.pdf');
    const snapshot = (value: string) =>
      safeForms('source', [
        {
          name: 'name',
          kind: 'text',
          value,
          changed: true,
          readOnly: false,
          options: [],
          multiSelect: false,
        },
      ]);

    await expect(exportSource(file, snapshot('café'))).resolves.toBeInstanceOf(
      Uint8Array,
    );
    for (const value of ['नमस्ते', 'Hello 😀']) {
      await expect(exportSource(file, snapshot(value))).rejects.toMatchObject({
        code: 'unsupported-text-font',
      });
    }
  });

  it('maps canonical choice values to display text and validates display glyphs', async () => {
    const snapshot = (displayValue: string) =>
      safeForms('source', [
        {
          name: 'mapped',
          kind: 'dropdown',
          value: 'JP',
          changed: true,
          readOnly: false,
          options: [{ exportValue: 'JP', displayValue }],
          multiSelect: false,
        },
      ]);
    const result = await exportSource(
      await makeMappedDropdown('JP', 'Japan'),
      snapshot('Japan'),
    );
    expect(await textByPage(result)).toEqual([
      expect.stringContaining('Japan'),
    ]);

    await expect(
      exportSource(await makeMappedDropdown('JP', '日本'), snapshot('日本')),
    ).rejects.toMatchObject({ code: 'unsupported-text-font' });
  });

  it('blocks unsafe capabilities and active drafts at the execution boundary', async () => {
    const file = await makeTextForm('blocked.pdf');
    for (const capability of [
      'unsupported-xfa',
      'unsupported-signature',
      'unsupported-password',
      'unsupported-button',
      'unsupported-field',
      'discovering',
      'error',
    ] as const) {
      await expect(
        exportSource(file, {
          sources: [{ sourceDocumentId: 'source', capability, fields: [] }],
          hasChangedTextDraft: false,
        }),
      ).rejects.toMatchObject({ code: 'unsupported-source' });
    }

    await expect(
      exportSource(file, {
        ...safeForms('source', []),
        hasChangedTextDraft: true,
      }),
    ).rejects.toMatchObject({ code: 'active-draft' });
  });

  it('rejects actual password and push-button fields even if a snapshot is mislabeled safe', async () => {
    for (const kind of ['password', 'button'] as const) {
      await expect(
        exportSource(
          await makeUnsafeField(kind),
          safeForms('source', [
            {
              name: 'unsafe',
              kind: 'text',
              value: 'value',
              changed: true,
              readOnly: false,
              options: [],
              multiSelect: false,
            },
          ]),
        ),
      ).rejects.toMatchObject({ code: 'unsupported-source' });
    }
  });

  it('fails safely for missing fields, type mismatches, and invalid choices', async () => {
    const base = {
      changed: true,
      readOnly: false,
      options: [],
      multiSelect: false,
    } as const;
    await expect(
      exportSource(
        await makeTextForm('missing.pdf'),
        safeForms('source', [
          { ...base, name: 'missing', kind: 'text', value: 'value' },
        ]),
      ),
    ).rejects.toMatchObject({ code: 'missing-field' });
    await expect(
      exportSource(
        await makeCheckboxForm(),
        safeForms('source', [
          {
            ...base,
            name: 'accepted',
            kind: 'text',
            value: 'value',
          },
        ]),
      ),
    ).rejects.toMatchObject({ code: 'field-type-mismatch' });
    await expect(
      exportSource(
        await makeDropdownForm(),
        safeForms('source', [
          {
            ...base,
            name: 'country',
            kind: 'dropdown',
            value: 'Missing',
            options: ['India', 'Japan'].map((value) => ({
              exportValue: value,
              displayValue: value,
            })),
          },
        ]),
      ),
    ).rejects.toMatchObject({ code: 'invalid-choice' });
  });
});
