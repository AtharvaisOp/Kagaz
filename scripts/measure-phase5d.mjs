import { createRequire } from 'node:module';
import console from 'node:console';
import { performance } from 'node:perf_hooks';
import process from 'node:process';
import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

/* global document, location, URL */

const require = createRequire(import.meta.url);
const { chromium } = require(
  process.env.KAGAZ_PLAYWRIGHT_MODULE || 'playwright',
);
const { PDFDocument } = require('../apps/web/node_modules/pdf-lib');
const artifactDir = process.env.KAGAZ_ARTIFACT_DIR;
const appUrl = process.env.KAGAZ_APP_URL || 'http://127.0.0.1:5173';
assert(artifactDir, 'Set KAGAZ_ARTIFACT_DIR to an existing output directory.');

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.KAGAZ_CHROME_PATH,
});
const context = await browser.newContext({ acceptDownloads: true });
const page = await context.newPage();
page.setDefaultTimeout(15_000);
const cdp = await context.newCDPSession(page);
const measurements = [];
const dialogs = [];
let startup;

page.on('dialog', async (dialog) => {
  dialogs.push(dialog.message());
  await dialog.accept();
});

async function sample(label) {
  await cdp.send('HeapProfiler.collectGarbage');
  await page.waitForTimeout(500);
  const dom = await cdp.send('Memory.getDOMCounters');
  const browserState = await page.evaluate(() => {
    const canvases = [...document.querySelectorAll('canvas')];
    const activeCanvases = canvases.filter(
      (canvas) => canvas.width > 0 && canvas.height > 0,
    );
    return {
      url: location.href,
      heapUsedBytes: performance.memory?.usedJSHeapSize ?? null,
      canvasCount: canvases.length,
      activeCanvasCount: activeCanvases.length,
      activeCanvasBackingBytesEstimate: activeCanvases.reduce(
        (total, canvas) => total + canvas.width * canvas.height * 4,
        0,
      ),
      activeCanvasClasses: Object.fromEntries(
        [
          ...new Set(activeCanvases.map((canvas) => String(canvas.className))),
        ].map((className) => [
          className,
          activeCanvases.filter((canvas) => canvas.className === className)
            .length,
        ]),
      ),
    };
  });
  measurements.push({
    label,
    workerCount: page.workers().length,
    ...browserState,
    dom,
  });
}

try {
  const pdf = await PDFDocument.create();
  for (let index = 0; index < 100; index += 1) {
    const pdfPage = pdf.addPage([500, 400]);
    pdfPage.drawText(`Phase 5D repeated export page ${index + 1}`, {
      x: 24,
      y: 360,
      size: 14,
    });
  }
  const sourcePath = `${artifactDir}/phase5d-repeated-100.pdf`;
  await writeFile(sourcePath, await pdf.save());

  const startupStarted = performance.now();
  await page.goto(appUrl);
  await page.locator('.upload-layout').waitFor();
  startup = await page.evaluate(() => {
    const navigation = performance.getEntriesByType('navigation')[0];
    const scripts = performance
      .getEntriesByType('resource')
      .filter((entry) => /\.js(?:\?|$)/.test(entry.name))
      .map((entry) => ({
        url: new URL(entry.name).pathname,
        transferSize: entry.transferSize,
        encodedBodySize: entry.encodedBodySize,
        durationMs: Math.round(entry.duration),
      }));
    return {
      domContentLoadedMs: navigation
        ? Math.round(navigation.domContentLoadedEventEnd - navigation.startTime)
        : null,
      firstContentfulPaintMs: performance.getEntriesByName(
        'first-contentful-paint',
      ).length
        ? Math.round(
            performance.getEntriesByName('first-contentful-paint').at(-1)
              .startTime,
          )
        : null,
      loadEventMs: navigation
        ? Math.round(navigation.loadEventEnd - navigation.startTime)
        : null,
      totalScriptTransferBytes: scripts.reduce(
        (total, resource) => total + resource.transferSize,
        0,
      ),
      scripts,
    };
  });
  startup.bootToUploadLayoutMs = Math.round(performance.now() - startupStarted);
  await page
    .locator('input[type=file][accept="application/pdf,.pdf"]')
    .setInputFiles(sourcePath);
  await page.locator('.pdf-canvas[data-ready=true]').first().waitFor();
  await page
    .getByRole('button', { name: 'Download PDF', exact: true })
    .waitFor();
  await sample('loaded-before-export');

  for (let index = 1; index <= 3; index += 1) {
    const started = performance.now();
    const downloadEvent = page.waitForEvent('download');
    await page
      .getByRole('button', { name: 'Download PDF', exact: true })
      .click();
    const download = await downloadEvent;
    await download.saveAs(`${artifactDir}/phase5d-export-${index}.pdf`);
    measurements.push({
      label: `export-${index}`,
      exportMs: Math.round(performance.now() - started),
      fileSizeBytes: (
        await readFile(`${artifactDir}/phase5d-export-${index}.pdf`)
      ).byteLength,
    });
    await sample(`after-export-${index}`);
  }

  await page.getByRole('button', { name: 'Start over', exact: true }).click();
  await page.locator('.upload-layout').waitFor();
  await sample('after-start-over');
  assert(
    dialogs.length <= 1,
    'Start Over should not open repeated confirmations.',
  );
  assert.equal(measurements.at(-1).canvasCount, 0);
  assert.equal(measurements.at(-1).workerCount, 0);

  const multiSourceStarted = performance.now();
  await page
    .locator('input[type=file][accept="application/pdf,.pdf"]')
    .first()
    .setInputFiles([sourcePath, sourcePath, sourcePath]);
  await page.waitForFunction(
    () => document.querySelectorAll('.pdf-page-surface').length === 300,
  );
  await page.locator('.pdf-canvas[data-ready=true]').first().waitFor();
  await page.waitForTimeout(500);
  measurements.push({
    label: 'three-source-300-page-load',
    loadMs: Math.round(performance.now() - multiSourceStarted),
  });
  await sample('three-sources-300-pages');
  await page.getByRole('button', { name: 'Start over', exact: true }).click();
  await page.locator('.upload-layout').waitFor();
  await sample('three-sources-after-start-over');
  assert.equal(measurements.at(-1).canvasCount, 0);
  assert.equal(measurements.at(-1).workerCount, 0);

  await writeFile(
    `${artifactDir}/phase5d-repeated-export-results.json`,
    JSON.stringify({ startup, measurements, dialogs }, null, 2),
  );
  console.log(JSON.stringify({ startup, measurements, dialogs }, null, 2));
  console.log('PHASE_5D_REPEATED_EXPORT_MEASUREMENTS_PASSED');
} finally {
  await cdp.detach().catch(() => undefined);
  await browser.close();
}
