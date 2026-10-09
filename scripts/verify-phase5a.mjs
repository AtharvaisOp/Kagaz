import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const { chromium } = require(
  process.env.KAGAZ_PLAYWRIGHT_MODULE || 'playwright',
);
const lib = require('../apps/web/node_modules/pdf-lib');
const root = process.env.KAGAZ_ARTIFACT_DIR;
assert(
  root,
  'Set KAGAZ_ARTIFACT_DIR to an output directory outside the repository.',
);
const artifactRoot = join(root, 'phase5a');
await mkdir(artifactRoot, { recursive: true });
const appUrl = process.env.KAGAZ_APP_URL || 'http://127.0.0.1:5173';
// Production smoke can operate the deployed UI while an independent local Vite
// page supplies the installed PDF.js parser. No test hooks enter production code.
const verifierUrl = process.env.KAGAZ_VERIFIER_URL || 'http://127.0.0.1:5173';
const production = process.argv.includes('--production');
const directOnly = process.argv.includes('--direct');
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
  acceptDownloads: true,
  deviceScaleFactor: 2,
});
const errors = [],
  requests = [],
  results = [],
  performance = [];
context.on('page', (current) =>
  current.on('pageerror', (error) => errors.push(error.message)),
);
context.on('request', (request) => {
  if (request.method() !== 'GET')
    requests.push({ method: request.method(), url: request.url() });
});
const page = await context.newPage();
const verifier = await context.newPage();
page.setDefaultTimeout(15000);
page.on('dialog', (dialog) => dialog.accept());
await verifier.goto(verifierUrl);
const button = (name) => page.getByRole('button', { name, exact: true });
let workspaceSourceBytes = null;
const hash = (bytes) =>
  createHash('sha256').update(Buffer.from(bytes)).digest('hex');
const markerNames = [
  'SECRET-TEXT-ALPHA',
  'SECRET-TEXT-BETA',
  'ACCOUNT-123456',
  'SECRET-ANNOTATION-ALPHA',
  'SECRET-HIDDEN-CONTENTS',
  'PRIVATE-IMAGE-MARKER',
];

async function fixture(
  name,
  {
    count = 1,
    rotation = 0,
    forms = false,
    crop = false,
    userUnit = 1,
    imageHeavy = false,
    sharedImage = false,
    crossPageLink = false,
    huge = false,
    publicOnly = false,
    publicFontFamily = lib.StandardFonts.Helvetica,
    sharedToUnicode = false,
    alternateRepresentation = false,
    customResource = null,
    privateFontMetadata = false,
    malformedFontResource = false,
    sharedResourceKey = false,
    sharedNumericFontMetadata = false,
    sharedNumericGraphicsState = false,
  } = {},
) {
  const doc = await lib.PDFDocument.create();
  doc.setTitle('SECRET-TEXT-ALPHA');
  const imageBytes = await verifier.evaluate(
    ({ imageHeavy }) => {
      const canvas = document.createElement('canvas');
      canvas.width = imageHeavy ? 1200 : 300;
      canvas.height = imageHeavy ? 900 : 140;
      const context = canvas.getContext('2d');
      context.fillStyle = '#1464dc';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = '#f62a59';
      context.fillRect(0, 0, canvas.width / 3, canvas.height);
      context.fillStyle = '#fff';
      context.font = 'bold 18px Arial';
      context.fillText('PRIVATE-IMAGE-MARKER', 12, 70);
      if (imageHeavy) {
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
        let seed = 12345;
        for (let index = 0; index < pixels.data.length; index += 4) {
          seed = (seed * 1664525 + 1013904223) >>> 0;
          pixels.data[index] = seed & 255;
          pixels.data[index + 1] = (seed >>> 8) & 255;
          pixels.data[index + 2] = (seed >>> 16) & 255;
        }
        context.putImageData(pixels, 0, 0);
      }
      return [
        ...Uint8Array.from(
          atob(canvas.toDataURL('image/png').split(',')[1]),
          (character) => character.charCodeAt(0),
        ),
      ];
    },
    { imageHeavy },
  );
  const image = await doc.embedPng(new Uint8Array(imageBytes));
  const first = doc.addPage(huge ? [10000, 10000] : [500, 400]);
  first.setRotation(lib.degrees(rotation));
  if (crop) {
    first.setMediaBox(-20, -30, 550, 460);
    first.setCropBox(20, 30, 440, 340);
  }
  if (userUnit !== 1)
    first.node.set(lib.PDFName.of('UserUnit'), lib.PDFNumber.of(userUnit));
  if (publicOnly) {
    first.drawText('PUBLIC OTHER SOURCE', {
      x: 50,
      y: 340,
      size: 18,
      font: await doc.embedFont(publicFontFamily),
    });
  } else {
    first.drawText('SECRET-TEXT-ALPHA', { x: 50, y: 340, size: 18 });
    first.drawText('SECRET-TEXT-BETA', { x: 50, y: 300, size: 18 });
    first.drawText('PUBLIC VISIBLE TEXT', { x: 270, y: 340, size: 15 });
    first.drawRectangle({
      x: 50,
      y: 180,
      width: 120,
      height: 70,
      color: lib.rgb(0.95, 0.08, 0.16),
    });
    first.drawImage(image, { x: 50, y: 80, width: 150, height: 70 });
    const hidden = doc.context.register(
      doc.context.obj({
        Type: 'Annot',
        Subtype: 'Text',
        Rect: [50, 340, 70, 360],
        Contents: lib.PDFString.of('SECRET-HIDDEN-CONTENTS'),
        F: 2,
      }),
    );
    first.node.addAnnot(hidden);
  }
  for (let index = 1; index < count; index++) {
    const next = doc.addPage([500, 400]);
    next.drawText(`PUBLIC PAGE ${index + 1}`, { x: 50, y: 340, size: 18 });
    if (sharedImage)
      next.drawImage(image, { x: 50, y: 80, width: 150, height: 70 });
    if (crossPageLink && index === 1) {
      next.node.addAnnot(
        doc.context.register(
          doc.context.obj({
            Type: 'Annot',
            Subtype: 'Link',
            Rect: [50, 330, 200, 360],
            Dest: [first.ref, 'Fit'],
          }),
        ),
      );
    }
  }
  if (sharedToUnicode) {
    await doc.flush();
    const fontResources = first.node
      .Resources()
      .lookup(lib.PDFName.of('Font'), lib.PDFDict);
    const fontRef = fontResources.values()[0];
    const font = doc.context.lookup(fontRef, lib.PDFDict);
    const cmap =
      '/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n' +
      '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n' +
      '/CMapName /Secret def\n/CMapType 2 def\n1 begincodespacerange\n<00> <FF>\nendcodespacerange\n' +
      '% SECRET-TEXT-ALPHA\n0 beginbfchar\nendbfchar\nendcmap\n' +
      'CMapName currentdict /CMap defineresource pop\nend\nend';
    font.set(
      lib.PDFName.of('ToUnicode'),
      doc.context.register(doc.context.flateStream(cmap)),
    );
    const secondFonts = doc
      .getPage(1)
      .node.Resources()
      .lookup(lib.PDFName.of('Font'), lib.PDFDict);
    for (const [key] of secondFonts.entries()) secondFonts.set(key, fontRef);
  }
  if (alternateRepresentation) {
    doc
      .getPage(1)
      .node.Resources()
      .set(
        lib.PDFName.of('Properties'),
        doc.context.obj({
          HiddenSecret: lib.PDFString.of('SECRET-TEXT-ALPHA'),
        }),
      );
  }
  if (customResource) {
    const value =
      customResource === 'string'
        ? lib.PDFString.of('SECRET-TEXT-ALPHA')
        : customResource === 'name'
          ? lib.PDFName.of('SECRET-TEXT-ALPHA')
          : lib.PDFNumber.of(123456);
    doc.getPage(1).node.Resources().set(lib.PDFName.of('UnknownSecret'), value);
  }
  if (privateFontMetadata) {
    await doc.flush();
    const fonts = doc
      .getPage(1)
      .node.Resources()
      .lookup(lib.PDFName.of('Font'), lib.PDFDict);
    doc.context
      .lookup(fonts.values()[0], lib.PDFDict)
      .set(
        lib.PDFName.of('PrivateNote'),
        lib.PDFString.of('SECRET-TEXT-ALPHA'),
      );
  }
  if (sharedResourceKey) {
    await doc.flush();
    const fonts = first.node
      .Resources()
      .lookup(lib.PDFName.of('Font'), lib.PDFDict);
    const fontRef = fonts.values()[0];
    const key =
      sharedResourceKey === 'numeric'
        ? 'Helvetica-123456'
        : 'SECRET-TEXT-ALPHA';
    if (sharedResourceKey === 'numeric')
      first.drawText('123456', { x: 50, y: 340, size: 18 });
    for (const sourcePage of doc.getPages()) {
      sourcePage.node
        .Resources()
        .lookup(lib.PDFName.of('Font'), lib.PDFDict)
        .set(lib.PDFName.of(key), fontRef);
    }
  }
  if (malformedFontResource) {
    doc
      .getPage(1)
      .node.Resources()
      .set(lib.PDFName.of('Font'), doc.context.obj([]));
  }
  if (forms) {
    const field = doc.getForm().createTextField('Account');
    field.setText('INITIAL-ACCOUNT');
    field.addToPage(first, { x: 260, y: 280, width: 200, height: 30 });
  }
  if (sharedNumericFontMetadata || sharedNumericGraphicsState)
    first.drawText('123456', { x: 50, y: 340, size: 18 });
  let bytes = await doc.save({ useObjectStreams: false });
  if (sharedNumericFontMetadata || sharedNumericGraphicsState) {
    // Mutate the parsed document after embedding so the serializer cannot
    // replace the adversarial, otherwise legal appearance dictionaries.
    const parsed = await lib.PDFDocument.load(bytes);
    if (sharedNumericFontMetadata) {
      const affectedFonts = parsed
        .getPage(0)
        .node.Resources()
        .lookup(lib.PDFName.of('Font'), lib.PDFDict);
      const sharedFontRef = affectedFonts.values()[0];
      const sharedFont = parsed.context.lookup(sharedFontRef, lib.PDFDict);
      sharedFont.set(lib.PDFName.of('FirstChar'), lib.PDFNumber.of(0));
      sharedFont.set(lib.PDFName.of('LastChar'), lib.PDFNumber.of(0));
      sharedFont.set(lib.PDFName.of('Widths'), parsed.context.obj([123456]));
      const preservedFonts = parsed
        .getPage(1)
        .node.Resources()
        .lookup(lib.PDFName.of('Font'), lib.PDFDict);
      for (const [key] of preservedFonts.entries())
        preservedFonts.set(key, sharedFontRef);
    }
    if (sharedNumericGraphicsState) {
      const stateRef = parsed.context.register(
        parsed.context.obj({
          Type: 'ExtGState',
          D: [[123456, 1], 0],
        }),
      );
      for (const [index, sourcePage] of parsed.getPages().entries())
        sourcePage.node.Resources().set(
          lib.PDFName.of('ExtGState'),
          parsed.context.obj({
            [index === 0 ? 'AffectedState' : 'PreservedState']: stateRef,
          }),
        );
    }
    bytes = await parsed.save({ useObjectStreams: false });
  }
  const file = join(artifactRoot, `${name}-source.pdf`);
  await writeFile(file, bytes);
  return {
    file,
    bytes: [...bytes],
    imageBytes,
    count,
    crop: crop
      ? { x: 20, y: 30, width: 440, height: 340 }
      : { x: 0, y: 0, width: 500, height: 400 },
    userUnit,
    sourceImageHash: hash(imageBytes),
  };
}

async function fresh(files) {
  const sources = Array.isArray(files) ? files : [files];
  workspaceSourceBytes = sources.every((source) => source.bytes)
    ? sources.reduce((total, source) => total + source.bytes.length, 0)
    : null;
  await page.bringToFront();
  await page.goto(appUrl);
  await page
    .locator('input[type=file][accept="application/pdf,.pdf"]')
    .setInputFiles(
      Array.isArray(files)
        ? files.map((file) => file.file || file)
        : files.file || files,
    );
  await page.locator('.pdf-canvas[data-ready=true]').first().waitFor();
  await button('Download PDF').waitFor();
  await page.waitForFunction(
    () => !document.body.innerText.includes('Checking this PDF'),
  );
}

async function addRegion(box) {
  await button('Add redaction region').click();
  await setGeometry(box);
}
async function setGeometry({ x, y, width, height }) {
  for (const [label, value] of [
    ['Redaction X', x],
    ['Redaction Y', y],
    ['Redaction width', width],
    ['Redaction height', height],
  ]) {
    await page.getByLabel(label, { exact: true }).fill(String(value));
  }
  await button('Apply redaction geometry').click();
}
async function regionBoxes() {
  const surface = page.locator('.pdf-page-surface').first();
  if (await surface.count()) {
    await surface.scrollIntoViewIfNeeded();
    await page.locator('.pdf-canvas[data-ready=true]').first().waitFor();
    const expected = await page
      .getByRole('button', { name: /^Pending redaction \d+$/ })
      .count();
    await page.waitForFunction(
      (expected) =>
        document.querySelectorAll('[data-redaction-id][data-pdf-box]').length >=
        expected,
      expected,
    );
  }
  return page
    .locator('[data-redaction-id][data-pdf-box]')
    .evaluateAll((regions) =>
      regions.map((region) =>
        region.getAttribute('data-pdf-box').split(',').map(Number),
      ),
    );
}
async function download(name, control = button('Download PDF')) {
  const beforeHeap = await page.evaluate(
    () => globalThis.performance.memory?.usedJSHeapSize ?? null,
  );
  const start = Date.now();
  const event = page.waitForEvent('download');
  await control.click();
  const download = await event;
  const file = join(artifactRoot, `${name}.pdf`);
  await download.saveAs(file);
  const bytes = new Uint8Array(await readFile(file));
  const afterHeap = await page.evaluate(
    () => globalThis.performance.memory?.usedJSHeapSize ?? null,
  );
  performance.push({
    name,
    exportAndDownloadMs: Date.now() - start,
    inputBytes: workspaceSourceBytes,
    outputBytes: bytes.length,
    beforeHeap,
    afterHeap,
    heapNote:
      'Transient Chromium JS heap estimate; excludes canvas, worker and native browser allocations.',
  });
  return { file, bytes };
}

// This inspects what was actually saved: an independent parser, decompressed PDF
// streams and the actual embedded image, never the creation-time screen canvas.
async function inspect(
  name,
  output,
  {
    affected = [0],
    regions = new Map(),
    crops = new Map(),
    rotations = [],
    secretMarkers = markerNames,
  } = {},
) {
  await verifier.bringToFront();
  const doc = await lib.PDFDocument.load(output.bytes, {
    throwOnInvalidObject: true,
  });
  assert.equal(
    doc.getForm().getFields().length,
    0,
    `${name}: interactive fields retained`,
  );
  const raw = Buffer.from(output.bytes).toString('latin1');
  const decodedStrings = [];
  let serializedPageCount = 0;
  for (const [, object] of doc.context.enumerateIndirectObjects()) {
    if (
      object instanceof lib.PDFDict &&
      object.get(lib.PDFName.of('Type'))?.toString() === '/Page'
    )
      serializedPageCount++;
    decodedStrings.push(object.toString());
    if (object instanceof lib.PDFRawStream) {
      decodedStrings.push(
        Buffer.from(lib.decodePDFRawStream(object).decode()).toString('latin1'),
      );
    }
  }
  assert.equal(
    serializedPageCount,
    doc.getPageCount(),
    `${name}: hidden original page object serialized`,
  );
  // Semantic decoding catches UTF-16 PDFHexString/PDFString metadata and hidden
  // dictionary values that ASCII/hex byte scanning alone cannot establish.
  const pendingObjects = doc.context
    .enumerateIndirectObjects()
    .map(([, object]) => object);
  const visitedObjects = new Set();
  while (pendingObjects.length) {
    const object = doc.context.lookup(pendingObjects.pop());
    if (!object || visitedObjects.has(object)) continue;
    visitedObjects.add(object);
    if (
      object instanceof lib.PDFString ||
      object instanceof lib.PDFHexString ||
      object instanceof lib.PDFName
    ) {
      decodedStrings.push(object.decodeText());
    }
    if (object instanceof lib.PDFDict)
      pendingObjects.push(...object.keys(), ...object.values());
    else if (object instanceof lib.PDFArray)
      pendingObjects.push(...object.asArray());
    else if (object instanceof lib.PDFRawStream)
      pendingObjects.push(object.dict);
  }
  for (const marker of secretMarkers) {
    const hex = Buffer.from(marker).toString('hex').toUpperCase();
    assert(!raw.includes(marker), `${name}: raw marker retained`);
    assert(
      !decodedStrings.some(
        (text) => text.includes(marker) || text.toUpperCase().includes(hex),
      ),
      `${name}: marker retained in an object or decoded content stream`,
    );
  }
  const embedded = [];
  for (const index of affected) {
    const current = doc.getPage(index);
    assert.equal(
      current.node.Annots()?.size() ?? 0,
      0,
      `${name}: annotations retained`,
    );
    const resources = current.node.Resources();
    assert.equal(
      resources.get(lib.PDFName.of('Font'))?.size?.() ?? 0,
      0,
      `${name}: source fonts remain reachable from redacted page`,
    );
    const xobjects = resources.lookup(lib.PDFName.of('XObject'), lib.PDFDict);
    const images = xobjects.values().map((ref) => doc.context.lookup(ref));
    assert.equal(
      images.length,
      1,
      `${name}: raster page retains extra XObjects`,
    );
    const image = images[0];
    assert(image instanceof lib.PDFRawStream);
    assert.equal(
      image.dict.get(lib.PDFName.of('Subtype')).toString(),
      '/Image',
    );
    assert(
      !image.dict.has(lib.PDFName.of('SMask')),
      `${name}: alternate image alpha layer`,
    );
    assert.equal(
      image.dict.get(lib.PDFName.of('BitsPerComponent')).asNumber(),
      8,
    );
    const channels =
      image.dict.get(lib.PDFName.of('ColorSpace')).toString() === '/DeviceRGB'
        ? 3
        : 1;
    const width = image.dict.get(lib.PDFName.of('Width')).asNumber();
    const height = image.dict.get(lib.PDFName.of('Height')).asNumber();
    const pixels = lib.decodePDFRawStream(image).decode();
    assert.equal(pixels.length, width * height * channels);
    const crop = crops.get(index) || current.getCropBox();
    const scaleX = width / crop.width,
      scaleY = height / crop.height;
    for (const box of regions.get(index) || []) {
      const x0 = Math.max(0, Math.ceil((box.x - crop.x) * scaleX));
      const x1 = Math.min(
        width,
        Math.floor((box.x + box.width - crop.x) * scaleX),
      );
      const y0 = Math.max(
        0,
        Math.ceil((crop.y + crop.height - box.y - box.height) * scaleY),
      );
      const y1 = Math.min(
        height,
        Math.floor((crop.y + crop.height - box.y) * scaleY),
      );
      // Tiny subpixel proposals still overwrite outward rounded pixels.
      const xs =
        x1 > x0
          ? [x0, x1]
          : [
              Math.max(0, Math.min(width - 1, x0)),
              Math.max(1, Math.min(width, x0 + 1)),
            ];
      const ys =
        y1 > y0
          ? [y0, y1]
          : [
              Math.max(0, Math.min(height - 1, y0)),
              Math.max(1, Math.min(height, y0 + 1)),
            ];
      for (let y = ys[0]; y < ys[1]; y++)
        for (let x = xs[0]; x < xs[1]; x++) {
          for (let channel = 0; channel < channels; channel++) {
            assert.equal(
              pixels[(y * width + x) * channels + channel],
              0,
              `${name}: recoverable image pixel at ${x},${y}`,
            );
          }
        }
    }
    embedded.push({
      page: index + 1,
      width,
      height,
      channels,
      decodedBytes: pixels.length,
      minimumCanvasRgbaBytes: width * height * 4,
      rasterHash: hash(pixels),
    });
  }
  const report = await verifier.evaluate(
    async ({ bytes, affected, rotations, secretMarkers, regions }) => {
      const pdfjs = await import('/node_modules/pdfjs-dist/build/pdf.mjs');
      pdfjs.GlobalWorkerOptions.workerSrc =
        '/node_modules/pdfjs-dist/build/pdf.worker.mjs';
      const task = pdfjs.getDocument({
        data: new Uint8Array(bytes),
        useSystemFonts: true,
      });
      const document = await task.promise;
      const result = [];
      window.document.body.replaceChildren();
      window.document.body.style.cssText =
        'background:#ddd;padding:24px;display:flex;flex-wrap:wrap;gap:20px;align-items:flex-start';
      try {
        for (let index = 0; index < document.numPages; index++) {
          const current = await document.getPage(index + 1);
          const text = (await current.getTextContent()).items
            .map((item) => item.str || '')
            .join(' ');
          const operators = await current.getOperatorList();
          const annotations = await current.getAnnotations();
          const canvas = window.document.createElement('canvas');
          const viewport = current.getViewport({ scale: 1 });
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          const context = canvas.getContext('2d', { alpha: false });
          await current.render({ canvas, canvasContext: context, viewport })
            .promise;
          if (index < 3) {
            const preview = window.document.createElement('img');
            preview.src = canvas.toDataURL('image/png');
            preview.style.maxWidth = '500px';
            window.document.body.append(preview);
          }
          const blackSamples = [];
          for (const box of regions.find(([page]) => page === index)?.[1] ||
            []) {
            const [x, y] = viewport.convertToViewportPoint(
              box.x + box.width / 2,
              box.y + box.height / 2,
            );
            const pixel = [
              ...context.getImageData(
                Math.min(canvas.width - 1, Math.max(0, Math.floor(x))),
                Math.min(canvas.height - 1, Math.max(0, Math.floor(y))),
                1,
                1,
              ).data,
            ];
            blackSamples.push(pixel);
          }
          result.push({
            page: index + 1,
            text,
            rotation: current.rotate,
            images: operators.fnArray.filter((op) =>
              [
                pdfjs.OPS.paintImageXObject,
                pdfjs.OPS.paintInlineImageXObject,
              ].includes(op),
            ).length,
            textOperators: operators.fnArray.filter((op) =>
              [
                pdfjs.OPS.showText,
                pdfjs.OPS.showSpacedText,
                pdfjs.OPS.nextLineShowText,
                pdfjs.OPS.nextLineSetSpacingShowText,
              ].includes(op),
            ).length,
            annotations: annotations.length,
            blackSamples,
          });
          current.cleanup();
          canvas.width = 0;
          canvas.height = 0;
        }
      } finally {
        await task.destroy();
      }
      return result;
    },
    {
      bytes: [...output.bytes],
      affected,
      rotations,
      secretMarkers,
      regions: [...regions],
    },
  );
  if (
    [
      'text-ui',
      'image-ui',
      'all-annotations',
      'rotation-90-0',
      'crop-unit-2',
      'preserved-annotation',
    ].includes(name)
  ) {
    await verifier.screenshot({
      path: join(artifactRoot, `${name}-export-render.png`),
      fullPage: true,
    });
  }
  for (const index of affected) {
    assert.equal(
      report[index].text,
      '',
      `${name}: PDF.js extracts source text`,
    );
    assert.equal(
      report[index].textOperators,
      0,
      `${name}: source text operators retained`,
    );
    assert.equal(report[index].images, 1);
    assert.equal(report[index].annotations, 0);
    for (const sample of report[index].blackSamples)
      assert.deepEqual(sample, [0, 0, 0, 255]);
  }
  if (rotations.length)
    assert.deepEqual(
      report.map((entry) => entry.rotation),
      rotations,
    );
  for (const marker of secretMarkers)
    assert(report.every((entry) => !entry.text.includes(marker)));
  if (qpdfAvailable) {
    const checked = spawnSync(qpdf, ['--check', output.file], {
      encoding: 'utf8',
    });
    assert.equal(
      checked.status,
      0,
      `${name}: qpdf --check failed: ${checked.stdout} ${checked.stderr}`,
    );
    const qdfPath = join(artifactRoot, `${name}-qdf.pdf`);
    const qdf = spawnSync(
      qpdf,
      [
        '--qdf',
        '--object-streams=disable',
        '--stream-data=uncompress',
        output.file,
        qdfPath,
      ],
      { encoding: 'utf8' },
    );
    assert.equal(qdf.status, 0, `${name}: qpdf QDF decoding failed`);
    const qdfBytes = (await readFile(qdfPath)).toString('latin1');
    for (const marker of secretMarkers)
      assert(!qdfBytes.includes(marker), `${name}: qpdf found secret`);
  }
  const entry = {
    name,
    pages: report,
    embedded,
    qpdf: qpdfAvailable ? 'PASS' : 'unavailable',
    outputBytes: output.bytes.length,
  };
  results.push(entry);
  console.log(JSON.stringify(entry));
  await page.bringToFront();
  return { doc, report, embedded };
}

async function directExport(
  fixture,
  name,
  {
    boxes = [{ x: 40, y: 325, width: 220, height: 40 }],
    rotationDelta = 0,
    redactionPageIndices = [0],
    annotations = [],
    preservedAnnotations = [],
    asset = false,
    abort = false,
    abortOnBuilding = false,
    canvasFailure = false,
    crossInstance = false,
    expectedError = null,
  } = {},
) {
  const result = await verifier.evaluate(
    async ({
      data,
      name,
      boxes,
      rotationDelta,
      redactionPageIndices,
      annotations,
      preservedAnnotations,
      asset,
      abort,
      abortOnBuilding,
      canvasFailure,
      crossInstance,
      imageBytes,
      count,
    }) => {
      const { exportWorkspace } =
        await import('/src/lib/pdf-export/exportWorkspace.ts');
      const file = new File([new Uint8Array(data)], `${name}.pdf`, {
        type: 'application/pdf',
      });
      const pages = [];
      for (let index = 0; index < count; index++)
        pages.push({
          id: `page-${index}`,
          sourceDocumentId:
            crossInstance && index === 1 ? 'duplicate-source' : 'source',
          sourcePageIndex: index,
          rotationDelta: index === 0 ? rotationDelta : 0,
        });
      const signal = new AbortController();
      if (abort) signal.abort();
      const original = HTMLCanvasElement.prototype.getContext;
      if (canvasFailure) HTMLCanvasElement.prototype.getContext = () => null;
      const start = window.performance.now();
      try {
        const bytes = await exportWorkspace(
          {
            pages,
            sources: new Map([
              ['source', { id: 'source', file, fileName: `${name}.pdf` }],
              ...(crossInstance
                ? [
                    [
                      'duplicate-source',
                      {
                        id: 'duplicate-source',
                        file: new File(
                          [new Uint8Array(data)],
                          `${name}-duplicate.pdf`,
                          { type: 'application/pdf' },
                        ),
                        fileName: `${name}-duplicate.pdf`,
                      },
                    ],
                  ]
                : []),
            ]),
            annotationsByPage: new Map([
              ['page-0', annotations],
              ['page-1', preservedAnnotations],
            ]),
            imageAssets: asset
              ? new Map([
                  [
                    'asset',
                    {
                      assetId: 'asset',
                      mimeType: 'image/png',
                      bytes: new Uint8Array(imageBytes),
                    },
                  ],
                ])
              : new Map(),
            redactionsByPage: new Map(
              redactionPageIndices.map((pageIndex) => [
                `page-${pageIndex}`,
                boxes.map((box, index) => ({
                  id: `region-${pageIndex}-${index}`,
                  pageId: `page-${pageIndex}`,
                  box,
                })),
              ]),
            ),
            forms: {
              hasChangedTextDraft: false,
              sources: [
                { sourceDocumentId: 'source', capability: 'plain', fields: [] },
                ...(crossInstance
                  ? [
                      {
                        sourceDocumentId: 'duplicate-source',
                        capability: 'plain',
                        fields: [],
                      },
                    ]
                  : []),
              ],
            },
          },
          {
            signal: signal.signal,
            onProgress: (progress) => {
              if (abortOnBuilding && progress.phase === 'building')
                signal.abort();
            },
          },
        );
        return {
          bytes: [...bytes],
          elapsedMs: window.performance.now() - start,
        };
      } catch (error) {
        return {
          error: error.code,
          message: error.message,
          elapsedMs: window.performance.now() - start,
        };
      } finally {
        HTMLCanvasElement.prototype.getContext = original;
      }
    },
    {
      data: fixture.bytes,
      name,
      boxes,
      rotationDelta,
      redactionPageIndices,
      annotations,
      preservedAnnotations,
      asset,
      abort,
      abortOnBuilding,
      canvasFailure,
      crossInstance,
      imageBytes: fixture.imageBytes,
      count: fixture.count,
    },
  );
  if (expectedError) {
    assert(result.error, `${name}: should fail closed`);
    if (Array.isArray(expectedError))
      assert(expectedError.includes(result.error), `${name}: ${result.error}`);
    else if (expectedError !== true) assert.equal(result.error, expectedError);
    results.push({ name, rejected: result.error, elapsedMs: result.elapsedMs });
    return;
  }
  assert(!result.error, `${name}: ${result.error}: ${result.message}`);
  const file = join(artifactRoot, `${name}.pdf`);
  const bytes = new Uint8Array(result.bytes);
  await writeFile(file, bytes);
  performance.push({
    name,
    exportMs: result.elapsedMs,
    inputBytes: fixture.bytes.length,
    outputBytes: bytes.length,
  });
  return { file, bytes };
}

try {
  const plain = await fixture('plain');
  const ten = await fixture('ten', { count: 10 });
  const form = await fixture('form', { forms: true });
  const coverText = { x: 40, y: 325, width: 220, height: 40 };
  const coverImage = { x: 45, y: 75, width: 160, height: 80 };
  const coverVector = { x: 45, y: 175, width: 130, height: 80 };
  const full = { x: 0, y: 0, width: 500, height: 400 };
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
      const source = await document.getPage(1);
      const text = (await source.getTextContent()).items
        .map((item) => item.str ?? '')
        .join(' ');
      const canvas = window.document.createElement('canvas');
      canvas.width = 500;
      canvas.height = 400;
      const context = canvas.getContext('2d');
      await source.render({
        canvas,
        canvasContext: context,
        viewport: source.getViewport({ scale: 1 }),
      }).promise;
      return {
        text,
        imagePixel: [...context.getImageData(80, 300, 1, 1).data],
        vectorPixel: [...context.getImageData(100, 200, 1, 1).data],
      };
    } finally {
      await task.destroy();
    }
  }, plain.bytes);
  assert(
    sourceProof.text.includes('SECRET-TEXT-ALPHA') &&
      sourceProof.text.includes('SECRET-TEXT-BETA'),
  );
  assert(sourceProof.imagePixel[0] > 200 && sourceProof.imagePixel[1] < 70);
  assert(sourceProof.vectorPixel[0] > 220 && sourceProof.vectorPixel[1] < 40);
  results.push({ name: 'source-proof', ...sourceProof });
  if (!directOnly) {
    await fresh(plain);
    await button('Redact').focus();
    await button('Redact').press('Enter');
    assert.equal(await button('Redact').getAttribute('aria-pressed'), 'true');
    await addRegion(coverText);
    assert(
      await button('Apply redaction geometry').evaluate(
        (element) => element === document.activeElement,
      ),
    );
    const textProof = await inspect('text-ui', await download('text-ui'), {
      regions: new Map([[0, [coverText]]]),
    });
    await page.screenshot({
      path: join(artifactRoot, 'desktop.png'),
      fullPage: true,
    });
    // A region edit and removal are separate visible history transactions.
    await setGeometry({ ...coverText, x: 42, width: 218 });
    await button('Undo').click();
    assert.deepEqual(await regionBoxes(), [[40, 325, 220, 40]]);
    await button('Redo').click();
    assert.deepEqual(await regionBoxes(), [[42, 325, 218, 40]]);
    await button('Remove pending redaction 1').click();
    assert(
      await page
        .getByRole('heading', { name: 'Pending redactions', exact: true })
        .evaluate((element) => element === document.activeElement),
    );
    assert.equal((await regionBoxes()).length, 0);
    await button('Undo').click();
    assert.equal((await regionBoxes()).length, 1);
    await button('Redo').click();
    assert.equal((await regionBoxes()).length, 0);
    await addRegion(coverImage);
    await inspect('image-ui', await download('image-ui'), {
      regions: new Map([[0, [coverImage]]]),
    });
    await button('Undo').click();
    await button('Undo').click();
    // Draw at two zoom levels; authoritative geometry must round-trip independently
    // of CSS, DPR, scroll and the page manager's separate thumbnail canvas.
    for (const zoomActions of [0, 2]) {
      await fresh(plain);
      await button('Redact').click();
      for (let index = 0; index < zoomActions; index++)
        await button('Zoom in').click();
      const surface = page.locator('.pdf-page-surface').first();
      await surface.scrollIntoViewIfNeeded();
      await page.locator('.pdf-canvas[data-ready=true]').first().waitFor();
      await page.waitForFunction(() => {
        const surface = document.querySelector('.pdf-page-surface');
        const overlay = document.querySelector('.redaction-overlay');
        const zoom = Number.parseInt(
          document.querySelector('[aria-label="Current zoom"]').textContent,
        );
        return (
          surface?.getBoundingClientRect().width === (500 * zoom) / 100 &&
          overlay?.getBoundingClientRect().width ===
            surface?.getBoundingClientRect().width
        );
      });
      await surface.evaluate(
        () =>
          new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          ),
      );
      const box = await surface.boundingBox();
      const scale = box.width / 500;
      await page.mouse.move(box.x + 40 * scale, box.y + 35 * scale);
      await page.mouse.down();
      await page.mouse.move(box.x + 260 * scale, box.y + 75 * scale, {
        steps: 8,
      });
      await page.mouse.up();
      const geometry = (await regionBoxes())[0];
      assert(geometry, 'drawn region missing');
      for (const [actual, expected] of geometry.map((value, index) => [
        value,
        [40, 325, 220, 40][index],
      ])) {
        assert(
          Math.abs(actual - expected) < 1.5,
          `zoom geometry ${actual} != ${expected}`,
        );
      }
      await inspect(
        `draw-zoom-${zoomActions}`,
        await download(`draw-zoom-${zoomActions}`),
        {
          regions: new Map([
            [
              0,
              [
                {
                  x: geometry[0],
                  y: geometry[1],
                  width: geometry[2],
                  height: geometry[3],
                },
              ],
            ],
          ]),
        },
      );
      await setGeometry(coverText);
      const normalized = await inspect(
        `canonical-zoom-${zoomActions}`,
        await download(`canonical-zoom-${zoomActions}`),
        { regions: new Map([[0, [coverText]]]) },
      );
      assert.equal(
        normalized.embedded[0].rasterHash,
        textProof.embedded[0].rasterHash,
        'Display zoom altered authoritative exported geometry',
      );
      await regionBoxes();
      const resizeHandle = await page
        .locator('.redaction-resize-handle')
        .first()
        .boundingBox();
      const currentScale = (await surface.boundingBox()).width / 500;
      await page.mouse.move(
        resizeHandle.x + resizeHandle.width / 2,
        resizeHandle.y + resizeHandle.height / 2,
      );
      await page.mouse.down();
      await page.mouse.move(
        resizeHandle.x + resizeHandle.width / 2 + 20 * currentScale,
        resizeHandle.y + resizeHandle.height / 2 + 10 * currentScale,
        { steps: 6 },
      );
      await page.mouse.up();
      const resized = (await regionBoxes())[0];
      for (const [index, expected] of [40, 315, 240, 50].entries())
        assert(Math.abs(resized[index] - expected) < 1);
      const proposal = await page
        .locator('.redaction-proposal[data-pdf-box]')
        .first()
        .boundingBox();
      await page.mouse.move(
        proposal.x + proposal.width / 2,
        proposal.y + proposal.height / 2,
      );
      await page.mouse.down();
      await page.mouse.move(
        proposal.x + proposal.width / 2 + 10 * currentScale,
        proposal.y + proposal.height / 2 + 15 * currentScale,
        { steps: 6 },
      );
      await page.mouse.up();
      const moved = (await regionBoxes())[0];
      for (const [index, expected] of [50, 300, 240, 50].entries())
        assert(Math.abs(moved[index] - expected) < 1);
      await button('Undo').click();
      await button('Undo').click();
      assert.deepEqual(await regionBoxes(), [Object.values(coverText)]);
      const staleSurface = await surface.boundingBox();
      await page.mouse.move(
        staleSurface.x + 300 * currentScale,
        staleSurface.y + 120 * currentScale,
      );
      await page.mouse.down();
      await page.mouse.move(
        staleSurface.x + 340 * currentScale,
        staleSurface.y + 160 * currentScale,
      );
      await button('Zoom in').evaluate((element) => element.click());
      await page.waitForFunction(
        (previousWidth) =>
          document.querySelector('.pdf-page-surface').getBoundingClientRect()
            .width > previousWidth,
        staleSurface.width,
      );
      await page.mouse.up();
      assert.deepEqual(
        await regionBoxes(),
        [Object.values(coverText)],
        'Stale drawing gesture survived zoom',
      );
      results.push({
        name: `pointer-history-zoom-${zoomActions}`,
        pointerMove: 'PASS',
        pointerResize: 'PASS',
        staleGesture: 'PASS',
        canonicalRasterIdentical: true,
      });
    }
    await fresh(form);
    await page
      .getByRole('textbox', { name: 'Account', exact: true })
      .fill('ACCOUNT-123456');
    await page
      .getByRole('textbox', { name: 'Account', exact: true })
      .press('Tab');
    await button('Create visual signature').click();
    await page.getByRole('tab', { name: 'Type', exact: true }).click();
    await page
      .getByLabel('Signature text', { exact: true })
      .fill('SECRET SIGNATURE');
    await button('Use signature').click();
    const surface = await page
      .locator('.pdf-page-surface')
      .first()
      .boundingBox();
    await page.mouse.click(surface.x + 280, surface.y + 200);
    await button('Redact').click();
    await addRegion(full);
    await inspect('form-signature-ui', await download('form-signature-ui'), {
      regions: new Map([[0, [full]]]),
    });
    await fresh(ten);
    await button('Redact').click();
    await addRegion(coverText);
    const tenResult = await inspect(
      'ten-one-affected',
      await download('ten-one-affected'),
      { regions: new Map([[0, [coverText]]]) },
    );
    assert.equal(tenResult.report.length, 10);
    assert(tenResult.report[1].text.includes('PUBLIC PAGE 2'));
    assert(
      tenResult.report
        .slice(1)
        .every((entry) => entry.images === 0 && entry.textOperators > 0),
    );
    await button('Extract pages').click();
    await page.getByLabel('Pages to extract').fill('1');
    await inspect(
      'extract-redacted',
      await download('extract-redacted', button('Create PDF')),
      { regions: new Map([[0, [coverText]]]) },
    );
    // Ordinary unrelated documents can coincidentally use identical resource
    // identifiers. The conservative guard rejects that collision rather than
    // exempting source-controlled names that could contain covered information.
    const commonAliasSource = await fixture('other-common-alias', {
      publicOnly: true,
    });
    await fresh([plain, commonAliasSource]);
    await button('Redact').click();
    await addRegion(coverText);
    let unexpectedDownloads = 0;
    const recordUnexpectedDownload = () => unexpectedDownloads++;
    page.on('download', recordUnexpectedDownload);
    await button('Download PDF').click();
    const collisionAlert = page.locator('.export-error[role=alert]');
    await collisionAlert.waitFor();
    const collisionMessage = await collisionAlert.innerText();
    assert(collisionMessage.includes('cannot safely export these redactions'));
    assert.equal(
      unexpectedDownloads,
      0,
      'Fail-closed export produced a download',
    );
    page.off('download', recordUnexpectedDownload);
    assert.deepEqual(await regionBoxes(), [Object.values(coverText)]);
    results.push({
      name: 'common-resource-alias-collision-ui',
      rejected: 'redaction-unsafe-retention',
      message: collisionMessage,
      proposalsPreserved: true,
      downloads: unexpectedDownloads,
    });
    await button('Extract pages').click();
    await page.getByLabel('Pages to extract').fill('1');
    await inspect(
      'extract-after-alias-rejection',
      await download('extract-after-alias-rejection', button('Create PDF')),
      { regions: new Map([[0, [coverText]]]) },
    );
    const publicSource = await fixture('other', {
      publicOnly: true,
      publicFontFamily: lib.StandardFonts.TimesRoman,
    });
    await fresh([plain, publicSource]);
    await button('Redact').click();
    await addRegion(coverText);
    await button('Move page 2 up').click();
    const mixed = await inspect(
      'distinct-sources-reordered',
      await download('distinct-sources-reordered'),
      { affected: [1], regions: new Map([[1, [coverText]]]) },
    );
    assert(
      mixed.report[0].text.includes('PUBLIC OTHER SOURCE'),
      'unaffected mixed source lost text',
    );
    assert.equal(mixed.report[1].text, '');
    await button('Delete page 2').click();
    assert.equal((await regionBoxes()).length, 0);
    const deleted = await download('deleted-redaction');
    const deletedProof = await inspect('deleted-redaction', deleted, {
      affected: [],
    });
    assert.equal(deletedProof.doc.getPageCount(), 1);
    assert(deletedProof.report[0].text.includes('PUBLIC OTHER SOURCE'));
    await button('Start over').click();
    await page
      .locator('input[type=file][accept="application/pdf,.pdf"]')
      .setInputFiles(plain.file);
    await page.locator('.pdf-canvas[data-ready=true]').first().waitFor();
    assert.equal((await regionBoxes()).length, 0);
    assert(await button('Undo').isDisabled());
    // Each opened occurrence has a distinct workspace identity, even when two
    // File objects have identical bytes and filenames. Both secret-bearing
    // copies must be sanitized; preserving an original copy is fail-closed.
    await fresh([plain, plain]);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal(await page.locator('.thumbnail-select').count(), 2);
    await button('Redact').click();
    await addRegion(coverText);
    const redactionPageSelect = page.getByLabel('Redactions on page', {
      exact: true,
    });
    await redactionPageSelect.focus();
    await redactionPageSelect.press('Home');
    await redactionPageSelect.press('ArrowDown');
    await redactionPageSelect.press('Enter');
    assert.equal(
      await redactionPageSelect.evaluate((select) => select.selectedIndex),
      1,
    );
    await page
      .locator('.pdf-page-surface')
      .nth(1)
      .locator('.pdf-canvas[data-ready=true]')
      .waitFor();
    await button('Add redaction region').focus();
    await button('Add redaction region').press('Enter');
    await setGeometry(full);
    assert.equal(
      await page
        .locator('.pdf-page-surface')
        .nth(0)
        .locator('[data-redaction-id]')
        .count(),
      1,
    );
    assert.equal(
      await page
        .locator('.pdf-page-surface')
        .nth(1)
        .locator('[data-redaction-id]')
        .count(),
      1,
    );
    await button('Move page 2 up').click();
    const duplicated = await inspect(
      'duplicate-sources-reordered',
      await download('duplicate-sources-reordered'),
      {
        affected: [0, 1],
        regions: new Map([
          [0, [full]],
          [1, [coverText]],
        ]),
      },
    );
    assert.equal(duplicated.report.length, 2);
    assert.notEqual(
      duplicated.embedded[0].rasterHash,
      duplicated.embedded[1].rasterHash,
      'Duplicate source proposals lost their distinct page identities',
    );
    await fresh(plain);
    await button('Redact').click();
    await addRegion(coverText);
    await page
      .locator('input[type=file][accept="application/pdf,.pdf"]')
      .setInputFiles(publicSource.file);
    workspaceSourceBytes += publicSource.bytes.length;
    await page.waitForFunction(
      () => document.querySelectorAll('.thumbnail-select').length === 2,
    );
    await page.waitForFunction(
      () => !document.body.innerText.includes('Checking this PDF'),
    );
    assert.deepEqual(await regionBoxes(), [Object.values(coverText)]);
    await button('Undo').click();
    assert.notDeepEqual(await regionBoxes(), [Object.values(coverText)]);
    await button('Redo').click();
    assert.deepEqual(await regionBoxes(), [Object.values(coverText)]);
    const afterAdd = await inspect(
      'add-pdf-after-redaction',
      await download('add-pdf-after-redaction'),
      {
        regions: new Map([[0, [coverText]]]),
      },
    );
    assert.equal(afterAdd.report.length, 2);
    assert(afterAdd.report[1].text.includes('PUBLIC OTHER SOURCE'));
    await button('Start over').click();
    await page
      .locator('input[type=file][accept="application/pdf,.pdf"]')
      .setInputFiles(plain.file);
    workspaceSourceBytes = plain.bytes.length;
    await page.locator('.pdf-canvas[data-ready=true]').first().waitFor();
    assert.equal((await regionBoxes()).length, 0);
    assert(await button('Undo').isDisabled());
    // Narrow layouts retain a semantic keyboard path and scoped horizontal scroll.
    for (const width of [768, 390, 360]) {
      await page.setViewportSize({ width, height: 844 });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      if ((await button('Redact').getAttribute('aria-pressed')) !== 'true')
        await button('Redact').click();
      await button('Add redaction region').focus();
      await button('Add redaction region').press('Enter');
      await page.getByLabel('Redaction X', { exact: true }).focus();
      assert(
        await page
          .getByLabel('Redaction X', { exact: true })
          .evaluate((input) => input === document.activeElement),
      );
      await page.screenshot({
        path: join(artifactRoot, `responsive-${width}.png`),
        fullPage: false,
      });
      await page.locator('.pdf-page-surface').first().scrollIntoViewIfNeeded();
      await page.locator('.pdf-canvas[data-ready=true]').first().waitFor();
      await page.screenshot({
        path: join(artifactRoot, `responsive-${width}-rendered.png`),
        fullPage: false,
      });
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
        `${width}: page overflow`,
      );
      await button('Remove pending redaction 1').click();
    }
    await page.setViewportSize({ width: 1440, height: 1100 });
  }
  if (!production) {
    for (const [name, boxes] of [
      ['partial-text', [{ x: 50, y: 335, width: 60, height: 25 }]],
      ['vector', [coverVector]],
      ['image', [coverImage]],
      ['overlap', [coverText, { x: 120, y: 315, width: 80, height: 60 }]],
      [
        'edges',
        [
          { x: 0, y: 0, width: 1, height: 400 },
          { x: 499, y: 399, width: 1, height: 1 },
        ],
      ],
      ['tiny', [{ x: 50.1, y: 340.1, width: 0.05, height: 0.05 }]],
    ]) {
      const output = await directExport(plain, name, { boxes });
      await inspect(name, output, { regions: new Map([[0, boxes]]) });
    }
    const annotations = [
      {
        id: 'text',
        workspacePageId: 'page-0',
        kind: 'text',
        box: {
          origin: { x: 260, y: 260 },
          width: 200,
          height: 30,
          rotation: 0,
        },
        text: 'SECRET-ANNOTATION-ALPHA',
        fontFamily: 'helvetica',
        fontSizeUserUnits: 12,
        lineHeight: 1.2,
        align: 'left',
        color: { r: 0, g: 0, b: 0 },
        opacity: 1,
      },
      {
        id: 'image',
        workspacePageId: 'page-0',
        kind: 'image',
        assetId: 'asset',
        box: {
          origin: { x: 260, y: 160 },
          width: 180,
          height: 80,
          rotation: 0,
        },
        opacity: 1,
      },
      {
        id: 'signature',
        workspacePageId: 'page-0',
        kind: 'signature',
        assetId: 'asset',
        method: 'upload',
        box: { origin: { x: 260, y: 70 }, width: 180, height: 80, rotation: 0 },
        opacity: 1,
      },
    ];
    const combined = await directExport(plain, 'all-annotations', {
      boxes: [full],
      annotations,
      asset: true,
    });
    await inspect('all-annotations', combined, {
      regions: new Map([[0, [full]]]),
    });
    for (const intrinsic of [0, 90, 180, 270])
      for (const delta of [0, 90, 180, 270]) {
        const rotated = await fixture(`rotation-${intrinsic}-${delta}`, {
          rotation: intrinsic,
        });
        const output = await directExport(
          rotated,
          `rotation-${intrinsic}-${delta}`,
          { boxes: [coverText], rotationDelta: delta },
        );
        await inspect(`rotation-${intrinsic}-${delta}`, output, {
          rotations: [(intrinsic + delta) % 360],
          regions: new Map([[0, [coverText]]]),
        });
      }
    for (const userUnit of [1, 2]) {
      const cropped = await fixture(`crop-unit-${userUnit}`, {
        crop: true,
        userUnit,
      });
      const output = await directExport(cropped, `crop-unit-${userUnit}`, {
        boxes: [coverText, coverImage],
      });
      await inspect(`crop-unit-${userUnit}`, output, {
        crops: new Map([[0, cropped.crop]]),
        regions: new Map([[0, [coverText, coverImage]]]),
      });
    }
    const imageHeavy = await fixture('image-heavy', { imageHeavy: true });
    await inspect(
      'image-heavy',
      await directExport(imageHeavy, 'image-heavy', { boxes: [coverImage] }),
      { regions: new Map([[0, [coverImage]]]) },
    );
    const several = await fixture('several', { count: 3 });
    const severalOutput = await directExport(several, 'several-affected', {
      redactionPageIndices: [0, 1, 2],
    });
    await inspect('several-affected', severalOutput, {
      affected: [0, 1, 2],
      regions: new Map([
        [0, [coverText]],
        [1, [coverText]],
        [2, [coverText]],
      ]),
    });
    for (const [name, box] of [
      ['nonfinite', { x: Infinity, y: 10, width: 10, height: 10 }],
      ['nan', { x: 10, y: NaN, width: 10, height: 10 }],
      ['zero', { x: 10, y: 10, width: 0, height: 10 }],
      ['negative', { x: 10, y: 10, width: -5, height: 10 }],
      ['outside', { x: 600, y: 10, width: 10, height: 10 }],
    ])
      await directExport(plain, `invalid-${name}`, {
        boxes: [box],
        expectedError: true,
      });
    await directExport(plain, 'abort-before', {
      abort: true,
      expectedError: 'aborted',
    });
    await directExport(plain, 'abort-building', {
      abortOnBuilding: true,
      expectedError: 'aborted',
    });
    await directExport(plain, 'canvas-failure', {
      canvasFailure: true,
      expectedError: true,
    });
    const huge = await fixture('huge', { huge: true });
    await directExport(huge, 'huge-page', { expectedError: true });
    const shared = await fixture('shared', { count: 2, sharedImage: true });
    await directExport(shared, 'shared-original-image', {
      expectedError: true,
    });
    const linked = await fixture('linked', { count: 2, crossPageLink: true });
    await directExport(linked, 'hidden-original-page', { expectedError: true });
    const cmapShared = await fixture('shared-cmap', {
      count: 2,
      sharedToUnicode: true,
    });
    await directExport(cmapShared, 'shared-ToUnicode-secret', {
      expectedError: true,
    });
    const alternate = await fixture('alternate', {
      count: 2,
      alternateRepresentation: true,
    });
    await directExport(alternate, 'alternate-representation', {
      expectedError: true,
    });
    for (const kind of ['string', 'name', 'number']) {
      const unknown = await fixture(`unknown-resource-${kind}`, {
        count: 2,
        customResource: kind,
      });
      await directExport(unknown, `unknown-resource-${kind}`, {
        expectedError: 'redaction-unsafe-retention',
      });
    }
    const privateFont = await fixture('private-font-metadata', {
      count: 2,
      privateFontMetadata: true,
    });
    await directExport(privateFont, 'private-font-metadata', {
      expectedError: 'redaction-unsafe-retention',
    });
    const malformedFont = await fixture('malformed-font-resource', {
      count: 2,
      malformedFontResource: true,
    });
    await directExport(malformedFont, 'malformed-font-resource', {
      expectedError: 'redaction-unsafe-retention',
    });
    const keyedFont = await fixture('shared-resource-key', {
      count: 2,
      sharedResourceKey: true,
    });
    await directExport(keyedFont, 'shared-resource-key', {
      expectedError: 'redaction-unsafe-retention',
    });
    const numericKeyedFont = await fixture('shared-numeric-resource-key', {
      count: 2,
      sharedResourceKey: 'numeric',
    });
    await directExport(numericKeyedFont, 'shared-numeric-resource-key', {
      expectedError: 'redaction-unsafe-retention',
    });
    const numericSharedFont = await fixture('shared-numeric-font-metadata', {
      count: 2,
      sharedNumericFontMetadata: true,
    });
    await directExport(numericSharedFont, 'shared-numeric-font-metadata', {
      expectedError: 'redaction-unsafe-retention',
    });
    await directExport(
      numericSharedFont,
      'cross-instance-numeric-font-metadata',
      {
        crossInstance: true,
        expectedError: 'redaction-unsafe-retention',
      },
    );
    const numericSharedState = await fixture('shared-numeric-graphics-state', {
      count: 2,
      sharedNumericGraphicsState: true,
    });
    await directExport(
      numericSharedState,
      'cross-instance-numeric-graphics-state',
      {
        crossInstance: true,
        expectedError: 'redaction-unsafe-retention',
      },
    );
    const preservedAnnotation = {
      ...annotations[0],
      id: 'public-text',
      workspacePageId: 'page-1',
      text: 'PUBLIC ANNOTATION',
    };
    const rectangle = {
      id: 'redacted-rectangle',
      workspacePageId: 'page-0',
      kind: 'rectangle',
      box: { origin: { x: 30, y: 170 }, width: 140, height: 60, rotation: 0 },
      stroke: {
        color: { r: 0.2, g: 0.6, b: 0.9 },
        widthUserUnits: 2,
        opacity: 1,
      },
      fill: null,
    };
    const annotatedMixed = await directExport(ten, 'preserved-annotation', {
      annotations: [annotations[0], rectangle],
      preservedAnnotations: [
        preservedAnnotation,
        { ...rectangle, id: 'preserved-rectangle', workspacePageId: 'page-1' },
      ],
    });
    const annotatedReport = await inspect(
      'preserved-annotation',
      annotatedMixed,
      { regions: new Map([[0, [coverText]]]) },
    );
    assert(annotatedReport.report[1].text.includes('PUBLIC ANNOTATION'));
    const unsafeGlyph = [{ ...annotations[0], text: 'Unsupported: \u{1f680}' }];
    await directExport(plain, 'glyph-safety', {
      annotations: unsafeGlyph,
      expectedError: 'unsupported-text-font',
    });
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(
    requests,
    [],
    'ordinary redaction or export made a non-GET request',
  );
  assert(
    await page.evaluate(
      () => localStorage.length === 0 && sessionStorage.length === 0,
    ),
    'editor persisted data',
  );
  console.log('PHASE_5A_BROWSER_PASSED');
} catch (error) {
  await page.screenshot({
    path: join(artifactRoot, 'failure.png'),
    fullPage: true,
  });
  console.error(await page.locator('body').innerText());
  throw error;
} finally {
  await writeFile(
    join(artifactRoot, 'phase5a-browser.json'),
    JSON.stringify(
      {
        appUrl,
        verifierUrl,
        production,
        qpdf: qpdfAvailable ? qpdfProbe.stdout.trim() : 'unavailable',
        results,
        performance,
        errors,
        requests,
        memoryNote:
          'Decoded RGB and RGBA dimensions are lower-bound allocations, not process peak measurements.',
      },
      null,
      2,
    ),
  );
  await browser.close();
}
