// Run from the repository root with: pnpm --filter @kagaz/api exec tsx src/assistant/fixtures/generate-known-pdf.mjs
import { writeFile } from 'node:fs/promises';
import { URL } from 'node:url';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { KNOWN_PDF_PASSAGES } from './groundingCases.ts';

const pdf = await PDFDocument.create();
pdf.setTitle('Kagaz synthetic grounding evaluation clauses');
pdf.setProducer('Kagaz deterministic test fixture');
pdf.setCreationDate(new Date('2026-01-01T00:00:00Z'));
pdf.setModificationDate(new Date('2026-01-01T00:00:00Z'));
const font = await pdf.embedFont(StandardFonts.Helvetica);
for (const text of KNOWN_PDF_PASSAGES) {
  pdf.addPage([595, 842]).drawText(text, {
    x: 48,
    y: 780,
    size: 12,
    lineHeight: 18,
    maxWidth: 499,
    font,
  });
}
await writeFile(
  new URL('./known-answer-contract.pdf', import.meta.url),
  await pdf.save(),
);
