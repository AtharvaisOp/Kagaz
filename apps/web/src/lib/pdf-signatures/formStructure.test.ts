import { describe, expect, it } from 'vitest';
import { PDFDocument, PDFName, PDFRef, PDFHexString, PDFNumber } from 'pdf-lib';
import { assertFormStructure, UnsafeFormStructureError } from './formStructure';
import { inspectSourceSignatureSafety } from './signatureSafety';
import { exportWorkspace } from '../pdf-export/exportWorkspace';

async function fixture() {
  const doc = await PDFDocument.create();
  const page = doc.addPage();
  const field = doc.getForm().createTextField('profile.name');
  field.addToPage(page, { x: 20, y: 30, width: 100, height: 25 });
  return { doc, page, field, widget: field.acroField.getWidgets()[0]! };
}

describe('untrusted AcroForm structure', () => {
  it.each([
    'dangling-field',
    'non-dictionary',
    'cycle',
    'duplicate-child',
    'missing-widget',
    'orphan-widget',
    'duplicate-annot',
    'invalid-rect',
    'zero-width',
    'negative-width',
    'wrong-parent',
    'wrong-page',
    'missing-acroform',
  ])('fails closed for %s at import and export', async (kind) => {
    const { doc, page, field, widget } = await fixture();
    const c = doc.context;
    const kids = field.acroField.Kids()!;
    const widgetRef = kids.get(0);
    if (!(widgetRef instanceof PDFRef)) throw new Error('Expected fixture ref');
    if (kind === 'dangling-field')
      doc.catalog.getOrCreateAcroForm().addField(PDFRef.of(999));
    if (kind === 'non-dictionary')
      doc.catalog.getOrCreateAcroForm().addField(c.register(PDFNumber.of(4)));
    if (kind === 'cycle') kids.push(field.ref);
    if (kind === 'duplicate-child') kids.push(kids.get(0));
    if (kind === 'missing-widget')
      field.acroField.dict.delete(PDFName.of('Kids'));
    if (kind === 'orphan-widget') page.node.removeAnnot(widgetRef);
    if (kind === 'duplicate-annot') page.node.addAnnot(widgetRef);
    if (kind === 'invalid-rect')
      widget.dict.set(PDFName.of('Rect'), c.obj([0, 0, 'oops', 50]));
    if (kind === 'zero-width')
      widget.dict.set(PDFName.of('Rect'), c.obj([0, 0, 0, 50]));
    if (kind === 'negative-width')
      widget.dict.set(PDFName.of('Rect'), c.obj([10, 0, 0, 50]));
    if (kind === 'wrong-parent')
      widget.dict.set(PDFName.of('Parent'), c.register(c.obj({})));
    if (kind === 'missing-acroform') doc.catalog.delete(PDFName.of('AcroForm'));
    if (kind === 'wrong-page')
      widget.dict.set(PDFName.of('P'), doc.addPage().ref);
    expect(() => assertFormStructure(doc)).toThrow(UnsafeFormStructureError);
    const bytes = await doc.save({ updateFieldAppearances: false });
    await expect(inspectSourceSignatureSafety(bytes)).rejects.toBeInstanceOf(
      UnsafeFormStructureError,
    );
    const file = new File([new Uint8Array(bytes)], 'malformed.pdf', {
      type: 'application/pdf',
    });
    await expect(
      exportWorkspace({
        pages: [
          {
            id: 'p',
            sourceDocumentId: 's',
            sourcePageIndex: 0,
            rotationDelta: 0,
          },
        ],
        sources: new Map([['s', { id: 's', fileName: file.name, file }]]),
        annotationsByPage: new Map(),
        imageAssets: new Map(),
        forms: {
          sources: [{ sourceDocumentId: 's', capability: 'plain', fields: [] }],
          hasChangedTextDraft: false,
        },
      }),
    ).rejects.toThrow(/cannot safely export/);
  });
  it('accepts nested fields and repeated page-owned widgets', async () => {
    const { doc, field } = await fixture();
    field.addToPage(doc.addPage(), { x: 30, y: 20, width: 100, height: 30 });
    expect(() => assertFormStructure(doc)).not.toThrow();
    await expect(
      inspectSourceSignatureSafety(await doc.save()),
    ).resolves.toBeUndefined();
  });
  it('rejects excessive nested trees before entering recursive field APIs', async () => {
    const doc = await PDFDocument.create();
    doc.addPage();
    let parent = doc.context.obj({ T: PDFHexString.fromText('root') });
    let ref = doc.context.register(parent);
    doc.catalog.getOrCreateAcroForm().addField(ref);
    for (let i = 0; i < 70; i++) {
      const child = doc.context.obj({ Parent: ref });
      const childRef = doc.context.register(child);
      parent.set(PDFName.of('Kids'), doc.context.obj([childRef]));
      parent = child;
      ref = childRef;
    }
    expect(() => assertFormStructure(doc)).toThrow(UnsafeFormStructureError);
  });
});
