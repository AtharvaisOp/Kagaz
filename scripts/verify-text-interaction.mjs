import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const lib = require('../apps/web/node_modules/pdf-lib');
assert(process.env.KAGAZ_ARTIFACT_DIR, 'Set KAGAZ_ARTIFACT_DIR outside Git.');
const artifacts = resolve(process.env.KAGAZ_ARTIFACT_DIR, 'text-interaction');
await mkdir(artifacts, { recursive: true });
const doc = await lib.PDFDocument.create();
const image = await doc.embedPng(
  await readFile('apps/api/src/tools/fixtures/english-scan.png'),
);
for (let i = 0; i < 12; i++) {
  const p = doc.addPage([612, 792]);
  if (i !== 2) {
    p.drawText(`Digital page ${i + 1}: first selectable line.`, {
      x: 60,
      y: 700,
      size: 18,
    });
    p.drawText('Second line for accurate multiline highlighting.', {
      x: 60,
      y: 670,
      size: 18,
    });
  }
  if (i === 1 || i === 2)
    p.drawImage(image, { x: 60, y: 100, width: 400, height: 420 });
}
doc
  .getForm()
  .createTextField('Synthetic field')
  .addToPage(doc.getPage(0), { x: 60, y: 550, width: 200, height: 30 });
const fixture = await doc.save();
await writeFile(resolve(artifacts, 'synthetic.pdf'), fixture);
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1100 },
  deviceScaleFactor: 2,
  permissions: ['clipboard-read', 'clipboard-write'],
  acceptDownloads: true,
});
const page = await context.newPage();
const errors = [],
  posts = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('request', (request) => {
  if (request.method() === 'POST') posts.push(request.url());
});
page.on('dialog', (dialog) => dialog.accept());
const button = (name) =>
  page.getByRole('button', {
    name: ['Select', 'Text', 'Highlight'].includes(name)
      ? new RegExp(`^${name} \\(`)
      : name,
    exact: true,
  });
const surface = () => page.locator('.pdf-page-surface').first();
const spans = () =>
  surface().locator('.pdf-text-layer span[role="presentation"]');
const waitText = async () => {
  await surface().locator('.pdf-text-layer[data-status="ready"]').waitFor();
  await spans().first().waitFor();
};
async function dragSelection() {
  await spans().first().scrollIntoViewIfNeeded();
  const start = await spans().nth(0).boundingBox();
  const end = await spans().nth(1).boundingBox();
  await page.mouse.move(start.x + 1, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(end.x + end.width - 1, end.y + end.height / 2, {
    steps: 20,
  });
  await page.mouse.up();
}
async function countHighlights() {
  return page
    .locator('.annotation-summary-list > li')
    .filter({ hasText: 'Highlight' })
    .count();
}
async function waitCount(count) {
  await page.waitForFunction(
    (n) =>
      [...document.querySelectorAll('.annotation-summary-list > li')].filter(
        (e) => e.textContent.includes('Highlight'),
      ).length === n,
    count,
  );
}
try {
  await page.goto(process.env.KAGAZ_APP_URL || 'http://127.0.0.1:5173');
  await page
    .locator('input[type=file][accept="application/pdf,.pdf"]')
    .first()
    .setInputFiles({
      name: 'synthetic.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from(fixture),
    });
  await waitText();
  assert(
    (await page.locator('.pdf-text-layer').count()) < 12,
    'pages stay lazy',
  );
  await dragSelection();
  const selected = await page.evaluate(() => getSelection().toString());
  assert.match(selected, /first selectable line/);
  assert.match(selected, /Second line/);
  await page.keyboard.press('Control+c');
  assert.equal(
    (await page.evaluate(() => navigator.clipboard.readText())).replace(
      /\r\n/g,
      '\n',
    ),
    selected,
  );
  await button('Highlight selected text').click();
  await waitCount(2);
  await button('Undo').click();
  await waitCount(0);
  await button('Redo').click();
  await waitCount(2);
  await button('Select PDF text').click();
  await dragSelection();
  assert.match(
    await page.evaluate(() => getSelection().toString()),
    /first selectable line/,
  );
  await button('Zoom in').click();
  await waitText();
  await button('Highlight').click();
  await dragSelection();
  await waitCount(4);
  await button('Undo').click();
  await waitCount(2);
  // Manual geometry still works away from selectable characters.
  const bounds = await surface().boundingBox();
  await page.mouse.move(bounds.x + 40, bounds.y + 280);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 180, bounds.y + 300, { steps: 10 });
  await page.mouse.up();
  await waitCount(3);
  await button('Select').click();
  await page
    .getByLabel('Synthetic field', { exact: true })
    .fill('Form remains usable');
  // Text annotations retain editing, movement, resizing and history through the semantic controls.
  await button('Text').click();
  const box = await surface().boundingBox();
  await page.mouse.click(box.x + 100, box.y + 400);
  await page
    .getByRole('textbox', { name: 'New annotation text', exact: true })
    .fill('Editable Kagaz text');
  await page.keyboard.press('Control+Enter');
  await button('Select').click();
  // Native mouse selection/double-click through the clipped annotation canvas.
  const annotationSurface = await surface().boundingBox();
  await page.mouse.dblclick(
    annotationSurface.x + 110,
    annotationSurface.y + 410,
  );
  await page
    .getByRole('textbox', { name: 'Edit annotation text', exact: true })
    .waitFor();
  await page.keyboard.press('Escape');
  await page.mouse.move(annotationSurface.x + 110, annotationSurface.y + 410);
  await page.mouse.down();
  await page.mouse.move(annotationSurface.x + 150, annotationSurface.y + 430, {
    steps: 10,
  });
  await page.mouse.up();
  await button('Undo').click();
  await button('Redo').click();
  const item = page
    .locator('.annotation-summary-item')
    .filter({ hasText: 'Editable Kagaz text' });
  await item
    .getByRole('button', { name: /Editable Kagaz text, annotation/ })
    .click();
  await item
    .getByRole('button', {
      name: 'Move Editable Kagaz text right',
      exact: true,
    })
    .click();
  await item
    .getByRole('button', {
      name: 'increase width of Editable Kagaz text',
      exact: true,
    })
    .click();
  await button('Edit text').click();
  await page
    .getByRole('textbox', { name: 'Edit annotation text', exact: true })
    .fill('Edited Kagaz text');
  await page.keyboard.press('Control+Enter');
  await button('Undo').click();
  assert(await page.getByText('Editable Kagaz text', { exact: true }).count());
  await button('Redo').click();
  await button('Rotate page 1 clockwise 90 degrees').click();
  await waitText();
  assert.equal(
    await surface()
      .locator('.pdf-text-layer')
      .getAttribute('data-main-rotation'),
    '90',
  );
  await button('Select PDF text').click();
  await dragSelection();
  assert.match(
    await page.evaluate(() => getSelection().toString()),
    /Second line/,
  );
  await button('Highlight selected text').click();
  await waitCount(5);
  await page.screenshot({
    path: resolve(artifacts, 'desktop.png'),
    fullPage: false,
  });
  const download = page.waitForEvent('download');
  await button('Download PDF').click();
  const output = await download;
  await output.saveAs(resolve(artifacts, 'highlighted.pdf'));
  const bytes = await readFile(resolve(artifacts, 'highlighted.pdf'));
  const reopened = await lib.PDFDocument.load(bytes);
  assert.equal(reopened.getPageCount(), 12);
  assert.equal(reopened.getPage(0).getRotation().angle, 90);
  // Reload actual export in PDF.js via the UI and verify original and added text.
  await button('Start over').click();
  await page
    .locator('input[type=file][accept="application/pdf,.pdf"]')
    .first()
    .setInputFiles({
      name: 'highlighted.pdf',
      mimeType: 'application/pdf',
      buffer: bytes,
    });
  await waitText();
  assert.match(
    await surface().locator('.pdf-text-layer').innerText(),
    /first selectable line/,
  );
  assert.match(
    await surface().locator('.pdf-text-layer').innerText(),
    /Edited Kagaz text/,
  );
  await button('Move page 1 down').click();
  await page.locator('.pdf-page-surface').nth(1).scrollIntoViewIfNeeded();
  await page
    .locator('.pdf-page-surface')
    .nth(1)
    .locator('.pdf-text-layer[data-status="ready"]')
    .waitFor();
  assert.match(
    await page
      .locator('.pdf-page-surface')
      .nth(1)
      .locator('.pdf-text-layer')
      .innerText(),
    /Digital page 1/,
  );
  await button('Move page 2 up').click();
  // Mixed page and image-only page, plus an initially distant page.
  for (const index of [1, 2, 11]) {
    const current = page.locator('.pdf-page-surface').nth(index);
    await current.scrollIntoViewIfNeeded();
    await current.locator('.pdf-text-layer[data-status="ready"]').waitFor();
    assert.equal(
      (await current.locator('span[role="presentation"]').count()) > 0,
      index !== 2,
    );
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.pdf-page-surface').first().scrollIntoViewIfNeeded();
  await waitText();
  await spans().first().scrollIntoViewIfNeeded();
  await page.screenshot({
    path: resolve(artifacts, 'mobile.png'),
    fullPage: false,
  });
  await page.setViewportSize({ width: 1440, height: 1100 });
  await button('Start over').click();
  const duplicated = {
    name: 'duplicate.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(fixture),
  };
  await page
    .locator('input[type=file][accept="application/pdf,.pdf"]')
    .first()
    .setInputFiles([duplicated, duplicated]);
  await waitText();
  assert.equal(await page.locator('.pdf-page-surface').count(), 24);
  const duplicate = page.locator('.pdf-page-surface').nth(12);
  await duplicate.scrollIntoViewIfNeeded();
  await duplicate.locator('.pdf-text-layer[data-status="ready"]').waitFor();
  assert.match(
    await duplicate.locator('.pdf-text-layer').innerText(),
    /Digital page 1/,
  );
  assert.deepEqual(posts, [], 'text interaction must remain browser local');
  assert.deepEqual(errors, []);
  console.log(
    'PASS: native drag/copy, multiline and manual highlights, undo/redo, zoom/rotation, forms, annotation controls, export/reopen, lazy/mixed/scanned pages, mobile and no uploads.',
  );
} finally {
  await browser.close();
}
