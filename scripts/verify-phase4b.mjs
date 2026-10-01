import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { scanFixture, inspectPdf } from './ocr-fixtures.mjs';
const root = process.env.KAGAZ_ARTIFACT_DIR;
assert(root, 'Set KAGAZ_ARTIFACT_DIR outside the repository.');
await mkdir(root, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  viewport: { width: 1440, height: 1000 },
  acceptDownloads: true,
});
page.setDefaultTimeout(30000);
const web = process.env.KAGAZ_WEB_URL ?? 'http://localhost:5173';
const api = process.env.KAGAZ_API_URL ?? 'http://localhost:4000';
const errors = [],
  uploads = [],
  results = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('request', (request) => {
  if (request.method() === 'POST')
    uploads.push({
      url: request.url(),
      bytes: request.postDataBuffer()?.length,
    });
});
const button = (name) => page.getByRole('button', { name, exact: true });
const dialog = () => page.getByRole('dialog');
async function fresh(name, options) {
  const path = `${root}/${name}.pdf`;
  await writeFile(path, await scanFixture(options));
  await page.goto(web);
  await page
    .locator('input[type=file][accept="application/pdf,.pdf"]')
    .setInputFiles(path);
  await page.locator('.pdf-canvas[data-ready=true]').first().waitFor();
  await page.waitForFunction(
    () => !document.body.innerText.includes('Checking this PDF'),
  );
}
async function download(name, control) {
  const wait = page.waitForEvent('download');
  await control.click();
  const file = await wait;
  const path = `${root}/${name}.pdf`;
  await file.saveAs(path);
  return readFile(path);
}
function samePixels(a, b) {
  assert.equal(a.width, b.width);
  assert.equal(a.height, b.height);
  let difference = 0;
  for (let n = 0; n < a.pixels.length; n++)
    difference += Math.abs(a.pixels[n] - b.pixels[n]);
  assert(
    difference / a.pixels.length < 0.15,
    `Visible content changed: ${difference / a.pixels.length}`,
  );
}
async function ocr(name, { retry = false, baseline } = {}) {
  const before =
    baseline ?? (await download(`${name}-before`, button('Download PDF')));
  const reference = await inspectPdf(page, before);
  const uploadCount = uploads.length;
  const workspaceBefore = await page
    .locator('.thumbnail-source-label')
    .allTextContents();
  if (!retry) await button('OCR PDF').click();
  assert((await dialog().innerText()).includes('English OCR'));
  assert.equal(uploads.length, uploadCount);
  const started = Date.now();
  const responseWait = page.waitForResponse(
    (res) =>
      res.url().endsWith('/tools/ocr') && res.request().method() === 'POST',
    { timeout: 310000 },
  );
  await dialog()
    .getByRole('button', {
      name: retry ? 'Retry OCR' : 'Start OCR',
      exact: true,
    })
    .click();
  const response = await responseWait;
  assert.equal(response.status(), 200, `OCR ${name} HTTP ${response.status()}`);
  await dialog()
    .getByRole('button', { name: 'Download searchable PDF', exact: true })
    .waitFor({ timeout: 310000 });
  const output = await download(
    `${name}-searchable`,
    dialog().getByRole('button', {
      name: 'Download searchable PDF',
      exact: true,
    }),
  );
  const returned = await inspectPdf(page, output);
  assert.equal(returned.forms, 0);
  assert.equal(returned.pages.length, reference.pages.length);
  for (let n = 0; n < reference.pages.length; n++) {
    samePixels(reference.pages[n], returned.pages[n]);
    if (reference.pages[n].text.trim())
      assert.equal(
        returned.pages[n].text.replace(/\s/g, ''),
        reference.pages[n].text.replace(/\s/g, ''),
      );
    else {
      const normalized = returned.pages[n].text
        .toLowerCase()
        .replace(/\s/g, '');
      assert(
        normalized.includes('kagaz') &&
          normalized.includes('english') &&
          normalized.includes('12345'),
        'Expected English OCR words missing in PDF.js',
      );
    }
  }
  assert.equal(uploads.length, uploadCount + 1);
  const headers = response.headers();
  assert.equal(headers['x-kagaz-ocr-language'], 'eng');
  assert.equal(Number(headers['x-kagaz-output-bytes']), output.length);
  results.push({
    name,
    input: before.length,
    output: output.length,
    milliseconds: Date.now() - started,
    pages: returned.pages.length,
    pagesOcred: Number(headers['x-kagaz-pages-ocred']),
    pagesSkipped: Number(headers['x-kagaz-pages-skipped']),
    searchability: 'PDF.js expected English words and retained digital text',
    visual: 'pixel comparison passed',
  });
  console.log(JSON.stringify(results.at(-1)));
  await page.screenshot({ path: `${root}/${name}-result.png`, fullPage: true });
  await dialog().getByRole('button', { name: 'Close', exact: true }).click();
  assert.deepEqual(
    await page.locator('.thumbnail-source-label').allTextContents(),
    workspaceBefore,
  );
  const after = await inspectPdf(
    page,
    await download(`${name}-after`, button('Download PDF')),
  );
  for (let n = 0; n < reference.pages.length; n++) {
    samePixels(reference.pages[n], after.pages[n]);
    assert.equal(reference.pages[n].text, after.pages[n].text);
  }
}
async function rectangle() {
  await button('Rectangle (R)').click();
  const b = await page.locator('.pdf-page-surface').first().boundingBox();
  await page.mouse.move(b.x + 40, b.y + 480);
  await page.mouse.down();
  await page.mouse.move(b.x + 160, b.y + 520, { steps: 6 });
  await page.mouse.up();
  await button('Select (V)').click();
}
try {
  assert.equal((await (await fetch(`${api}/health`)).json()).status, 'ok');
  await fresh('one-page');
  await ocr('one-page');
  await fresh('multi-page', { pages: 3 });
  await ocr('multi-page');
  await fresh('mixed', { digital: true, pages: 2 });
  await ocr('mixed');
  await fresh('ordered', { pages: 3 });
  await button('Move page 3 up').click();
  await button('Delete page 1').click();
  await button('Rotate page 1 clockwise 90 degrees').click();
  await ocr('edited-reordered');
  await fresh('annotation');
  await rectangle();
  await ocr('annotation');
  await fresh('form', { pages: 2, form: true });
  await page
    .getByRole('textbox', { name: 'Name', exact: true })
    .fill('Filled OCR value');
  await page.getByRole('textbox', { name: 'Name', exact: true }).press('Enter');
  await ocr('filled-form');
  await fresh('signature');
  await button('Create visual signature').click();
  await page.getByRole('tab', { name: 'Type', exact: true }).click();
  await page
    .getByLabel('Signature text', { exact: true })
    .fill('Ada Signature');
  await button('Use signature').click();
  const blockedUploads = uploads.length;
  await button('OCR PDF').click();
  assert(
    await dialog()
      .getByRole('button', { name: 'Start OCR', exact: true })
      .isDisabled(),
  );
  assert.equal(uploads.length, blockedUploads);
  await dialog().getByRole('button', { name: 'Close', exact: true }).click();
  const b = await page.locator('.pdf-page-surface').first().boundingBox();
  await page.mouse.click(b.x + 80, b.y + 490);
  await ocr('visual-signature');
  await fresh('password', { form: true, unsafe: true });
  await button('OCR PDF').click();
  assert(
    await dialog()
      .getByRole('button', { name: 'Start OCR', exact: true })
      .isDisabled(),
  );
  assert.equal(uploads.length, blockedUploads + 1);
  await page.keyboard.press('Escape');
  await fresh('glyph', { form: true });
  await page
    .getByRole('textbox', { name: 'Name', exact: true })
    .fill('Unsupported 漢字');
  await page.getByRole('textbox', { name: 'Name', exact: true }).press('Enter');
  const glyphCount = uploads.length;
  await button('OCR PDF').click();
  await dialog()
    .getByRole('button', { name: 'Start OCR', exact: true })
    .click();
  await dialog()
    .getByRole('alert')
    .filter({ hasText: /unsupported by Standard Helvetica/ })
    .waitFor();
  assert.equal(uploads.length, glyphCount);
  await page.keyboard.press('Escape');
  // Hold a browser request to observe cancellation and reject stale completions.
  await fresh('cancel');
  const cancelBaseline = await download(
    'cancel-before',
    button('Download PDF'),
  );
  let release;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  await page.route('**/tools/ocr', async (route) => {
    await held;
    try {
      await route.continue();
    } catch {}
  });
  await button('OCR PDF').click();
  await dialog()
    .getByRole('button', { name: 'Start OCR', exact: true })
    .click();
  await dialog()
    .getByText('Uploading and processing English OCR on the server…', {
      exact: true,
    })
    .waitFor();
  assert(
    await dialog()
      .getByRole('button', { name: 'Working…', exact: true })
      .isDisabled(),
  );
  await dialog()
    .getByRole('button', { name: 'Cancel OCR', exact: true })
    .click();
  await dialog()
    .getByText(/OCR cancelled/)
    .waitFor();
  release();
  await page.unroute('**/tools/ocr');
  await page.route('**/tools/ocr', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({
        error: { code: 'server-busy', message: 'private stderr' },
      }),
    }),
  );
  await dialog()
    .getByRole('button', { name: 'Retry OCR', exact: true })
    .click();
  await dialog()
    .getByRole('alert')
    .filter({ hasText: /server is busy/ })
    .waitFor();
  assert(!(await dialog().innerText()).includes('private stderr'));
  await page.unroute('**/tools/ocr');
  await ocr('retry', { retry: true, baseline: cancelBaseline });
  await page.route('**/tools/ocr', (route) => route.abort('failed'));
  await button('OCR PDF').click();
  await dialog()
    .getByRole('button', { name: 'Start OCR', exact: true })
    .click();
  await dialog()
    .getByRole('alert')
    .filter({ hasText: /Check your connection/ })
    .waitFor();
  await page.unroute('**/tools/ocr');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() =>
    [...document.querySelectorAll('button')].some(
      (el) =>
        el.textContent.trim() === 'OCR PDF' && document.activeElement === el,
    ),
  );
  for (const width of [1440, 768, 390, 360]) {
    await page.setViewportSize({ width, height: 844 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const count = uploads.length;
    await button('OCR PDF').click();
    assert(
      await dialog().evaluate((el) => el.contains(document.activeElement)),
    );
    await dialog()
      .getByRole('button', { name: 'Start OCR', exact: true })
      .focus();
    await page.keyboard.press('Tab');
    assert(
      await dialog().evaluate((el) => el.contains(document.activeElement)),
    );
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    assert.equal(uploads.length, count);
    await page.screenshot({ path: `${root}/ocr-${width}.png`, fullPage: true });
    await page.keyboard.press('Escape');
  }
  const malformed = new FormData();
  malformed.append('file', new Blob(['%PDF-1.7 broken']), 'evil.pdf');
  malformed.append('language', 'eng');
  const failure = await fetch(`${api}/tools/ocr`, {
    method: 'POST',
    body: malformed,
  });
  assert.equal(failure.status, 400);
  assert.equal((await failure.json()).error.code, 'invalid-pdf');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await fresh('compression-after-ocr');
  await button('Compress PDF').click();
  await dialog().getByRole('button', { name: 'Compress', exact: true }).click();
  await dialog()
    .getByRole('button', { name: 'Download compressed PDF', exact: true })
    .waitFor();
  const compressed = await inspectPdf(
    page,
    await download(
      'compression-after-ocr-result',
      dialog().getByRole('button', {
        name: 'Download compressed PDF',
        exact: true,
      }),
    ),
  );
  assert.equal(compressed.pages.length, 1);
  assert.deepEqual(errors, []);
  assert(
    await page.evaluate(
      () => localStorage.length === 0 && sessionStorage.length === 0,
    ),
  );
  console.log('PHASE_4B_BROWSER_PASSED');
} catch (error) {
  await page.screenshot({
    path: `${root}/phase4b-failure.png`,
    fullPage: true,
  });
  throw error;
} finally {
  await writeFile(
    `${root}/phase4b-results.json`,
    JSON.stringify({ results, uploads, errors }, null, 2),
  );
  await browser.close();
}
