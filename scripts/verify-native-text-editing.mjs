import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import process from 'node:process';

const require = createRequire(import.meta.url);
const { chromium } = require(
  process.env.KAGAZ_PLAYWRIGHT_MODULE || 'playwright',
);
const {
  PDFDocument,
  PDFName,
  PDFRawStream,
  decodePDFRawStream,
} = require('../apps/web/node_modules/pdf-lib');
const pdfjs =
  await import('../apps/web/node_modules/pdfjs-dist/legacy/build/pdf.mjs');

const artifactDirectory = process.env.KAGAZ_ARTIFACT_DIR;
assert(artifactDirectory, 'Set KAGAZ_ARTIFACT_DIR outside the repository.');
const artifacts = resolve(artifactDirectory, 'native-text-editing');
await mkdir(artifacts, { recursive: true });

const originalText = 'NATIVE-UI-OLD';
const replacementText = 'NATIVE-UI-NEW';
const sourceX = 40;
const sourceY = 300;
const translationX = 120;
const translationY = -100;
const replacementX = sourceX + translationX;
const replacementY = sourceY + translationY;
const pageWidth = 300;
const pageHeight = 400;

async function createFixture(content, name) {
  const document = await PDFDocument.create();
  const fontRef = document.context.register(
    document.context.obj({
      Type: 'Font',
      Subtype: 'Type1',
      BaseFont: 'Helvetica',
      Encoding: 'WinAnsiEncoding',
    }),
  );
  const pdfPage = document.addPage([pageWidth, pageHeight]);
  // The page deliberately has exactly one direct, Flate-decoded content stream
  // and one Standard-14 Type1 font: this is the product's supported subset.
  pdfPage.node.set(
    PDFName.Resources,
    document.context.obj({ Font: { F1: fontRef } }),
  );
  pdfPage.node.set(
    PDFName.Contents,
    document.context.register(document.context.flateStream(content)),
  );
  const bytes = await document.save({ useObjectStreams: false });
  const fixture = resolve(artifacts, name);
  await writeFile(fixture, bytes);
  return { bytes: new Uint8Array(bytes), fixture };
}

const eligibleFixture = await createFixture(
  `BT\n/F1 12 Tf\n1 0 0 1 ${sourceX} ${sourceY} Tm\n(${originalText}) Tj\nET\n`,
  'eligible-source-text.pdf',
);
const unsupportedFixture = await createFixture(
  'BT\n/F1 12 Tf\n1 0 0 1 40 300 Tm\n[(NATIVE-UI-UNSAFE)] TJ\nET\n',
  'unsupported-tj-source.pdf',
);
const partialSelectionFixture = await createFixture(
  'BT\n/F1 12 Tf\n1 0 0 1 40 300 Tm\n(PrefixSuffix) Tj\nET\n' +
    'BT\n/F1 12 Tf\n1 0 0 1 40 260 Tm\n(Suffix) Tj\nET\n',
  'partial-selection-source.pdf',
);

const appUrl =
  process.env.KAGAZ_APP_URL ||
  process.env.KAGAZ_WEB_URL ||
  'http://127.0.0.1:5173';
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.KAGAZ_CHROME_PATH || undefined,
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  deviceScaleFactor: 2,
  acceptDownloads: true,
});
const page = await context.newPage();
page.setDefaultTimeout(15_000);
const pageErrors = [];
const nonGetRequests = [];
page.on('pageerror', (error) => pageErrors.push(error.message));
context.on('request', (request) => {
  if (request.method() !== 'GET') {
    nonGetRequests.push({ method: request.method(), url: request.url() });
  }
});
page.on('dialog', (dialog) => dialog.accept());

const sourceInput = () =>
  page.locator('input[type=file][accept="application/pdf,.pdf"]').first();
const surface = () => page.locator('.pdf-page-surface').first();
const textLayer = () =>
  surface().locator('.pdf-text-layer[data-status="ready"]');
const nativeEditButton = () =>
  page.getByRole('button', { name: 'Edit source text', exact: true });
const downloadButton = () =>
  page.getByRole('button', { name: 'Download PDF', exact: true });

async function waitForTextLayer() {
  await surface().locator('.pdf-canvas[data-ready="true"]').waitFor();
  await textLayer().waitFor();
}

async function setTextRange(expectedText, startOffset = 0, endOffset) {
  return page.evaluate(
    ({ expected, start, end }) => {
      const spans = [
        ...document.querySelectorAll(
          '.pdf-text-layer[data-status="ready"] span[role="presentation"]',
        ),
      ];
      const span = spans.find(
        (candidate) => candidate.textContent === expected,
      );
      const textNode = span?.firstChild;
      if (!textNode || textNode.nodeType !== Node.TEXT_NODE) return null;
      const text = textNode.textContent ?? '';
      if (start < 0 || end > text.length || start >= end) return null;
      const selection = window.getSelection();
      if (!selection) return null;
      const range = document.createRange();
      range.setStart(textNode, start);
      range.setEnd(textNode, end);
      selection.removeAllRanges();
      selection.addRange(range);
      // The browser normally emits this when addRange changes selection. Dispatch
      // once explicitly so this test remains deterministic across headless builds.
      document.dispatchEvent(new Event('selectionchange'));
      return selection.toString();
    },
    {
      expected: expectedText,
      start: startOffset,
      end: endOffset ?? expectedText.length,
    },
  );
}

async function selectFullTextRun(expectedText) {
  await nativeEditButton().click();
  const run = textLayer()
    .locator('span[role="presentation"]')
    .filter({ hasText: expectedText })
    .first();
  await run.waitFor();
  await run.scrollIntoViewIfNeeded();
  assert.equal(
    await setTextRange(expectedText),
    expectedText,
    `Expected one full rendered text span for ${expectedText}.`,
  );
  await page.waitForFunction(
    (text) => getSelection()?.toString() === text,
    expectedText,
  );
  await page
    .getByRole('button', { name: 'Edit selected source text', exact: true })
    .waitFor();
}

async function extractText(bytes) {
  const task = pdfjs.getDocument({ data: bytes.slice(), useSystemFonts: true });
  const document = await task.promise;
  try {
    const text = [];
    for (let index = 1; index <= document.numPages; index += 1) {
      const pdfPage = await document.getPage(index);
      try {
        const content = await pdfPage.getTextContent({
          disableNormalization: true,
        });
        text.push(
          content.items
            .filter((item) => 'str' in item)
            .map((item) => ('str' in item ? item.str : ''))
            .join(''),
        );
      } finally {
        pdfPage.cleanup();
      }
    }
    return text;
  } finally {
    await task.destroy();
  }
}

async function decodedRawStreams(bytes) {
  const document = await PDFDocument.load(bytes, {
    throwOnInvalidObject: true,
  });
  return document.context
    .enumerateIndirectObjects()
    .flatMap(([, object]) =>
      object instanceof PDFRawStream
        ? [new TextDecoder().decode(decodePDFRawStream(object).decode())]
        : [],
    );
}

async function canvasDarkPixels(region) {
  return surface()
    .locator('.pdf-canvas[data-ready="true"]')
    .evaluate((canvas, sourceRegion) => {
      if (!(canvas instanceof HTMLCanvasElement)) return -1;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) return -1;
      const width = canvas.width;
      const height = canvas.height;
      const x = Math.max(
        0,
        Math.floor((sourceRegion.x / sourceRegion.pageWidth) * width),
      );
      const y = Math.max(
        0,
        Math.floor((sourceRegion.y / sourceRegion.pageHeight) * height),
      );
      const right = Math.min(
        width,
        Math.ceil(
          ((sourceRegion.x + sourceRegion.width) / sourceRegion.pageWidth) *
            width,
        ),
      );
      const bottom = Math.min(
        height,
        Math.ceil(
          ((sourceRegion.y + sourceRegion.height) / sourceRegion.pageHeight) *
            height,
        ),
      );
      const pixels = context.getImageData(x, y, right - x, bottom - y).data;
      let dark = 0;
      for (let index = 0; index < pixels.length; index += 4) {
        const alpha = pixels[index + 3] ?? 0;
        const red = pixels[index] ?? 255;
        const green = pixels[index + 1] ?? 255;
        const blue = pixels[index + 2] ?? 255;
        if (alpha > 0 && red < 90 && green < 90 && blue < 90) dark += 1;
      }
      return dark;
    }, region);
}

try {
  await page.goto(appUrl);
  await sourceInput().setInputFiles(eligibleFixture.fixture);
  await waitForTextLayer();

  // Selecting the live PDF.js text layer must open the source-edit transaction,
  // not an annotation or a painted replacement.
  await selectFullTextRun(originalText);
  await page
    .getByRole('button', { name: 'Edit selected source text', exact: true })
    .click();
  await page
    .getByRole('heading', { name: 'Edit original PDF text', exact: true })
    .waitFor();
  assert.match(await textLayer().innerText(), new RegExp(originalText));
  await page
    .getByLabel('Replacement source text', { exact: true })
    .fill(replacementText);
  await page
    .getByLabel('Move source text horizontally', { exact: true })
    .fill(String(translationX));
  await page
    .getByLabel('Move source text vertically', { exact: true })
    .fill(String(translationY));
  await page
    .getByRole('button', { name: 'Stage genuine edit', exact: true })
    .click();
  await page
    .getByRole('list', { name: 'Staged source-text edits', exact: true })
    .waitFor();

  // The page remains the genuine source preview until export. This proves the
  // staged UI does not fake a replacement with an annotation overlay.
  assert.match(await textLayer().innerText(), new RegExp(originalText));
  await page.screenshot({
    path: resolve(artifacts, 'staged-source-transaction.png'),
    fullPage: false,
  });

  // Source-text changes share the established immutable editor history.
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await page
    .getByRole('list', { name: 'Staged source-text edits', exact: true })
    .waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await page
    .getByRole('list', { name: 'Staged source-text edits', exact: true })
    .waitFor();

  const download = page.waitForEvent('download');
  await downloadButton().click();
  const artifact = await download;
  const outputPath = resolve(artifacts, 'native-source-text-output.pdf');
  await artifact.saveAs(outputPath);
  const output = new Uint8Array(await readFile(outputPath));

  // Logical verification is against the actual saved file, not the temporary
  // isolated page used while composing the export.
  assert.deepEqual(await extractText(output), [replacementText]);
  const rawStreams = await decodedRawStreams(output);
  const allRawContent = rawStreams.join('\n');
  assert(!allRawContent.includes(originalText), 'Old Tj text survived export.');
  assert.match(allRawContent, new RegExp(`\\(${replacementText}\\) Tj`));
  assert.match(
    allRawContent,
    new RegExp(`1 0 0 1 ${replacementX} ${replacementY} Tm`),
  );

  // Reopen the saved bytes through the same PDF.js browser rendering path.
  await page.getByRole('button', { name: 'Start over', exact: true }).click();
  await sourceInput().setInputFiles({
    name: 'native-source-text-output.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(output),
  });
  await waitForTextLayer();
  assert.match(await textLayer().innerText(), new RegExp(replacementText));
  assert.doesNotMatch(await textLayer().innerText(), new RegExp(originalText));

  // Pixel probes are intentionally broad around the rendered glyph bounds;
  // unlike text extraction, they prove the output canvas paints at the moved
  // location and no longer paints at the source location.
  const movedInk = await canvasDarkPixels({
    x: replacementX - 4,
    y: pageHeight - replacementY - 18,
    width: 110,
    height: 28,
    pageWidth,
    pageHeight,
  });
  const sourceInk = await canvasDarkPixels({
    x: sourceX - 4,
    y: pageHeight - sourceY - 18,
    width: 110,
    height: 28,
    pageWidth,
    pageHeight,
  });
  assert(
    movedInk > 12,
    'Reopened PDF did not render text at its new position.',
  );
  assert.equal(
    sourceInk,
    0,
    'Reopened PDF still renders text at its old position.',
  );
  await page.screenshot({
    path: resolve(artifacts, 'reopened-native-source-text.png'),
    fullPage: false,
  });

  // A substring selected from one visible text item must never resolve to a
  // separate raw Tj run that happens to contain the same string.
  await page.getByRole('button', { name: 'Start over', exact: true }).click();
  await sourceInput().setInputFiles(partialSelectionFixture.fixture);
  await waitForTextLayer();
  await nativeEditButton().click();
  const prefixSuffix = textLayer()
    .locator('span[role="presentation"]')
    .filter({ hasText: 'PrefixSuffix' })
    .first();
  await prefixSuffix.waitFor();
  assert.equal(
    await setTextRange('PrefixSuffix', 'Prefix'.length, 'PrefixSuffix'.length),
    'Suffix',
  );
  await page
    .getByRole('button', { name: 'Edit selected source text', exact: true })
    .click();
  const partialRejection = page.getByRole('alert');
  await partialRejection.waitFor();
  assert.notEqual((await partialRejection.innerText()).trim(), '');
  assert.equal(
    await page.getByLabel('Replacement source text', { exact: true }).count(),
    0,
    'A partial PDF.js text item must not open a source-text edit.',
  );
  await page.screenshot({
    path: resolve(artifacts, 'partial-source-selection-rejected.png'),
    fullPage: false,
  });

  // A TJ source is selectable in PDF.js but cannot be transformed safely. The
  // UI must reject it explicitly instead of displaying a visual replacement.
  await page.getByRole('button', { name: 'Start over', exact: true }).click();
  await sourceInput().setInputFiles(unsupportedFixture.fixture);
  await waitForTextLayer();
  await selectFullTextRun('NATIVE-UI-UNSAFE');
  await page
    .getByRole('button', { name: 'Edit selected source text', exact: true })
    .click();
  const rejection = page.getByRole('alert').filter({
    hasText: 'verified source-text subset',
  });
  await rejection.waitFor();
  assert.match(await rejection.innerText(), /cannot safely|outside Kagaz/u);
  await page.screenshot({
    path: resolve(artifacts, 'unsupported-tj-rejected.png'),
    fullPage: false,
  });

  assert.deepEqual(
    nonGetRequests,
    [],
    'Source editing must remain browser local.',
  );
  assert.deepEqual(pageErrors, []);
  console.log(
    'PASS: exact-span source Tj selection/edit/move, partial-selection rejection, undo/redo, saved-byte removal, PDF.js logical/canvas reopen, and TJ rejection.',
  );
} finally {
  await browser.close();
}
