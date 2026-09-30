import { PDFArray, PDFDict, PDFName, PDFNull, PDFStream } from 'pdf-lib';
import type { PDFDocument, PDFObject } from 'pdf-lib';
import { assertFormStructure } from './formStructure';

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
    if (object instanceof PDFArray)
      for (const child of object.asArray()) pending.push(child);
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
        }
        ancestor = ancestor.lookupMaybe(PDFName.of('Parent'), PDFDict);
      }
    }
    const type = document.context
      .lookup(object.get(PDFName.of('Type')))
      ?.toString();
    if (
      (type === '/Sig' || type === '/DocTimeStamp') &&
      object.has(PDFName.of('Contents'))
    )
      throw new SignedPdfError();
    for (const child of object.values()) pending.push(child);
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
  assertNoExecutableActions(document);
  assertUnsignedSignatureStructure(document);
}

export class UnsafePdfActionError extends Error {
  constructor() {
    super(
      'This PDF contains JavaScript actions. Kagaz cannot safely edit or export PDF scripts.',
    );
    this.name = 'UnsafePdfActionError';
  }
}

export function assertNoExecutableActions(document: PDFDocument): void {
  const pending: PDFObject[] = document.context
    .enumerateIndirectObjects()
    .map(([, object]) => object);
  const seen = new Set<PDFObject>();
  while (pending.length) {
    const object = pending.pop()!;
    if (seen.has(object)) continue;
    seen.add(object);
    if (object instanceof PDFStream) pending.push(object.dict);
    if (object instanceof PDFArray)
      for (const value of object.asArray()) pending.push(value);
    if (object instanceof PDFDict) {
      if (
        object.has(PDFName.of('JS')) ||
        document.context.lookup(object.get(PDFName.of('S')))?.toString() ===
          '/JavaScript'
      )
        throw new UnsafePdfActionError();
      for (const value of object.values()) pending.push(value);
    }
  }
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
  assertFormStructure(document);
  if (!document.catalog.getAcroForm()) return;
  const fields = document.getForm().getFields();
  const fieldNames = new Set<string>();
  for (const field of fields) {
    if (fieldNames.has(field.getName())) throw new UnsafeSignatureFieldError();
    fieldNames.add(field.getName());
  }
}
