import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const { PDFDocument } = require('../apps/web/node_modules/pdf-lib');
assert(process.env.KAGAZ_ARTIFACT_DIR, 'Set KAGAZ_ARTIFACT_DIR outside Git.');
const artifacts = resolve(process.env.KAGAZ_ARTIFACT_DIR, 'ocr-feedback');
await mkdir(artifacts, { recursive: true });
const pdf = await PDFDocument.create();
pdf.addPage().drawText('Synthetic readable digital page');
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
let code = 'no-ocr-needed',
  requests = 0;
await page.route('**/tools/ocr', async (route) => {
  requests++;
  const rejection = {
    error: {
      code,
      message: 'fixed server envelope',
      ...(code === 'unsupported-pdf' ? { reason: 'unsafe-structure' } : {}),
    },
  };
  await route.fulfill({
    status: 422,
    contentType: 'application/json',
    body: JSON.stringify(rejection),
  });
});
try {
  await page.goto(process.env.KAGAZ_APP_URL || 'http://127.0.0.1:5173');
  await page
    .locator('input[type=file][accept="application/pdf,.pdf"]')
    .first()
    .setInputFiles({
      name: 'synthetic.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from(await pdf.save()),
    });
  await page.getByRole('button', { name: 'OCR PDF', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'OCR PDF', exact: true });
  assert.match(
    await dialog.innerText(),
    /OCR does not edit the visible original text/,
  );
  await dialog.getByRole('button', { name: 'Start OCR', exact: true }).click();
  await dialog
    .getByRole('alert')
    .filter({ hasText: 'OCR skipped every page' })
    .waitFor();
  assert.match(await dialog.innerText(), /scanned regions are also skipped/);
  assert.match(
    await dialog.innerText(),
    /does not mean all visible characters are editable/,
  );
  code = 'unsupported-pdf';
  await dialog.getByRole('button', { name: 'Retry OCR', exact: true }).click();
  await dialog
    .getByRole('alert')
    .filter({
      hasText: 'external links, actions, attachments or digital signatures',
    })
    .waitFor();
  await page.screenshot({ path: resolve(artifacts, 'desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: resolve(artifacts, 'mobile.png') });
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  assert.equal(requests, 2);
  assert.deepEqual(errors, []);
  console.log(
    'PASS: mocked 422 OCR feedback, disclosure, retry, responsive dialog and Escape; no native/backend request.',
  );
} finally {
  await browser.close();
}
