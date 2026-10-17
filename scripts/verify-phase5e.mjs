import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import process from 'node:process';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require(
  process.env.KAGAZ_PLAYWRIGHT_MODULE || 'playwright',
);
const pdfLib = require('../apps/web/node_modules/pdf-lib');
const artifactDirectory = process.env.KAGAZ_ARTIFACT_DIR;
assert(artifactDirectory, 'Set KAGAZ_ARTIFACT_DIR outside the repository.');
const artifacts = resolve(artifactDirectory);
await mkdir(artifacts, { recursive: true });

const fixturePath = resolve(artifacts, 'phase5e-responsive-fixture.pdf');
const document = await pdfLib.PDFDocument.create();
for (let index = 0; index < 3; index++) {
  const page = document.addPage([500, 700]);
  page.drawText(`Kagaz responsive verification · page ${index + 1}`, {
    x: 28,
    y: 650,
    size: 16,
  });
}
await writeFile(fixturePath, await document.save());

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
page.setDefaultTimeout(12_000);
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(error.message));
const results = [];

try {
  for (const width of [1440, 768, 390, 360]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('http://127.0.0.1:5173');
    await page
      .locator('input[type=file][accept="application/pdf,.pdf"]')
      .first()
      .setInputFiles(fixturePath);
    await page.locator('.pdf-canvas').first().waitFor({ state: 'visible' });
    await page.waitForFunction(() => {
      const canvas = globalThis.document.querySelector('.pdf-canvas');
      return canvas instanceof globalThis.HTMLCanvasElement && canvas.width > 0;
    });

    const dimensions = await page.evaluate(() => ({
      viewport: globalThis.window.innerWidth,
      document: globalThis.document.documentElement.scrollWidth,
      devicePixelRatio: globalThis.window.devicePixelRatio,
    }));
    assert.equal(dimensions.devicePixelRatio, 2);
    assert(
      dimensions.document <= dimensions.viewport + 1,
      `Horizontal page overflow at ${width}px: ${JSON.stringify(dimensions)}`,
    );
    const toolbarButtons = await page
      .locator('.toolbar-actions button')
      .evaluateAll((buttons) =>
        buttons
          .map((button) => {
            const rect = button.getBoundingClientRect();
            return {
              label: button.getAttribute('aria-label') || button.textContent,
              left: rect.left,
              right: rect.right,
              width: rect.width,
            };
          })
          .filter((button) => button.width > 0),
      );
    assert(
      toolbarButtons.every(
        (button) =>
          button.width > 0 && button.left >= -1 && button.right <= width + 1,
      ),
      `Toolbar controls are clipped at ${width}px: ${JSON.stringify(toolbarButtons)}`,
    );
    const pagesToggleVisible = await page
      .locator('.pages-toggle-button')
      .isVisible();
    const pageManagerCloseVisible = await page
      .locator('.thumbnail-close')
      .isVisible();
    assert.equal(pagesToggleVisible, width <= 720);
    assert.equal(pageManagerCloseVisible, false);
    if (width <= 720) {
      const mobileTextActions = await page
        .locator('.compress-button, .ocr-button')
        .evaluateAll((buttons) =>
          buttons.map((button) => ({
            text: button.textContent?.trim(),
            fontSize: Number.parseFloat(
              globalThis.window.getComputedStyle(button).fontSize,
            ),
          })),
        );
      assert.deepEqual(
        mobileTextActions.map((button) => button.text),
        ['Compress PDF', 'OCR PDF'],
      );
      assert(
        mobileTextActions.every((button) => button.fontSize > 0),
        'Mobile PDF tool labels must remain visible.',
      );
    }
    const annotationSummaryToggle = page
      .locator('.annotation-summary-toggle')
      .first();
    await annotationSummaryToggle.focus();
    const annotationFocus = await annotationSummaryToggle.evaluate((button) => {
      const style = globalThis.window.getComputedStyle(button);
      return {
        outlineStyle: style.outlineStyle,
        outlineWidth: style.outlineWidth,
      };
    });
    assert.deepEqual(annotationFocus, {
      outlineStyle: 'solid',
      outlineWidth: '2px',
    });

    const zoomIn = page.getByRole('button', { name: 'Zoom in' });
    await zoomIn.focus();
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    assert.equal(
      await page.locator('.zoom-control output').textContent(),
      '120%',
    );

    let mobileDialogResult = null;
    if (width <= 720) {
      let reachedPagesTrigger = false;
      for (let tab = 0; tab < 80; tab++) {
        reachedPagesTrigger = await page.evaluate(
          () =>
            globalThis.document.activeElement?.getAttribute('aria-controls') ===
            'thumbnail-rail',
        );
        if (reachedPagesTrigger) break;
        await page.keyboard.press('Tab');
      }
      assert(
        reachedPagesTrigger,
        'Tab navigation did not reach the Pages control.',
      );
      await page.keyboard.press('Enter');

      const dialog = page.getByRole('dialog', { name: /Pages/ });
      await dialog.waitFor({ state: 'visible' });
      assert(await page.locator('.thumbnail-close').isVisible());
      await page.waitForFunction(
        () =>
          globalThis.document.activeElement?.getAttribute('aria-label') ===
          'Close page manager',
      );
      if (width === 390) {
        await page.screenshot({
          path: resolve(artifacts, `phase5e-${width}px-pages-open.png`),
          fullPage: false,
        });
      }
      await page.keyboard.press('Shift+Tab');
      const wrappedToLast = await page.evaluate(() =>
        globalThis.document.activeElement?.getAttribute('aria-label'),
      );
      assert.equal(wrappedToLast, 'Delete page 3');
      await page.keyboard.press('Tab');
      const wrappedToFirst = await page.evaluate(() =>
        globalThis.document.activeElement?.getAttribute('aria-label'),
      );
      assert.equal(wrappedToFirst, 'Close page manager');
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'hidden' });
      await page.waitForFunction(
        () =>
          globalThis.document.activeElement?.getAttribute('aria-controls') ===
          'thumbnail-rail',
      );
      mobileDialogResult = {
        keyboardOpened: true,
        focusWrappedBothDirections: true,
        escapeClosed: true,
        focusReturned: true,
      };
    }

    await page.screenshot({
      path: resolve(artifacts, `phase5e-${width}px.png`),
      fullPage: true,
    });
    results.push({
      viewport: width,
      devicePixelRatio: dimensions.devicePixelRatio,
      documentWidth: dimensions.document,
      horizontalOverflow: false,
      zoomAfterTwoKeyboardAccessibleControls: '120%',
      mobilePageManager: mobileDialogResult,
    });
  }

  assert.deepEqual(pageErrors, []);
  const report = {
    browser: await browser.version(),
    deviceScaleFactor: 2,
    results,
    pageErrors,
  };
  await writeFile(
    resolve(artifacts, 'phase5e-responsive-results.json'),
    JSON.stringify(report, null, 2),
  );
  globalThis.console.log(JSON.stringify(report, null, 2));
} finally {
  await context.close();
  await browser.close();
}
