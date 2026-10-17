import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

// No application test hooks. Accepted artifacts are real browser exports or
// downloads, independently reloaded with PDF.js, pdf-lib and required CI qpdf.
// All fixtures, modified negative controls and screenshots remain outside Git.
const require = createRequire(import.meta.url);
const { chromium } = require(
  process.env.KAGAZ_PLAYWRIGHT_MODULE || 'playwright',
);
const lib = require('../apps/web/node_modules/pdf-lib');
assert(
  process.env.KAGAZ_ARTIFACT_DIR,
  'Set KAGAZ_ARTIFACT_DIR outside the repository.',
);
const root = join(process.env.KAGAZ_ARTIFACT_DIR, 'phase5c');
await mkdir(root, { recursive: true });
const appUrl = process.env.KAGAZ_APP_URL || 'http://127.0.0.1:5173';
const verifierUrl = process.env.KAGAZ_VERIFIER_URL || 'http://127.0.0.1:5173';
const production = process.argv.includes('--production');
const directOnly = process.argv.includes('--direct');
const uiOnly = process.argv.includes('--ui');
const normalizationOnly = process.argv.includes('--normalization');
const qpdf = process.env.KAGAZ_QPDF_PATH || process.env.QPDF_PATH || 'qpdf';
const probe = spawnSync(qpdf, ['--version'], { encoding: 'utf8' });
const qpdfAvailable = probe.status === 0;
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
const results = [],
  measurements = [],
  errors = [],
  requests = [];
let completed = false;
context.on('page', (current) =>
  current.on('pageerror', (error) => errors.push(error.message)),
);
context.on('request', (request) => {
  if (request.method() !== 'GET')
    requests.push({ method: request.method(), url: request.url() });
});
const page = await context.newPage();
const verifier = await context.newPage();
page.setDefaultTimeout(30000);
page.on('dialog', (dialog) => dialog.accept());
await Promise.all([page.goto(appUrl), verifier.goto(verifierUrl)]);
const button = (name) => page.getByRole('button', { name, exact: true });
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const canonical = (text) => text.replace(/\r\n?/g, '\n').normalize('NFC');
const compact = (text) => canonical(text).replace(/\s+/gu, ' ').trim();
const fontPath = join(
  'apps',
  'web',
  'src',
  'assets',
  'fonts',
  'NotoSans-Regular.ttf',
);
const green = { r: 0.1, g: 0.7, b: 0.2 };
const supported = [
  ['latin', 'Kagaz Unicode text'],
  ['latin-extended', 'Été Ångström Łódź café'],
  ['greek', 'Ελληνικά Καλημέρα'],
  ['cyrillic', 'Привет мир Україна'],
  ['combining-nfc', 'Cafe\u0301 A\u030A'],
];
const unsupported = [
  ['hindi', 'नमस्ते'],
  ['marathi', 'मराठी भाषा'],
  ['devanagari-document', 'कागदपत्र'],
  ['devanagari-student', 'विद्यार्थी'],
  ['devanagari-project', 'प्रकल्प'],
  ['devanagari-conjunct', 'क्षेत्र'],
  ['devanagari-vowel-sign', 'कृपया'],
  ['devanagari-virama', 'हिन्दी'],
  ['devanagari-mixed', 'Kagaz कागदपत्र १२३'],
  ['devanagari-joiners', 'क्\u200dष क्\u200cष'],
  ['devanagari-repeated-conjuncts', 'प्र प्र प्र क्ष क्ष ज्ञ ज्ञ'],
  ['devanagari-reordered-matras', 'कि की कु कृ के कै को कौ । १२३'],
  ['devanagari-mixed-punctuation', 'Kagaz नमस्ते १२३; हिन्दी, मराठी!'],
  ['arabic', 'مرحبا'],
  ['hebrew', 'שלום'],
  ['bengali', 'বাংলা'],
  ['tamil', 'தமிழ்'],
  ['cjk', '中文'],
  ['emoji', '🙂'],
  ['uncomposable-mark', 'q\u0307'],
];

function annotation(text, changes = {}) {
  return {
    id: 'unicode-annotation',
    workspacePageId: 'page-0',
    kind: 'text',
    box: { origin: { x: 40, y: 150 }, width: 420, height: 100, rotation: 0 },
    text,
    fontFamily: 'noto-sans',
    fontSizeUserUnits: 24,
    lineHeight: 1.2,
    align: 'left',
    color: green,
    opacity: 1,
    ...changes,
  };
}
function watermark(text, changes = {}) {
  return {
    id: 'unicode-watermark',
    kind: 'text',
    text,
    fontFamily: 'noto-sans',
    fontSize: 36,
    color: green,
    opacity: 0.8,
    rotation: 0,
    scale: 1,
    position: 'center',
    customPosition: { x: 0.5, y: 0.5 },
    target: { kind: 'all' },
    ...changes,
  };
}

async function fixture(
  name,
  {
    count = 1,
    rotation = 0,
    crop = false,
    userUnit = 1,
    forms = false,
    unicodeSource = false,
    blank = false,
  } = {},
) {
  const doc = await lib.PDFDocument.create();
  doc.setCreationDate(new Date('2020-01-01T00:00:00Z'));
  doc.setModificationDate(new Date('2020-01-01T00:00:00Z'));
  let font;
  if (unicodeSource) {
    const fontkit = require('../apps/web/node_modules/@pdf-lib/fontkit');
    doc.registerFontkit(fontkit);
    font = await doc.embedFont(await readFile(fontPath), { subset: false });
  }
  for (let index = 0; index < count; index++) {
    const current = doc.addPage([500, 400]);
    current.setRotation(lib.degrees(rotation));
    if (crop) {
      current.setMediaBox(-20, -30, 550, 460);
      current.setCropBox(20, 30, 440, 340);
    }
    if (userUnit !== 1)
      current.node.set(lib.PDFName.of('UserUnit'), lib.PDFNumber.of(userUnit));
    if (!blank)
      current.drawText(
        unicodeSource
          ? 'SECRET ÉΛЖ КОНФИДЕНЦИАЛЬНО'
          : `PUBLIC PAGE ${index + 1}`,
        {
          x: 40,
          y: 340,
          size: 18,
          ...(font ? { font } : {}),
        },
      );
  }
  let fields = [];
  if (forms) {
    const field = doc.getForm().createTextField('Unicode value');
    field.setText('Original');
    field.addToPage(doc.getPage(0), { x: 40, y: 280, width: 360, height: 35 });
    field.setFontSize(14);
    fields = [
      {
        name: 'Unicode value',
        kind: 'text',
        value: 'Original',
        changed: false,
        readOnly: false,
        options: [],
        multiSelect: false,
      },
    ];
    if (forms === 'matrix') {
      const fontkit = require('../apps/web/node_modules/@pdf-lib/fontkit');
      doc.registerFontkit(fontkit);
      const choiceFont = await doc.embedFont(await readFile(fontPath), {
        subset: false,
      });
      const multiline = doc.getForm().createTextField('Multiline value');
      multiline.enableMultiline();
      multiline.setText('Original multiline');
      multiline.addToPage(doc.getPage(0), {
        x: 40,
        y: 170,
        width: 360,
        height: 85,
      });
      multiline.setFontSize(14);
      fields.push({
        name: 'Multiline value',
        kind: 'multiline-text',
        value: 'Original multiline',
        changed: false,
        readOnly: false,
        options: [],
        multiSelect: false,
      });
      const dropdown = doc.getForm().createDropdown('Unicode choice');
      const choices = ['Original choice', 'Καλημέρα', 'Привет'];
      dropdown.setOptions(choices);
      dropdown.select('Original choice');
      dropdown.addToPage(doc.getPage(0), {
        x: 40,
        y: 115,
        width: 180,
        height: 35,
        font: choiceFont,
      });
      dropdown.updateAppearances(choiceFont);
      fields.push({
        name: 'Unicode choice',
        kind: 'dropdown',
        value: 'Original choice',
        changed: false,
        readOnly: false,
        options: choices.map((value) => ({
          exportValue: value,
          displayValue: value,
        })),
        multiSelect: false,
      });
      const list = doc.getForm().createOptionList('Unicode list');
      list.setOptions(choices);
      list.enableMultiselect();
      list.select('Original choice');
      list.addToPage(doc.getPage(0), {
        x: 270,
        y: 40,
        width: 180,
        height: 110,
        font: choiceFont,
      });
      list.updateAppearances(choiceFont);
      fields.push({
        name: 'Unicode list',
        kind: 'option-list',
        value: ['Original choice'],
        changed: false,
        readOnly: false,
        options: choices.map((value) => ({
          exportValue: value,
          displayValue: value,
        })),
        multiSelect: true,
      });
    }
  }
  const bytes = Array.from(await doc.save({ useObjectStreams: false }));
  const file = join(root, `${name}-source.pdf`);
  await writeFile(file, new Uint8Array(bytes));
  return { bytes, file, count, fields, rotation, userUnit };
}

async function directExport(
  source,
  name,
  {
    annotations = [],
    mark = null,
    redactions = [],
    order = null,
    rotationDelta = 0,
    fields = source.fields,
    abort = false,
    mutate = false,
    fontBytes = null,
    sourceCount = 1,
    additionalSources = [],
    expectedError = null,
  } = {},
) {
  await verifier.bringToFront();
  const result = await verifier.evaluate(
    async ({
      source,
      annotations,
      mark,
      redactions,
      order,
      rotationDelta,
      fields,
      abort,
      mutate,
      fontBytes,
      sourceCount,
      additionalSources,
    }) => {
      const { exportWorkspace } =
        await import('/src/lib/pdf-export/exportWorkspace.ts');
      const allSources = [
        ...Array.from({ length: sourceCount }, () => source),
        ...additionalSources,
      ];
      const sourceIds = Array.from({ length: allSources.length }, (_, index) =>
        index === 0 ? 'source' : `source-${index}`,
      );
      const logical = [];
      allSources.forEach((currentSource, sourceIndex) => {
        for (
          let sourcePageIndex = 0;
          sourcePageIndex < currentSource.count;
          sourcePageIndex++
        )
          logical.push({
            id: `page-${logical.length}`,
            sourceDocumentId: sourceIds[sourceIndex],
            sourcePageIndex,
            rotationDelta,
          });
      });
      const controller = new AbortController();
      if (abort) controller.abort();
      const request = {
        pages: order ? order.map((index) => logical[index]) : logical,
        sources: new Map(
          sourceIds.map((id, sourceIndex) => [
            id,
            {
              id,
              file: new File(
                [new Uint8Array(allSources[sourceIndex].bytes)],
                'synthetic.pdf',
                {
                  type: 'application/pdf',
                },
              ),
              fileName: 'synthetic.pdf',
            },
          ]),
        ),
        annotationsByPage: new Map(
          logical.map((current) => [
            current.id,
            annotations.filter((item) => item.workspacePageId === current.id),
          ]),
        ),
        imageAssets: new Map(),
        fontAssets: fontBytes
          ? new Map([['noto-sans', new Uint8Array(fontBytes)]])
          : undefined,
        forms: {
          hasChangedTextDraft: false,
          sources: sourceIds.map((id) => ({
            sourceDocumentId: id,
            capability: fields.length ? 'safe-acroform' : 'plain',
            fields,
          })),
        },
        watermark: mark,
        redactionsByPage: new Map(
          redactions.map(({ pageIndex, box }) => [
            `page-${pageIndex}`,
            [
              {
                id: `redaction-${pageIndex}`,
                pageId: `page-${pageIndex}`,
                box,
              },
            ],
          ]),
        ),
      };
      const start = performance.now();
      const beforeHeap = performance.memory?.usedJSHeapSize ?? null;
      try {
        const pending = exportWorkspace(request, { signal: controller.signal });
        if (mutate) {
          request.sources.get('source').file = new File(
            [new Uint8Array([0, 1, 2])],
            'later-change.pdf',
            {
              type: 'application/pdf',
            },
          );
          request.sources.get('source').fileName = 'later-change.pdf';
          request.pages[0].rotationDelta = 180;
          request.sources.clear();
          if (mark) {
            mark.text = 'LATER CHANGE';
            mark.fontFamily = 'helvetica';
          }
          for (const item of annotations) {
            item.text = 'LATER CHANGE';
            item.fontFamily = 'helvetica';
          }
          request.fontAssets?.get('noto-sans')?.fill(0);
        }
        return {
          bytes: Array.from(await pending),
          elapsedMs: performance.now() - start,
          beforeHeap,
          afterHeap: performance.memory?.usedJSHeapSize ?? null,
        };
      } catch (error) {
        return {
          error: error.code,
          message: error.message,
          elapsedMs: performance.now() - start,
        };
      }
    },
    {
      source,
      annotations,
      mark,
      redactions,
      order,
      rotationDelta,
      fields,
      abort,
      mutate,
      fontBytes,
      sourceCount,
      additionalSources,
    },
  );
  if (expectedError) {
    assert(result.error, `${name}: unsafe operation succeeded`);
    if (expectedError !== true)
      assert.equal(result.error, expectedError, `${name}: ${result.message}`);
    const row = {
      name,
      rejected: result.error,
      message: result.message,
      elapsedMs: result.elapsedMs,
    };
    results.push(row);
    console.log(JSON.stringify(row));
    return null;
  }
  assert(!result.error, `${name}: ${result.error}: ${result.message}`);
  const output = {
    bytes: new Uint8Array(result.bytes),
    file: join(root, `${name}.pdf`),
  };
  await writeFile(output.file, output.bytes);
  measurements.push({
    name,
    inputBytes:
      source.bytes.length * sourceCount +
      additionalSources.reduce(
        (total, current) => total + current.bytes.length,
        0,
      ),
    outputBytes: output.bytes.length,
    ...Object.fromEntries(
      Object.entries(result).filter(([key]) => key !== 'bytes'),
    ),
  });
  return output;
}

function fontEvidence(doc) {
  const fonts = [];
  for (const [ref, object] of doc.context.enumerateIndirectObjects()) {
    if (
      !(object instanceof lib.PDFDict) ||
      object.get(lib.PDFName.of('Subtype'))?.toString() !== '/Type0'
    )
      continue;
    const cmap = object.lookupMaybe(
      lib.PDFName.of('ToUnicode'),
      lib.PDFRawStream,
    );
    assert(cmap, 'Custom font has no ToUnicode mapping.');
    const mappings = Buffer.from(
      lib.decodePDFRawStream(cmap).decode(),
    ).toString('ascii');
    assert(
      mappings.includes('beginbf'),
      'ToUnicode has no character mappings.',
    );
    const descendant = object
      .lookup(lib.PDFName.of('DescendantFonts'), lib.PDFArray)
      .lookup(0, lib.PDFDict);
    const descriptor = descendant.lookup(
      lib.PDFName.of('FontDescriptor'),
      lib.PDFDict,
    );
    const embedded =
      descriptor.lookupMaybe(lib.PDFName.of('FontFile2'), lib.PDFRawStream) ??
      descriptor.lookupMaybe(lib.PDFName.of('FontFile3'), lib.PDFRawStream);
    assert(embedded, 'Custom font is not embedded.');
    const fontBytes = lib.decodePDFRawStream(embedded).decode();
    assert(fontBytes.length > 1000, 'Empty/truncated embedded font.');
    fonts.push({
      ref: ref.toString(),
      baseFont: object.get(lib.PDFName.of('BaseFont')).toString(),
      embeddedBytes: fontBytes.length,
      sha256: hash(fontBytes),
      toUnicodeBytes: mappings.length,
      mappings,
    });
  }
  return fonts;
}

async function render(output, { screenshots = false } = {}) {
  await verifier.bringToFront();
  return verifier.evaluate(
    async ({ bytes, screenshots }) => {
      const pdfjs = await import('/node_modules/pdfjs-dist/build/pdf.mjs');
      pdfjs.GlobalWorkerOptions.workerSrc =
        '/node_modules/pdfjs-dist/build/pdf.worker.mjs';
      const task = pdfjs.getDocument({
        data: new Uint8Array(bytes),
        useSystemFonts: false,
      });
      const doc = await task.promise,
        pages = [];
      if (screenshots) {
        document.body.replaceChildren();
        document.body.style.cssText =
          'background:#ddd;padding:20px;display:flex;flex-wrap:wrap;gap:20px';
      }
      try {
        for (let index = 1; index <= doc.numPages; index++) {
          const current = await doc.getPage(index);
          const viewport = current.getViewport({ scale: 1 });
          const canvas = document.createElement('canvas');
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          const ctx = canvas.getContext('2d', { alpha: false });
          await current.render({ canvas, canvasContext: ctx, viewport })
            .promise;
          const pixels = ctx.getImageData(
            0,
            0,
            canvas.width,
            canvas.height,
          ).data;
          let left = canvas.width,
            right = -1,
            top = canvas.height,
            bottom = -1,
            greenPixels = 0,
            darkPixels = 0;
          for (let y = 0; y < canvas.height; y++)
            for (let x = 0; x < canvas.width; x++) {
              const at = (y * canvas.width + x) * 4;
              if (pixels[at] < 80 && pixels[at + 1] < 80 && pixels[at + 2] < 80)
                darkPixels++;
              if (
                pixels[at + 1] > pixels[at] + 12 &&
                pixels[at + 1] > pixels[at + 2] + 12
              ) {
                greenPixels++;
                left = Math.min(left, x);
                right = Math.max(right, x);
                top = Math.min(top, y);
                bottom = Math.max(bottom, y);
              }
            }
          const items = (await current.getTextContent()).items.filter(
            (item) => 'str' in item,
          );
          const ops = await current.getOperatorList();
          const textOperators = ops.fnArray.filter((op) =>
            [
              pdfjs.OPS.showText,
              pdfjs.OPS.showSpacedText,
              pdfjs.OPS.nextLineShowText,
              pdfjs.OPS.nextLineSetSpacingShowText,
            ].includes(op),
          ).length;
          pages.push({
            page: index,
            text: items.map((item) => item.str).join(' '),
            rotation: current.rotate,
            width: canvas.width,
            height: canvas.height,
            textOperators,
            annotations: (await current.getAnnotations()).length,
            greenPixels,
            darkPixels,
            greenBounds: greenPixels
              ? {
                  x: left,
                  y: top,
                  width: right - left + 1,
                  height: bottom - top + 1,
                }
              : null,
            items: items.map((item) => ({
              str: item.str,
              width: item.width,
              height: item.height,
              transform: item.transform,
            })),
            image:
              screenshots && index <= 3 ? canvas.toDataURL('image/png') : null,
          });
          if (screenshots && index <= 3) {
            const img = document.createElement('img');
            img.src = canvas.toDataURL('image/png');
            document.body.append(img);
          }
          canvas.width = 0;
          canvas.height = 0;
          current.cleanup();
        }
      } finally {
        await task.destroy();
      }
      return pages;
    },
    { bytes: Array.from(output.bytes), screenshots },
  );
}

async function inspect(
  name,
  output,
  {
    expected = [],
    excluded = [],
    affected = [],
    targeted = null,
    rotations = null,
    screenshots = false,
    fontCount = null,
  } = {},
) {
  const doc = await lib.PDFDocument.load(output.bytes, {
    throwOnInvalidObject: true,
  });
  assert.equal(doc.getForm().getFields().length, 0, `${name}: forms retained`);
  const fonts = fontEvidence(doc);
  if (fontCount !== null)
    assert.equal(
      fonts.length,
      fontCount,
      `${name}: duplicate/missing font embedding`,
    );
  const pages = await render(output, { screenshots });
  if (rotations)
    assert.deepEqual(
      pages.map((current) => current.rotation),
      rotations,
    );
  for (let index = 0; index < pages.length; index++) {
    const current = pages[index];
    for (const text of excluded)
      assert(
        !compact(current.text).includes(compact(text)),
        `${name}: excluded text retained`,
      );
    for (const text of expected)
      if (
        !affected.includes(index) &&
        (targeted === null || targeted.includes(index))
      )
        assert(
          compact(current.text).includes(compact(text)),
          `${name}: Unicode extraction mismatch: ${current.text}`,
        );
    if (
      expected.length &&
      !affected.includes(index) &&
      (targeted === null || targeted.includes(index))
    )
      assert(
        current.greenPixels > 8 || name.includes('form'),
        `${name}: expected visible glyphs absent`,
      );
    if (targeted && !targeted.includes(index))
      for (const text of expected)
        assert(
          !compact(current.text).includes(compact(text)),
          `${name}: Unicode mark on untargeted page`,
        );
    if (affected.includes(index)) {
      assert.equal(
        current.text,
        '',
        `${name}: redacted page text layer retained`,
      );
      assert.equal(current.textOperators, 0);
      assert.equal(current.annotations, 0);
      const resources = doc.getPage(index).node.Resources();
      assert.equal(
        resources.lookupMaybe(lib.PDFName.of('Font'), lib.PDFDict)?.keys()
          .length ?? 0,
        0,
      );
      const xobjects = resources.lookup(lib.PDFName.of('XObject'), lib.PDFDict);
      assert.equal(
        xobjects.keys().length,
        1,
        `${name}: alternative image/source resource`,
      );
      const raster = xobjects.lookup(xobjects.keys()[0], lib.PDFRawStream);
      assert.equal(
        raster.dict.get(lib.PDFName.of('Subtype')).toString(),
        '/Image',
      );
      assert(!raster.dict.has(lib.PDFName.of('SMask')));
      const pixels = lib.decodePDFRawStream(raster).decode();
      assert.equal(
        pixels.length,
        raster.dict.get(lib.PDFName.of('Width')).asNumber() *
          raster.dict.get(lib.PDFName.of('Height')).asNumber() *
          3,
      );
      let black = 0,
        foreground = 0;
      // Full-page fixtures: only sanitized exact black or newly intended green.
      // Neutral original glyph/background samples cannot pass this predicate.
      for (let at = 0; at < pixels.length; at += 3) {
        const [r, g, b] = pixels.subarray(at, at + 3);
        if (r === 0 && g === 0 && b === 0) black++;
        else {
          assert(
            g > r && g > b,
            `${name}: original pixels retained under Unicode foreground`,
          );
          foreground++;
        }
      }
      assert(black > 1000, `${name}: no actual protected pixels`);
      if (targeted === null || targeted.includes(index))
        assert(
          foreground > 8,
          `${name}: Unicode foreground absent from sanitized raster`,
        );
      current.embeddedRaster = {
        decodedBytes: pixels.length,
        blackPixels: black,
        foregroundPixels: foreground,
        sha256: hash(pixels),
      };
    }
  }
  if (qpdfAvailable) {
    const checked = spawnSync(qpdf, ['--check', output.file], {
      encoding: 'utf8',
    });
    assert.equal(
      checked.status,
      0,
      `${name}: qpdf rejected output: ${checked.stderr}`,
    );
  }
  if (screenshots)
    await verifier.screenshot({
      path: join(root, `${name}-render.png`),
      fullPage: true,
    });
  const row = {
    name,
    pages: pages.map(({ image, ...rest }) => rest),
    fonts: fonts.map(({ mappings, ...rest }) => rest),
    outputBytes: output.bytes.length,
    qpdf: qpdfAvailable ? 'PASS' : 'unavailable',
  };
  results.push(row);
  console.log(
    JSON.stringify({
      name,
      inspectedPages: pages.length,
      embeddedFonts: fonts.length,
      outputBytes: output.bytes.length,
      qpdf: row.qpdf,
    }),
  );
  await page.bringToFront();
  return { doc, pages, fonts };
}

async function visualReference(output, text, size = 24) {
  // Independently shaped browser FontFace, with real bundled bytes and no app
  // layout import. Baseline comes from PDF text geometry; the intended size and
  // native glyph outlines/advances do not come from the output font resource.
  const fontBytes = Array.from(await readFile(fontPath));
  const report = await verifier.evaluate(
    async ({ bytes, fontBytes, text, size }) => {
      const pdfjs = await import('/node_modules/pdfjs-dist/build/pdf.mjs');
      const task = pdfjs.getDocument({
        data: new Uint8Array(bytes),
        useSystemFonts: false,
      });
      const doc = await task.promise;
      const font = new FontFace(
        'Phase5CIndependentReference',
        new Uint8Array(fontBytes),
      );
      await font.load();
      document.fonts.add(font);
      const actual = document.createElement('canvas'),
        reference = document.createElement('canvas');
      try {
        const current = await doc.getPage(1),
          viewport = current.getViewport({ scale: 2 });
        for (const canvas of [actual, reference]) {
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
        }
        await current.render({
          canvas: actual,
          canvasContext: actual.getContext('2d'),
          viewport,
        }).promise;
        const items = (await current.getTextContent()).items;
        const item = items.find(
          (candidate) => candidate.str === text.normalize('NFC'),
        );
        assertReference(item, 'reference text item absent');
        const ctx = reference.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, reference.width, reference.height);
        ctx.fillStyle = 'rgb(26,179,51)';
        ctx.font = `${size * 2}px Phase5CIndependentReference`;
        ctx.fontKerning = 'none';
        const [x, y] = viewport.convertToViewportPoint(
          item.transform[4],
          item.transform[5],
        );
        ctx.fillText(text.normalize('NFC'), x, y);
        function footprint(canvas) {
          const pixels = canvas
            .getContext('2d')
            .getImageData(0, 0, canvas.width, canvas.height).data;
          const points = [];
          let left = canvas.width,
            right = -1,
            top = canvas.height,
            bottom = -1;
          for (let y = 0; y < canvas.height; y++)
            for (let x = 0; x < canvas.width; x++) {
              const at = (y * canvas.width + x) * 4;
              if (
                pixels[at + 1] > pixels[at] + 24 &&
                pixels[at + 1] > pixels[at + 2] + 24
              ) {
                points.push(y * canvas.width + x);
                left = Math.min(left, x);
                right = Math.max(right, x);
                top = Math.min(top, y);
                bottom = Math.max(bottom, y);
              }
            }
          return {
            points,
            bounds: {
              x: left,
              y: top,
              width: right - left + 1,
              height: bottom - top + 1,
            },
          };
        }
        const a = footprint(actual),
          r = footprint(reference),
          set = new Set(a.points);
        let close = 0;
        for (const point of r.points) {
          const x = point % actual.width,
            y = Math.floor(point / actual.width);
          if (
            [-2, -1, 0, 1, 2].some((dy) =>
              [-2, -1, 0, 1, 2].some((dx) =>
                set.has((y + dy) * actual.width + x + dx),
              ),
            )
          )
            close++;
        }
        return {
          actualBounds: a.bounds,
          referenceBounds: r.bounds,
          referencePixels: r.points.length,
          actualPixels: a.points.length,
          referenceMatchFraction: close / r.points.length,
          expectedSize: size,
          nativeAdvance: ctx.measureText(text.normalize('NFC')).width / 2,
          pdfAdvance: item.width,
        };
      } finally {
        actual.width = 0;
        reference.width = 0;
        document.fonts.delete(font);
        await task.destroy();
      }
      function assertReference(value, message) {
        if (!value) throw new Error(message);
      }
    },
    { bytes: Array.from(output.bytes), fontBytes, text, size },
  );
  assert(report.referencePixels > 50 && report.actualPixels > 50);
  assert(
    report.referenceMatchFraction >= 0.85,
    `independent visual glyph oracle failed: ${JSON.stringify(report)}`,
  );
  assert(
    Math.abs(report.actualBounds.width - report.referenceBounds.width) <= 5,
    `independent visual width oracle failed: ${JSON.stringify(report)}`,
  );
  assert(
    Math.abs(report.actualBounds.height - report.referenceBounds.height) <= 5,
    `independent visual height oracle failed: ${JSON.stringify(report)}`,
  );
  return report;
}

async function bundledFontSafety() {
  const original = Array.from(await readFile(fontPath));
  const evidence = await verifier.evaluate(async (original) => {
    const { validateBundledFontBytes, snapshotFontAssets } =
      await import('/src/lib/fonts/fontAssets.ts');
    const bytes = new Uint8Array(original);
    await validateBundledFontBytes(bytes);
    const candidates = [
      ['empty', new Uint8Array()],
      ['truncated', bytes.slice(0, bytes.length - 1)],
      ['oversized', new Uint8Array(bytes.length + 1)],
      ['collection-signature', Uint8Array.from(bytes)],
      ['table-overflow', Uint8Array.from(bytes)],
      ['changed-font-content', Uint8Array.from(bytes)],
    ];
    new DataView(candidates[3][1].buffer).setUint32(0, 0x74746366);
    new DataView(candidates[4][1].buffer).setUint32(20, 0xffffffff);
    candidates[5][1][bytes.length - 1] ^= 1;
    const rejected = [];
    for (const [name, candidate] of candidates) {
      const start = performance.now();
      let code = null;
      try {
        await validateBundledFontBytes(candidate);
      } catch (error) {
        code = error.code;
      }
      if (code !== 'invalid-font')
        throw new Error(`${name}: invalid bundled asset accepted`);
      rejected.push({ name, code, elapsedMs: performance.now() - start });
    }
    const controller = new AbortController();
    controller.abort();
    let cancelled = false;
    try {
      await snapshotFontAssets(['noto-sans'], controller.signal);
    } catch (error) {
      cancelled = error.name === 'AbortError';
    }
    if (!cancelled) throw new Error('pre-cancelled font request succeeded');
    const first = await snapshotFontAssets(['noto-sans']);
    first.get('noto-sans').fill(0);
    const second = await snapshotFontAssets(['noto-sans']);
    await validateBundledFontBytes(second.get('noto-sans'));
    return {
      trustedAssetBytes: bytes.length,
      invalidAssets: rejected,
      preAbort: cancelled,
      independentCopies: true,
    };
  }, original);
  results.push({
    name: 'bounded-bundled-font-validation-and-copy-lifecycle',
    ...evidence,
  });
}

async function embeddingAlternatives() {
  const fontkit = require('../apps/web/node_modules/@pdf-lib/fontkit');
  const bytes = await readFile(fontPath),
    text = 'Été Ελληνικά Привет';
  const rows = [];
  for (const subset of [false, true]) {
    const start = performance.now(),
      doc = await lib.PDFDocument.create();
    doc.registerFontkit(fontkit);
    const parsed = fontkit.create(bytes);
    const features = Object.fromEntries(
      parsed.availableFeatures.map((feature) => [feature, false]),
    );
    const font = await doc.embedFont(bytes, { subset, features });
    doc.addPage([500, 400]).drawText(text, {
      x: 40,
      y: 220,
      size: 24,
      font,
      color: lib.rgb(green.r, green.g, green.b),
    });
    const output = {
      bytes: await doc.save(),
      file: join(root, `independent-embedding-subset-${subset}.pdf`),
    };
    await writeFile(output.file, output.bytes);
    const elapsedMs = performance.now() - start;
    const checked = await inspect(
      `independent-embedding-subset-${subset}`,
      output,
      { expected: [text], fontCount: 1 },
    );
    await visualReference(output, text);
    rows.push({
      subset,
      bytes: output.bytes.length,
      embeddedBytes: checked.fonts[0].embeddedBytes,
      elapsedMs,
    });
  }
  results.push({
    name: 'standalone-font-embedding-alternatives',
    experimentalOnly: true,
    applicationPolicy: 'verified full embedding',
    rows,
  });
}

async function negativeControls(accepted, text) {
  // Correct visible glyphs with broken search/copy mapping: alter ToUnicode only.
  const badCopy = await lib.PDFDocument.load(accepted.bytes);
  const type0 = badCopy.context
    .enumerateIndirectObjects()
    .find(
      ([, object]) =>
        object instanceof lib.PDFDict &&
        object.get(lib.PDFName.of('Subtype'))?.toString() === '/Type0',
    )[1];
  const ref = type0.get(lib.PDFName.of('ToUnicode'));
  const cmap = Buffer.from(
    lib.decodePDFRawStream(badCopy.context.lookup(ref)).decode(),
  ).toString('ascii');
  const corrupted = cmap.replace(/beginbfchar[\s\S]*?endbfchar/g, (section) =>
    section.replace(/(<[0-9A-Fa-f]+>\s*)<([0-9A-Fa-f]{4,})>/g, '$1<0058>'),
  );
  assert.notEqual(corrupted, cmap);
  badCopy.context.assign(ref, badCopy.context.flateStream(corrupted));
  const wrongCopy = {
    bytes: await badCopy.save({ useObjectStreams: false }),
    file: join(root, 'counterexample-visible-glyphs-wrong-copy.pdf'),
  };
  await writeFile(wrongCopy.file, wrongCopy.bytes);
  const originalRendering = await render(accepted);
  const brokenCopyRendering = await render(wrongCopy);
  assert.deepEqual(
    brokenCopyRendering[0].greenBounds,
    originalRendering[0].greenBounds,
  );
  assert.equal(
    brokenCopyRendering[0].greenPixels,
    originalRendering[0].greenPixels,
  );
  await assert.rejects(
    inspect('counterexample-visible-glyphs-wrong-copy', wrongCopy, {
      expected: [text],
    }),
    /Unicode extraction mismatch/,
  );
  // Correct Unicode extraction with grossly distorted glyph geometry: replace
  // only drawing font size, preserving text bytes and the complete ToUnicode.
  const badVisual = await lib.PDFDocument.load(accepted.bytes);
  const contents = badVisual.getPage(0).node.Contents();
  const refs =
    contents instanceof lib.PDFArray ? contents.asArray() : [contents];
  let changed = false;
  for (const ref of refs) {
    const stream = badVisual.context.lookup(ref);
    if (!(stream instanceof lib.PDFRawStream)) continue;
    const source = Buffer.from(
      lib.decodePDFRawStream(stream).decode(),
    ).toString('ascii');
    const altered = source.replace(/(\/\S+\s+)24(\s+Tf)/g, '$1' + '9' + '$2');
    if (altered !== source) {
      changed = true;
      badVisual.context.assign(ref, badVisual.context.flateStream(altered));
    }
  }
  assert(
    changed,
    'visual counterexample did not alter the actual text operator',
  );
  const wrongVisual = {
    bytes: await badVisual.save({ useObjectStreams: false }),
    file: join(root, 'counterexample-correct-copy-wrong-visual.pdf'),
  };
  await writeFile(wrongVisual.file, wrongVisual.bytes);
  const extracted = await render(wrongVisual);
  assert(
    compact(extracted[0].text).includes(compact(text)),
    'wrong-visual control must retain expected Unicode extraction',
  );
  await assert.rejects(
    visualReference(wrongVisual, text),
    /independent visual/,
  );
  for (const control of [wrongCopy, wrongVisual])
    if (qpdfAvailable)
      assert.equal(
        spawnSync(qpdf, ['--check', control.file], { encoding: 'utf8' }).status,
        0,
        'counterexample must be structurally valid',
      );
  results.push({
    name: 'independent-oracle-counterexamples',
    correctAppearanceWrongCopyRejected: true,
    correctCopyWrongAppearanceRejected: true,
    qpdf: qpdfAvailable ? 'PASS' : 'unavailable',
  });
}

async function viewerNormalization(source) {
  for (const [name, text, defaultText, unnormalizedText, codepoints] of [
    [
      'compatibility-ligatures',
      'ﬁ ﬂ ﬀ ﬃ ﬄ',
      'fi fl ff ffi ffl',
      'ﬁ ﬂ ﬀ ﬃ ﬄ',
      [0xfb01, 0xfb02, 0xfb00, 0xfb03, 0xfb04],
    ],
    ['nonbreaking-space', 'a\u00a0b', 'a b', 'a b', [0x00a0]],
  ]) {
    const output = await directExport(source, `viewer-normalization-${name}`, {
      annotations: [annotation(text)],
    });
    const evidence = await inspect(`viewer-normalization-${name}`, output, {
      expected: [defaultText],
      fontCount: 1,
    });
    const resources = evidence.doc
      .getPage(0)
      .node.Resources()
      .lookup(lib.PDFName.of('Font'), lib.PDFDict);
    const [fontName] = resources
      .entries()
      .find(([, ref]) => ref.toString() === evidence.fonts[0].ref);
    const contents = evidence.doc.getPage(0).node.Contents();
    const refs =
      contents instanceof lib.PDFArray ? contents.asArray() : [contents];
    const emittedCids = new Set();
    for (const ref of refs) {
      const stream = evidence.doc.context.lookup(ref);
      const content = Buffer.from(
        lib.decodePDFRawStream(stream).decode(),
      ).toString('ascii');
      let currentFont = null;
      for (const operation of content.matchAll(
        /(\/\S+)\s+[\d.]+\s+Tf|<([0-9a-fA-F]+)>\s*Tj/g,
      )) {
        if (operation[1]) currentFont = operation[1];
        if (operation[2] && currentFont === fontName.toString())
          for (const cid of operation[2].match(/.{4}/g))
            emittedCids.add(cid.toUpperCase());
      }
    }
    const mappedSourceCodepoints = [];
    for (const codepoint of codepoints) {
      const target = codepoint.toString(16).padStart(4, '0').toUpperCase();
      const mapping = evidence.fonts[0].mappings.match(
        new RegExp(`<([0-9a-fA-F]+)>\\s*<${target}>`, 'i'),
      );
      assert(
        mapping && emittedCids.has(mapping[1].toUpperCase()),
        `${name}: original mapped glyph was not actually emitted`,
      );
      mappedSourceCodepoints.push(`U+${target}`);
    }
    const extraction = await verifier.evaluate(async (bytes) => {
      const pdfjs = await import('/node_modules/pdfjs-dist/build/pdf.mjs');
      const task = pdfjs.getDocument({
        data: new Uint8Array(bytes),
        useSystemFonts: false,
      });
      try {
        const doc = await task.promise,
          current = await doc.getPage(1);
        const read = async (disableNormalization) =>
          (await current.getTextContent({ disableNormalization })).items
            .filter((item) => 'str' in item)
            .map((item) => item.str)
            .join(' ');
        return { default: await read(false), disabled: await read(true) };
      } finally {
        await task.destroy();
      }
    }, Array.from(output.bytes));
    assert(extraction.default.includes(defaultText));
    assert(extraction.disabled.includes(unnormalizedText));
    results.push({
      name: `viewer-normalization-semantics-${name}`,
      originalInput: text,
      mappedSourceCodepoints,
      defaultExtraction: extraction.default,
      normalizationDisabledExtraction: extraction.disabled,
      policy:
        'Original glyph codepoints remain in used ToUnicode mappings; viewer text extraction may expand compatibility ligatures or normalize whitespace.',
    });
  }
}

async function fresh(source) {
  await page.bringToFront();
  await page.goto(appUrl);
  await page
    .locator('input[type=file][accept="application/pdf,.pdf"]')
    .setInputFiles(source.file);
  await page.locator('.pdf-canvas[data-ready=true]').first().waitFor();
  await button('Download PDF').waitFor();
  await page.waitForFunction(
    () => !document.body.innerText.includes('Checking this PDF'),
  );
}
async function download(name, control = button('Download PDF')) {
  const start = Date.now(),
    pending = page.waitForEvent('download');
  await control.click();
  const current = await pending,
    file = join(root, `${name}.pdf`);
  await current.saveAs(file);
  const bytes = new Uint8Array(await readFile(file));
  measurements.push({
    name,
    exportAndDownloadMs: Date.now() - start,
    outputBytes: bytes.length,
  });
  return { file, bytes };
}
const dialog = () =>
  page.getByRole('dialog', { name: 'Watermark', exact: true });
async function configure(text) {
  await button('Watermark').click();
  await dialog().waitFor();
  await page
    .getByLabel('Watermark font', { exact: true })
    .selectOption('noto-sans');
  await page.getByLabel('Watermark text', { exact: true }).fill(text);
  await page
    .getByLabel('Watermark text color', { exact: true })
    .fill('#1ab333');
  await page.getByLabel('Watermark rotation', { exact: true }).fill('0');
}
async function apply() {
  const control = dialog().getByRole('button', {
    name: 'Apply watermark',
    exact: true,
  });
  await control.waitFor();
  await page.waitForFunction(() => {
    const current = Array.from(document.querySelectorAll('dialog button')).find(
      (item) => item.textContent.trim() === 'Apply watermark',
    );
    return current && !current.disabled;
  });
  await control.click();
  await dialog().waitFor({ state: 'detached' });
}

async function previewFootprint(selector) {
  await page.waitForFunction(
    (selector) => {
      const canvas = document.querySelector(selector);
      if (!canvas || !canvas.width || !canvas.height) return false;
      const pixels = canvas
        .getContext('2d')
        .getImageData(0, 0, canvas.width, canvas.height).data;
      let green = 0;
      for (let at = 0; at < pixels.length; at += 4)
        if (
          pixels[at + 3] > 10 &&
          pixels[at + 1] > pixels[at] + 12 &&
          pixels[at + 1] > pixels[at + 2] + 12
        )
          green++;
      return green > 20;
    },
    selector,
    { polling: 200 },
  );
  return page
    .locator(selector)
    .first()
    .evaluate((canvas) => {
      const pixels = canvas
        .getContext('2d')
        .getImageData(0, 0, canvas.width, canvas.height).data;
      let left = canvas.width,
        top = canvas.height,
        right = -1,
        bottom = -1,
        count = 0;
      for (let y = 0; y < canvas.height; y++)
        for (let x = 0; x < canvas.width; x++) {
          const at = (y * canvas.width + x) * 4;
          if (
            pixels[at + 3] > 10 &&
            pixels[at + 1] > pixels[at] + 12 &&
            pixels[at + 1] > pixels[at + 2] + 12
          ) {
            count++;
            left = Math.min(left, x);
            right = Math.max(right, x);
            top = Math.min(top, y);
            bottom = Math.max(bottom, y);
          }
        }
      const css = canvas.getBoundingClientRect();
      return {
        count,
        centerX: (left + right + 1) / (2 * canvas.width),
        centerY: (top + bottom + 1) / (2 * canvas.height),
        inkWidth: (right - left + 1) / canvas.width,
        inkHeight: (bottom - top + 1) / canvas.height,
        backingWidth: canvas.width,
        backingHeight: canvas.height,
        cssWidth: css.width,
        cssHeight: css.height,
      };
    });
}

function comparePreview(name, preview, actual) {
  assert(preview.count > 20 && actual.greenBounds, `${name}: no glyph pixels`);
  const normalized = {
    centerX:
      (actual.greenBounds.x + actual.greenBounds.width / 2) / actual.width,
    centerY:
      (actual.greenBounds.y + actual.greenBounds.height / 2) / actual.height,
    inkWidth: actual.greenBounds.width / actual.width,
    inkHeight: actual.greenBounds.height / actual.height,
  };
  for (const key of Object.keys(normalized))
    assert(
      Math.abs(normalized[key] - preview[key]) <= 0.025,
      `${name}: ${key} preview/export mismatch ${JSON.stringify({ preview, normalized })}`,
    );
  assert(
    Math.abs(
      preview.backingWidth / preview.backingHeight -
        preview.cssWidth / preview.cssHeight,
    ) <= 0.025,
    `${name}: CSS distorted text canvas`,
  );
  results.push({
    name,
    preview,
    normalizedExport: normalized,
    tolerance: '2.5% of page extent for independent raster antialiasing',
  });
}

try {
  const plain = await fixture('plain'),
    ten = await fixture('ten', { count: 10 }),
    hundred = await fixture('hundred', { count: 100 });
  if (normalizationOnly) await viewerNormalization(plain);
  if (!production && !uiOnly && !normalizationOnly) {
    await bundledFontSafety();
    await viewerNormalization(plain);
    await embeddingAlternatives();
    let control;
    for (const [name, text] of supported) {
      const output = await directExport(plain, `annotation-${name}`, {
        annotations: [annotation(text)],
      });
      const inspection = await inspect(`annotation-${name}`, output, {
        expected: [text],
        fontCount: 1,
        screenshots: true,
      });
      assert(inspection.fonts[0].mappings.length > 100);
      const parity = await visualReference(output, text);
      results.push({
        name: `independent-native-font-reference-${name}`,
        ...parity,
      });
      if (name === 'latin-extended') control = { output, text };
      const mark = watermark(text);
      await inspect(
        `watermark-${name}`,
        await directExport(plain, `watermark-${name}`, { mark }),
        { expected: [text], fontCount: 1 },
      );
    }
    await negativeControls(control.output, control.text);
    for (const align of ['left', 'center', 'right']) {
      const text = 'Καλημέρα\r\nПривет\nÉté café';
      const changes = {
        align,
        box: {
          origin: { x: 40, y: 100 },
          width: 220,
          height: 150,
          rotation: 0,
        },
      };
      const report = await inspect(
        `multiline-${align}`,
        await directExport(plain, `multiline-${align}`, {
          annotations: [annotation(text, changes)],
        }),
        { expected: ['Καλημέρα', 'Привет', 'Été café'] },
      );
      const unicodeItems = report.pages[0].items.filter((item) =>
        ['Καλημέρα', 'Привет', 'Été café'].includes(item.str),
      );
      assert.equal(unicodeItems.length, 3);
      for (const item of unicodeItems) {
        const expectedX =
          align === 'left'
            ? 40
            : align === 'center'
              ? 40 + (220 - item.width) / 2
              : 260 - item.width;
        assert(
          Math.abs(item.transform[4] - expectedX) <= 0.6,
          `alignment geometry mismatch ${align}`,
        );
      }
    }
    for (const size of [8, 72])
      await inspect(
        `font-size-${size}`,
        await directExport(plain, `font-size-${size}`, {
          annotations: [annotation('ÉΛЖ', { fontSizeUserUnits: size })],
        }),
        { expected: ['ÉΛЖ'] },
      );
    const long = 'E\u0301'.repeat(50);
    const wrapped = await inspect(
      'long-word-grapheme-wrap',
      await directExport(plain, 'long-word-grapheme-wrap', {
        annotations: [
          annotation(long, {
            box: {
              origin: { x: 40, y: 50 },
              width: 100,
              height: 300,
              rotation: 0,
            },
          }),
        ],
      }),
    );
    assert.equal(
      wrapped.pages[0].items
        .filter((item) => item.str.includes('É'))
        .map((item) => item.str)
        .join(''),
      canonical(long),
    );
    for (const rotation of [90, 180, 270]) {
      const rotated = await fixture(`rotated-${rotation}`, { rotation });
      await inspect(
        `rotation-${rotation}`,
        await directExport(rotated, `rotation-${rotation}`, {
          annotations: [annotation('ÉΛЖ')],
          mark: watermark('Unicode ÉΛЖ', { rotation: 27 }),
        }),
        { expected: ['ÉΛЖ', 'Unicode ÉΛЖ'], rotations: [rotation] },
      );
    }
    await inspect(
      'rotated-annotation',
      await directExport(plain, 'rotated-annotation', {
        annotations: [
          annotation('ÉΛЖ rotation', {
            box: {
              origin: { x: 250, y: 40 },
              width: 250,
              height: 80,
              rotation: 90,
            },
          }),
        ],
      }),
      { expected: ['ÉΛЖ rotation'] },
    );
    const cropped = await fixture('crop-userunit', {
      crop: true,
      userUnit: 2,
      rotation: 90,
    });
    await inspect(
      'crop-userunit',
      await directExport(cropped, 'crop-userunit', {
        annotations: [annotation('ÉΛЖ')],
        mark: watermark('Unicode ÉΛЖ'),
      }),
      { expected: ['ÉΛЖ', 'Unicode ÉΛЖ'], rotations: [90] },
    );
    for (const [name, text] of unsupported) {
      await directExport(plain, `unsupported-annotation-${name}`, {
        annotations: [annotation(text)],
        expectedError: 'unsupported-text-font',
      });
      await directExport(plain, `unsupported-watermark-${name}`, {
        mark: watermark(text),
        expectedError: 'watermark-unsupported-text',
      });
    }
    await directExport(plain, 'unsupported-devanagari-multiple-paragraphs', {
      annotations: [
        annotation(
          'नमस्ते विद्यार्थी\nमराठी भाषा प्रकल्प\nकागदपत्र क्षेत्र हिन्दी',
        ),
      ],
      expectedError: 'unsupported-text-font',
    });
    for (const [name, text, width, height, size] of [
      ['short-height', 'ÉΛЖ', 420, 4, 24],
      ['wrapped-lines', 'Καλημέρα '.repeat(20), 100, 45, 24],
      ['single-glyph-too-wide', 'W', 5, 150, 72],
    ])
      await directExport(plain, `noto-text-overflow-${name}`, {
        annotations: [
          annotation(text, {
            fontSizeUserUnits: size,
            box: { origin: { x: 40, y: 100 }, width, height, rotation: 0 },
          }),
        ],
        expectedError: 'text-overflow',
      });
    await directExport(
      plain,
      'unsupported-text-rejected-before-zero-capacity',
      {
        annotations: [
          annotation('नमस्ते', {
            box: {
              origin: { x: 40, y: 100 },
              width: 420,
              height: 1,
              rotation: 0,
            },
          }),
        ],
        expectedError: 'unsupported-text-font',
      },
    );
    const all = watermark('ÉΛЖ Unicode');
    await inspect(
      'ten-pages',
      await directExport(ten, 'ten-pages', { mark: all }),
      { expected: [all.text], fontCount: 1 },
    );
    await inspect(
      'hundred-pages-font-reuse',
      await directExport(hundred, 'hundred-pages-font-reuse', { mark: all }),
      { expected: [all.text], fontCount: 1 },
    );
    const dozens = await inspect(
      'dozens-annotations',
      await directExport(ten, 'dozens-annotations', {
        annotations: Array.from({ length: 40 }, (_, index) =>
          annotation(`ÉΛЖ ${index}`, {
            id: `a-${index}`,
            workspacePageId: `page-${index % 10}`,
            fontSizeUserUnits: 10,
            box: {
              origin: { x: 40, y: 60 + Math.floor(index / 10) * 40 },
              width: 420,
              height: 30,
              rotation: 0,
            },
          }),
        ),
      }),
      { fontCount: 1 },
    );
    for (let index = 0; index < 40; index++)
      assert(
        dozens.pages[index % 10].items.some(
          (item) => item.str === `ÉΛЖ ${index}`,
        ),
        `annotation ${index} was lost during shared font embedding`,
      );
    await inspect(
      'stable-targets-extract',
      await directExport(ten, 'stable-targets-extract', {
        mark: watermark('ÉΛЖ target', {
          target: { kind: 'pages', pageIds: ['page-1'] },
        }),
        order: [3, 1],
      }),
      { expected: ['ÉΛЖ target'], targeted: [1] },
    );
    await inspect(
      'immutable-font-text-snapshot',
      await directExport(plain, 'immutable-font-text-snapshot', {
        annotations: [annotation('ÉΛЖ snapshot')],
        mark: watermark('ÉΛЖ captured'),
        mutate: true,
        fontBytes: Array.from(await readFile(fontPath)),
      }),
      {
        expected: ['ÉΛЖ snapshot', 'ÉΛЖ captured'],
        excluded: ['LATER CHANGE'],
        rotations: [0],
      },
    );
    await directExport(plain, 'invalid-export-font-snapshot', {
      annotations: [annotation('ÉΛЖ')],
      fontBytes: [0, 1, 2],
      expectedError: true,
    });
    await directExport(plain, 'cancelled-export', {
      annotations: [annotation('ÉΛЖ')],
      abort: true,
      expectedError: 'aborted',
    });
    await inspect(
      'repeated-export',
      await directExport(plain, 'repeated-export', {
        annotations: [annotation('ÉΛЖ repeated')],
      }),
      { expected: ['ÉΛЖ repeated'], fontCount: 1 },
    );
    const privateSource = await fixture('unicode-sensitive-source', {
      unicodeSource: true,
    });
    const proof = await render({ bytes: new Uint8Array(privateSource.bytes) });
    assert(compact(proof[0].text).includes('КОНФИДЕНЦИАЛЬНО'));
    results.push({
      name: 'original-unicode-source-present',
      text: proof[0].text,
    });
    await inspect(
      'multiple-duplicate-sources-reordered',
      await directExport(plain, 'multiple-duplicate-sources-reordered', {
        sourceCount: 2,
        order: [1, 0],
        mark: watermark('ÉΛЖ merged'),
        annotations: [
          annotation('SOURCE A ÉΛЖ'),
          annotation('SOURCE B ÉΛЖ', {
            id: 'second-source-annotation',
            workspacePageId: 'page-1',
          }),
        ],
      }),
      { expected: ['ÉΛЖ merged'], fontCount: 1 },
    );
    const devanagariBytes = await readFile(
      'apps/web/src/lib/fonts/fixtures/devanagari-positioned-source.pdf',
    );
    assert.equal(
      hash(devanagariBytes),
      '6bd10ede38c46de838defdff89a732fab77c2d7e28600f1be494954fcd3752b9',
    );
    const devanagariSource = {
      bytes: Array.from(devanagariBytes),
      count: 1,
      fields: [],
      rotation: 0,
      userUnit: 1,
    };
    const devanagariProof = await render(
      { bytes: devanagariBytes },
      { screenshots: true },
    );
    const devanagariDocument = await lib.PDFDocument.load(devanagariBytes);
    const devanagariFonts = fontEvidence(devanagariDocument);
    assert.equal(devanagariFonts.length, 1);
    assert(devanagariProof[0].darkPixels > 500);
    assert(devanagariProof[0].textOperators > 0);
    assert(devanagariProof[0].text.includes('मराठी'));
    const intendedDevanagari = 'विद्यार्थी क्षेत्र मराठी भाषा';
    await assert.rejects(
      inspect(
        'positioned-devanagari-candidate-must-fail-logical-extraction',
        { bytes: devanagariBytes },
        { expected: [intendedDevanagari], fontCount: 1 },
      ),
      /Unicode extraction mismatch/,
      'A visually positioned Devanagari PDF must not be accepted when its text order is wrong.',
    );
    results.push({
      name: 'positioned-devanagari-donor-present',
      text: devanagariProof[0].text,
      darkPixels: devanagariProof[0].darkPixels,
      fontCount: devanagariFonts.length,
      intendedText: intendedDevanagari,
      extractionRejected: true,
      note: 'Investigative source only; glyph positions are real, but pre-matra extraction is incomplete. The extraction quality gate rejects it. No application support claim.',
    });
    await directExport(
      devanagariSource,
      'distinct-cid-source-metadata-collision-fails-closed',
      {
        additionalSources: [plain],
        mark: watermark('PUBLIC ÉΛЖ'),
        redactions: [
          { pageIndex: 0, box: { x: 0, y: 0, width: 500, height: 400 } },
        ],
        expectedError: 'redaction-unsafe-retention',
      },
    );
    const blank = await fixture('blank-ordinary-source', { blank: true });
    await inspect(
      'mixed-redacted-and-ordinary-unicode',
      await directExport(plain, 'mixed-redacted-and-ordinary-unicode', {
        additionalSources: [blank],
        mark: watermark('PUBLIC ÉΛЖ'),
        redactions: [
          { pageIndex: 0, box: { x: 0, y: 0, width: 500, height: 400 } },
        ],
      }),
      { expected: ['PUBLIC ÉΛЖ'], affected: [0], fontCount: 1 },
    );
    await inspect(
      'devanagari-source-secure-redaction',
      await directExport(
        devanagariSource,
        'devanagari-source-secure-redaction',
        {
          mark: watermark('PUBLIC ÉΛЖ'),
          redactions: [
            { pageIndex: 0, box: { x: 0, y: 0, width: 500, height: 400 } },
          ],
        },
      ),
      {
        excluded: ['मराठी', 'भाषा', 'क्षेत्र', 'विद्यार्थी'],
        affected: [0],
        fontCount: 0,
        screenshots: true,
      },
    );
    await directExport(
      privateSource,
      'duplicate-custom-font-sensitive-resource-retention',
      {
        sourceCount: 2,
        mark: watermark('PUBLIC ÉΛЖ'),
        redactions: [
          { pageIndex: 0, box: { x: 0, y: 0, width: 500, height: 400 } },
        ],
        expectedError: 'redaction-unsafe-retention',
      },
    );
    await inspect(
      'unicode-redaction-source-annotation-watermark',
      await directExport(
        privateSource,
        'unicode-redaction-source-annotation-watermark',
        {
          annotations: [annotation('SECRET ÉΛЖ АННОТАЦИЯ')],
          mark: watermark('PUBLIC ÉΛЖ'),
          redactions: [
            { pageIndex: 0, box: { x: 0, y: 0, width: 500, height: 400 } },
          ],
        },
      ),
      {
        excluded: ['SECRET', 'КОНФИДЕНЦИАЛЬНО', 'АННОТАЦИЯ'],
        affected: [0],
        screenshots: true,
        fontCount: 0,
      },
    );
    const form = await fixture('form', { forms: true });
    const fields = [
      { ...form.fields[0], value: 'Été Ελληνικά Привет', changed: true },
    ];
    await inspect(
      'unicode-form',
      await directExport(form, 'unicode-form', { fields }),
      { expected: ['Été Ελληνικά Привет'] },
    );
    await directExport(form, 'unsupported-devanagari-form', {
      fields: [{ ...form.fields[0], value: 'विद्यार्थी', changed: true }],
      expectedError: 'unsupported-text-font',
    });
    await inspect(
      'unicode-form-redaction-watermark',
      await directExport(form, 'unicode-form-redaction-watermark', {
        fields,
        mark: watermark('PUBLIC ÉΛЖ'),
        redactions: [
          { pageIndex: 0, box: { x: 0, y: 0, width: 500, height: 400 } },
        ],
      }),
      { excluded: ['Été Ελληνικά Привет'], affected: [0], fontCount: 0 },
    );
    for (const rotation of [0, 90]) {
      const matrix = await fixture(`form-matrix-${rotation}`, {
        forms: 'matrix',
        rotation,
      });
      const matrixFields = matrix.fields.map((field) => ({
        ...field,
        changed: true,
        value:
          field.kind === 'text'
            ? 'Été text value'
            : field.kind === 'multiline-text'
              ? 'Été multiline\nПривет second line'
              : field.kind === 'dropdown'
                ? 'Καλημέρα'
                : ['Καλημέρα', 'Привет'],
      }));
      await inspect(
        `unicode-form-matrix-${rotation}`,
        await directExport(matrix, `unicode-form-matrix-${rotation}`, {
          fields: matrixFields,
        }),
        {
          expected: [
            'Été text value',
            'Été multiline',
            'Привет second line',
            'Καλημέρα',
          ],
          excluded: ['Original multiline'],
          rotations: [rotation],
          screenshots: true,
        },
      );
      const emptyMatrix = await inspect(
        `empty-unicode-form-matrix-${rotation}`,
        await directExport(matrix, `empty-unicode-form-matrix-${rotation}`, {
          fields: matrixFields.map((field) => ({
            ...field,
            value:
              field.kind === 'option-list'
                ? []
                : field.kind === 'dropdown'
                  ? null
                  : '',
          })),
        }),
        {
          excluded: [
            'Été text value',
            'Été multiline',
            'Привет second line',
            'Original multiline',
          ],
          rotations: [rotation],
        },
      );
      assert(
        !emptyMatrix.pages[0].items.some((item) => item.str === 'Original'),
        'empty field retained its original text appearance',
      );
    }
  }
  if (!directOnly && !normalizationOnly) {
    await fresh(plain);
    await button('Text (T)').click();
    await button('Use #4ade80 annotation color').click();
    await page.getByLabel('Text font size', { exact: true }).selectOption('24');
    await page.getByLabel('Annotation opacity', { exact: true }).press('End');
    await page
      .getByLabel('Text font', { exact: true })
      .selectOption('noto-sans');
    const surface = await page
      .locator('.pdf-page-surface')
      .first()
      .boundingBox();
    await page.mouse.move(surface.x + 40, surface.y + 120);
    await page.mouse.down();
    await page.mouse.move(surface.x + 430, surface.y + 220, { steps: 8 });
    await page.mouse.up();
    const editor = page.getByLabel('New annotation text', { exact: true });
    await editor.fill('Été Ελληνικά Привет');
    await editor.press('Control+Enter');
    const annotationPreview = await previewFootprint(
      '.annotation-overlay canvas',
    );
    const annotationDownload = await inspect(
      'ui-annotation-download',
      await download('ui-annotation-download'),
      { expected: ['Été Ελληνικά Привет'], screenshots: true },
    );
    comparePreview(
      'unicode-annotation-preview-export-parity',
      annotationPreview,
      annotationDownload.pages[0],
    );
    const thumbnailPreview = await previewFootprint(
      '.thumbnail-annotation-canvas',
    );
    comparePreview(
      'unicode-annotation-thumbnail-export-parity',
      thumbnailPreview,
      annotationDownload.pages[0],
    );
    const zoomStarted = Date.now();
    await button('Zoom in').click();
    await button('Zoom in').click();
    const zoomPreview = await previewFootprint('.annotation-overlay canvas');
    comparePreview(
      'unicode-annotation-zoom-preview-export-parity',
      zoomPreview,
      annotationDownload.pages[0],
    );
    measurements.push({
      name: 'annotation-zoom-preview',
      elapsedMs: Date.now() - zoomStarted,
      actualZoom: await page
        .getByLabel('Current zoom', { exact: true })
        .innerText(),
    });
    await page.screenshot({
      path: join(root, 'annotation-zoomed.png'),
      fullPage: true,
    });
    await button('Zoom out').click();
    await button('Zoom out').click();
    await button('Undo').click();
    await inspect('ui-annotation-undo', await download('ui-annotation-undo'), {
      excluded: ['Été Ελληνικά Привет'],
    });
    await button('Redo').click();
    await inspect('ui-annotation-redo', await download('ui-annotation-redo'), {
      expected: ['Été Ελληνικά Привет'],
    });
    await fresh(plain);
    await configure('ÉΛЖ watermark');
    await page
      .locator(
        '.watermark-dialog-preview .watermark-canvas[data-watermark-ready=true]',
      )
      .waitFor();
    const dialogPreview = await previewFootprint(
      '.watermark-dialog-preview .watermark-canvas[data-watermark-ready=true]',
    );
    await page.keyboard.press('Escape');
    await dialog().waitFor({ state: 'detached' });
    assert(
      await button('Watermark').evaluate(
        (current) => current === document.activeElement,
      ),
    );
    await configure('ÉΛЖ watermark');
    await apply();
    const watermarkPreview = await previewFootprint(
      '.watermark-page-preview .watermark-canvas[data-watermark-ready=true]',
    );
    const watermarkDownload = await inspect(
      'ui-watermark-download',
      await download('ui-watermark-download'),
      { expected: ['ÉΛЖ watermark'] },
    );
    comparePreview(
      'unicode-watermark-dialog-preview-export-parity',
      dialogPreview,
      watermarkDownload.pages[0],
    );
    comparePreview(
      'unicode-watermark-page-preview-export-parity',
      watermarkPreview,
      watermarkDownload.pages[0],
    );
    await button('Undo').click();
    await inspect('ui-watermark-undo', await download('ui-watermark-undo'), {
      excluded: ['ÉΛЖ watermark'],
    });
    await button('Redo').click();
    await inspect('ui-watermark-redo', await download('ui-watermark-redo'), {
      expected: ['ÉΛЖ watermark'],
    });
    await configure('नमस्ते');
    await dialog().getByRole('alert').first().waitFor();
    assert(
      await dialog()
        .getByRole('button', { name: 'Apply watermark', exact: true })
        .isDisabled(),
    );
    await page.keyboard.press('Escape');
    results.push({
      name: 'keyboard-font-selection-unsupported-escape-focus',
      fontChoice: true,
      unsupportedVisible: true,
      focusRestored: true,
      undoRedo: true,
    });
    await previewFootprint(
      '.watermark-page-preview .watermark-canvas[data-watermark-ready=true]',
    );
    await page.screenshot({ path: join(root, 'desktop.png'), fullPage: true });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    for (const width of [768, 390, 360]) {
      await page.setViewportSize({ width, height: 900 });
      await configure('ÉΛЖ mobile');
      await page
        .locator(
          '.watermark-dialog-preview .watermark-canvas[data-watermark-ready=true]',
        )
        .waitFor();
      await page.getByLabel('Watermark font', { exact: true }).focus();
      assert(
        await page
          .getByLabel('Watermark font', { exact: true })
          .evaluate((current) => current === document.activeElement),
      );
      for (let step = 0; step < 20; step++) {
        await page.keyboard.press('Tab');
        assert(
          await dialog().evaluate((current) =>
            current.contains(document.activeElement),
          ),
          'font dialog focus escaped',
        );
      }
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        `horizontal overflow at ${width}`,
      );
      await page.screenshot({
        path: join(root, `mobile-${width}.png`),
        fullPage: true,
      });
      await page.keyboard.press('Escape');
      await dialog().waitFor({ state: 'detached' });
      assert(
        await button('Watermark').evaluate(
          (current) => current === document.activeElement,
        ),
      );
      results.push({
        name: `responsive-${width}`,
        width,
        dpr: 2,
        reducedMotion: true,
        labelledFontControl: true,
        focusContainment: true,
        escapeFocusReturn: true,
      });
    }
    await page.setViewportSize({ width: 1440, height: 1100 });
    await button('Start over').click();
    await page
      .locator('input[type=file][accept="application/pdf,.pdf"]')
      .setInputFiles(plain.file);
    await page.locator('.pdf-canvas[data-ready=true]').first().waitFor();
    assert(await button('Undo').isDisabled());
    await inspect(
      'start-over-cleared-font-edits',
      await download('start-over-cleared-font-edits'),
      { excluded: ['ÉΛЖ watermark', 'Été Ελληνικά Привет'] },
    );
    const fontFaces = await page.evaluate(
      () =>
        Array.from(document.fonts).filter(
          (font) => font.family.replaceAll('"', '') === 'Kagaz Noto Sans',
        ).length,
    );
    assert(
      fontFaces <= 1,
      'repeated font choice accumulated FontFace instances',
    );
    results.push({
      name: 'bounded-fixed-fontface-cache-after-reset',
      faces: fontFaces,
      policy: 'one shared immutable bundled face; no user-upload registry',
    });
    await page.route(/NotoSans-Regular.*\.ttf/, (route) => route.abort());
    await fresh(plain);
    await configure('ÉΛЖ failed font request');
    await dialog().getByRole('alert').first().waitFor();
    const loadError = (
      await dialog().getByRole('alert').allTextContents()
    ).join(' ');
    assert(
      /load|prepared|font|reload/i.test(loadError),
      'missing font has no useful visible error',
    );
    assert(
      await dialog()
        .getByRole('button', { name: 'Apply watermark', exact: true })
        .isDisabled(),
    );
    await page.keyboard.press('Escape');
    await page.unroute(/NotoSans-Regular.*\.ttf/);
    await fresh(plain);
    await configure('ÉΛЖ font retry');
    await apply();
    await inspect('font-load-recovery', await download('font-load-recovery'), {
      expected: ['ÉΛЖ font retry'],
    });
    results.push({
      name: 'font-load-failure-visible-and-recovery',
      visibleMessage: loadError,
      failedApplyDisabled: true,
      recovered: true,
    });
    for (const name of ['Compress PDF', 'OCR PDF']) {
      await button(name).click();
      const heavy = page.getByRole('dialog');
      assert((await heavy.innerText()).includes('uploads'));
      await page.keyboard.press('Escape');
    }
  }
  assert.deepEqual(errors, [], 'browser errors');
  assert.deepEqual(requests, [], 'ordinary Unicode work uploaded data');
  assert(
    await page.evaluate(
      () => localStorage.length === 0 && sessionStorage.length === 0,
    ),
    'document/font data persisted',
  );
  completed = true;
  console.log('PHASE_5C_BROWSER_PASSED');
} catch (error) {
  await page
    .screenshot({ path: join(root, 'failure.png'), fullPage: true })
    .catch(() => {});
  console.error(error);
  throw error;
} finally {
  await writeFile(
    join(root, 'phase5c-browser.json'),
    JSON.stringify(
      {
        completed,
        appUrl,
        verifierUrl,
        production,
        normalizationOnly,
        qpdf: qpdfAvailable ? probe.stdout.trim() : 'unavailable',
        supported: supported.map(([name, text]) => ({
          name,
          text,
          normalization: 'NFC canonical equivalence',
        })),
        unsupported: unsupported.map(([name]) => name),
        results,
        measurements,
        errors,
        requests,
        memoryNote:
          'Transient JS heap estimates exclude Canvas, font/native decoders and workers; decoded bitmap sizes are lower-bound allocations, not measured process peaks.',
      },
      null,
      2,
    ),
  );
  await browser.close();
}
