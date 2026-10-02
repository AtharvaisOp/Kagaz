import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { officeFixture } from './office-fixtures.mjs';

const require = createRequire(import.meta.url);
const {
  PDFDocument,
  StandardFonts,
} = require('../apps/web/node_modules/pdf-lib');
const artifacts = process.env.KAGAZ_ARTIFACT_DIR;
assert(artifacts, 'Set KAGAZ_ARTIFACT_DIR outside the repository.');
await mkdir(artifacts, { recursive: true });

const web = process.env.KAGAZ_WEB_URL ?? 'http://localhost:5173';
const api = process.env.KAGAZ_API_URL ?? 'http://localhost:4000';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  viewport: { width: 1440, height: 1000 },
  acceptDownloads: true,
});
page.setDefaultTimeout(30_000);
const uploads = [];
const errors = [];
const results = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('request', (request) => {
  if (request.method() === 'POST') uploads.push(request.url());
});
const dialog = () => page.getByRole('dialog');
const openConvert = () =>
  page.getByRole('button', { name: 'Convert to PDF', exact: true });

async function saveFixture(name, asName = name) {
  const path = `${artifacts}/${asName}`;
  await writeFile(path, await officeFixture(name));
  return path;
}

async function download(control, name) {
  const waiting = page.waitForEvent('download');
  await control.click();
  const item = await waiting;
  if (name.endsWith('-converted.pdf'))
    assert.equal(item.suggestedFilename(), 'kagaz-converted.pdf');
  const path = `${artifacts}/${name}`;
  await item.saveAs(path);
  return readFile(path);
}

async function inspectPdf(bytes) {
  const parsed = await PDFDocument.load(bytes, { throwOnInvalidObject: true });
  const pages = await page.evaluate(async (base64) => {
    const pdfjs = await import('/node_modules/pdfjs-dist/build/pdf.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc =
      '/node_modules/pdfjs-dist/build/pdf.worker.mjs';
    const task = pdfjs.getDocument({
      data: Uint8Array.from(atob(base64), (character) =>
        character.charCodeAt(0),
      ),
      useSystemFonts: true,
    });
    const pdf = await task.promise;
    const pages = [];
    try {
      for (let number = 1; number <= pdf.numPages; number++) {
        const current = await pdf.getPage(number);
        const text = await current.getTextContent();
        const operations = await current.getOperatorList();
        const viewport = current.getViewport({ scale: 1 });
        const canvas = document.createElement('canvas');
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        const context = canvas.getContext('2d');
        context.fillStyle = '#fff';
        context.fillRect(0, 0, canvas.width, canvas.height);
        await current.render({ canvasContext: context, viewport }).promise;
        const pixels = context.getImageData(
          0,
          0,
          canvas.width,
          canvas.height,
        ).data;
        let visiblePixels = 0;
        for (let offset = 0; offset < pixels.length; offset += 4)
          if (
            pixels[offset] < 245 ||
            pixels[offset + 1] < 245 ||
            pixels[offset + 2] < 245
          )
            visiblePixels++;
        pages.push({
          text: text.items.map((item) => item.str ?? '').join(' '),
          width: viewport.width,
          height: viewport.height,
          visiblePixels,
          imagePaints: operations.fnArray.filter((operation) =>
            [
              pdfjs.OPS.paintImageXObject,
              pdfjs.OPS.paintInlineImageXObject,
              pdfjs.OPS.paintImageXObjectRepeat,
            ].includes(operation),
          ).length,
        });
        current.cleanup();
      }
    } finally {
      await task.destroy();
    }
    return pages;
  }, Buffer.from(bytes).toString('base64'));
  assert.equal(
    pages.length,
    parsed.getPageCount(),
    'PDF.js and pdf-lib page counts differ.',
  );
  return pages;
}

async function convertFixture({
  name,
  format,
  pages,
  expectedWords,
  image = false,
  retry = false,
}) {
  const inputPath = await saveFixture(name);
  const before = uploads.length;
  if (!retry) {
    await openConvert().click();
    await dialog().locator('#convert-file').setInputFiles(inputPath);
  }
  await dialog()
    .getByText(
      'This uploads the selected document temporarily to the Kagaz server for conversion.',
      { exact: true },
    )
    .waitFor();
  await dialog()
    .getByText(new RegExp(`${format.toUpperCase()} \\(supported\\)`))
    .waitFor();
  assert.equal(uploads.length, before, 'Selecting a file must not upload it.');
  const responseWait = page.waitForResponse(
    (response) =>
      response.url().endsWith('/tools/convert-to-pdf') &&
      response.request().method() === 'POST',
    { timeout: 210_000 },
  );
  await dialog()
    .getByRole('button', {
      name: retry ? 'Retry conversion' : 'Convert',
      exact: true,
    })
    .click();
  // A repeated form event in the same active attempt must not create another upload.
  await dialog()
    .locator('form')
    .evaluate((form) =>
      form.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true }),
      ),
    );
  const response = await responseWait;
  assert.equal(
    response.status(),
    200,
    `Conversion returned HTTP ${response.status()}.`,
  );
  const headers = response.headers();
  assert.equal(headers['x-kagaz-input-format'], format);
  assert.equal(Number(headers['x-kagaz-pages']), pages);
  await dialog()
    .getByRole('button', { name: 'Download PDF', exact: true })
    .waitFor();
  await dialog()
    .getByText(
      new RegExp(
        `PDF ready · ${format.toUpperCase()} · ${pages} ${pages === 1 ? 'page' : 'pages'}`,
      ),
    )
    .waitFor();
  assert.equal(
    uploads.length,
    before + 1,
    'One explicit submit should send exactly one request.',
  );
  const output = await download(
    dialog().getByRole('button', { name: 'Download PDF', exact: true }),
    `${name}-converted.pdf`,
  );
  const inspected = await inspectPdf(output);
  assert.equal(inspected.length, pages);
  const wholeText = inspected
    .map((entry) => entry.text)
    .join(' ')
    .toLowerCase()
    .replace(/\s+/g, ' ');
  for (const word of expectedWords)
    assert(
      wholeText.includes(word.toLowerCase()),
      `Missing expected PDF text: ${word}`,
    );
  assert(
    inspected.every((entry) => entry.visiblePixels > 0),
    'PDF.js rendered an empty page.',
  );
  if (image)
    assert(
      inspected.some((entry) => entry.imagePaints > 0),
      'Expected an embedded image to render.',
    );
  const result = {
    fixture: name,
    format,
    inputBytes: Number(headers['x-kagaz-original-bytes']),
    outputBytes: output.byteLength,
    pages: inspected.length,
    expectedText: expectedWords,
    renderedPages: inspected.map(
      ({ width, height, visiblePixels, imagePaints }) => ({
        width,
        height,
        visiblePixels,
        imagePaints,
      }),
    ),
  };
  results.push(result);
  console.log(JSON.stringify(result));
  await page.screenshot({
    path: `${artifacts}/${name}-conversion-${await page.evaluate(() => innerWidth)}.png`,
    fullPage: true,
  });
  await dialog().getByRole('button', { name: 'Close', exact: true }).click();
  return output;
}

async function createWorkspacePdf() {
  const document = await PDFDocument.create();
  const current = document.addPage([500, 400]);
  const font = await document.embedFont(StandardFonts.Helvetica);
  current.drawText('Workspace remains local', {
    x: 40,
    y: 320,
    size: 20,
    font,
  });
  const path = `${artifacts}/active-workspace.pdf`;
  await writeFile(path, await document.save());
  return path;
}

try {
  assert.equal((await (await fetch(`${api}/health`)).json()).status, 'ok');
  await page.goto(web);
  assert(
    await page
      .getByText('Your documents. Your browser. Nothing in between.')
      .isVisible(),
  );

  // Empty-state access, privacy, file selection without network activity, and mobile focus/layout.
  for (const width of [1440, 768, 390, 360]) {
    await page.setViewportSize({ width, height: 844 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const count = uploads.length;
    await openConvert().click();
    assert(
      await dialog().evaluate((element) =>
        element.contains(document.activeElement),
      ),
    );
    const privacy = await dialog().innerText();
    assert(privacy.includes('temporarily to the Kagaz server for conversion'));
    assert(privacy.includes('not permanently stored'));
    assert(privacy.includes('browser-local'));
    assert(privacy.includes('derivative PDF download'));
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await page.screenshot({
      path: `${artifacts}/convert-empty-${width}.png`,
      fullPage: true,
    });
    await page.keyboard.press('Tab');
    assert(
      await dialog().evaluate((element) =>
        element.contains(document.activeElement),
      ),
    );
    await page.keyboard.press('Escape');
    await page.waitForFunction(
      () => document.activeElement?.textContent?.trim() === 'Convert to PDF',
    );
    assert.equal(uploads.length, count);
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await convertFixture({
    name: 'paragraphs.docx',
    format: 'docx',
    pages: 1,
    expectedWords: ['Kagaz Writer Conversion', 'First paragraph'],
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  // Abort an intentionally held browser request, then prove an explicit retry succeeds.
  const docxPath = await saveFixture('paragraphs.docx');
  await openConvert().click();
  await dialog().locator('#convert-file').setInputFiles(docxPath);
  const beforeCancel = uploads.length;
  let release;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  await page.route('**/tools/convert-to-pdf', async (route) => {
    await held;
    try {
      await route.abort('aborted');
    } catch {}
  });
  await dialog().getByRole('button', { name: 'Convert', exact: true }).click();
  await dialog()
    .getByText('Uploading, checking and converting on the server…', {
      exact: true,
    })
    .waitFor();
  assert(
    !/\d+%/.test(await dialog().getByRole('status').innerText()),
    'Conversion must not display fake percentage progress.',
  );
  await dialog()
    .getByRole('button', { name: 'Cancel conversion', exact: true })
    .click();
  await dialog()
    .getByText('Conversion cancelled. Your workspace is intact.', {
      exact: true,
    })
    .waitFor();
  assert.equal(uploads.length, beforeCancel + 1);
  release();
  await page.unroute('**/tools/convert-to-pdf');

  await page.route('**/tools/convert-to-pdf', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({
        error: { code: 'server-busy', message: '/tmp/private stderr' },
      }),
    }),
  );
  await dialog()
    .getByRole('button', { name: 'Retry conversion', exact: true })
    .click();
  await dialog()
    .getByRole('alert')
    .filter({ hasText: /server is busy/ })
    .waitFor();
  assert(!(await dialog().innerText()).includes('/tmp/private'));
  await page.unroute('**/tools/convert-to-pdf');

  const convertedDocx = await convertFixture({
    name: 'paragraphs.docx',
    format: 'docx',
    pages: 1,
    expectedWords: [
      'Kagaz Writer Conversion',
      'First paragraph',
      'Bold formatted paragraph',
    ],
    retry: true,
  });
  const docxResult = await inspectPdf(convertedDocx);
  assert(docxResult[0].visiblePixels > 0);

  await convertFixture({
    name: 'image-page-break.docx',
    format: 'docx',
    pages: 2,
    expectedWords: [
      'Kagaz Writer Conversion',
      'Explicit page break',
      'Second Page',
    ],
    image: true,
  });
  await convertFixture({
    name: 'slides.pptx',
    format: 'pptx',
    pages: 3,
    expectedWords: [
      'Kagaz Slide 1',
      'Kagaz Slide 2',
      'Kagaz Slide 3',
      'Meaningful presentation content',
    ],
    image: true,
  });
  await convertFixture({
    name: 'sheet.xlsx',
    format: 'xlsx',
    pages: 1,
    expectedWords: ['Kagaz Budget', 'Paper', 'Printing', '375'],
  });
  await convertFixture({
    name: 'sheets.xlsx',
    format: 'xlsx',
    pages: 2,
    expectedWords: ['Kagaz Budget', 'Kagaz Summary', 'Paper', '375'],
  });

  // Unsupported extensions fail locally and never submit an upload.
  const disguisedPath = await saveFixture('paragraphs.docx', 'renamed.docm');
  const uploadsBeforeDisguised = uploads.length;
  await openConvert().click();
  await dialog().locator('#convert-file').setInputFiles(disguisedPath);
  await dialog()
    .getByRole('alert')
    .filter({ hasText: /Choose a non-empty DOCX/ })
    .waitFor();
  assert(
    await dialog()
      .getByRole('button', { name: 'Convert', exact: true })
      .isDisabled(),
  );
  assert.equal(uploads.length, uploadsBeforeDisguised);
  await page.keyboard.press('Escape');

  // A failed network attempt stays friendly and can be retried without auto-upload.
  await openConvert().click();
  await dialog().locator('#convert-file').setInputFiles(docxPath);
  const networkCount = uploads.length;
  await page.route('**/tools/convert-to-pdf', (route) => route.abort('failed'));
  await dialog().getByRole('button', { name: 'Convert', exact: true }).click();
  await dialog()
    .getByRole('alert')
    .filter({ hasText: /Check your connection/ })
    .waitFor();
  assert.equal(uploads.length, networkCount + 1);
  await page.unroute('**/tools/convert-to-pdf');
  await dialog()
    .getByRole('button', { name: 'Retry conversion', exact: true })
    .click();
  await dialog()
    .getByRole('button', { name: 'Download PDF', exact: true })
    .waitFor();
  await dialog().getByRole('button', { name: 'Close', exact: true }).click();

  // Convert while a PDF workspace is open and compare its local export before/after.
  const activePath = await createWorkspacePdf();
  await page.goto(web);
  await page
    .locator('input[type=file][accept="application/pdf,.pdf"]')
    .setInputFiles(activePath);
  await page.locator('.pdf-canvas[data-ready=true]').first().waitFor();
  const workspaceBefore = {
    name: await page.locator('.document-name').innerText(),
    pages: await page.locator('.document-pages').innerText(),
    labels: await page.locator('.thumbnail-source-label').allTextContents(),
    pdf: await download(
      page.getByRole('button', { name: 'Download PDF', exact: true }),
      'workspace-before.pdf',
    ),
  };
  const workspaceText = (await inspectPdf(workspaceBefore.pdf))[0].text;
  await convertFixture({
    name: 'paragraphs.docx',
    format: 'docx',
    pages: 1,
    expectedWords: ['Kagaz Writer Conversion', 'First paragraph'],
  });
  assert.equal(
    await page.locator('.document-name').innerText(),
    workspaceBefore.name,
  );
  assert.equal(
    await page.locator('.document-pages').innerText(),
    workspaceBefore.pages,
  );
  assert.deepEqual(
    await page.locator('.thumbnail-source-label').allTextContents(),
    workspaceBefore.labels,
  );
  const workspaceAfter = await download(
    page.getByRole('button', { name: 'Download PDF', exact: true }),
    'workspace-after.pdf',
  );
  assert.equal((await inspectPdf(workspaceAfter))[0].text, workspaceText);
  assert.deepEqual(errors, []);
  assert(
    await page.evaluate(
      () => localStorage.length === 0 && sessionStorage.length === 0,
    ),
  );
  await writeFile(
    `${artifacts}/phase4c-browser.json`,
    JSON.stringify({ uploads, errors, results }, null, 2),
  );
  console.log('PHASE_4C_BROWSER_PASSED');
} catch (error) {
  await page.screenshot({
    path: `${artifacts}/phase4c-failure.png`,
    fullPage: true,
  });
  throw error;
} finally {
  await browser.close();
}
