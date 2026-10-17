import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
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

const fixturePath = resolve(artifacts, 'phase6a-five-page-fixture.pdf');
const fixtureDocument = await pdfLib.PDFDocument.create();
for (let index = 0; index < 5; index++) {
  const page = fixtureDocument.addPage([500, 700]);
  page.drawText('SOURCE-PAGE-' + (index + 1), {
    x: 40,
    y: 640,
    size: 22,
  });
}
await writeFile(fixturePath, await fixtureDocument.save());

const appUrl = process.env.KAGAZ_APP_URL || 'http://127.0.0.1:5173';
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
const verifier = await context.newPage();
page.setDefaultTimeout(15_000);
verifier.setDefaultTimeout(15_000);
const pageErrors = [];
const nonGetRequests = [];
const results = [];
page.on('pageerror', (error) => pageErrors.push(error.message));
context.on('request', (request) => {
  if (request.method() !== 'GET') {
    nonGetRequests.push({ method: request.method(), url: request.url() });
  }
});
page.on('dialog', (dialog) => dialog.accept());

const assistantButton = () =>
  page.getByRole('button', { name: 'AI Assistant' });
const downloadButton = () => page.getByRole('button', { name: 'Download PDF' });
const openAssistant = async () => {
  await assistantButton().click();
  const dialog = page.getByRole('dialog', { name: 'AI Assistant' });
  await dialog.waitFor({ state: 'visible' });
  return dialog;
};
const submitCommand = async (dialog, text, heading) => {
  await dialog.getByLabel('Describe one PDF change').fill(text);
  await dialog.getByRole('button', { name: 'Review command' }).click();
  if (heading) {
    try {
      await dialog.getByRole('heading', { name: heading }).waitFor();
    } catch (error) {
      throw new Error(
        'Expected proposal heading ' +
          heading +
          '; dialog text: ' +
          (await dialog.innerText()),
        { cause: error },
      );
    }
  }
  return dialog;
};
const applyCommand = async (dialog, duplicate = false) => {
  const apply = dialog.getByRole('button', { name: 'Apply change' });
  if (duplicate) {
    await apply.evaluate((button) => {
      button.click();
      button.click();
    });
  } else {
    await apply.click();
  }
  await dialog.getByRole('button', { name: 'Applied' }).waitFor();
};
const downloadPdf = async (name) => {
  const event = page.waitForEvent('download');
  await downloadButton().click();
  const artifact = await event;
  const file = resolve(artifacts, name + '.pdf');
  await artifact.saveAs(file);
  const bytes = new Uint8Array(await readFile(file));
  const document = await pdfLib.PDFDocument.load(bytes);
  return { file, bytes, document };
};
const extractText = async (bytes) =>
  verifier.evaluate(async (buffer) => {
    const pdfjs = await import('/node_modules/pdfjs-dist/build/pdf.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc =
      '/node_modules/pdfjs-dist/build/pdf.worker.mjs';
    const task = pdfjs.getDocument({
      data: new Uint8Array(buffer),
      useSystemFonts: true,
    });
    const document = await task.promise;
    try {
      const pages = [];
      for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
        const current = await document.getPage(pageNumber);
        try {
          const content = await current.getTextContent();
          pages.push(content.items.map((item) => item.str || '').join(' '));
        } finally {
          current.cleanup();
        }
      }
      return pages;
    } finally {
      await task.destroy();
    }
  }, Array.from(bytes));
const closeAssistant = async (dialog) => {
  await dialog.getByRole('button', { name: 'Close AI Assistant' }).click();
  await dialog.waitFor({ state: 'hidden' });
  await page.waitForFunction(
    () => document.activeElement?.textContent?.trim() === 'AI Assistant',
  );
};

try {
  await verifier.goto(appUrl);
  await page.goto(appUrl);
  await page
    .locator('input[type=file][accept="application/pdf,.pdf"]')
    .first()
    .setInputFiles(fixturePath);
  await page.locator('.pdf-canvas[data-ready="true"]').first().waitFor();
  await downloadButton().waitFor();

  // A page rotation is previewed first and does not change the visible page
  // until the explicit Apply action.
  const pageTwo = page.locator('.pdf-page-shell').nth(1);
  await pageTwo.scrollIntoViewIfNeeded();
  await pageTwo.locator('.pdf-canvas[data-ready="true"]').waitFor();
  const beforeRotation = await pageTwo
    .locator('.pdf-canvas')
    .evaluate((canvas) => ({
      width: Number.parseFloat(canvas.style.width),
      height: Number.parseFloat(canvas.style.height),
    }));
  const rotationDialog = await openAssistant();
  await submitCommand(
    rotationDialog,
    'rotate page 2 clockwise',
    'Rotate page 2 clockwise',
  );
  const beforeApply = await pageTwo
    .locator('.pdf-canvas')
    .evaluate((canvas) => ({
      width: Number.parseFloat(canvas.style.width),
      height: Number.parseFloat(canvas.style.height),
    }));
  assert.deepEqual(beforeApply, beforeRotation);
  await applyCommand(rotationDialog, true);
  await page.waitForFunction(() => {
    const canvas = document
      .querySelectorAll('.pdf-page-shell')[1]
      ?.querySelector('canvas');
    return Boolean(
      canvas &&
      Number.parseFloat(canvas.style.width) >
        Number.parseFloat(canvas.style.height),
    );
  });
  await closeAssistant(rotationDialog);
  const rotatedOutput = await downloadPdf('phase6a-rotation-approved');
  assert.equal(rotatedOutput.document.getPageCount(), 5);
  assert.equal(rotatedOutput.document.getPage(1).getRotation().angle, 90);
  results.push({
    case: 'rotation',
    previewDidNotMutate: true,
    duplicateApplyResult: 'one 90-degree rotation',
    exportedRotationDegrees: rotatedOutput.document.getPage(1).getRotation()
      .angle,
  });

  // Navigation uses current workspace numbering and stable IDs.
  const navigationDialog = await openAssistant();
  await submitCommand(navigationDialog, 'take me to page 5', 'Select page 5');
  await applyCommand(navigationDialog);
  await page.locator('.thumbnail-select[aria-current="page"]').waitFor();
  assert.match(
    await page
      .locator('.thumbnail-select[aria-current="page"]')
      .getAttribute('aria-label'),
    /^Page 5,/,
  );
  results.push({ case: 'navigation', selectedPage: 5 });
  await closeAssistant(navigationDialog);

  // Watermark creation, an existing-watermark edit, and Undo all use the
  // established watermark controller/history and the ordinary export path.
  const createWatermarkDialog = await openAssistant();
  await submitCommand(
    createWatermarkDialog,
    'add a CONFIDENTIAL watermark to every page',
    'Set text watermark',
  );
  await applyCommand(createWatermarkDialog);
  await closeAssistant(createWatermarkDialog);
  const firstWatermark = await downloadPdf('phase6a-watermark-created');
  const firstWatermarkText = (await extractText(firstWatermark.bytes)).join(
    ' ',
  );
  assert(firstWatermarkText.includes('CONFIDENTIAL'));

  const editWatermarkDialog = await openAssistant();
  await submitCommand(
    editWatermarkDialog,
    'add an INTERNAL watermark to every page',
    'Update existing text watermark',
  );
  await applyCommand(editWatermarkDialog);
  await closeAssistant(editWatermarkDialog);
  const editedWatermark = await downloadPdf('phase6a-watermark-edited');
  const editedWatermarkText = (await extractText(editedWatermark.bytes)).join(
    ' ',
  );
  assert(editedWatermarkText.includes('INTERNAL'));
  assert(!editedWatermarkText.includes('CONFIDENTIAL'));
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  const undoWatermark = await downloadPdf('phase6a-watermark-edit-undo');
  const undoWatermarkText = (await extractText(undoWatermark.bytes)).join(' ');
  assert(undoWatermarkText.includes('CONFIDENTIAL'));
  assert(!undoWatermarkText.includes('INTERNAL'));
  results.push({
    case: 'watermark-edit-and-history',
    createdAndExported: true,
    editExported: true,
    undoRestoredPriorWatermark: true,
  });

  const removeWatermarkDialog = await openAssistant();
  await submitCommand(
    removeWatermarkDialog,
    'remove the existing watermark',
    'Remove watermark',
  );
  await applyCommand(removeWatermarkDialog);
  await closeAssistant(removeWatermarkDialog);
  const removedWatermark = await downloadPdf('phase6a-watermark-removed');
  const removedWatermarkText = (await extractText(removedWatermark.bytes)).join(
    ' ',
  );
  assert(!removedWatermarkText.includes('CONFIDENTIAL'));
  results.push({ case: 'watermark-removal', exportedWatermarkAbsent: true });

  // The note is added through the annotation reducer and is present in output.
  const annotationDialog = await openAssistant();
  await submitCommand(
    annotationDialog,
    'put a text note "AI-NOTE-6A" in the center of page 1',
    'Add a centered text note to page 1',
  );
  await applyCommand(annotationDialog);
  await closeAssistant(annotationDialog);
  const annotatedOutput = await downloadPdf('phase6a-note-created');
  const annotatedPages = await extractText(annotatedOutput.bytes);
  assert(annotatedPages[0]?.includes('AI-NOTE-6A'));
  results.push({ case: 'text-annotation', extractedFromPage: 1 });

  // Unsupported commands produce no proposal. Cancelling a proposed move
  // leaves the workspace unchanged; the following approved move is verified
  // independently from the downloaded output.
  const reorderDialog = await openAssistant();
  await submitCommand(reorderDialog, 'compress the PDF', null);
  await reorderDialog
    .getByRole('alert')
    .filter({ hasText: 'outside the assistant’s supported commands' })
    .waitFor();
  assert.equal(
    await reorderDialog.getByRole('button', { name: 'Apply change' }).count(),
    0,
  );
  await submitCommand(
    reorderDialog,
    'move the last page to the beginning',
    'Move page 5',
  );
  await reorderDialog.getByRole('button', { name: 'Cancel proposal' }).click();
  assert.equal(
    await reorderDialog.getByRole('button', { name: 'Apply change' }).count(),
    0,
  );
  await submitCommand(
    reorderDialog,
    'move the last page to the beginning',
    'Move page 5',
  );
  await applyCommand(reorderDialog);
  await closeAssistant(reorderDialog);
  const reorderedOutput = await downloadPdf('phase6a-page-reordered');
  const reorderedText = await extractText(reorderedOutput.bytes);
  assert(reorderedText[0]?.includes('SOURCE-PAGE-5'));
  results.push({
    case: 'reorder',
    firstExportedPage: reorderedText[0],
    cancellationMadeNoChange: true,
  });

  const deletionDialog = await openAssistant();
  await submitCommand(deletionDialog, 'delete page 3', 'Delete page 3');
  const deleteApply = deletionDialog.getByRole('button', {
    name: 'Apply change',
  });
  assert.equal(await deleteApply.isDisabled(), true);
  await deletionDialog
    .getByLabel('I understand this page will be deleted.')
    .check();
  await applyCommand(deletionDialog);
  await closeAssistant(deletionDialog);
  const deletedOutput = await downloadPdf('phase6a-page-deleted');
  const deletedText = await extractText(deletedOutput.bytes);
  assert.equal(deletedOutput.document.getPageCount(), 4);
  assert(!deletedText.join(' ').includes('SOURCE-PAGE-2'));
  results.push({
    case: 'deletion',
    explicitConfirmationRequired: true,
    outputPageCount: deletedOutput.document.getPageCount(),
    deletedSourcePageAbsent: true,
  });

  // Start Over discards the viewer and its pending proposal. Reopening the
  // same file creates new page IDs; no old proposal can remain actionable.
  const staleDialog = await openAssistant();
  await submitCommand(
    staleDialog,
    'rotate page 1 clockwise',
    'Rotate page 1 clockwise',
  );
  await closeAssistant(staleDialog);
  await page.getByRole('button', { name: 'Start over' }).click();
  await page
    .locator('input[type=file][accept="application/pdf,.pdf"]')
    .first()
    .setInputFiles(fixturePath);
  await page.locator('.pdf-canvas[data-ready="true"]').first().waitFor();
  const reopenedOutput = await downloadPdf('phase6a-start-over-fresh-source');
  assert.equal(reopenedOutput.document.getPage(0).getRotation().angle, 0);
  results.push({ case: 'start-over-stale-plan', oldProposalRemoved: true });

  // Responsive, focus, reduced-motion and no-upload checks at requested widths.
  for (const width of [1440, 768, 390, 360]) {
    await page.setViewportSize({ width, height: 900 });
    if (width <= 720) await page.emulateMedia({ reducedMotion: 'reduce' });
    const dialog = await openAssistant();
    try {
      await page.waitForFunction(
        () => document.activeElement?.id === 'assistant-prompt',
      );
    } catch (error) {
      throw new Error(
        'Prompt autofocus failed at ' +
          width +
          'px; active element: ' +
          (await page.evaluate(() =>
            document.activeElement instanceof HTMLElement
              ? document.activeElement.outerHTML.slice(0, 240)
              : String(document.activeElement),
          )),
        { cause: error },
      );
    }
    const geometry = await dialog.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return {
        left: rect.left,
        right: rect.right,
        viewport: window.innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        animationDuration: getComputedStyle(element).animationDuration,
      };
    });
    assert(geometry.left >= 0 && geometry.right <= width + 1);
    assert(geometry.documentWidth <= width + 1);
    if (width <= 720) {
      assert(Number.parseFloat(geometry.animationDuration) <= 0.00001);
    }
    await dialog
      .getByLabel('Describe one PDF change')
      .fill('rotate page 1 clockwise');
    await dialog.getByRole('button', { name: 'Review command' }).focus();
    await page.keyboard.press('Tab');
    assert.equal(
      await page.evaluate(() =>
        document.activeElement?.getAttribute('aria-label'),
      ),
      'Close AI Assistant',
    );
    await page.keyboard.press('Shift+Tab');
    assert.equal(
      await page.evaluate(() => document.activeElement?.textContent?.trim()),
      'Review command',
    );
    await page.screenshot({
      path: resolve(artifacts, 'phase6a-assistant-' + width + 'px.png'),
      fullPage: false,
    });
    await closeAssistant(dialog);
    results.push({
      case: 'responsive-and-keyboard',
      viewport: width,
      withinViewport: true,
      focusWrapped: true,
      reducedMotion: width <= 720,
    });
  }

  assert.deepEqual(pageErrors, []);
  assert.deepEqual(nonGetRequests, []);
  const report = {
    browser: await browser.version(),
    fixturePages: 5,
    outputArtifacts: results,
    nonGetRequests,
    pageErrors,
  };
  await writeFile(
    resolve(artifacts, 'phase6a-report.json'),
    JSON.stringify(report, null, 2) + '\n',
  );
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
} finally {
  await context.close();
  await browser.close();
}
