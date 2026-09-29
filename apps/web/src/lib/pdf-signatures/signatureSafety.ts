import {
  PDFArray,
  PDFDict,
  PDFName,
  PDFNull,
  PDFRef,
  PDFSignature,
  PDFStream,
} from 'pdf-lib';
import type { PDFDocument, PDFObject } from 'pdf-lib';

export const SIGNED_PDF_MESSAGE =
  'This PDF contains a digital-signature value or byte-range structure. Kagaz does not modify digitally signed PDFs because changes can invalidate the signature.';

export class SignedPdfError extends Error {
  constructor() {
    super(SIGNED_PDF_MESSAGE);
    this.name = 'SignedPdfError';
  }
}

/** Structural safety only: never verifies certificates, signers, or validity. */
export function assertNoDigitalSignature(document: PDFDocument): void {
  const pending: PDFObject[] = document.context
    .enumerateIndirectObjects()
    .map(([, object]) => object);
  const visited = new Set<PDFObject>();
  while (pending.length > 0) {
    const object = pending.pop()!;
    if (visited.has(object)) continue;
    visited.add(object);
    if (object instanceof PDFStream) pending.push(object.dict);
    if (object instanceof PDFArray) pending.push(...object.asArray());
    if (!(object instanceof PDFDict)) continue;

    // Also catches malformed, orphaned, inline, and document timestamp
    // structures which PDF.js getSignatures() can omit. False positives are
    // intentionally preferable to modifying an existing signature.
    if (object.has(PDFName.of('ByteRange'))) throw new SignedPdfError();
    const value = object.get(PDFName.of('V'));
    if (value !== undefined && value !== PDFNull) {
      let ancestor: PDFDict | undefined = object;
      const ancestors = new Set<PDFDict>();
      while (ancestor && !ancestors.has(ancestor)) {
        ancestors.add(ancestor);
        const type = ancestor.get(PDFName.of('FT'));
        if (type) {
          if (document.context.lookup(type)?.toString() === '/Sig') {
            // A dangling /V is unsafe too; do not resolve it away as absent.
            if (document.context.lookup(value) !== PDFNull)
              throw new SignedPdfError();
          }
          break;
        }
        ancestor = ancestor.lookupMaybe(PDFName.of('Parent'), PDFDict);
      }
    }
    const type = object.get(PDFName.of('Type'))?.toString();
    if (
      (type === '/Sig' || type === '/DocTimeStamp') &&
      object.has(PDFName.of('Contents'))
    )
      throw new SignedPdfError();
    pending.push(...object.values());
  }
}

/** Loaded only on PDF selection, separate from the initial application chunk. */
export async function inspectSourceSignatureSafety(
  bytes: Uint8Array,
): Promise<void> {
  const { PDFDocument } = await import('pdf-lib');
  const document = await PDFDocument.load(bytes, {
    throwOnInvalidObject: true,
  });
  assertNoDigitalSignature(document);
  assertUnsignedSignatureStructure(document);
}

export class UnsafeSignatureFieldError extends Error {
  constructor() {
    super(
      'This PDF has an unsigned signature field whose widget structure Kagaz cannot safely edit or export.',
    );
    this.name = 'UnsafeSignatureFieldError';
  }
}

/** Limit widget placement to unambiguous, page-owned terminal fields. */
export function assertUnsignedSignatureStructure(document: PDFDocument): void {
  if (!document.catalog.getAcroForm()) return;
  const fields = document.getForm().getFields();
  const signatures = fields.filter((field) => field instanceof PDFSignature);
  if (signatures.length === 0) return;
  const fieldNames = new Set<string>();
  for (const field of fields) {
    if (fieldNames.has(field.getName())) throw new UnsafeSignatureFieldError();
    fieldNames.add(field.getName());
  }
  const pages = document.getPages();
  for (const field of signatures) {
    for (const widget of field.acroField.getWidgets()) {
      const rect = widget.getRectangle();
      if (
        ![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) ||
        rect.width <= 0 ||
        rect.height <= 0
      )
        throw new UnsafeSignatureFieldError();
      const owners = pages.filter((page) =>
        page.node
          .Annots()
          ?.asArray()
          .some(
            (ref) =>
              ref instanceof PDFRef &&
              document.context.lookup(ref) === widget.dict,
          ),
      );
      if (owners.length !== 1 || (widget.P() && widget.P() !== owners[0]!.ref))
        throw new UnsafeSignatureFieldError();
      const parent = widget.dict.get(PDFName.of('Parent'));
      if (
        widget.dict !== field.acroField.dict &&
        document.context.lookup(parent) !== field.acroField.dict
      )
        throw new UnsafeSignatureFieldError();
    }
  }
}
