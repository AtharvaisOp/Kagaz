import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

// Synthetic fixtures and all downloaded/decoded evidence stay outside the repo.
// The production app has no test hooks: a local installed PDF.js parser independently
// examines real downloads. Direct cases exercise the browser export boundary only.
const require = createRequire(import.meta.url);
const { chromium } = require(
  process.env.KAGAZ_PLAYWRIGHT_MODULE || 'playwright',
);
const lib = require('../apps/web/node_modules/pdf-lib');
assert(
  process.env.KAGAZ_ARTIFACT_DIR,
  'Set KAGAZ_ARTIFACT_DIR outside the repository.',
);
const artifactRoot = join(process.env.KAGAZ_ARTIFACT_DIR, 'phase5b');
await mkdir(artifactRoot, { recursive: true });
const appUrl = process.env.KAGAZ_APP_URL || 'http://127.0.0.1:5173';
const verifierUrl = process.env.KAGAZ_VERIFIER_URL || 'http://127.0.0.1:5173';
const production = process.argv.includes('--production');
const directOnly = process.argv.includes('--direct');
const uiOnly = process.argv.includes('--ui');
const imageNegativesOnly = process.argv.includes('--images');
const qpdf = process.env.KAGAZ_QPDF_PATH || process.env.QPDF_PATH || 'qpdf';
const qpdfProbe = spawnSync(qpdf, ['--version'], { encoding: 'utf8' });
const qpdfAvailable = qpdfProbe.status === 0;
if (process.env.KAGAZ_REQUIRE_QPDF === '1')
  assert(qpdfAvailable, 'qpdf is required.');
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.KAGAZ_CHROME_PATH,
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1100 },
  deviceScaleFactor: 2,
  acceptDownloads: true,
});
const errors = [],
  requests = [],
  results = [],
  measurements = [];
let completed = false;
let failure = null;
await context.addInitScript(() => {
  const create = URL.createObjectURL.bind(URL),
    revoke = URL.revokeObjectURL.bind(URL);
  const live = new Set();
  let created = 0,
    released = 0;
  URL.createObjectURL = (blob) => {
    const url = create(blob);
    if (blob.type.startsWith('image/')) {
      live.add(url);
      created++;
    }
    return url;
  };
  URL.revokeObjectURL = (url) => {
    if (live.delete(url)) released++;
    revoke(url);
  };
  globalThis.__phase5bImageUrls = () => ({
    live: live.size,
    created,
    released,
  });
});
context.on('page', (current) =>
  current.on('pageerror', (error) => errors.push(error.message)),
);
context.on('request', (request) => {
  if (request.method() !== 'GET')
    requests.push({ method: request.method(), url: request.url() });
});
const page = await context.newPage();
const verifier = await context.newPage();
page.setDefaultTimeout(20000);
page.on('dialog', (dialog) => dialog.accept());
await verifier.goto(verifierUrl);
const button = (name) => page.getByRole('button', { name, exact: true });
const digest = (bytes) =>
  createHash('sha256').update(Buffer.from(bytes)).digest('hex');
const secrets = [
  'SECRET-TEXT-ALPHA',
  'SECRET-FORM-ALPHA',
  'SECRET-ANNOTATION-ALPHA',
  'PRIVATE-IMAGE-MARKER',
];
const green = { r: 0.1, g: 0.7, b: 0.2 };
const watermarkText = 'WATERMARK-5B';
const baseWatermark = {
  id: 'watermark-5b',
  kind: 'text',
  text: watermarkText,
  fontSize: 40,
  color: green,
  opacity: 0.65,
  rotation: 0,
  scale: 1,
  position: 'center',
  customPosition: { x: 0.5, y: 0.5 },
  target: { kind: 'all' },
};
const coverText = { x: 40, y: 325, width: 230, height: 45 };
const coverImage = { x: 40, y: 70, width: 170, height: 90 };
const fullPage = { x: 0, y: 0, width: 500, height: 400 };

function pngChunk(type, payload) {
  const typeBytes = Buffer.from(type),
    body = Buffer.concat([typeBytes, Buffer.from(payload)]);
  let crc = 0xffffffff;
  for (const byte of body) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++)
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  const length = Buffer.alloc(4),
    checksum = Buffer.alloc(4);
  length.writeUInt32BE(payload.length);
  checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([length, body, checksum]);
}

function maliciousImageFixtures(png, jpeg) {
  const pngBytes = Buffer.from(png.bytes),
    header = Buffer.from(pngBytes.subarray(16, 29));
  header.writeUInt32BE(8193, 0);
  header.writeUInt32BE(8193, 4);
  const oversized = Buffer.concat([
    pngBytes.subarray(0, 8),
    pngChunk('IHDR', header),
    pngBytes.subarray(33),
  ]);
  const animation = Buffer.alloc(8);
  animation.writeUInt32BE(2, 0);
  const tiff = Buffer.alloc(26);
  tiff.writeUInt16LE(0x4949, 0);
  tiff.writeUInt16LE(42, 2);
  tiff.writeUInt32LE(8, 4);
  tiff.writeUInt16LE(1, 8);
  tiff.writeUInt16LE(0x0112, 10);
  tiff.writeUInt16LE(3, 12);
  tiff.writeUInt32LE(1, 14);
  tiff.writeUInt16LE(6, 18);
  const exif = Buffer.concat([Buffer.from('Exif\0\0'), tiff]);
  const segment = Buffer.alloc(4);
  segment[0] = 255;
  segment[1] = 225;
  segment.writeUInt16BE(exif.length + 2, 2);
  return [
    ['oversized-image', 'image/png', oversized],
    [
      'animated-image',
      'image/png',
      Buffer.concat([
        pngBytes.subarray(0, 33),
        pngChunk('acTL', animation),
        pngBytes.subarray(33),
      ]),
    ],
    [
      'duplicate-image-header',
      'image/png',
      Buffer.concat([
        pngBytes.subarray(0, 33),
        pngBytes.subarray(8, 33),
        pngBytes.subarray(33),
      ]),
    ],
    [
      'unterminated-image-metadata',
      'image/png',
      Buffer.concat([
        pngBytes.subarray(0, 33),
        pngChunk('iTXt', [65, 0, 0, 0, 0, 65]),
        pngBytes.subarray(33),
      ]),
    ],
    [
      'unsupported-image-orientation',
      'image/jpeg',
      Buffer.concat([
        Buffer.from(jpeg.bytes.slice(0, 2)),
        segment,
        exif,
        Buffer.from(jpeg.bytes.slice(2)),
      ]),
    ],
    [
      'malformed-image-deflate',
      'image/png',
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADklEQVR4nAQAAAAAAAAAAAAAANvPr/sAAAAASUVORK5CYII=',
        'base64',
      ),
    ],
  ].map(([name, mimeType, bytes]) => ({
    name,
    mimeType,
    bytes: Array.from(bytes),
  }));
}

async function imageFixture(
  name,
  mimeType = 'image/png',
  transparent = true,
  { width = 160, height = 80 } = {},
) {
  const bytes = await verifier.evaluate(
    ({ mimeType, transparent, width, height }) => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.scale(width / 160, height / 80);
      if (!transparent || mimeType === 'image/jpeg') {
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, 160, 80);
      }
      ctx.fillStyle = 'rgb(26,179,51)';
      ctx.fillRect(0, 0, 160, 12);
      ctx.fillRect(0, 68, 160, 12);
      ctx.fillRect(0, 0, 12, 80);
      ctx.fillRect(148, 0, 12, 80);
      ctx.fillRect(72, 0, 16, 80);
      return Array.from(
        Uint8Array.from(
          atob(canvas.toDataURL(mimeType, 0.95).split(',')[1]),
          (c) => c.charCodeAt(0),
        ),
      );
    },
    { mimeType, transparent, width, height },
  );
  const file = join(
    artifactRoot,
    `${name}.${mimeType === 'image/png' ? 'png' : 'jpg'}`,
  );
  await writeFile(file, new Uint8Array(bytes));
  return { file, bytes, mimeType, width, height };
}

async function fixture(
  name,
  {
    count = 1,
    rotation = 0,
    crop = false,
    userUnit = 1,
    forms = false,
    sharedImage = false,
    publicOnly = false,
  } = {},
) {
  const doc = await lib.PDFDocument.create();
  doc.setCreationDate(new Date('2020-01-01T00:00:00Z'));
  doc.setModificationDate(new Date('2020-01-01T00:00:00Z'));
  doc.setTitle(publicOnly ? 'Public synthetic fixture' : 'SECRET-TEXT-ALPHA');
  const sourceImageBytes = await verifier.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 300;
    canvas.height = 140;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#1464dc';
    ctx.fillRect(0, 0, 300, 140);
    ctx.fillStyle = '#f62a59';
    ctx.fillRect(0, 0, 100, 140);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 18px Arial';
    ctx.fillText('PRIVATE-IMAGE-MARKER', 12, 70);
    return Array.from(
      Uint8Array.from(atob(canvas.toDataURL('image/png').split(',')[1]), (c) =>
        c.charCodeAt(0),
      ),
    );
  });
  const sourceImage = await doc.embedPng(new Uint8Array(sourceImageBytes));
  const publicFont = await doc.embedFont(lib.StandardFonts.TimesRoman);
  const first = doc.addPage([500, 400]);
  first.setRotation(lib.degrees(rotation));
  if (crop) {
    first.setMediaBox(-20, -30, 550, 460);
    first.setCropBox(20, 30, 440, 340);
  }
  if (userUnit !== 1)
    first.node.set(lib.PDFName.of('UserUnit'), lib.PDFNumber.of(userUnit));
  if (publicOnly)
    first.drawText('PUBLIC PAGE 1', {
      x: 50,
      y: 340,
      size: 18,
      font: publicFont,
    });
  else {
    first.drawText('SECRET-TEXT-ALPHA', { x: 50, y: 340, size: 18 });
    first.drawText('PUBLIC VISIBLE TEXT', { x: 280, y: 340, size: 14 });
    first.drawImage(sourceImage, { x: 50, y: 80, width: 150, height: 70 });
    first.drawRectangle({
      x: 320,
      y: 80,
      width: 80,
      height: 60,
      color: lib.rgb(0.9, 0.1, 0.2),
    });
    first.node.addAnnot(
      doc.context.register(
        doc.context.obj({
          Type: 'Annot',
          Subtype: 'Text',
          Rect: [50, 340, 70, 360],
          Contents: lib.PDFString.of('SECRET-TEXT-ALPHA'),
          F: 2,
        }),
      ),
    );
  }
  for (let index = 1; index < count; index++) {
    const next = doc.addPage([500, 400]);
    next.drawText(`PUBLIC PAGE ${index + 1}`, {
      x: 50,
      y: 340,
      size: 18,
      font: publicFont,
    });
    if (sharedImage)
      next.drawImage(sourceImage, { x: 50, y: 80, width: 150, height: 70 });
  }
  if (forms) {
    const field = doc.getForm().createTextField('private');
    field.setText('SECRET-FORM-ALPHA');
    field.addToPage(first, { x: 40, y: 250, width: 250, height: 30 });
  }
  const bytes = Array.from(await doc.save({ useObjectStreams: false }));
  const file = join(artifactRoot, `${name}-source.pdf`);
  await writeFile(file, new Uint8Array(bytes));
  return {
    file,
    bytes,
    count,
    sourceImageBytes,
    rotation,
    formFields: forms
      ? [
          {
            name: 'private',
            kind: 'text',
            value: 'SECRET-FORM-ALPHA',
            changed: false,
            readOnly: false,
            options: [],
            multiSelect: false,
          },
        ]
      : [],
  };
}

async function fresh(files) {
  await page.bringToFront();
  await page.goto(appUrl);
  await page
    .locator('input[type=file][accept="application/pdf,.pdf"]')
    .setInputFiles(
      (Array.isArray(files) ? files : [files]).map(
        (current) => current.file || current,
      ),
    );
  await page.locator('.pdf-canvas[data-ready=true]').first().waitFor();
  await button('Download PDF').waitFor();
  await page.waitForFunction(
    () => !document.body.innerText.includes('Checking this PDF'),
  );
}

async function download(name, control = button('Download PDF')) {
  const beforeHeap = await page.evaluate(
    () => globalThis.performance.memory?.usedJSHeapSize ?? null,
  );
  const start = Date.now();
  const event = page.waitForEvent('download');
  await control.click();
  const artifact = await event;
  const file = join(artifactRoot, `${name}.pdf`);
  await artifact.saveAs(file);
  const bytes = new Uint8Array(await readFile(file));
  measurements.push({
    name,
    exportAndDownloadMs: Date.now() - start,
    outputBytes: bytes.length,
    beforeHeap,
    afterHeap: await page.evaluate(
      () => globalThis.performance.memory?.usedJSHeapSize ?? null,
    ),
    memoryNote:
      'Transient JS heap estimate; excludes canvas, worker and native allocations.',
  });
  return { bytes, file };
}

function embeddedImages(doc, index) {
  const resources = doc.getPage(index).node.Resources();
  const xobjects = resources?.lookupMaybe(
    lib.PDFName.of('XObject'),
    lib.PDFDict,
  );
  return (xobjects?.values() || [])
    .map((ref) => doc.context.lookup(ref))
    .filter(
      (object) =>
        object instanceof lib.PDFRawStream &&
        object.dict.get(lib.PDFName.of('Subtype'))?.toString() === '/Image',
    );
}

function decodedObjectStrings(doc) {
  const strings = [],
    pending = doc.context
      .enumerateIndirectObjects()
      .map(([, object]) => object),
    visited = new Set();
  while (pending.length) {
    const object = doc.context.lookup(pending.pop());
    if (!object || visited.has(object)) continue;
    visited.add(object);
    strings.push(object.toString());
    if (
      object instanceof lib.PDFString ||
      object instanceof lib.PDFHexString ||
      object instanceof lib.PDFName
    )
      strings.push(object.decodeText());
    if (object instanceof lib.PDFDict)
      pending.push(...object.keys(), ...object.values());
    else if (object instanceof lib.PDFArray) pending.push(...object.asArray());
    else if (object instanceof lib.PDFRawStream) {
      pending.push(object.dict);
      // JPEGs are inspected through PDF.js render; their DCT samples are not
      // conflated with decodable raw RGB streams in this supplemental search.
      if (
        !object.dict
          .get(lib.PDFName.of('Filter'))
          ?.toString()
          .includes('DCTDecode')
      )
        strings.push(
          Buffer.from(lib.decodePDFRawStream(object).decode()).toString(
            'latin1',
          ),
        );
    }
  }
  return strings;
}

async function inspect(
  name,
  output,
  {
    watermark = baseWatermark,
    targeted = null,
    affected = [],
    forbidden = [],
    rotations = null,
    regionBoxes = new Map(),
    greenExpected = true,
    pageCount = null,
    opacity = null,
    imageAspect = null,
    preservePublic = true,
    snapshot = false,
  } = {},
) {
  await verifier.bringToFront();
  const doc = await lib.PDFDocument.load(output.bytes, {
    throwOnInvalidObject: true,
  });
  assert.equal(
    doc.getForm().getFields().length,
    0,
    `${name}: interactive forms retained`,
  );
  if (pageCount !== null) assert.equal(doc.getPageCount(), pageCount);
  const pageObjects = doc.context
    .enumerateIndirectObjects()
    .filter(
      ([, object]) =>
        object instanceof lib.PDFDict &&
        object.get(lib.PDFName.of('Type'))?.toString() === '/Page',
    );
  assert.equal(
    pageObjects.length,
    doc.getPageCount(),
    `${name}: orphan donor page`,
  );
  const objectStrings = decodedObjectStrings(doc);
  const raw = Buffer.from(output.bytes).toString('latin1');
  for (const marker of forbidden) {
    const hex = Buffer.from(marker).toString('hex').toUpperCase();
    assert(!raw.includes(marker), `${name}: raw secret retained`);
    assert(
      !objectStrings.some(
        (text) => text.includes(marker) || text.toUpperCase().includes(hex),
      ),
      `${name}: decoded secret retained`,
    );
  }
  const embedded = [];
  for (const index of affected) {
    const current = doc.getPage(index);
    assert.equal(current.node.Annots()?.size() ?? 0, 0);
    assert.equal(
      current.node
        .Resources()
        .lookupMaybe(lib.PDFName.of('Font'), lib.PDFDict)
        ?.keys().length ?? 0,
      0,
      `${name}: source/new PDF text on rasterized page`,
    );
    const images = embeddedImages(doc, index);
    assert.equal(
      images.length,
      1,
      `${name}: extra image representation on reconstructed page`,
    );
    const image = images[0];
    assert(
      !image.dict.has(lib.PDFName.of('SMask')),
      `${name}: alternate alpha image`,
    );
    assert.equal(
      image.dict.get(lib.PDFName.of('ColorSpace')).toString(),
      '/DeviceRGB',
    );
    const width = image.dict.get(lib.PDFName.of('Width')).asNumber(),
      height = image.dict.get(lib.PDFName.of('Height')).asNumber();
    const pixels = lib.decodePDFRawStream(image).decode();
    assert.equal(pixels.length, width * height * 3);
    const crop = current.getCropBox();
    let greenPixels = 0,
      changedCoveredPixels = 0;
    for (let offset = 0; offset < pixels.length; offset += 3) {
      if (
        pixels[offset + 1] > pixels[offset] + 12 &&
        pixels[offset + 1] > pixels[offset + 2] + 12
      )
        greenPixels++;
    }
    for (const box of regionBoxes.get(index) || []) {
      const x0 = Math.max(
        0,
        Math.ceil(((box.x - crop.x) * width) / crop.width),
      );
      const x1 = Math.min(
        width,
        Math.floor(((box.x + box.width - crop.x) * width) / crop.width),
      );
      const y0 = Math.max(
        0,
        Math.ceil(
          ((crop.y + crop.height - box.y - box.height) * height) / crop.height,
        ),
      );
      const y1 = Math.min(
        height,
        Math.floor(((crop.y + crop.height - box.y) * height) / crop.height),
      );
      for (let y = y0; y < y1; y++)
        for (let x = x0; x < x1; x++) {
          const offset = (y * width + x) * 3;
          const [r, g, b] = pixels.subarray(offset, offset + 3);
          // Foreground watermarks may paint above the sanitized black appearance.
          // Any nonblack sample there must be the deliberately added green mark,
          // never the original blue/red image or source glyph. Allow antialiasing.
          if (r > 4 || g > 4 || b > 4) {
            assert(
              g >= r && g >= b,
              `${name}: original color underneath watermark at ${x},${y}`,
            );
            changedCoveredPixels++;
          }
        }
    }
    if (greenExpected && watermark && watermark.opacity > 0)
      assert(
        greenPixels > 20,
        `${name}: watermark absent from actual embedded raster`,
      );
    embedded.push({
      page: index + 1,
      width,
      height,
      decodedBytes: pixels.length,
      greenPixels,
      changedCoveredPixels,
      rasterHash: digest(pixels),
    });
  }
  const pages = await verifier.evaluate(
    async ({
      bytes,
      targeted,
      affected,
      watermark,
      greenExpected,
      snapshot,
    }) => {
      const pdfjs = await import('/node_modules/pdfjs-dist/build/pdf.mjs');
      pdfjs.GlobalWorkerOptions.workerSrc =
        '/node_modules/pdfjs-dist/build/pdf.worker.mjs';
      const task = pdfjs.getDocument({
        data: new Uint8Array(bytes),
        useSystemFonts: true,
      });
      const pdf = await task.promise,
        reports = [];
      window.document.body.replaceChildren();
      window.document.body.style.cssText =
        'background:#ddd;padding:24px;display:flex;flex-wrap:wrap;gap:20px;align-items:flex-start';
      try {
        for (let index = 0; index < pdf.numPages; index++) {
          const current = await pdf.getPage(index + 1),
            viewport = current.getViewport({ scale: 1 });
          const items = (await current.getTextContent()).items;
          const operators = await current.getOperatorList();
          const text = items.map((item) => item.str || '').join(' ');
          const selected = targeted === null || targeted.includes(index);
          const canvas = window.document.createElement('canvas');
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          const ctx = canvas.getContext('2d', { alpha: true });
          await current.render({ canvas, canvasContext: ctx, viewport })
            .promise;
          const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
          const coloredRows = new Map();
          let minX = canvas.width,
            minY = canvas.height,
            maxX = -1,
            maxY = -1,
            count = 0,
            minimumRed = 255,
            greenAtMinimumRed = 255,
            blueAtMinimumRed = 255;
          for (let y = 0; y < canvas.height; y++)
            for (let x = 0; x < canvas.width; x++) {
              const offset = (y * canvas.width + x) * 4,
                r = data[offset],
                g = data[offset + 1],
                b = data[offset + 2];
              const matchesWhiteBlend =
                Math.abs(g - (170 + r / 3)) <= 8 &&
                Math.abs(b - (255 / 9 + (r * 8) / 9)) <= 8;
              const matchesBlackBlend =
                Math.abs(g - r * 7) <= 8 && Math.abs(b - r * 2) <= 8;
              if (
                g > r + 12 &&
                g > b + 12 &&
                r < 245 &&
                (matchesWhiteBlend ||
                  (affected.includes(index) && matchesBlackBlend))
              ) {
                count++;
                const row = coloredRows.get(y) || [];
                row.push(x);
                coloredRows.set(y, row);
                if (r < minimumRed) {
                  minimumRed = r;
                  greenAtMinimumRed = g;
                  blueAtMinimumRed = b;
                }
              }
            }
          // Canvas font antialiasing can leave isolated colored fringe samples
          // on black source text. Require a meaningful same-color row footprint
          // rather than treating one fringe sample as the watermark's whole box.
          const maximumRow = Math.max(
            0,
            ...Array.from(coloredRows.values(), (row) => row.length),
          );
          for (const [y, xs] of coloredRows)
            if (xs.length >= Math.max(3, maximumRow * 0.1)) {
              minX = Math.min(minX, ...xs);
              maxX = Math.max(maxX, ...xs);
              minY = Math.min(minY, y);
              maxY = Math.max(maxY, y);
            }
          if (snapshot && index < 3) {
            const preview = window.document.createElement('img');
            preview.src = canvas.toDataURL('image/png');
            preview.style.maxWidth = '500px';
            window.document.body.append(preview);
          }
          const textOps = operators.fnArray.filter((op) =>
            [
              pdfjs.OPS.showText,
              pdfjs.OPS.showSpacedText,
              pdfjs.OPS.nextLineShowText,
              pdfjs.OPS.nextLineSetSpacingShowText,
            ].includes(op),
          ).length;
          reports.push({
            page: index + 1,
            text,
            rotation: current.rotate,
            width: canvas.width,
            height: canvas.height,
            textOperators: textOps,
            annotations: (await current.getAnnotations()).length,
            greenPixels: count,
            greenBounds: count
              ? {
                  x: minX,
                  y: minY,
                  width: maxX - minX + 1,
                  height: maxY - minY + 1,
                  centerX: (minX + maxX + 1) / 2,
                  centerY: (minY + maxY + 1) / 2,
                }
              : null,
            minimumColor: [minimumRed, greenAtMinimumRed, blueAtMinimumRed],
            watermarkTextItems: items
              .filter((item) =>
                item.str?.includes(watermark?.text || 'WATERMARK-5B'),
              )
              .map((item) => ({
                str: item.str,
                transform: item.transform,
                width: item.width,
                height: item.height,
              })),
            selected,
            affected: affected.includes(index),
          });
          canvas.width = 0;
          canvas.height = 0;
          current.cleanup();
        }
      } finally {
        await task.destroy();
      }
      return reports;
    },
    {
      bytes: Array.from(output.bytes),
      targeted,
      affected,
      watermark,
      greenExpected,
      snapshot,
    },
  );
  if (snapshot)
    await verifier.screenshot({
      path: join(artifactRoot, `${name}-render.png`),
      fullPage: true,
    });
  if (rotations)
    assert.deepEqual(
      pages.map((current) => current.rotation),
      rotations,
    );
  for (const current of pages) {
    for (const marker of forbidden)
      assert(!current.text.includes(marker), `${name}: extractable secret`);
    if (current.affected) {
      assert.equal(current.text, '');
      assert.equal(current.textOperators, 0);
      assert.equal(current.annotations, 0);
    } else if (preservePublic)
      assert(
        current.text.includes('PUBLIC'),
        `${name}: ordinary source text lost`,
      );
    if (watermark?.kind === 'text' && current.selected && !current.affected)
      assert(
        current.text
          .replace(/\s+/g, ' ')
          .includes(watermark.text.trim().replace(/\s+/g, ' ')),
        `${name}: missing watermark text`,
      );
    if (watermark?.kind === 'text' && !current.selected)
      assert(
        !current.text.includes(watermark.text),
        `${name}: watermark on untargeted page`,
      );
    if (greenExpected) {
      if (watermark && current.selected && watermark.opacity > 0)
        assert(current.greenPixels > 3, `${name}: rendered watermark absent`);
      else
        assert.equal(
          current.greenPixels,
          0,
          `${name}: mark on untargeted/unmarked page`,
        );
    }
    if (opacity !== null && current.selected && !current.affected) {
      const expected = [green.r, green.g, green.b].map((channel) =>
        Math.round(255 * (1 - opacity) + channel * 255 * opacity),
      );
      current.minimumColor.forEach((channel, index) =>
        assert(
          Math.abs(channel - expected[index]) <= 8,
          `${name}: opacity mismatch ${current.minimumColor} expected ${expected}`,
        ),
      );
    }
    if (imageAspect && current.selected)
      assert(
        Math.abs(
          current.greenBounds.width / current.greenBounds.height - imageAspect,
        ) < 0.08,
        `${name}: image stretched`,
      );
    if (current.selected && current.greenBounds) {
      assert(
        current.greenBounds.x >= 0 &&
          current.greenBounds.y >= 0 &&
          current.greenBounds.x + current.greenBounds.width <= current.width &&
          current.greenBounds.y + current.greenBounds.height <= current.height,
        `${name}: watermark clipped outside page`,
      );
      if (watermark?.opacity > 0) {
        const tolerance = 2;
        assert(
          current.greenBounds.x >= current.width * 0.05 - tolerance &&
            current.greenBounds.y >= current.height * 0.05 - tolerance &&
            current.greenBounds.x + current.greenBounds.width <=
              current.width * 0.95 + tolerance &&
            current.greenBounds.y + current.greenBounds.height <=
              current.height * 0.95 + tolerance,
          `${name}: visible ink escaped intended 5% margins ${JSON.stringify(current.greenBounds)}`,
        );
      }
      if (watermark?.position === 'center')
        assert(
          Math.abs(current.greenBounds.centerX - current.width / 2) <= 12 &&
            Math.abs(current.greenBounds.centerY - current.height / 2) <= 12,
          `${name}: watermark not centered ${JSON.stringify(current.greenBounds)}`,
        );
      if (watermark?.position === 'top-left')
        assert(
          current.greenBounds.centerX <= current.width / 2 + 2 &&
            current.greenBounds.centerY <= current.height / 2 + 2,
        );
      if (watermark?.position === 'top-right')
        assert(
          current.greenBounds.centerX >= current.width / 2 - 2 &&
            current.greenBounds.centerY <= current.height / 2 + 2,
        );
      if (watermark?.position === 'bottom-left')
        assert(
          current.greenBounds.centerX <= current.width / 2 + 2 &&
            current.greenBounds.centerY >= current.height / 2 - 2,
        );
      if (watermark?.position === 'bottom-right')
        assert(
          current.greenBounds.centerX >= current.width / 2 - 2 &&
            current.greenBounds.centerY >= current.height / 2 - 2,
        );
    }
  }
  if (qpdfAvailable) {
    const checked = spawnSync(qpdf, ['--check', output.file], {
      encoding: 'utf8',
    });
    assert.equal(
      checked.status,
      0,
      `${name}: qpdf structure failure ${checked.stdout} ${checked.stderr}`,
    );
    const qdfFile = join(artifactRoot, `${name}-qdf.pdf`);
    const decoded = spawnSync(
      qpdf,
      [
        '--qdf',
        '--object-streams=disable',
        '--stream-data=uncompress',
        output.file,
        qdfFile,
      ],
      { encoding: 'utf8' },
    );
    assert.equal(decoded.status, 0);
    const qdfText = (await readFile(qdfFile)).toString('latin1');
    for (const marker of forbidden)
      assert(!qdfText.includes(marker), `${name}: qpdf retained secret`);
  }
  if (snapshot)
    await verifier.screenshot({
      path: join(artifactRoot, `${name}-render.png`),
      fullPage: true,
    });
  const row = {
    name,
    pages,
    embedded,
    outputBytes: output.bytes.length,
    qpdf: qpdfAvailable ? 'PASS' : 'unavailable',
  };
  results.push(row);
  console.log(JSON.stringify(row));
  await page.bringToFront();
  return { doc, pages, embedded };
}

async function directExport(
  source,
  name,
  {
    watermark = baseWatermark,
    asset = null,
    redactions = [],
    rotationDelta = 0,
    order = null,
    annotations = [],
    assetAnnotations = false,
    abort = false,
    abortBuilding = false,
    failure = false,
    expectedError = null,
    mutateSnapshot = false,
  } = {},
) {
  // Native decode/Canvas work in a background Chrome tab is timer-throttled.
  // Keep the actual export foregrounded for representative performance data.
  await verifier.bringToFront();
  const result = await verifier.evaluate(
    async ({
      data,
      count,
      name,
      watermark,
      asset,
      redactions,
      rotationDelta,
      order,
      annotations,
      assetAnnotations,
      sourceImageBytes,
      abort,
      abortBuilding,
      failure,
      mutateSnapshot,
      formFields,
    }) => {
      const { exportWorkspace } =
        await import('/src/lib/pdf-export/exportWorkspace.ts');
      const file = new File([new Uint8Array(data)], `${name}.pdf`, {
        type: 'application/pdf',
      });
      const logical = Array.from({ length: count }, (_, index) => ({
        id: `page-${index}`,
        sourceDocumentId: 'source',
        sourcePageIndex: index,
        rotationDelta,
      }));
      const pages = order ? order.map((index) => logical[index]) : logical;
      const imageAssets = new Map();
      if (asset)
        imageAssets.set('watermark-asset', {
          assetId: 'watermark-asset',
          mimeType: asset.mimeType,
          bytes: new Uint8Array(asset.bytes),
        });
      if (assetAnnotations)
        imageAssets.set('annotation-asset', {
          assetId: 'annotation-asset',
          mimeType: 'image/png',
          bytes: new Uint8Array(sourceImageBytes),
        });
      const signal = new AbortController();
      if (abort) signal.abort();
      const originalGetContext = HTMLCanvasElement.prototype.getContext;
      if (failure) HTMLCanvasElement.prototype.getContext = () => null;
      const start = window.performance.now();
      let pulses = 0;
      const timer = setInterval(() => {
        pulses++;
      }, 16);
      try {
        const request = {
          pages,
          sources: new Map([
            ['source', { id: 'source', file, fileName: `${name}.pdf` }],
          ]),
          annotationsByPage: new Map([['page-0', annotations]]),
          imageAssets,
          forms: {
            hasChangedTextDraft: false,
            sources: [
              {
                sourceDocumentId: 'source',
                capability: formFields.length ? 'safe-acroform' : 'plain',
                fields: formFields,
              },
            ],
          },
          redactionsByPage: new Map(
            redactions.map(({ pageIndex, boxes }) => [
              `page-${pageIndex}`,
              boxes.map((box, index) => ({
                id: `redaction-${pageIndex}-${index}`,
                pageId: `page-${pageIndex}`,
                box,
              })),
            ]),
          ),
          watermark,
        };
        const promise = exportWorkspace(request, {
          signal: signal.signal,
          onProgress: (progress) => {
            if (abortBuilding && progress.phase === 'building') signal.abort();
          },
        });
        if (mutateSnapshot) {
          watermark.text = 'LATER-MUTATION';
          watermark.opacity = 0.01;
          if (watermark.target.kind === 'pages')
            watermark.target.pageIds.splice(0);
          imageAssets.get('watermark-asset')?.bytes.fill(0);
        }
        const bytes = await promise;
        return {
          bytes: Array.from(bytes),
          exportMs: window.performance.now() - start,
          responsivenessPulses: pulses,
          beforeHeap: null,
          afterHeap: globalThis.performance.memory?.usedJSHeapSize ?? null,
        };
      } catch (error) {
        return {
          error: error.code,
          message: error.message,
          exportMs: window.performance.now() - start,
        };
      } finally {
        clearInterval(timer);
        HTMLCanvasElement.prototype.getContext = originalGetContext;
      }
    },
    {
      data: source.bytes,
      count: source.count,
      sourceImageBytes: source.sourceImageBytes,
      name,
      watermark,
      asset,
      redactions,
      rotationDelta,
      order,
      annotations,
      assetAnnotations,
      abort,
      abortBuilding,
      failure,
      mutateSnapshot,
      formFields: source.formFields,
    },
  );
  if (expectedError) {
    assert(result.error, `${name}: unsafe operation succeeded`);
    if (Array.isArray(expectedError))
      assert(
        expectedError.includes(result.error),
        `${name}: unexpected ${result.error}`,
      );
    else if (expectedError !== true)
      assert.equal(result.error, expectedError, `${name}: ${result.message}`);
    if (name === 'malformed-image-deflate')
      assert(
        result.exportMs < 5000,
        `${name}: malformed compressed data stalled the browser`,
      );
    const row = { name, rejected: result.error, elapsedMs: result.exportMs };
    results.push(row);
    console.log(JSON.stringify(row));
    return null;
  }
  assert(!result.error, `${name}: ${result.error}: ${result.message}`);
  const bytes = new Uint8Array(result.bytes),
    file = join(artifactRoot, `${name}.pdf`);
  await writeFile(file, bytes);
  measurements.push({
    name,
    inputBytes: source.bytes.length,
    outputBytes: bytes.length,
    exportMs: result.exportMs,
    responsivenessPulses: result.responsivenessPulses,
    afterHeap: result.afterHeap,
    memoryNote:
      'Transient JS heap estimate; excludes canvas, worker and native allocations.',
  });
  return { file, bytes };
}

const watermarkDialog = () =>
  page.getByRole('dialog', { name: 'Watermark', exact: true });
async function slider(label, value) {
  const control = page.getByLabel(label, { exact: true });
  await control.focus();
  await control.press('Home');
  const minimum = Number((await control.getAttribute('min')) || 0);
  for (let index = minimum; index < value; index++)
    await control.press('ArrowRight');
}
async function configureWatermark({
  kind = 'text',
  text = watermarkText,
  fontSize = 40,
  opacity = 65,
  scale = 100,
  rotation = 0,
  position = 'center',
  customPosition = null,
  scope = 'all',
  ranges = null,
  selected = null,
  image = null,
} = {}) {
  await button('Watermark').click();
  await watermarkDialog().waitFor();
  await watermarkDialog()
    .getByRole('radio', {
      name: kind === 'text' ? 'Text' : 'Image',
      exact: true,
    })
    .check();
  if (kind === 'text') {
    await page.getByLabel('Watermark text', { exact: true }).fill(text);
    await page
      .getByLabel('Watermark font size', { exact: true })
      .fill(String(fontSize));
    await page
      .getByLabel('Watermark text color', { exact: true })
      .fill('#1ab333');
  } else {
    if (image)
      await page
        .getByLabel('Choose watermark image', { exact: true })
        .setInputFiles(image.file || image);
    await page.waitForFunction(
      () => !document.body.innerText.includes('Preparing…'),
    );
  }
  await slider('Watermark opacity', opacity);
  await slider('Watermark size', scale);
  await page
    .getByLabel('Watermark rotation', { exact: true })
    .fill(String(rotation));
  await page
    .getByLabel('Watermark position', { exact: true })
    .selectOption(position);
  if (customPosition) {
    await page
      .getByLabel('Watermark custom X', { exact: true })
      .fill(String(customPosition.x * 100));
    await page
      .getByLabel('Watermark custom Y', { exact: true })
      .fill(String(customPosition.y * 100));
  }
  await page
    .getByLabel('Watermark page scope', { exact: true })
    .selectOption(scope);
  if (ranges !== null)
    await page
      .getByLabel('Watermark page ranges', { exact: true })
      .fill(ranges);
  if (selected) {
    for (
      let index = 0;
      index <
      (await page
        .getByRole('checkbox', { name: /^Watermark page \d+$/ })
        .count());
      index++
    ) {
      const checkbox = page.getByRole('checkbox', {
        name: `Watermark page ${index + 1}`,
        exact: true,
      });
      await checkbox.setChecked(selected.includes(index));
    }
  }
}
async function applyWatermark() {
  const apply = watermarkDialog().getByRole('button', {
    name: 'Apply watermark',
    exact: true,
  });
  await apply.waitFor();
  await page.waitForFunction(() => {
    const button = Array.from(document.querySelectorAll('dialog button')).find(
      (current) => current.textContent.trim() === 'Apply watermark',
    );
    return button && !button.disabled;
  });
  await apply.click();
  await watermarkDialog().waitFor({ state: 'detached' });
}
async function previewFootprint(
  selector = '.watermark-page-preview .watermark-canvas',
) {
  const canvas = page.locator(`${selector}[data-watermark-ready=true]`).first();
  await canvas.waitFor();
  return canvas.evaluate((current) => {
    const data = current
      .getContext('2d')
      .getImageData(0, 0, current.width, current.height).data;
    let left = current.width,
      top = current.height,
      right = 0,
      bottom = 0,
      samples = 0,
      maximumAlpha = 0;
    for (let y = 0; y < current.height; y++)
      for (let x = 0; x < current.width; x++) {
        const offset = (y * current.width + x) * 4;
        if (
          data[offset + 3] > 10 &&
          data[offset + 1] > data[offset] + 12 &&
          data[offset + 1] > data[offset + 2] + 12
        ) {
          samples++;
          left = Math.min(left, x);
          right = Math.max(right, x);
          top = Math.min(top, y);
          bottom = Math.max(bottom, y);
          maximumAlpha = Math.max(maximumAlpha, data[offset + 3]);
        }
      }
    const css = current.getBoundingClientRect();
    return {
      samples,
      maximumAlpha,
      width: current.width,
      height: current.height,
      centerX: (left + right + 1) / (2 * current.width),
      centerY: (top + bottom + 1) / (2 * current.height),
      inkWidth: (right - left + 1) / current.width,
      inkHeight: (bottom - top + 1) / current.height,
      cssAspect: css.width / css.height,
      backingAspect: current.width / current.height,
    };
  });
}
function comparePreview(preview, actual, name) {
  assert(preview.samples > 20, `${name}: actual preview mark absent`);
  assert(
    Math.abs(preview.cssAspect - preview.backingAspect) <= 0.025,
    `${name}: preview distorted by CSS`,
  );
  const normalized = {
    centerX: actual.greenBounds.centerX / actual.width,
    centerY: actual.greenBounds.centerY / actual.height,
    inkWidth: actual.greenBounds.width / actual.width,
    inkHeight: actual.greenBounds.height / actual.height,
  };
  for (const key of Object.keys(normalized))
    assert(
      Math.abs(preview[key] - normalized[key]) <= 0.025,
      `${name}: ${key} preview ${preview[key]} differs from independently rendered export ${normalized[key]}`,
    );
  results.push({
    name: `${name}-preview-proof`,
    preview,
    normalizedExport: normalized,
    tolerance: '2.5% of page extent (antialiasing/preview sampling).',
  });
}
async function addRedaction(box) {
  await button('Redact').click();
  await button('Add redaction region').click();
  for (const [label, value] of [
    ['Redaction X', box.x],
    ['Redaction Y', box.y],
    ['Redaction width', box.width],
    ['Redaction height', box.height],
  ])
    await page.getByLabel(label, { exact: true }).fill(String(value));
  await button('Apply redaction geometry').click();
}
async function holdNextImageRead() {
  await page.evaluate(() => {
    const original = Blob.prototype.arrayBuffer;
    let captured = false;
    Blob.prototype.arrayBuffer = async function () {
      if (!captured && this.type.startsWith('image/')) {
        captured = true;
        globalThis.__phase5bImageReadPaused = true;
        await new Promise((resolve) => {
          globalThis.__phase5bResumeImageRead = resolve;
        });
      }
      return original.call(this);
    };
    globalThis.__phase5bRestoreImageRead = () => {
      Blob.prototype.arrayBuffer = original;
    };
  });
}

async function verifyInvalidImageUi(malicious) {
  const rejectionStarted = Date.now();
  const file = join(
    artifactRoot,
    `${malicious.name}.${malicious.mimeType === 'image/png' ? 'png' : 'jpg'}`,
  );
  await writeFile(file, new Uint8Array(malicious.bytes));
  await button('Watermark').click();
  await watermarkDialog()
    .getByRole('radio', { name: 'Image', exact: true })
    .check();
  await page
    .getByLabel('Choose watermark image', { exact: true })
    .setInputFiles(file);
  // Observe the actual import failure before changing draft controls, which
  // deliberately clears the controller error. The empty-image model alert is
  // present before an import starts and cannot prove that decoding rejected it.
  await page.waitForFunction(() => {
    const dialog = document.querySelector('.watermark-form')?.closest('dialog');
    const alert = dialog?.querySelector('[role=alert]')?.textContent?.trim();
    return (
      alert &&
      alert !== 'Choose a PNG or JPEG watermark image.' &&
      !dialog.textContent.includes('Preparing…')
    );
  });
  const alert = (
    await watermarkDialog().getByRole('alert').allTextContents()
  ).join(' ');
  if (malicious.name === 'malformed-image-deflate')
    assert(
      alert.includes('invalid compressed pixel data'),
      `${malicious.name}: specific decoder error missing`,
    );
  assert(
    await watermarkDialog()
      .getByRole('button', { name: 'Apply watermark', exact: true })
      .isDisabled(),
    `${malicious.name}: invalid UI image could be applied`,
  );
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.watermark-summary').count(), 0);
  const row = {
    name: `ui-${malicious.name}`,
    rejected: true,
    alert,
    rejectionMs: Date.now() - rejectionStarted,
    workspacePreserved: true,
  };
  results.push(row);
  console.log(JSON.stringify(row));
}

try {
  const png = await imageFixture('watermark-transparent');
  const jpeg = await imageFixture('watermark-jpeg', 'image/jpeg', false);
  const largePng = await imageFixture(
    'watermark-large-preview',
    'image/png',
    true,
    {
      width: 3072,
      height: 1536,
    },
  );
  const plain = await fixture('plain');
  const ten = await fixture('ten', { count: 10 });
  const hundred = await fixture('hundred', { count: 100, publicOnly: true });
  const form = await fixture('form', { forms: true });
  const publicSource = await fixture('public', { publicOnly: true });
  const imageWatermark = {
    ...baseWatermark,
    kind: 'image',
    assetId: 'watermark-asset',
    scale: 0.45,
  };
  if (imageNegativesOnly) {
    await fresh(publicSource);
    for (const malicious of maliciousImageFixtures(png, jpeg))
      await verifyInvalidImageUi(malicious);
    assert(
      await button('Undo').isDisabled(),
      'Rejected images created hidden history.',
    );
    for (const malicious of maliciousImageFixtures(png, jpeg))
      await directExport(publicSource, malicious.name, {
        watermark: imageWatermark,
        asset: malicious,
        expectedError: 'watermark-image-invalid',
      });
  }
  if (!imageNegativesOnly) {
    // Independently establish the starting secret and original colored samples.
    const sourceProof = await verifier.evaluate(async (bytes) => {
      const pdfjs = await import('/node_modules/pdfjs-dist/build/pdf.mjs');
      pdfjs.GlobalWorkerOptions.workerSrc =
        '/node_modules/pdfjs-dist/build/pdf.worker.mjs';
      const task = pdfjs.getDocument({
        data: new Uint8Array(bytes),
        useSystemFonts: true,
      });
      const document = await task.promise;
      try {
        const current = await document.getPage(1),
          viewport = current.getViewport({ scale: 1 });
        const text = (await current.getTextContent()).items
          .map((item) => item.str || '')
          .join(' ');
        const canvas = window.document.createElement('canvas');
        canvas.width = 500;
        canvas.height = 400;
        const ctx = canvas.getContext('2d', { alpha: false });
        await current.render({ canvas, canvasContext: ctx, viewport }).promise;
        const color = Array.from(ctx.getImageData(150, 290, 1, 1).data);
        canvas.width = 0;
        canvas.height = 0;
        return { text, color };
      } finally {
        await task.destroy();
      }
    }, plain.bytes);
    assert(sourceProof.text.includes('SECRET-TEXT-ALPHA'));
    assert(sourceProof.color[2] > sourceProof.color[0] + 50);
    results.push({ name: 'source-content-proof', ...sourceProof });
  }

  if (!production && !uiOnly && !imageNegativesOnly) {
    for (const [name, changes] of [
      ['text-center', {}],
      ['text-diagonal', { rotation: 45 }],
      ['text-clockwise', { rotation: -30 }],
      ['text-vertical', { rotation: 90 }],
      ['text-top-left', { position: 'top-left', fontSize: 24 }],
      ['text-top-right', { position: 'top-right', fontSize: 24 }],
      ['text-bottom-left', { position: 'bottom-left', fontSize: 24 }],
      ['text-bottom-right', { position: 'bottom-right', fontSize: 24 }],
      [
        'text-custom',
        {
          position: 'custom',
          customPosition: { x: 0.15, y: 0.8 },
          fontSize: 20,
        },
      ],
      ['text-font-small', { fontSize: 12 }],
      ['text-font-large', { fontSize: 144 }],
      ['text-scaled', { scale: 0.2 }],
      [
        'text-long',
        { text: 'LONG WATERMARK '.repeat(12), fontSize: 100, rotation: 35 },
      ],
      [
        'text-unkerned-edge',
        { text: 'AV'.repeat(100), fontSize: 144, position: 'top-right' },
      ],
      [
        'text-unkerned-diagonal-edge',
        {
          text: 'AV'.repeat(100),
          fontSize: 144,
          rotation: -33,
          position: 'bottom-left',
        },
      ],
      [
        'text-accented-edge',
        { text: 'ÉÇÅ ÁÜ ÿ', fontSize: 144, position: 'top-left', rotation: 28 },
      ],
    ]) {
      const watermark = { ...baseWatermark, ...changes };
      const output = await directExport(publicSource, name, { watermark });
      await inspect(name, output, {
        watermark,
        snapshot: ['text-center', 'text-diagonal', 'text-custom'].includes(
          name,
        ),
      });
    }
    for (const opacity of [0, 0.25, 0.8, 1]) {
      const watermark = { ...baseWatermark, opacity };
      const output = await directExport(
        publicSource,
        `text-opacity-${opacity}`,
        { watermark },
      );
      await inspect(`text-opacity-${opacity}`, output, {
        watermark,
        opacity: opacity || null,
      });
    }
    for (const [name, asset, changes] of [
      ['image-png-alpha', png, {}],
      ['image-jpeg', jpeg, {}],
      ['image-large-asset', largePng, {}],
      ['image-rotated', png, { rotation: 35 }],
      ['image-small', png, { scale: 0.1 }],
      ['image-large', png, { scale: 0.95 }],
      [
        'image-custom',
        png,
        { position: 'custom', customPosition: { x: 0.1, y: 0.9 } },
      ],
    ]) {
      const watermark = { ...imageWatermark, ...changes };
      const output = await directExport(publicSource, name, {
        watermark,
        asset,
      });
      const checked = await inspect(name, output, {
        watermark,
        imageAspect: changes.rotation ? null : 2,
        snapshot: name === 'image-png-alpha',
      });
      const images = embeddedImages(checked.doc, 0);
      assert.equal(images.length, 1);
      assert.equal(
        images[0].dict.get(lib.PDFName.of('Width')).asNumber(),
        asset.width,
      );
      assert.equal(
        images[0].dict.get(lib.PDFName.of('Height')).asNumber(),
        asset.height,
      );
      if (asset.mimeType === 'image/png') {
        const mask = checked.doc.context.lookup(
          images[0].dict.get(lib.PDFName.of('SMask')),
        );
        assert(
          mask instanceof lib.PDFRawStream,
          `${name}: PNG transparency lost`,
        );
        const alpha = lib.decodePDFRawStream(mask).decode();
        assert(
          alpha.includes(0) && alpha.includes(255),
          `${name}: original PNG alpha not retained`,
        );
      }
    }
    const targeted = {
      ...baseWatermark,
      target: { kind: 'pages', pageIds: ['page-1', 'page-3'] },
    };
    await inspect(
      'target-selected',
      await directExport(ten, 'target-selected', { watermark: targeted }),
      { watermark: targeted, targeted: [1, 3], pageCount: 10 },
    );
    const reordered = {
      ...baseWatermark,
      target: { kind: 'pages', pageIds: ['page-0'] },
    };
    await inspect(
      'target-reordered',
      await directExport(ten, 'target-reordered', {
        watermark: reordered,
        order: [2, 0, 1],
      }),
      { watermark: reordered, targeted: [1], pageCount: 3 },
    );
    await inspect(
      'target-extracted',
      await directExport(ten, 'target-extracted', {
        watermark: {
          ...targeted,
          target: { kind: 'pages', pageIds: ['page-3'] },
        },
        order: [3, 2],
      }),
      { watermark: targeted, targeted: [0], pageCount: 2 },
    );
    await inspect('target-all-ten', await directExport(ten, 'target-all-ten'), {
      pageCount: 10,
    });
    await inspect('text-hundred', await directExport(hundred, 'text-hundred'), {
      pageCount: 100,
    });
    const manyImages = await directExport(hundred, 'image-hundred', {
      watermark: imageWatermark,
      asset: png,
    });
    const imageReport = await inspect('image-hundred', manyImages, {
      watermark: imageWatermark,
      imageAspect: 2,
      pageCount: 100,
    });
    const imageRefs = imageReport.doc
      .getPages()
      .map((current) =>
        current.node
          .Resources()
          .lookup(lib.PDFName.of('XObject'), lib.PDFDict)
          .values()[0]
          .toString(),
      );
    assert.equal(
      new Set(imageRefs).size,
      1,
      'The watermark must embed once per ordinary output document.',
    );
    results.push({
      name: 'image-cache-proof',
      pages: 100,
      uniqueWatermarkImageRefs: new Set(imageRefs).size,
    });

    await inspect(
      'text-click-snapshot',
      await directExport(publicSource, 'text-click-snapshot', {
        watermark: {
          ...baseWatermark,
          target: { kind: 'pages', pageIds: ['page-0'] },
        },
        mutateSnapshot: true,
      }),
    );
    await inspect(
      'image-click-snapshot',
      await directExport(publicSource, 'image-click-snapshot', {
        watermark: imageWatermark,
        asset: png,
        mutateSnapshot: true,
      }),
      { watermark: imageWatermark, imageAspect: 2 },
    );
    for (const [name, watermark] of [
      ['invalid-empty', { ...baseWatermark, text: '' }],
      ['invalid-glyph', { ...baseWatermark, text: 'WATERMARK\u{1F512}' }],
      ['invalid-opacity', { ...baseWatermark, opacity: NaN }],
      ['invalid-infinite', { ...baseWatermark, rotation: Infinity }],
      ['invalid-scale', { ...baseWatermark, scale: -1 }],
      ['invalid-font', { ...baseWatermark, fontSize: 10000 }],
      [
        'invalid-position',
        { ...baseWatermark, customPosition: { x: NaN, y: 0.5 } },
      ],
      [
        'invalid-target',
        { ...baseWatermark, target: { kind: 'pages', pageIds: [] } },
      ],
      ['missing-watermark-asset', imageWatermark],
    ])
      await directExport(publicSource, name, {
        watermark,
        expectedError: true,
      });
    await directExport(publicSource, 'invalid-image', {
      watermark: imageWatermark,
      asset: { mimeType: 'image/png', bytes: [1, 2, 3] },
      expectedError: true,
    });
    for (const malicious of maliciousImageFixtures(png, jpeg))
      await directExport(publicSource, malicious.name, {
        watermark: imageWatermark,
        asset: malicious,
        expectedError: 'watermark-image-invalid',
      });
    await directExport(publicSource, 'export-pre-abort', {
      abort: true,
      expectedError: 'aborted',
    });
    await directExport(publicSource, 'export-building-abort', {
      abortBuilding: true,
      expectedError: 'aborted',
    });
    await directExport(plain, 'redaction-render-failure', {
      redactions: [{ pageIndex: 0, boxes: [coverText] }],
      failure: true,
      expectedError: ['redaction-render-failed', 'watermark-render-failed'],
    });

    // Watermark foreground is intentionally visible above sanitized black pixels.
    // Every combination still has zero page text/font operators and one opaque
    // sanitized raster. Known source strings and donor images are absent.
    for (const [name, watermark, asset, boxes] of [
      ['text-redaction', baseWatermark, null, [coverText]],
      ['image-redaction', imageWatermark, png, [coverImage]],
      ['text-on-black', baseWatermark, null, [fullPage]],
      ['image-on-black', imageWatermark, png, [fullPage]],
    ]) {
      const output = await directExport(plain, name, {
        watermark,
        asset,
        redactions: [{ pageIndex: 0, boxes }],
      });
      await inspect(name, output, {
        watermark,
        affected: [0],
        forbidden: secrets,
        regionBoxes: new Map([[0, boxes]]),
        snapshot: true,
      });
    }
    const mixed = await directExport(ten, 'mixed-ten', {
      redactions: [{ pageIndex: 0, boxes: [coverText] }],
    });
    const mixedReport = await inspect('mixed-ten', mixed, {
      affected: [0],
      forbidden: secrets,
      regionBoxes: new Map([[0, [coverText]]]),
      pageCount: 10,
    });
    assert.equal(
      mixedReport.pages.filter((current) =>
        current.text.includes('PUBLIC PAGE'),
      ).length,
      9,
    );
    await inspect(
      'redacted-extract',
      await directExport(ten, 'redacted-extract', {
        redactions: [{ pageIndex: 0, boxes: [coverText] }],
        order: [0],
      }),
      { affected: [0], forbidden: secrets, pageCount: 1 },
    );
    const annotation = {
      id: 'annotation-secret',
      kind: 'text',
      pageId: 'page-0',
      box: { origin: { x: 50, y: 330 }, width: 240, height: 40, rotation: 0 },
      text: 'SECRET-ANNOTATION-ALPHA',
      fontSizeUserUnits: 16,
      lineHeight: 1.2,
      align: 'left',
      color: { r: 0, g: 0, b: 0 },
      opacity: 1,
    };
    const imageAnnotation = {
      id: 'image-secret',
      kind: 'image',
      pageId: 'page-0',
      assetId: 'annotation-asset',
      box: { origin: { x: 50, y: 80 }, width: 150, height: 70, rotation: 0 },
      opacity: 1,
    };
    for (const [name, annotations, source] of [
      ['ordinary-annotation', [annotation], plain],
      ['ordinary-image-annotation', [imageAnnotation], plain],
      [
        'ordinary-signature',
        [{ ...imageAnnotation, kind: 'signature' }],
        plain,
      ],
      ['ordinary-form', [], form],
      [
        'ordinary-form-annotations',
        [
          annotation,
          imageAnnotation,
          { ...imageAnnotation, id: 'signature-secret', kind: 'signature' },
        ],
        form,
      ],
    ]) {
      const checked = await inspect(
        name,
        await directExport(source, name, {
          annotations,
          assetAnnotations: true,
        }),
      );
      assert(
        checked.pages[0].text.includes('SECRET-TEXT-ALPHA'),
        `${name}: ordinary source text lost`,
      );
      if (annotations.some((current) => current.kind === 'text'))
        assert(
          checked.pages[0].text.includes('SECRET-ANNOTATION-ALPHA'),
          `${name}: annotation text lost`,
        );
      if (source === form)
        assert(
          checked.pages[0].text.includes('SECRET-FORM-ALPHA'),
          `${name}: filled form value lost`,
        );
      if (
        annotations.some(
          (current) => current.kind === 'image' || current.kind === 'signature',
        )
      )
        assert(
          embeddedImages(checked.doc, 0).length >= 2,
          `${name}: placed image/signature asset lost`,
        );
    }
    for (const [name, annotations, source] of [
      ['annotation-redaction', [annotation], plain],
      ['image-annotation-redaction', [imageAnnotation], plain],
      [
        'signature-redaction',
        [{ ...imageAnnotation, kind: 'signature' }],
        plain,
      ],
      ['form-redaction', [], form],
    ]) {
      const output = await directExport(source, name, {
        annotations,
        assetAnnotations: true,
        redactions: [{ pageIndex: 0, boxes: [fullPage] }],
      });
      await inspect(name, output, {
        affected: [0],
        forbidden: secrets,
        regionBoxes: new Map([[0, [fullPage]]]),
      });
    }
    for (const intrinsic of [0, 90, 180, 270]) {
      const rotated = await fixture(`rotation-${intrinsic}`, {
        rotation: intrinsic,
      });
      for (const delta of [0, 90, 180, 270]) {
        const name = `redaction-rotation-${intrinsic}-${delta}`;
        const output = await directExport(rotated, name, {
          rotationDelta: delta,
          redactions: [{ pageIndex: 0, boxes: [coverText] }],
        });
        await inspect(name, output, {
          affected: [0],
          forbidden: secrets,
          rotations: [(intrinsic + delta) % 360],
          regionBoxes: new Map([[0, [coverText]]]),
        });
      }
      const name = `ordinary-rotation-${intrinsic}`;
      await inspect(name, await directExport(rotated, name), {
        rotations: [intrinsic],
      });
    }
    const cropped = await fixture('crop-unit', {
      crop: true,
      userUnit: 2,
      rotation: 90,
    });
    await inspect(
      'crop-unit-ordinary',
      await directExport(cropped, 'crop-unit-ordinary'),
      { rotations: [90] },
    );
    await inspect(
      'crop-unit-redacted',
      await directExport(cropped, 'crop-unit-redacted', {
        redactions: [{ pageIndex: 0, boxes: [coverText] }],
      }),
      {
        affected: [0],
        forbidden: secrets,
        rotations: [90],
        regionBoxes: new Map([[0, [coverText]]]),
      },
    );
    const unsafe = await fixture('unsafe-shared-image', {
      count: 2,
      sharedImage: true,
    });
    await directExport(unsafe, 'unsafe-retention-watermarked', {
      redactions: [{ pageIndex: 0, boxes: [coverImage] }],
      expectedError: 'redaction-unsafe-retention',
    });
    await inspect(
      'repeated-export',
      await directExport(publicSource, 'repeated-export'),
      { pageCount: 1 },
    );
  }

  if (!directOnly && !imageNegativesOnly) {
    await fresh(publicSource);
    assert(await button('Undo').isDisabled());
    await configureWatermark();
    const dialogPreview = await previewFootprint(
      '.watermark-dialog-preview .watermark-canvas',
    );
    await watermarkDialog()
      .getByRole('button', { name: 'Cancel', exact: true })
      .click();
    assert(
      await button('Undo').isDisabled(),
      'Preview/Cancel created an invisible history step.',
    );
    assert(
      await button('Watermark').evaluate(
        (current) => current === document.activeElement,
      ),
    );
    await button('Watermark').click();
    for (let index = 0; index < 28; index++) {
      await page.keyboard.press('Tab');
      assert(
        await watermarkDialog().evaluate((current) =>
          current.contains(document.activeElement),
        ),
        'Focus escaped the modal.',
      );
    }
    await page.keyboard.press('Escape');
    await watermarkDialog().waitFor({ state: 'detached' });
    assert(
      await button('Watermark').evaluate(
        (current) => current === document.activeElement,
      ),
    );
    results.push({
      name: 'keyboard-preview-cancel-escape-focus',
      invisibleHistory: false,
      focusContained: true,
      focusRestored: true,
    });

    await configureWatermark();
    await applyWatermark();
    const preview = await previewFootprint();
    const textUI = await inspect('text-ui', await download('text-ui'), {
      snapshot: true,
    });
    comparePreview(preview, textUI.pages[0], 'text-ui');
    comparePreview(dialogPreview, textUI.pages[0], 'text-dialog');
    assert(
      Math.abs(preview.maximumAlpha - 255 * 0.65) <= 3,
      'Preview opacity differs from configured opacity.',
    );
    await page.screenshot({
      path: join(artifactRoot, 'desktop.png'),
      fullPage: true,
    });
    await button('Undo').click();
    assert.equal(await page.locator('.watermark-summary').count(), 0);
    await inspect('ui-undo', await download('ui-undo'), { watermark: null });
    await button('Redo').click();
    await inspect('ui-redo', await download('ui-redo'));
    await configureWatermark({
      text: 'EDITED-5B',
      fontSize: 28,
      rotation: -25,
      position: 'top-right',
    });
    await applyWatermark();
    await inspect('ui-edit', await download('ui-edit'), {
      watermark: {
        ...baseWatermark,
        text: 'EDITED-5B',
        fontSize: 28,
        rotation: -25,
        position: 'top-right',
      },
    });
    await button('Undo').click();
    await inspect('ui-edit-undo', await download('ui-edit-undo'));
    await button('Redo').click();
    await button('Remove watermark').click();
    await inspect('ui-remove', await download('ui-remove'), {
      watermark: null,
    });
    await button('Undo').click();
    assert.equal(await page.locator('.watermark-summary').count(), 1);
    await button('Redo').click();

    await configureWatermark({ text: 'UNSUPPORTED-\u{1F512}' });
    const glyphError = watermarkDialog().getByRole('alert');
    await glyphError.first().waitFor();
    assert(
      (await glyphError.allTextContents()).join(' ').includes('unsupported'),
    );
    assert(
      await watermarkDialog()
        .getByRole('button', { name: 'Apply watermark', exact: true })
        .isDisabled(),
    );
    await page.keyboard.press('Escape');
    await configureWatermark({ text: '' });
    assert(
      await watermarkDialog()
        .getByRole('button', { name: 'Apply watermark', exact: true })
        .isDisabled(),
    );
    await page.keyboard.press('Escape');
    results.push({
      name: 'unsupported-glyph-empty-visible',
      unsupportedRejected: true,
      workspacePreserved: true,
    });

    // Header-valid malformed compressed data must be rejected before any
    // synchronous pdf-lib/UPNG embedding. This also checks the accessible UI
    // error and that unsuccessful imports do not create a history entry.
    for (const malicious of maliciousImageFixtures(png, jpeg))
      await verifyInvalidImageUi(malicious);

    await fresh(publicSource);
    await configureWatermark({ kind: 'image', image: png, scale: 45 });
    await applyWatermark();
    const imagePreview = await previewFootprint();
    const imageUI = await inspect('image-ui', await download('image-ui'), {
      watermark: imageWatermark,
      imageAspect: 2,
      snapshot: true,
    });
    comparePreview(imagePreview, imageUI.pages[0], 'image-ui');
    const pngMask = imageUI.doc.context.lookup(
      embeddedImages(imageUI.doc, 0)[0].dict.get(lib.PDFName.of('SMask')),
    );
    assert(pngMask instanceof lib.PDFRawStream);
    assert(lib.decodePDFRawStream(pngMask).decode().includes(0));
    await configureWatermark({ kind: 'image', image: jpeg, scale: 45 });
    await applyWatermark();
    await inspect('jpeg-ui', await download('jpeg-ui'), {
      watermark: imageWatermark,
      imageAspect: 2,
    });
    await button('Undo').click();
    await inspect('image-replace-undo', await download('image-replace-undo'), {
      watermark: imageWatermark,
      imageAspect: 2,
    });
    // A captured immutable asset survives removal/registry reconciliation while
    // an export Blob read is paused; the next independent export omits the mark.
    await holdNextImageRead();
    const capturedDownload = page.waitForEvent('download');
    await button('Download PDF').click();
    await page.waitForFunction(() => globalThis.__phase5bImageReadPaused);
    await button('Remove watermark').click();
    await page.evaluate(() => {
      globalThis.__phase5bResumeImageRead();
      globalThis.__phase5bRestoreImageRead();
    });
    const captured = await capturedDownload,
      capturedFile = join(artifactRoot, 'image-ui-captured-snapshot.pdf');
    await captured.saveAs(capturedFile);
    await inspect(
      'image-ui-captured-snapshot',
      {
        file: capturedFile,
        bytes: new Uint8Array(await readFile(capturedFile)),
      },
      { watermark: imageWatermark, imageAspect: 2 },
    );
    await inspect(
      'image-ui-later-removed',
      await download('image-ui-later-removed'),
      { watermark: null },
    );
    await button('Undo').click();
    // Cancel Start Over preserves the watermark and its reachable history asset.
    page.removeAllListeners('dialog');
    page.on('dialog', (dialog) => dialog.dismiss());
    await button('Start over').click();
    assert.equal(await page.locator('.watermark-summary').count(), 1);
    await inspect('start-over-cancel', await download('start-over-cancel'), {
      watermark: imageWatermark,
      imageAspect: 2,
    });
    page.removeAllListeners('dialog');
    page.on('dialog', (dialog) => dialog.accept());
    await button('Start over').click();
    await page.waitForFunction(
      () => globalThis.__phase5bImageUrls().live === 0,
    );
    const released = await page.evaluate(() => globalThis.__phase5bImageUrls());
    assert.equal(released.created, released.released);
    results.push({ name: 'asset-history-reset-cleanup', ...released });
    await page
      .locator('input[type=file][accept="application/pdf,.pdf"]')
      .setInputFiles(publicSource.file);
    await page.locator('.pdf-canvas[data-ready=true]').first().waitFor();
    assert(await button('Undo').isDisabled());
    await holdNextImageRead();
    await button('Watermark').click();
    await watermarkDialog()
      .getByRole('radio', { name: 'Image', exact: true })
      .check();
    await page
      .getByLabel('Choose watermark image', { exact: true })
      .setInputFiles(png.file);
    await page.waitForFunction(() => globalThis.__phase5bImageReadPaused);
    await page.keyboard.press('Escape');
    await page.evaluate(() => {
      globalThis.__phase5bResumeImageRead();
      globalThis.__phase5bRestoreImageRead();
    });
    await page.waitForFunction(
      () => globalThis.__phase5bImageUrls().live === 0,
    );
    assert.equal(await page.locator('.watermark-summary').count(), 0);
    assert(await button('Undo').isDisabled());
    results.push({
      name: 'late-image-cancel',
      staleWatermark: false,
      liveAssets: 0,
    });

    // Exercise a real 4.7 MP asset and rapidly superseded native previews. The
    // heartbeat records event-loop observations, not total browser/native memory.
    await fresh(publicSource);
    await button('Watermark').click();
    await watermarkDialog()
      .getByRole('radio', { name: 'Image', exact: true })
      .check();
    await page.evaluate(() => {
      const metrics = {
        pulses: 0,
        maximumGapMs: 0,
        last: performance.now(),
        started: performance.now(),
      };
      const timer = setInterval(() => {
        const now = performance.now();
        metrics.pulses++;
        metrics.maximumGapMs = Math.max(
          metrics.maximumGapMs,
          now - metrics.last,
        );
        metrics.last = now;
      }, 16);
      globalThis.__phase5bPreviewMetrics = () => {
        clearInterval(timer);
        return { ...metrics, elapsedMs: performance.now() - metrics.started };
      };
    });
    await page
      .getByLabel('Choose watermark image', { exact: true })
      .setInputFiles(largePng.file);
    await previewFootprint('.watermark-dialog-preview .watermark-canvas');
    for (const rotation of [10, -40, 89, -15, 35, 0, 25])
      await page
        .getByLabel('Watermark rotation', { exact: true })
        .fill(String(rotation));
    const largePreview = await previewFootprint(
      '.watermark-dialog-preview .watermark-canvas',
    );
    const previewMetrics = await page.evaluate(() =>
      globalThis.__phase5bPreviewMetrics(),
    );
    assert(
      previewMetrics.pulses > 0,
      'Large native image preview blocked the heartbeat.',
    );
    assert(largePreview.width * largePreview.height <= 4_000_000);
    await page.keyboard.press('Escape');
    await button('Start over').click();
    await page.waitForFunction(
      () => globalThis.__phase5bImageUrls().live === 0,
    );
    const previewReleased = await page.evaluate(() =>
      globalThis.__phase5bImageUrls(),
    );
    assert.equal(previewReleased.created, previewReleased.released);
    results.push({
      name: 'large-image-preview-rapid-cancel-cleanup',
      assetWidth: largePng.width,
      assetHeight: largePng.height,
      encodedBytes: largePng.bytes.length,
      approximateSingleRgbaBytes: largePng.width * largePng.height * 4,
      preview: largePreview,
      ...previewMetrics,
      imageUrls: previewReleased,
    });

    await fresh(ten);
    await configureWatermark({ scope: 'range', ranges: '1-2, 2, 4' });
    await applyWatermark();
    const rangeWatermark = {
      ...baseWatermark,
      target: { kind: 'pages', pageIds: [] },
    };
    await inspect(
      'ui-ranges-deduplicated',
      await download('ui-ranges-deduplicated'),
      { watermark: rangeWatermark, targeted: [0, 1, 3], pageCount: 10 },
    );
    await button('Move page 2 up').click();
    await inspect(
      'ui-reordered-targets',
      await download('ui-reordered-targets'),
      { watermark: rangeWatermark, targeted: [0, 1, 3], pageCount: 10 },
    );
    await button('Extract pages').click();
    await page.getByLabel('Pages to extract').fill('2,3');
    await inspect(
      'ui-extract-targets',
      await download('ui-extract-targets', button('Create PDF')),
      { watermark: rangeWatermark, targeted: [0], pageCount: 2 },
    );
    await button('Delete page 2').click();
    await inspect('ui-deleted-targets', await download('ui-deleted-targets'), {
      watermark: rangeWatermark,
      targeted: [0, 2],
      pageCount: 9,
    });
    await configureWatermark({ scope: 'range', ranges: '0, 20, x' });
    assert(
      await watermarkDialog()
        .getByRole('button', { name: 'Apply watermark', exact: true })
        .isDisabled(),
    );
    await page.keyboard.press('Escape');
    await configureWatermark({ scope: 'selected', selected: [] });
    assert(
      await watermarkDialog()
        .getByRole('button', { name: 'Apply watermark', exact: true })
        .isDisabled(),
    );
    await page
      .getByRole('checkbox', { name: 'Watermark page 2', exact: true })
      .check();
    await applyWatermark();
    await inspect('ui-selected-pages', await download('ui-selected-pages'), {
      watermark: rangeWatermark,
      targeted: [1],
      pageCount: 9,
    });
    await page.locator('.thumbnail-select').nth(2).click();
    await configureWatermark({ scope: 'current' });
    await applyWatermark();
    await inspect('ui-current-page', await download('ui-current-page'), {
      watermark: rangeWatermark,
      targeted: [2],
      pageCount: 9,
    });
    await fresh(publicSource);
    await configureWatermark();
    await applyWatermark();
    await page
      .locator('input[type=file][accept="application/pdf,.pdf"]')
      .setInputFiles(publicSource.file);
    await page.waitForFunction(
      () => document.querySelectorAll('.thumbnail-select').length === 2,
    );
    await inspect(
      'ui-all-includes-added-duplicate',
      await download('ui-all-includes-added-duplicate'),
      { pageCount: 2 },
    );
    await button('Move page 2 up').click();
    await button('Rotate page 1 clockwise 90 degrees').click();
    await inspect(
      'ui-duplicates-reorder-rotate',
      await download('ui-duplicates-reorder-rotate'),
      { pageCount: 2, rotations: [90, 0] },
    );

    await fresh(plain);
    await addRedaction(coverText);
    await configureWatermark();
    await applyWatermark();
    await inspect('text-redaction-ui', await download('text-redaction-ui'), {
      affected: [0],
      forbidden: secrets,
      regionBoxes: new Map([[0, [coverText]]]),
      snapshot: true,
    });
    await button('Extract pages').click();
    await page.getByLabel('Pages to extract').fill('1');
    await inspect(
      'watermarked-redaction-extract-ui',
      await download('watermarked-redaction-extract-ui', button('Create PDF')),
      { affected: [0], forbidden: secrets, pageCount: 1 },
    );
    await fresh(plain);
    await addRedaction(coverImage);
    await configureWatermark({ kind: 'image', image: png, scale: 45 });
    await applyWatermark();
    await inspect('image-redaction-ui', await download('image-redaction-ui'), {
      watermark: imageWatermark,
      affected: [0],
      forbidden: secrets,
      regionBoxes: new Map([[0, [coverImage]]]),
      snapshot: true,
    });
    await fresh([plain, publicSource]);
    await addRedaction(coverText);
    await configureWatermark();
    await applyWatermark();
    await button('Move page 2 up').click();
    await inspect('mixed-sources-ui', await download('mixed-sources-ui'), {
      affected: [1],
      forbidden: secrets,
      regionBoxes: new Map([[1, [coverText]]]),
      pageCount: 2,
    });
    await fresh([plain, plain]);
    await addRedaction(coverText);
    await page
      .getByLabel('Redactions on page', { exact: true })
      .selectOption({ index: 1 });
    await button('Add redaction region').click();
    for (const [label, value] of [
      ['Redaction X', coverText.x],
      ['Redaction Y', coverText.y],
      ['Redaction width', coverText.width],
      ['Redaction height', coverText.height],
    ])
      await page.getByLabel(label, { exact: true }).fill(String(value));
    await button('Apply redaction geometry').click();
    await configureWatermark();
    await applyWatermark();
    await inspect(
      'duplicates-redacted-ui',
      await download('duplicates-redacted-ui'),
      { affected: [0, 1], forbidden: secrets, pageCount: 2 },
    );

    await fresh(publicSource);
    await configureWatermark({
      rotation: 35,
      position: 'custom',
      customPosition: { x: 0.2, y: 0.75 },
    });
    await applyWatermark();
    const customWatermark = {
      ...baseWatermark,
      rotation: 35,
      position: 'custom',
      customPosition: { x: 0.2, y: 0.75 },
    };
    const beforeZoom = await inspect('zoom-100', await download('zoom-100'), {
      watermark: customWatermark,
    });
    const zoomPreview = await previewFootprint();
    comparePreview(zoomPreview, beforeZoom.pages[0], 'zoom-100');
    await button('Zoom in').click();
    await page.locator('.pdf-page-surface').first().scrollIntoViewIfNeeded();
    const afterZoom = await inspect('zoom-110', await download('zoom-110'), {
      watermark: customWatermark,
    });
    assert.deepEqual(
      afterZoom.pages[0].watermarkTextItems,
      beforeZoom.pages[0].watermarkTextItems,
      'Viewer zoom changed canonical export geometry.',
    );
    comparePreview(await previewFootprint(), afterZoom.pages[0], 'zoom-110');
    for (const width of [768, 390, 360]) {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await button('Watermark').click();
      await watermarkDialog().waitFor();
      await previewFootprint('.watermark-dialog-preview .watermark-canvas');
      const layout = await page.evaluate(() => {
        const dialog = document.querySelector('dialog[open]'),
          box = dialog.getBoundingClientRect();
        return {
          viewportWidth: innerWidth,
          outerWidth: document.documentElement.scrollWidth,
          dialogWidth: box.width,
          dialogScrollWidth: dialog.scrollWidth,
          reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
        };
      });
      assert(
        layout.outerWidth <= width + 1 &&
          layout.dialogWidth <= width &&
          layout.dialogScrollWidth <= layout.dialogWidth + 2,
        `Overflow at ${width}: ${JSON.stringify(layout)}`,
      );
      assert(layout.reducedMotion);
      await page.getByLabel('Watermark rotation', { exact: true }).focus();
      await page.screenshot({
        path: join(artifactRoot, `responsive-${width}.png`),
        fullPage: true,
      });
      await watermarkDialog()
        .getByRole('button', { name: 'Apply watermark', exact: true })
        .scrollIntoViewIfNeeded();
      await page.screenshot({
        path: join(artifactRoot, `responsive-${width}-preview.png`),
      });
      await page.keyboard.press('Escape');
      assert(
        await button('Watermark').evaluate(
          (current) => current === document.activeElement,
        ),
      );
      await page.locator('.pdf-page-surface').first().scrollIntoViewIfNeeded();
      await previewFootprint();
      await page.screenshot({
        path: join(artifactRoot, `responsive-${width}-rendered.png`),
        fullPage: true,
      });
      results.push({
        name: `responsive-${width}`,
        ...layout,
        keyboardFocusRestored: true,
      });
    }
    await page.setViewportSize({ width: 1440, height: 1100 });
    // Both server tools still require explicit submission. Simply opening their
    // dialogs (also on anonymous production) must not prepare/upload a document.
    for (const title of ['Compress PDF', 'OCR PDF']) {
      const requestCount = requests.length;
      await button(title).click();
      const toolDialog = page.getByRole('dialog', { name: title, exact: true });
      await toolDialog.waitFor();
      assert((await toolDialog.innerText()).includes('temporarily'));
      assert.equal(
        requests.length,
        requestCount,
        `${title}: opening initiated upload`,
      );
      await page.keyboard.press('Escape');
      results.push({ name: `${title}-explicit-consent`, openingRequests: 0 });
    }
    assert.equal(
      await page.evaluate(() => localStorage.length + sessionStorage.length),
      0,
      'Watermark document data persisted.',
    );
    assert.equal(
      requests.length,
      0,
      'Ordinary watermark editing/export caused an upload.',
    );
    if (!production) {
      // Controlled test routes capture the derivative only after real explicit
      // Submit. The existing Linux suites independently exercise native services.
      await fresh(plain);
      await addRedaction(coverText);
      await configureWatermark();
      await applyWatermark();
      for (const [operation, title, submit] of [
        ['compress', 'Compress PDF', 'Compress'],
        ['ocr', 'OCR PDF', 'Start OCR'],
      ]) {
        let uploaded = null;
        const routePattern = `**/tools/${operation}`;
        await page.route(routePattern, async (route) => {
          const request = route.request();
          assert.equal(request.method(), 'POST');
          const body = request.postDataBuffer();
          const formData = await new Request('http://verification.invalid', {
            method: 'POST',
            headers: { 'content-type': request.headers()['content-type'] },
            body,
          }).formData();
          const generated = formData.get('file');
          assert(generated instanceof File);
          const file = join(artifactRoot, `${operation}-prepared-upload.pdf`),
            bytes = new Uint8Array(await generated.arrayBuffer());
          await writeFile(file, bytes);
          uploaded = { file, bytes };
          await route.fulfill({
            status: 500,
            contentType: 'application/json',
            body: JSON.stringify({
              error: {
                code: 'processing-failed',
                message:
                  'Verification route intentionally stops before native processing.',
              },
            }),
          });
        });
        const before = requests.length;
        await button(title).click();
        assert.equal(requests.length, before);
        await page
          .getByRole('dialog', { name: title, exact: true })
          .getByRole('button', { name: submit, exact: true })
          .click();
        await page.waitForFunction(() =>
          document.querySelector('dialog [role=alert]'),
        );
        assert(
          uploaded,
          `${title}: explicit submission supplied no generated derivative`,
        );
        await inspect(`${operation}-prepared-upload`, uploaded, {
          affected: [0],
          forbidden: secrets,
        });
        await page.keyboard.press('Escape');
        await page.unroute(routePattern);
        assert.equal(
          requests.length,
          before + 1,
          `${title}: more than one explicit upload`,
        );
      }
      assert.equal(requests.length, 2);
      assert(
        requests.every(
          (request) =>
            request.method === 'POST' &&
            /\/tools\/(compress|ocr)$/.test(request.url),
        ),
      );
    }
  }
  assert.equal(errors.length, 0, JSON.stringify(errors));
  if (production || directOnly || imageNegativesOnly)
    assert.equal(requests.length, 0, JSON.stringify(requests));
  completed = true;
  console.log('PHASE_5B_BROWSER_PASSED');
} catch (error) {
  failure = { message: error.message, stack: error.stack };
  await page
    .screenshot({ path: join(artifactRoot, 'failure.png'), fullPage: true })
    .catch(() => {});
  throw error;
} finally {
  await writeFile(
    join(artifactRoot, 'phase5b-browser.json'),
    JSON.stringify(
      {
        completed,
        failure,
        results,
        measurements,
        errors,
        requests,
        qpdf: qpdfAvailable ? qpdfProbe.stdout.trim() : 'unavailable',
      },
      null,
      2,
    ),
  );
  await browser.close();
}
