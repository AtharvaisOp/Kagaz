import { describe, expect, it } from 'vitest';
import { PDFDocument, PDFHexString, PDFName, PDFNull, PDFRef } from 'pdf-lib';
import {
  assertNoDigitalSignature,
  inspectSourceSignatureSafety,
  SignedPdfError,
} from './signatureSafety';
import { describePdfError } from '../pdf';

describe('signed PDF structural safety', () => {
  it.each([
    'value',
    'dangling-value',
    'byte-range',
    'inline-range',
    'timestamp',
    'inherited-type',
    'indirect-timestamp',
    'contradictory-type',
    'malformed-range',
  ])(
    'blocks %s in compressed save/reload without verifying cryptography',
    async (kind) => {
      const document = await PDFDocument.create();
      document.addPage();
      const context = document.context;
      const field = context.obj({
        FT: 'Sig',
        T: PDFHexString.fromText('Signature'),
      });
      const fieldRef = context.register(field);
      document.catalog.getOrCreateAcroForm().addField(fieldRef);
      if (kind === 'indirect-timestamp')
        context.register(
          context.obj({
            Type: context.register(PDFName.of('DocTimeStamp')),
            Contents: PDFHexString.of('00'),
          }),
        );
      if (kind === 'contradictory-type')
        context.register(
          context.obj({ FT: 'Tx', Parent: fieldRef, V: PDFHexString.of('00') }),
        );
      if (kind === 'malformed-range')
        context.register(context.obj({ ByteRange: PDFRef.of(999) }));
      if (kind === 'value')
        field.set(
          PDFName.of('V'),
          context.obj({ Contents: PDFHexString.of('AB') }),
        );
      if (kind === 'dangling-value') field.set(PDFName.of('V'), PDFRef.of(999));
      if (kind === 'byte-range')
        context.register(context.obj({ ByteRange: [0, 0, 0, 0] }));
      if (kind === 'inline-range')
        document.catalog.set(
          PDFName.of('Perms'),
          context.obj({ DocMDP: { ByteRange: [0, 5, 9, 5] } }),
        );
      if (kind === 'timestamp')
        context.register(
          context.obj({
            Type: 'DocTimeStamp',
            Contents: PDFHexString.of('00'),
          }),
        );
      if (kind === 'inherited-type')
        context.register(
          context.obj({ Parent: fieldRef, V: PDFHexString.of('00') }),
        );
      const bytes = await document.save({ updateFieldAppearances: false });
      await expect(inspectSourceSignatureSafety(bytes)).rejects.toBeInstanceOf(
        SignedPdfError,
      );
    },
  );

  it('accepts an absent or explicit-null signature value', async () => {
    const document = await PDFDocument.create();
    document.addPage();
    const field = document.context.obj({ FT: 'Sig' });
    document.context.register(field);
    expect(() => assertNoDigitalSignature(document)).not.toThrow();
    field.set(PDFName.of('V'), PDFNull);
    expect(() => assertNoDigitalSignature(document)).not.toThrow();
  });

  it('explains the policy without certificate or signer validity claims', () => {
    const message = describePdfError(new SignedPdfError());
    expect(message).toContain('changes can invalidate');
    expect(message).not.toMatch(/verified|valid certificate|authentic signer/i);
  });
});

it('rejects JavaScript actions before an editable workspace is admitted', async () => {
  const document = await PDFDocument.create();
  document.addPage();
  document.catalog.set(
    PDFName.of('OpenAction'),
    document.context.obj({
      S: 'JavaScript',
      JS: PDFHexString.fromText('syntheticOnly()'),
    }),
  );
  await expect(
    inspectSourceSignatureSafety(await document.save()),
  ).rejects.toThrow('JavaScript actions');
});
