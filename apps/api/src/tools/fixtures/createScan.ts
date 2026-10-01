import { readFile } from 'node:fs/promises';
import { PDFDocument, degrees, rgb } from 'pdf-lib';

export async function createScan({
  pages = 1,
  digital = false,
  blank = false,
  marks = false,
  rotation = 0,
  quality = 'english',
}: {
  pages?: number;
  digital?: boolean;
  blank?: boolean;
  marks?: boolean;
  rotation?: number;
  quality?: 'english' | 'rotated' | 'low-quality';
} = {}) {
  const doc = await PDFDocument.create();
  const image = await doc.embedPng(
    await readFile(
      new URL(
        `./${quality === 'english' ? 'english' : quality}-scan.png`,
        import.meta.url,
      ),
    ),
  );
  if (digital)
    doc.addPage([576, 720]).drawText('Original digital text stays usable', {
      x: 60,
      y: 650,
      size: 24,
    });
  for (let index = 0; index < pages; index++) {
    const page = doc.addPage([576, 720]);
    page.drawImage(image, { x: 0, y: 0, width: 576, height: 720 });
    if (rotation) page.setRotation(degrees(rotation));
    if (marks) {
      page.drawRectangle({
        x: 50,
        y: 80,
        width: 100,
        height: 30,
        color: rgb(0, 0.7, 0.7),
        opacity: 0.4,
      });
      // Synthetic signature strokes are visible graphics, never certificate signatures.
      for (let n = 0; n < 10; n++)
        page.drawLine({
          start: { x: 300 + n * 12, y: 80 + (n % 2) * 20 },
          end: { x: 312 + n * 12, y: 80 + ((n + 1) % 2) * 20 },
          thickness: 2,
          color: rgb(0.1, 0.2, 0.7),
        });
    }
  }
  if (blank) doc.addPage([576, 720]);
  return doc.save();
}
