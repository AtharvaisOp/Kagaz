import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
const require = createRequire(import.meta.url);
const lib = require('../apps/web/node_modules/pdf-lib');

export async function scanFixture({
  pages = 1,
  digital = false,
  form = false,
  unsafe = false,
  blank = false,
  quality = 'english',
} = {}) {
  const doc = await lib.PDFDocument.create();
  const image = await doc.embedPng(
    await readFile(
      new URL(
        `../apps/api/src/tools/fixtures/${quality}-scan.png`,
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
  for (let n = 0; n < pages; n++) {
    const page = doc.addPage([576, 720]);
    page.drawImage(image, { x: 0, y: 0, width: 576, height: 720 });
    if (form && n === 0) {
      const field = doc.getForm().createTextField('Name');
      field.setText('Original');
      if (unsafe) field.enablePassword();
      field.addToPage(page, { x: 40, y: 100, width: 220, height: 28 });
    }
  }
  if (blank) doc.addPage([576, 720]);
  return doc.save();
}

export async function inspectPdf(page, bytes) {
  const doc = await lib.PDFDocument.load(bytes, { throwOnInvalidObject: true });
  const report = await page.evaluate(async (base64) => {
    const pdfjs = await import('/node_modules/pdfjs-dist/build/pdf.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc =
      '/node_modules/pdfjs-dist/build/pdf.worker.mjs';
    const task = pdfjs.getDocument({
      data: Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)),
      useSystemFonts: true,
    });
    const pdf = await task.promise,
      result = [];
    try {
      for (let n = 1; n <= pdf.numPages; n++) {
        const p = await pdf.getPage(n),
          text = await p.getTextContent(),
          vp = p.getViewport({ scale: 1 });
        const canvas = document.createElement('canvas');
        canvas.width = vp.width;
        canvas.height = vp.height;
        await p.render({ canvasContext: canvas.getContext('2d'), viewport: vp })
          .promise;
        const pixels = canvas
          .getContext('2d')
          .getImageData(0, 0, canvas.width, canvas.height).data;
        const chunks = [];
        for (let offset = 0; offset < pixels.length; offset += 32768)
          chunks.push(
            String.fromCharCode(...pixels.subarray(offset, offset + 32768)),
          );
        result.push({
          text: text.items.map((t) => t.str ?? '').join(' '),
          width: vp.width,
          height: vp.height,
          // Binary transport avoids millions of individually serialized JS numbers.
          pixels: btoa(chunks.join('')),
        });
        p.cleanup();
      }
    } finally {
      await task.destroy();
    }
    return result;
  }, Buffer.from(bytes).toString('base64'));
  if (report.length !== doc.getPageCount())
    throw new Error('PDF.js/pdf-lib page count mismatch');
  return {
    pages: report.map((p) => ({
      ...p,
      pixels: Buffer.from(p.pixels, 'base64'),
    })),
    forms: doc.getForm().getFields().length,
  };
}
