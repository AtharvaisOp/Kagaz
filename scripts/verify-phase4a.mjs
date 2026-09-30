import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
const require = createRequire(import.meta.url);
const lib = require('../apps/web/node_modules/pdf-lib');
const root = process.env.KAGAZ_ARTIFACT_DIR;
assert(root, 'Set KAGAZ_ARTIFACT_DIR outside the repository.');
await mkdir(root, { recursive: true });
const web = process.env.KAGAZ_WEB_URL ?? 'http://localhost:5173';
const api = process.env.KAGAZ_API_URL ?? 'http://localhost:4000';
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  acceptDownloads: true,
});
const page = await context.newPage();
page.setDefaultTimeout(15000);
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
async function fixture(
  name,
  { forms = false, pages = 1, unsafe = false, image = true } = {},
) {
  const doc = await lib.PDFDocument.create();
  for (let i = 0; i < pages; i++) {
    const p = doc.addPage([500, 400]);
    p.drawText(`${name} page ${i + 1}`, { x: 30, y: 365, size: 14 });
    if (image) {
      const pixels = new Uint8Array(900 * 900 * 3);
      // Deliberately uncompressed image forces a real derivative in Balanced.
      let seed = 123;
      for (let n = 0; n < pixels.length; n++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        pixels[n] = seed >>> 24;
      }
      const ref = doc.context.register(
        doc.context.stream(pixels, {
          Type: 'XObject',
          Subtype: 'Image',
          Width: 900,
          Height: 900,
          ColorSpace: 'DeviceRGB',
          BitsPerComponent: 8,
        }),
      );
      const key = p.node.newXObject('Photo', ref);
      p.pushOperators(
        lib.pushGraphicsState(),
        lib.concatTransformationMatrix(100, 0, 0, 80, 350, 20),
        lib.drawObject(key),
        lib.popGraphicsState(),
      );
    }
    if (forms && i === 0) {
      const f = doc.getForm().createTextField('Name');
      f.setText('Original');
      if (unsafe) f.enablePassword();
      f.addToPage(p, { x: 30, y: 300, width: 200, height: 24 });
    }
  }
  const path = `${root}/${name}.pdf`;
  await writeFile(path, await doc.save());
  return path;
}
async function fresh(files) {
  await page.goto(web);
  await page
    .locator('input[type=file][accept="application/pdf,.pdf"]')
    .setInputFiles(files);
  await page.locator('.pdf-canvas[data-ready=true]').first().waitFor();
  await page.waitForFunction(
    () => !document.body.innerText.includes('Checking this PDF'),
  );
}
async function download(name, locator) {
  const event = page.waitForEvent('download');
  await locator.click();
  const artifact = await event;
  const path = `${root}/${name}.pdf`;
  await artifact.saveAs(path);
  return path;
}
async function inspect(path) {
  const data = await readFile(path);
  const doc = await lib.PDFDocument.load(data, { throwOnInvalidObject: true });
  assert.equal(doc.getForm().getFields().length, 0);
  return page.evaluate(async (base64) => {
    const pdfjs = await import('/node_modules/pdfjs-dist/build/pdf.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc =
      '/node_modules/pdfjs-dist/build/pdf.worker.mjs';
    const task = pdfjs.getDocument({
      data: Uint8Array.from(atob(base64), (character) =>
        character.charCodeAt(0),
      ),
      useSystemFonts: true,
    });
    const pdf = await task.promise,
      report = [];
    try {
      for (let n = 1; n <= pdf.numPages; n++) {
        const p = await pdf.getPage(n),
          text = await p.getTextContent(),
          ops = await p.getOperatorList(),
          vp = p.getViewport({ scale: 1 });
        const canvas = document.createElement('canvas');
        canvas.width = vp.width;
        canvas.height = vp.height;
        await p.render({
          canvasContext: canvas.getContext('2d'),
          viewport: vp,
        }).promise;
        const rgba = canvas
          .getContext('2d')
          .getImageData(0, 0, canvas.width, canvas.height).data;
        const sample = [...rgba];
        report.push({
          text: text.items.map((t) => t.str ?? '').join(' '),
          width: vp.width,
          height: vp.height,
          images: ops.fnArray.filter((op) =>
            [
              pdfjs.OPS.paintImageXObject,
              pdfjs.OPS.paintInlineImageXObject,
            ].includes(op),
          ).length,
          sample,
        });
      }
    } finally {
      await task.destroy();
    }
    return report;
  }, data.toString('base64'));
}
async function compress(name) {
  const before = await download(
    `${name}-browser-export`,
    button('Download PDF'),
  );
  const reference = await inspect(before);
  const uploadCount = uploads.length;
  await button('Compress PDF').click();
  await dialog()
    .getByText(
      'Compression temporarily uploads the current PDF to the Kagaz server for processing.',
      { exact: true },
    )
    .waitFor();
  assert.equal(uploads.length, uploadCount);
  const stateBefore = await page
    .locator('.thumbnail-source-label')
    .allTextContents();
  const started = Date.now();
  const responseEvent = page.waitForResponse(
    (res) =>
      res.url().endsWith('/tools/compress') &&
      res.request().method() === 'POST',
  );
  await dialog().getByRole('button', { name: 'Compress', exact: true }).click();
  const response = await responseEvent;
  assert.equal(response.status(), 200, await response.text());
  await dialog()
    .getByRole('button', { name: 'Download compressed PDF', exact: true })
    .waitFor();
  assert.equal(uploads.length, uploadCount + 1);
  const output = await download(
    `${name}-compressed`,
    dialog().getByRole('button', {
      name: 'Download compressed PDF',
      exact: true,
    }),
  );
  const returned = await inspect(output);
  assert.equal(returned.length, reference.length);
  for (let n = 0; n < reference.length; n++) {
    assert.equal(
      returned[n].text.replace(/\s+/g, ' ').trim(),
      reference[n].text.replace(/\s+/g, ' ').trim(),
    );
    assert.equal(returned[n].width, reference[n].width);
    assert.equal(returned[n].height, reference[n].height);
    assert.equal(returned[n].images, reference[n].images);
    // Compare rendered marks outside the intentionally lossy image region.
    let sum = 0,
      count = 0;
    const a = reference[n].sample,
      b = returned[n].sample;
    for (let offset = 0; offset < a.length; offset += 4) {
      const x = (offset / 4) % reference[n].width,
        y = Math.floor(offset / 4 / reference[n].width);
      if (
        (reference[n].width === 500 && x > 340 && y > 290) ||
        (reference[n].width === 400 && x < 110 && y > 340)
      )
        continue;
      sum +=
        Math.abs(a[offset] - b[offset]) +
        Math.abs(a[offset + 1] - b[offset + 1]) +
        Math.abs(a[offset + 2] - b[offset + 2]);
      count += 3;
    }
    assert(sum / count < 2, `Visual difference ${sum / count}`);
  }
  const headers = response.headers();
  assert.equal(headers['x-kagaz-outcome'], 'compressed');
  assert.equal(
    Number(headers['x-kagaz-compressed-bytes']),
    (await readFile(output)).length,
  );
  const result = {
    name,
    input: Number(headers['x-kagaz-original-bytes']),
    output: Number(headers['x-kagaz-compressed-bytes']),
    savedPercent: Number(headers['x-kagaz-saved-percent']),
    milliseconds: Date.now() - started,
    pages: returned.map(({ sample, ...rest }) => rest),
  };
  results.push(result);
  console.log(JSON.stringify(result));
  await page.screenshot({ path: `${root}/${name}-result.png`, fullPage: true });
  await dialog().getByRole('button', { name: 'Close', exact: true }).click();
  assert.deepEqual(
    await page.locator('.thumbnail-source-label').allTextContents(),
    stateBefore,
  );
  const after = await download(`${name}-after`, button('Download PDF'));
  const afterDoc = await lib.PDFDocument.load(await readFile(after));
  assert.equal(afterDoc.getPageCount(), reference.length);
}
async function rectangle() {
  await button('Rectangle (R)').click();
  const b = await page.locator('.pdf-page-surface').first().boundingBox();
  await page.mouse.move(b.x + 40, b.y + 160);
  await page.mouse.down();
  await page.mouse.move(b.x + 160, b.y + 230, { steps: 6 });
  await page.mouse.up();
  await button('Select (V)').click();
}
try {
  assert.equal((await (await fetch(`${api}/health`)).json()).status, 'ok');
  const plain = await fixture('plain');
  await fresh(plain);
  await compress('plain');
  const ordered = await fixture('ordered', { pages: 3 });
  await fresh(ordered);
  await button('Move page 3 up').click();
  await button('Delete page 1').click();
  await button('Rotate page 1 clockwise 90 degrees').click();
  await compress('reordered-rotated-deleted');
  await fresh(plain);
  await rectangle();
  await compress('annotations');
  const form = await fixture('forms', { forms: true });
  await fresh(form);
  await page
    .getByRole('textbox', { name: 'Name', exact: true })
    .fill('Filled compression value');
  await page.getByRole('textbox', { name: 'Name', exact: true }).press('Enter');
  await compress('filled-form');
  await fresh(plain);
  await button('Create visual signature').click();
  await page.getByRole('tab', { name: 'Type', exact: true }).click();
  await page
    .getByLabel('Signature text', { exact: true })
    .fill('Ada Signature');
  await button('Use signature').click();
  const uploadsBeforeBlock = uploads.length;
  await button('Compress PDF').click();
  assert(
    await dialog()
      .getByRole('button', { name: 'Compress', exact: true })
      .isDisabled(),
  );
  assert.equal(uploads.length, uploadsBeforeBlock);
  await dialog().getByRole('button', { name: 'Close', exact: true }).click();
  const b = await page.locator('.pdf-page-surface').first().boundingBox();
  await page.mouse.click(b.x + 80, b.y + 190);
  await compress('visual-signature');
  await fresh([plain, form]);
  await compress('multi-source');
  // Unsafe form blocker must prevent preparation and upload.
  const unsafe = await fixture('unsafe', { forms: true, unsafe: true });
  await fresh(unsafe);
  const blocked = uploads.length;
  await button('Compress PDF').click();
  assert(
    await dialog()
      .getByRole('button', { name: 'Compress', exact: true })
      .isDisabled(),
  );
  assert.equal(uploads.length, blocked);
  await dialog().getByRole('button', { name: 'Close', exact: true }).click();
  await fresh(form);
  await page
    .getByRole('textbox', { name: 'Name', exact: true })
    .fill('Unsupported 漢字');
  await page.getByRole('textbox', { name: 'Name', exact: true }).press('Enter');
  await button('Compress PDF').click();
  await dialog().getByRole('button', { name: 'Compress', exact: true }).click();
  await dialog()
    .getByRole('alert')
    .filter({ hasText: /unsupported by Standard Helvetica/ })
    .waitFor();
  assert.equal(uploads.length, blocked);
  await dialog().getByRole('button', { name: 'Close', exact: true }).click();
  // Delay the response to observe busy state, duplicate protection, cancel and stale completion.
  await fresh(plain);
  let release;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  await page.route('**/tools/compress', async (route) => {
    await held;
    try {
      await route.continue();
    } catch {}
  });
  await button('Compress PDF').click();
  await dialog()
    .getByRole('radio', { name: /Maximum compression/ })
    .check();
  await dialog().getByRole('button', { name: 'Compress', exact: true }).click();
  await dialog()
    .getByText('Uploading and compressing on the server…', { exact: true })
    .waitFor();
  assert(
    await dialog()
      .getByRole('button', { name: 'Working…', exact: true })
      .isDisabled(),
  );
  await dialog()
    .getByRole('button', { name: 'Cancel compression', exact: true })
    .click();
  await dialog()
    .getByText(/Compression cancelled/)
    .waitFor();
  release();
  await page.unroute('**/tools/compress');
  // Friendly server failure -> retry using real API.
  await page.route('**/tools/compress', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({
        error: { code: 'server-busy', message: '/tmp/private stderr' },
      }),
    }),
  );
  await dialog()
    .getByRole('button', { name: 'Retry compression', exact: true })
    .click();
  await dialog()
    .getByRole('alert')
    .filter({ hasText: /server is busy/ })
    .waitFor();
  assert(!(await dialog().innerText()).includes('/tmp/private'));
  await page.unroute('**/tools/compress');
  await dialog()
    .getByRole('button', { name: 'Retry compression', exact: true })
    .click();
  await dialog()
    .getByRole('button', { name: 'Download compressed PDF', exact: true })
    .waitFor();
  await dialog().getByRole('button', { name: 'Close', exact: true }).click();
  // Network failure and focus containment/return on desktop and small screens.
  await page.route('**/tools/compress', (route) => route.abort('failed'));
  await button('Compress PDF').click();
  await dialog().getByRole('button', { name: 'Compress', exact: true }).click();
  await dialog()
    .getByRole('alert')
    .filter({ hasText: /Check your connection/ })
    .waitFor();
  await page.unroute('**/tools/compress');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() =>
    [...document.querySelectorAll('button')].some(
      (el) =>
        el.textContent.trim() === 'Compress PDF' &&
        document.activeElement === el,
    ),
  );
  assert(
    await button('Compress PDF').evaluate(
      (el) => document.activeElement === el,
    ),
  );
  for (const width of [1440, 768, 390, 360]) {
    await page.setViewportSize({ width, height: 844 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await button('Compress PDF').click();
    assert(
      await dialog().evaluate((el) => el.contains(document.activeElement)),
    );
    await dialog()
      .getByRole('button', { name: 'Compress', exact: true })
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
    await page.screenshot({
      path: `${root}/compression-${width}.png`,
      fullPage: true,
    });
    await page.keyboard.press('Escape');
  }
  const bad = new FormData();
  bad.append('file', new Blob(['%PDF-1.7 broken']), 'evil.pdf');
  bad.append('preset', 'balanced');
  const failure = await fetch(`${api}/tools/compress`, {
    method: 'POST',
    body: bad,
  });
  assert.equal(failure.status, 400);
  assert.equal((await failure.json()).error.code, 'invalid-pdf');
  assert.deepEqual(errors, []);
  assert(
    await page.evaluate(
      () => localStorage.length === 0 && sessionStorage.length === 0,
    ),
  );
  console.log('PHASE_4A_BROWSER_PASSED');
} catch (error) {
  await page.screenshot({ path: `${root}/failure.png`, fullPage: true });
  console.error(await page.locator('body').innerText());
  throw error;
} finally {
  await writeFile(
    `${root}/phase4a-results.json`,
    JSON.stringify({ results, uploads, errors }, null, 2),
  );
  await browser.close();
}
