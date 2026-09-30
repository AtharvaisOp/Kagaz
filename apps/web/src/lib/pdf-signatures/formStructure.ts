import { PDFArray, PDFDict, PDFName, PDFNumber, PDFRef } from 'pdf-lib';
import type { PDFDocument, PDFObject } from 'pdf-lib';

export class UnsafeFormStructureError extends Error {
  constructor() {
    super(
      'This PDF has a malformed or unsupported form structure. Kagaz cannot safely edit or export it.',
    );
    this.name = 'UnsafeFormStructureError';
  }
}

/** Validate before pdf-lib's recursive field/ancestor APIs. Never repair input. */
export function assertFormStructure(document: PDFDocument): void {
  const { context } = document;
  const raw = document.catalog.get(PDFName.of('AcroForm'));
  const form = context.lookup(raw);
  if (raw !== undefined && !(form instanceof PDFDict))
    throw new UnsafeFormStructureError();
  const fields =
    form instanceof PDFDict
      ? context.lookup(form.get(PDFName.of('Fields')))
      : undefined;
  if (form && !(fields instanceof PDFArray))
    throw new UnsafeFormStructureError();
  const pending: { object: PDFObject; parent?: PDFDict; depth: number }[] = [];
  if (fields instanceof PDFArray)
    for (const object of fields.asArray()) pending.push({ object, depth: 0 });
  const seen = new Set<PDFDict>();
  const widgets = new Set<PDFDict>();
  while (pending.length) {
    const item = pending.pop()!;
    const field = context.lookup(item.object);
    // A conservative nesting bound protects downstream recursive library APIs.
    if (
      !(item.object instanceof PDFRef) ||
      !(field instanceof PDFDict) ||
      seen.has(field) ||
      item.depth > 64
    )
      throw new UnsafeFormStructureError();
    seen.add(field);
    const parent = field.get(PDFName.of('Parent'));
    if (
      (parent !== undefined && context.lookup(parent) !== item.parent) ||
      (item.parent && parent === undefined)
    )
      throw new UnsafeFormStructureError();
    const isWidget =
      context.lookup(field.get(PDFName.of('Subtype')))?.toString() ===
      '/Widget';
    if (isWidget) {
      widgets.add(field);
      const rect = context.lookup(field.get(PDFName.of('Rect')));
      if (!(rect instanceof PDFArray) || rect.size() !== 4)
        throw new UnsafeFormStructureError();
      const values = rect.asArray().map((value) => context.lookup(value));
      if (
        !values.every(
          (value) =>
            value instanceof PDFNumber && Number.isFinite(value.asNumber()),
        )
      )
        throw new UnsafeFormStructureError();
      const [x, y, right, top] = (values as PDFNumber[]).map((value) =>
        value.asNumber(),
      );
      if (right! <= x! || top! <= y!) throw new UnsafeFormStructureError();
    }
    const rawKids = field.get(PDFName.of('Kids'));
    if (rawKids !== undefined) {
      const kids = context.lookup(rawKids);
      if (!(kids instanceof PDFArray) || kids.size() === 0 || isWidget)
        throw new UnsafeFormStructureError();
      for (const object of kids.asArray())
        pending.push({ object, parent: field, depth: item.depth + 1 });
    } else if (!isWidget) {
      throw new UnsafeFormStructureError();
    }
  }
  const owners = new Set<PDFDict>();
  for (const page of document.getPages()) {
    const rawAnnots = page.node.get(PDFName.of('Annots'));
    if (rawAnnots === undefined) continue;
    const annotations = context.lookup(rawAnnots);
    if (!(annotations instanceof PDFArray))
      throw new UnsafeFormStructureError();
    for (const ref of annotations.asArray()) {
      const annotation = context.lookup(ref);
      if (!(annotation instanceof PDFDict))
        throw new UnsafeFormStructureError();
      if (
        context.lookup(annotation.get(PDFName.of('Subtype')))?.toString() !==
        '/Widget'
      )
        continue;
      if (
        !(ref instanceof PDFRef) ||
        !widgets.has(annotation) ||
        owners.has(annotation)
      )
        throw new UnsafeFormStructureError();
      const pageRef = annotation.get(PDFName.of('P'));
      if (pageRef !== undefined && pageRef !== page.ref)
        throw new UnsafeFormStructureError();
      owners.add(annotation);
    }
  }
  if (owners.size !== widgets.size) throw new UnsafeFormStructureError();
}
