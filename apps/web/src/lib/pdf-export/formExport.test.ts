import { describe, expect, it, vi } from 'vitest';
import type { PDFObject } from 'pdf-lib';

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

async function makeSignatureForm(
  options: {
    readonly signed?: boolean;
    readonly multipleWidgets?: boolean;
    readonly includeText?: boolean;
    readonly mergedWidget?: boolean;
    readonly nested?: boolean;
    readonly fileName?: string;
  } = {},
): Promise<File> {
  const document = await pdfLib.PDFDocument.create();
  const first = document.addPage([400, 300]);
  const second = options.multipleWidgets ? document.addPage([400, 300]) : first;
  if (options.includeText) {
    const text = document.getForm().createTextField('profile.name');
    text.setText('Original');
    text.addToPage(first, { x: 30, y: 230, width: 180, height: 24 });
  }

  const context = document.context;
  const signatureDictionary = context.obj({
    FT: 'Sig',
    T: pdfLib.PDFHexString.fromText('Signature1'),
  });
  const signatureRef = context.register(signatureDictionary);
  const pages = options.multipleWidgets ? [first, second] : [first];
  const widgetRefs = pages.map((pdfPage, index) => {
    const widget = context.obj({
      Type: 'Annot',
      Subtype: 'Widget',
      Rect: [40, 70 + index * 40, 240, 120 + index * 40],
      P: pdfPage.ref,
      Parent: signatureRef,
      F: 4,
    });
    const widgetRef = context.register(widget);
    pdfPage.node.addAnnot(widgetRef);
    return widgetRef;
  });
  signatureDictionary.set(PdfName('Kids'), context.obj(widgetRefs));
  if (options.mergedWidget) {
    signatureDictionary.delete(PdfName('Kids'));
    signatureDictionary.set(PdfName('Subtype'), PdfName('Widget'));
    signatureDictionary.set(PdfName('Rect'), context.obj([40, 70, 240, 120]));
    signatureDictionary.set(PdfName('P'), first.ref);
    first.node.removeAnnot(widgetRefs[0]!);
    context.delete(widgetRefs[0]!);
    first.node.addAnnot(signatureRef);
  }
  if (options.signed) {
    const valueRef = context.register(
      context.obj({
        Type: 'Sig',
        ByteRange: [0, 10, 20, 10],
        Contents: pdfLib.PDFHexString.of('DEADBEEF'),
        SubFilter: 'adbe.pkcs7.detached',
      }),
    );
    signatureDictionary.set(PdfName('V'), valueRef);
    document.catalog
      .getOrCreateAcroForm()
      .dict.set(PdfName('SigFlags'), context.obj(3));
  }
  if (options.nested) {
    const parent = context.obj({
      T: pdfLib.PDFHexString.fromText('parent'),
      Kids: [signatureRef],
    });
    const parentRef = context.register(parent);
    signatureDictionary.set(PdfName('Parent'), parentRef);
    document.catalog.getOrCreateAcroForm().addField(parentRef);
  } else document.catalog.getOrCreateAcroForm().addField(signatureRef);
  return fileFromBytes(
    await document.save({ updateFieldAppearances: false }),
    options.fileName ?? 'signature-field.pdf',
  );
}

function PdfName(name: string) {
  return pdfLib.PDFName.of(name);
}

const signaturePngBytes = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  ),
  (character) => character.charCodeAt(0),
);

function visualSignature(pageId: string, assetId: string, widgetId?: string) {
  return {
    id: `signature-${pageId}`,
    workspacePageId: pageId,
    kind: 'signature' as const,
    box: {
      origin: { x: 55, y: 82 },
      width: 120,
      height: 30,
      rotation: 0 as const,
    },
    assetId,
    method: 'draw' as const,
    opacity: 1,
    target: widgetId
      ? {
          kind: 'form-signature-field' as const,
          sourceDocumentId: 'source',
          sourcePageIndex: 0,
          fieldName: 'Signature1',
          widgetId,
        }
      : undefined,
  };
}

async function imagePaintCount(bytes: Uint8Array): Promise<number> {
  const loadingTask = pdfjs.getDocument({
    data: bytes.slice(),
    useSystemFonts: true,
  });
  const document = await loadingTask.promise;
  try {
    const pdfPage = await document.getPage(1);
    const operators = await pdfPage.getOperatorList();
    pdfPage.cleanup();
    return operators.fnArray.filter(
      (operator) =>
        operator === pdfjs.OPS.paintImageXObject ||
        operator === pdfjs.OPS.paintInlineImageXObject,
    ).length;
  } finally {
    await loadingTask.destroy();
  }
}

describe('safe AcroForm export', () => {
  it.each([true, false])(
    'isolates signature fields with the same name across reordered sources (same file=%s)',
    async (sameFile) => {
      const a = await makeSignatureForm({
        includeText: true,
        fileName: 'alpha.pdf',
      });
      const b = sameFile
        ? a
        : await makeSignatureForm({ includeText: true, fileName: 'beta.pdf' });
      const fields = (value: string) => [
        {
          name: 'profile.name',
          kind: 'text' as const,
          value,
          changed: true,
          readOnly: false,
          options: [],
          multiSelect: false,
        },
      ];
      const sigA = {
        ...visualSignature('a-page', 'a-asset', 'a-widget'),
        target: {
          kind: 'form-signature-field' as const,
          sourceDocumentId: 'a',
          sourcePageIndex: 0,
          fieldName: 'Signature1',
          widgetId: 'a-widget',
        },
      };
      const sigB = {
        ...visualSignature('b-page', 'b-asset', 'b-widget'),
        box: { ...sigA.box, origin: { x: 170, y: 82 } },
        target: { ...sigA.target, sourceDocumentId: 'b', widgetId: 'b-widget' },
      };
      const result = await exportWorkspace({
        pages: [page('b-page', 'b', 0), page('a-page', 'a', 0)],
        sources: new Map([
          ['a', source('a', a)],
          ['b', source('b', b)],
        ]),
        forms: {
          sources: [
            ...safeForms('a', fields('ALPHA')).sources,
            ...safeForms('b', fields('BETA')).sources,
          ],
          hasChangedTextDraft: false,
        },
        annotationsByPage: new Map([
          ['a-page', [sigA]],
          ['b-page', [sigB]],
        ]),
        imageAssets: new Map(
          ['a-asset', 'b-asset'].map((assetId) => [
            assetId,
            {
              assetId,
              mimeType: 'image/png' as const,
              bytes: signaturePngBytes,
            },
          ]),
        ),
      });
      expect(await textByPage(result)).toEqual([
        expect.stringContaining('BETA'),
        expect.stringContaining('ALPHA'),
      ]);
      expect(await widgetCount(result)).toBe(0);
      const output = await pdfLib.PDFDocument.load(result, {
        throwOnInvalidObject: true,
      });
      expect(output.getForm().getFields()).toHaveLength(0);
      const content = output.getPages().map((p) => {
        const streams = p.node.Contents();
        if (!(streams instanceof pdfLib.PDFArray))
          throw new Error('Expected content array');
        return streams
          .asArray()
          .map((ref) => {
            const stream = output.context.lookup(ref);
            if (!(stream instanceof pdfLib.PDFRawStream))
              throw new Error('Expected stream');
            return new TextDecoder().decode(
              pdfLib.decodePDFRawStream(stream).decode(),
            );
          })
          .join('\n');
      });
      expect(content[0]).toContain('1 0 0 1 170 82 cm');
      expect(content[1]).toContain('1 0 0 1 55 82 cm');
    },
  );

  it('demonstrates that pdf-lib can remove a signed field without preserving its signature', async () => {
    const file = await makeSignatureForm({ signed: true });
    for (const operation of ['remove', 'flatten'] as const) {
      const document = await pdfLib.PDFDocument.load(await file.arrayBuffer());
      const form = document.getForm();
      const field = form.getSignature('Signature1');
      for (const widget of field.acroField.getWidgets()) {
        widget.setNormalAppearance(
          document.context.register(
            document.context.formXObject([], {
              BBox: document.context.obj([0, 0, 200, 50]),
            }),
          ),
        );
      }
      if (operation === 'remove') form.removeField(field);
      else form.flatten();
      const output = await pdfLib.PDFDocument.load(await document.save(), {
        throwOnInvalidObject: true,
      });
      expect(output.getForm().getFields()).toHaveLength(0);
      // The primitive API does not protect existing digital signatures.
    }
  });

  it.each(['missing-page', 'wrong-page', 'bad-rectangle'] as const)(
    'rejects unsafe unsigned signature widgets: %s',
    async (fault) => {
      const document = await pdfLib.PDFDocument.load(
        await (await makeSignatureForm()).arrayBuffer(),
      );
      const widget = document
        .getForm()
        .getSignature('Signature1')
        .acroField.getWidgets()[0]!;
      if (fault === 'missing-page')
        document.getPage(0).node.delete(PdfName('Annots'));
      if (fault === 'wrong-page') widget.setP(document.addPage().ref);
      if (fault === 'bad-rectangle')
        widget.dict.set(PdfName('Rect'), document.context.obj([0, 0, 0, 0]));
      const file = fileFromBytes(
        await document.save({ updateFieldAppearances: false }),
        'unsafe.pdf',
      );
      await expect(
        exportSource(file, safeForms('source', [])),
      ).rejects.toMatchObject({ code: 'signature-field-removal-failed' });
    },
  );
  it.each([{ mergedWidget: true }, { nested: true }])(
    'strictly reloads flattened signature structure %j',
    async (options) => {
      const file = await makeSignatureForm(options);
      const result = await exportSource(file, safeForms('source', []));
      const output = await pdfLib.PDFDocument.load(result, {
        throwOnInvalidObject: true,
      });
      expect(output.getForm().getFields()).toHaveLength(0);
      expect(output.getPage(0).node.Annots()?.size() ?? 0).toBe(0);
      expect(await widgetCount(result)).toBe(0);
      const visited = new Set<PDFObject>();
      const pending = output.context
        .enumerateIndirectObjects()
        .map(([, object]) => object);
      while (pending.length) {
        const object = pending.pop()!;
        if (visited.has(object)) continue;
        visited.add(object);
        if (object instanceof pdfLib.PDFRef)
          expect(output.context.lookup(object)).toBeDefined();
        if (object instanceof pdfLib.PDFDict) pending.push(...object.values());
        if (object instanceof pdfLib.PDFArray)
          pending.push(...object.asArray());
        if (object instanceof pdfLib.PDFStream) pending.push(object.dict);
      }
    },
  );

  it.each(['plain', 'safe-acroform'] as const)(
    'blocks signed sources even with a %s snapshot',
    async (capability) => {
      const file = await makeSignatureForm({ signed: true });
      await expect(
        exportSource(file, {
          sources: [{ sourceDocumentId: 'source', capability, fields: [] }],
          hasChangedTextDraft: false,
        }),
      ).rejects.toMatchObject({ code: 'existing-digital-signature' });
    },
  );

  it('records pdf-lib 1.17.1 unsigned removeField/flatten failure and copyPages orphaning', async () => {
    const file = await makeSignatureForm();
    const load = () =>
      file.arrayBuffer().then((bytes) => pdfLib.PDFDocument.load(bytes));
    const removeDoc = await load();
    expect(() =>
      removeDoc
        .getForm()
        .removeField(removeDoc.getForm().getSignature('Signature1')),
    ).toThrow();
    const flattenDoc = await load();
    expect(() => flattenDoc.getForm().flatten()).toThrow();
    const copied = await pdfLib.PDFDocument.create();
    const [copiedPage] = await copied.copyPages(await load(), [0]);
    copied.addPage(copiedPage);
    const saved = await copied.save();
    expect(
      (await pdfLib.PDFDocument.load(saved)).getForm().getFields(),
    ).toHaveLength(0);
    expect(await widgetCount(saved)).toBe(1);
  });
  it('removes an empty unsigned signature field without leaving widgets', async () => {
    const file = await makeSignatureForm();
    const result = await exportSource(file, safeForms('source', []));
    const output = await pdfLib.PDFDocument.load(result);
    expect(output.getForm().getFields()).toHaveLength(0);
    expect(output.getPage(0).node.Annots()?.size() ?? 0).toBe(0);
    expect(await widgetCount(result)).toBe(0);
  });

  it('coexists with normal form flattening and a field-targeted visual signature', async () => {
    const file = await makeSignatureForm({ includeText: true });
    const result = await exportWorkspace({
      pages: [page('page-1', 'source', 0)],
      sources: new Map([['source', source('source', file)]]),
      annotationsByPage: new Map([
        ['page-1', [visualSignature('page-1', 'signature-asset', 'widget-a')]],
      ]),
      imageAssets: new Map([
        [
          'signature-asset',
          {
            assetId: 'signature-asset',
            mimeType: 'image/png',
            bytes: signaturePngBytes,
          },
        ],
      ]),
      forms: safeForms('source', [
        {
          name: 'profile.name',
          kind: 'text',
          value: 'Signed visually',
          changed: true,
          readOnly: false,
          options: [],
          multiSelect: false,
        },
      ]),
    });
    const output = await pdfLib.PDFDocument.load(result);
    expect(output.getForm().getFields()).toHaveLength(0);
    expect(output.getPage(0).node.Annots()?.size() ?? 0).toBe(0);
    expect(await widgetCount(result)).toBe(0);
    expect(await textByPage(result)).toEqual([
      expect.stringContaining('Signed visually'),
    ]);
    expect(await imagePaintCount(result)).toBeGreaterThan(0);
  });

  it('removes every widget from a repeated unsigned signature field', async () => {
    const file = await makeSignatureForm({ multipleWidgets: true });
    const result = await exportSource(file, safeForms('source', []), [
      page('first', 'source', 0),
      page('second', 'source', 1),
    ]);
    const output = await pdfLib.PDFDocument.load(result);
    expect(output.getForm().getFields()).toHaveLength(0);
    expect(
      output.getPages().map((entry) => entry.node.Annots()?.size() ?? 0),
    ).toEqual([0, 0]);
    expect(await widgetCount(result)).toBe(0);
  });

  it('blocks a signature value before modifying the export-scoped source', async () => {
    await expect(
      exportSource(
        await makeSignatureForm({ signed: true }),
        safeForms('source', []),
      ),
    ).rejects.toMatchObject({
      code: 'existing-digital-signature',
    });
  });

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
      'unsupported-signed-pdf',
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
