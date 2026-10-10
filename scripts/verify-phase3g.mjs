import { createRequire } from 'node:module';
import { writeFile, readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { chromium } = require(
  process.env.KAGAZ_PLAYWRIGHT_MODULE || 'playwright',
);
const lib = require('../apps/web/node_modules/pdf-lib');
const root = process.env.KAGAZ_ARTIFACT_DIR;
assert(
  root,
  'Set KAGAZ_ARTIFACT_DIR to an existing output directory outside the repository.',
);
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.KAGAZ_CHROME_PATH,
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1100 },
  acceptDownloads: true,
});
const page = await context.newPage();
page.setDefaultTimeout(12000);
const errors = [],
  requests = [],
  results = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('request', (request) => {
  if (request.method() !== 'GET')
    requests.push({ url: request.url(), method: request.method() });
});
let dialogDecision = 'accept';
const dialogs = [];
page.on('dialog', async (dialog) => {
  dialogs.push({ type: dialog.type(), message: dialog.message() });
  await dialog[dialogDecision]();
});
async function fixture(
  name,
  {
    forms = false,
    signature = false,
    signed = false,
    rotation = 0,
    count = 1,
  } = {},
) {
  const doc = await lib.PDFDocument.create();
  const first = doc.addPage([500, 400]);
  first.setRotation(lib.degrees(rotation));
  first.drawText('Kagaz Phase 3G synthetic verification', {
    x: 30,
    y: 365,
    size: 15,
  });
  for (let i = 1; i < count; i++)
    doc.addPage([500, 400]).drawText(`Page ${i + 1}`, { x: 30, y: 365 });
  if (forms) {
    const text = doc.getForm().createTextField('Name');
    text.setText('Original');
    text.addToPage(first, { x: 30, y: 300, width: 220, height: 25 });
    const choice = doc.getForm().createDropdown('Choice');
    choice.addOptions(['Alpha', 'Beta']);
    choice.select('Alpha');
    choice.addToPage(first, { x: 30, y: 260, width: 130, height: 25 });
    const check = doc.getForm().createCheckBox('Accepted');
    check.addToPage(first, { x: 280, y: 300, width: 22, height: 22 });
  }
  if (signature || signed) {
    const field = doc.context.obj({
      FT: 'Sig',
      T: lib.PDFHexString.fromText('Signature1'),
    });
    const ref = doc.context.register(field);
    const widget = doc.context.obj({
      Type: 'Annot',
      Subtype: 'Widget',
      Rect: [40, 180, 300, 250],
      P: first.ref,
      Parent: ref,
      F: 4,
    });
    const wref = doc.context.register(widget);
    field.set(lib.PDFName.of('Kids'), doc.context.obj([wref]));
    if (signed)
      field.set(
        lib.PDFName.of('V'),
        doc.context.obj({ Type: 'Sig', Contents: lib.PDFHexString.of('ABCD') }),
      );
    doc.catalog.getOrCreateAcroForm().addField(ref);
    first.node.addAnnot(wref);
  }
  await writeFile(`${root}/${name}.pdf`, await doc.save());
  return `${root}/${name}.pdf`;
}
async function fresh(file) {
  await page.goto('http://127.0.0.1:5173');
  await page
    .locator('input[type=file][accept="application/pdf,.pdf"]')
    .setInputFiles(file);
  await page.locator('.pdf-canvas[data-ready=true]').first().waitFor();
  await page
    .getByRole('button', { name: 'Download PDF', exact: true })
    .waitFor();
  await page.waitForFunction(
    () => !document.body.innerText.includes('Checking this PDF'),
  );
}
async function point(x, y, index = 0) {
  const surface = page.locator('.pdf-page-surface').nth(index);
  await surface.scrollIntoViewIfNeeded();
  const box = await surface.boundingBox();
  await page.mouse.click(box.x + x, box.y + y);
}
async function dragSurface(x, y, x2, y2) {
  const surface = page.locator('.pdf-page-surface').first();
  await surface.scrollIntoViewIfNeeded();
  const b = await surface.boundingBox();
  await page.mouse.move(b.x + x, b.y + y);
  await page.mouse.down();
  await page.mouse.move(b.x + x2, b.y + y2, { steps: 12 });
  await page.mouse.up();
}
async function create(method, value = 'Ada Visual', field = false) {
  if (field)
    await page
      .getByRole('button', { name: /Place visual signature in/ })
      .nth(typeof field === 'number' ? field - 1 : 0)
      .click();
  else
    await page
      .getByRole('button', { name: 'Create visual signature', exact: true })
      .click();
  await page.getByRole('tab', { name: method, exact: true }).click();
  if (method === 'Draw') {
    const b = await page.getByLabel('Signature drawing pad').boundingBox();
    await page.mouse.move(b.x + 80, b.y + 140);
    await page.mouse.down();
    for (const [x, y] of [
      [100, 60],
      [130, 150],
      [160, 85],
      [205, 145],
      [250, 90],
      [320, 130],
      [400, 65],
      [480, 120],
    ])
      await page.mouse.move(b.x + x, b.y + y, { steps: 4 });
    await page.mouse.up();
    await page
      .getByRole('button', { name: 'Use signature', exact: true })
      .click();
  } else if (method === 'Type') {
    await page.getByLabel('Signature text', { exact: true }).fill(value);
    await page
      .getByRole('button', { name: 'Use signature', exact: true })
      .click();
  } else
    await page
      .getByLabel('Choose signature image', { exact: true })
      .setInputFiles(`${root}/${value}`);
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
}
async function download(
  name,
  locator = page.getByRole('button', { name: 'Download PDF', exact: true }),
) {
  const event = page.waitForEvent('download');
  await locator.click();
  const d = await event;
  const file = `${root}/${name}.pdf`;
  await d.saveAs(file);
  return file;
}
async function inspect(file, name, expectedImages, render = true) {
  const data = new Uint8Array(await readFile(file));
  const doc = await lib.PDFDocument.load(data, { throwOnInvalidObject: true });
  assert.equal(doc.getForm().getFields().length, 0);
  for (const p of doc.getPages()) assert.equal(p.node.Annots()?.size() ?? 0, 0);
  const view = await context.newPage();
  await view.goto('http://127.0.0.1:5173');
  const report = await view.evaluate(
    async ({ data, render }) => {
      const pdfjs = await import('/node_modules/pdfjs-dist/build/pdf.mjs');
      pdfjs.GlobalWorkerOptions.workerSrc =
        '/node_modules/pdfjs-dist/build/pdf.worker.mjs';
      const task = pdfjs.getDocument({
        data: new Uint8Array(data),
        useSystemFonts: true,
      });
      const doc = await task.promise;
      document.body.replaceChildren();
      document.body.style.cssText =
        'background:#ddd;padding:24px;display:flex;align-items:flex-start;flex-wrap:wrap;gap:20px';
      const pages = [];
      for (let i = 1; i <= doc.numPages; i++) {
        const p = await doc.getPage(i),
          ops = await p.getOperatorList(),
          text = await p.getTextContent(),
          annots = await p.getAnnotations();
        pages.push({
          rotation: p.rotate,
          images: ops.fnArray.filter((op) =>
            [
              pdfjs.OPS.paintImageXObject,
              pdfjs.OPS.paintInlineImageXObject,
            ].includes(op),
          ).length,
          widgets: annots.filter((a) => a.subtype === 'Widget').length,
          text: text.items.map((t) => t.str ?? '').join(' '),
        });
        if (render) {
          const canvas = document.createElement('canvas'),
            vp = p.getViewport({ scale: 1.4 });
          canvas.width = vp.width;
          canvas.height = vp.height;
          document.body.append(canvas);
          await p.render({
            canvasContext: canvas.getContext('2d'),
            viewport: vp,
          }).promise;
        }
      }
      await task.destroy();
      return pages;
    },
    { data: [...data], render },
  );
  assert.deepEqual(
    report.map((p) => p.images),
    expectedImages,
  );
  assert(report.every((p) => p.widgets === 0));
  if (render)
    await view.screenshot({
      path: `${root}/${name}-artifact.png`,
      fullPage: true,
    });
  await view.close();
  results.push({ name, pages: report });
  console.log(JSON.stringify({ name, pages: report }));
  return { doc, report };
}
const button = (name) => page.getByRole('button', { name, exact: true });
const input = () =>
  page.getByRole('textbox', { name: 'Name', exact: true }).first();
const record = (name, details = {}) => {
  results.push({ name, ...details });
  console.log(JSON.stringify({ name, ...details }));
};
const settle = () =>
  page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
async function rectangle(index = 0) {
  await button('Rectangle (R)').click();
  const surface = page.locator('.pdf-page-surface').nth(index);
  await surface.scrollIntoViewIfNeeded();
  const b = await surface.boundingBox();
  await page.mouse.move(b.x + b.width * 0.12, b.y + b.height * 0.78);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width * 0.4, b.y + b.height * 0.9, {
    steps: 6,
  });
  await page.mouse.up();
  await button('Select (V)').click();
}
async function state() {
  await input().waitFor();
  await settle();
  return page.evaluate(() => ({
    values: [
      ...document.querySelectorAll(
        '.form-widget-layer input, .form-widget-layer select, .form-widget-layer textarea',
      ),
    ].map((x) => [x.getAttribute('aria-label'), x.value, x.checked]),
    annotations: [
      ...document.querySelectorAll('.annotation-summary-label'),
    ].map((x) => x.textContent),
    pages: [...document.querySelectorAll('.thumbnail-source-label')].map(
      (x) => x.textContent,
    ),
    undo: [...document.querySelectorAll('button')].find(
      (x) => x.textContent.trim() === 'Undo',
    )?.disabled,
    redo: [...document.querySelectorAll('button')].find(
      (x) => x.textContent.trim() === 'Redo',
    )?.disabled,
  }));
}
async function start(decision, expected, retainFocus = false) {
  const before = dialogs.length;
  dialogDecision = decision;
  if (retainFocus) await button('Start over').evaluate((x) => x.click());
  else await button('Start over').click();
  await settle();
  assert.equal(dialogs.length - before, expected);
}
async function freshBaseline(file) {
  await page
    .locator('input[type=file][accept="application/pdf,.pdf"]')
    .setInputFiles(file);
  await page.locator('.pdf-canvas[data-ready=true]').first().waitFor();
  await page.waitForFunction(
    () => !document.body.innerText.includes('Checking this PDF'),
  );
  // Discovery commits definitions before the form baseline effect. Observe the
  // same settled editor frame used by state(), then assert the actual value.
  await settle();
  assert.equal(await input().inputValue(), 'Original');
  assert(await button('Undo').isDisabled());
  assert(await button('Redo').isDisabled());
  assert.equal(
    await page
      .getByRole('button', { name: /^Delete (Typed|Drawn|Uploaded) signature/ })
      .count(),
    0,
  );
}
try {
  const form = await fixture('3g-form', {
    forms: true,
    signature: true,
    count: 3,
  });
  for (const mode of [
    'clean',
    'untouched-focus',
    'form',
    'annotation',
    'workspace',
    'combined',
    'active-draft',
  ]) {
    await fresh(form);
    if (mode === 'untouched-focus') await input().focus();
    if (mode === 'form' || mode === 'combined') {
      await input().fill('Changed');
      await input().press('Enter');
    }
    if (mode === 'annotation' || mode === 'combined') await rectangle();
    if (mode === 'workspace' || mode === 'combined')
      await button('Rotate page 1 clockwise 90 degrees').click();
    if (mode === 'combined') await create('Type', 'Reset Signature', true);
    if (mode === 'active-draft') await input().fill('Still drafting');
    const dirty = !['clean', 'untouched-focus'].includes(mode);
    if (dirty) {
      const before = await state();
      await start('dismiss', 1);
      assert.deepEqual(await state(), before);
      if (mode === 'active-draft')
        assert(await input().evaluate((x) => x === document.activeElement));
    }
    await start('accept', dirty ? 1 : 0);
    await page.locator('.upload-layout').waitFor();
    await freshBaseline(form);
    await start('accept', 0);
    record(`Start Over: ${mode}, Cancel/Confirm/reopen`);
  }
  await fresh(form);
  await input().fill('History text');
  await input().press('Enter');
  await create('Type', 'History signature', true);
  await rectangle();
  await page.getByRole('checkbox', { name: 'Accepted', exact: true }).check();
  await page.getByRole('button', { name: /^Page 1,/ }).click();
  await button('Typed signature in signature field, annotation 1').click();
  await button('Move Typed signature in signature field right').click();
  await page
    .getByRole('combobox', { name: 'Choice', exact: true })
    .selectOption('Beta');
  const final = await state();
  await button('Undo').click();
  assert.equal(
    await page
      .getByRole('combobox', { name: 'Choice', exact: true })
      .inputValue(),
    'Alpha',
  );
  await button('Undo').click();
  await button('Undo').click();
  assert.equal(
    await page
      .getByRole('checkbox', { name: 'Accepted', exact: true })
      .isChecked(),
    false,
  );
  await button('Undo').click();
  assert.equal(await button('Delete Rectangle').count(), 0);
  await button('Undo').click();
  assert.equal(
    await button('Delete Typed signature in signature field').count(),
    0,
  );
  await button('Undo').click();
  assert.equal(await input().inputValue(), 'Original');
  assert(await button('Undo').isDisabled());
  for (let i = 0; i < 6; i++) await button('Redo').click();
  assert.deepEqual(await state(), final);
  for (const domain of ['form', 'annotation', 'signature']) {
    await button('Undo').click();
    await button('Undo').click();
    if (domain === 'form') {
      await input().fill('Branched');
      await input().press('Enter');
    }
    if (domain === 'annotation') await rectangle();
    if (domain === 'signature') {
      await create('Type', 'Branch');
      await point(150, 220);
    }
    assert(await button('Redo').isDisabled());
  }
  record(
    'Unified history: six edits, Undo all, Redo all, three branch domains',
  );
  await fresh(form);
  await rectangle();
  await input().fill('Surviving form');
  await input().press('Enter');
  await rectangle(1);
  await button('Delete page 2').click();
  await button('Undo').click();
  assert.equal(await input().inputValue(), 'Original');
  await button('Undo').click();
  assert.equal(await button('Delete Rectangle').count(), 0);
  assert(await button('Undo').isDisabled());
  await button('Redo').click();
  await button('Redo').click();
  assert(await button('Redo').isDisabled());
  assert.equal(await input().inputValue(), 'Surviving form');
  record(
    'Page deletion: surviving annotation/form chronology, no invisible transaction',
  );
  await input().focus();
  await input().press('End');
  await page.keyboard.type(' native');
  await page.keyboard.press('Control+z');
  assert.equal(
    await page
      .locator('.annotation-summary-label')
      .filter({ hasText: /^Rectangle$/ })
      .count(),
    1,
  );
  await input().press('Escape');
  await page
    .locator('.pdf-page-surface')
    .first()
    .click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Control+z');
  assert.equal(await input().inputValue(), 'Original');
  record('Keyboard: native input Undo protected, global Undo outside inputs');
  await button('Create visual signature').click();
  assert(
    await page
      .getByRole('dialog')
      .evaluate((x) => x.contains(document.activeElement)),
  );
  await page.getByRole('tab', { name: 'Draw', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(
    await page
      .getByRole('tab', { name: 'Type', exact: true })
      .getAttribute('aria-selected'),
    'true',
  );
  await button('Close signature creator').focus();
  await page.keyboard.press('Shift+Tab');
  assert(
    await page
      .getByRole('dialog')
      .evaluate((x) => x.contains(document.activeElement)),
  );
  await page.getByRole('tab', { name: 'Type', exact: true }).click();
  await page
    .getByLabel('Signature text', { exact: true })
    .fill('Preview restored');
  const pixels = () =>
    page.getByLabel('Typed signature preview').evaluate((x) => x.toDataURL());
  const preview = await pixels();
  await page.getByRole('tab', { name: 'Draw', exact: true }).click();
  await page.getByRole('tab', { name: 'Type', exact: true }).click();
  assert.equal(await pixels(), preview);
  await page.evaluate(() => {
    const original = HTMLCanvasElement.prototype.toBlob;
    window.releaseCanvas = null;
    HTMLCanvasElement.prototype.toBlob = function (callback, ...args) {
      HTMLCanvasElement.prototype.toBlob = original;
      const self = this;
      window.releaseCanvas = () => original.call(self, callback, ...args);
    };
  });
  await button('Use signature').click();
  await button('Cancel').click();
  await page.evaluate(() => window.releaseCanvas());
  await settle();
  assert.equal(await page.getByRole('dialog').count(), 0);
  assert(
    !(await page.locator('body').innerText()).includes(
      'pending visual signature',
    ),
  );
  assert(
    await button('Create visual signature').evaluate(
      (x) => x === document.activeElement,
    ),
  );
  record(
    'Signature creator: focus containment/return, tab repaint, cancelled canvas completion',
  );
  await fresh(form);
  await input().fill('Unsupported 漢字');
  await input().press('Enter');
  let downloads = 0;
  const downloaded = () => downloads++;
  page.on('download', downloaded);
  const beforeFailure = await state();
  await button('Download PDF').click();
  await page.getByText(/unsupported by Standard Helvetica/).waitFor();
  assert.equal(downloads, 0);
  assert.deepEqual(await state(), beforeFailure);
  await button('Extract pages').click();
  await page.getByLabel('Pages to extract').fill('999');
  await button('Create PDF').click();
  await page
    .getByRole('alert')
    .filter({ hasText: /outside the current workspace/ })
    .waitFor();
  await button('Cancel').click();
  page.off('download', downloaded);
  record(
    'Export failure: no partial download, edits/history preserved, Extract validation',
  );
  for (const rotation of [0, 90, 180, 270]) {
    const file = await fixture(`3g-rotation-${rotation}`, {
      forms: true,
      signature: true,
      rotation,
    });
    await fresh(file);
    await input().fill(`Rotation ${rotation}`);
    await input().press('Enter');
    await create('Type', 'Rotation mark', true);
    const output = await inspect(
      await download(`3g-output-${rotation}`),
      `3g-output-${rotation}`,
      [1],
    );
    assert.equal(output.report[0].rotation, rotation);
    assert(output.report[0].text.includes(`Rotation ${rotation}`));
  }
  for (const [width, height] of [
    [390, 844],
    [360, 800],
  ]) {
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await fresh(form);
    await input().fill('Mobile form');
    await input().press('Enter');
    await rectangle();
    await create('Type', 'Mobile field', true);
    await button('Create visual signature').click();
    const pad = await page.getByLabel('Signature drawing pad').boundingBox();
    await page.mouse.move(pad.x + 20, pad.y + 20);
    await page.mouse.down();
    await page.mouse.move(pad.x + pad.width * 0.8, pad.y + pad.height * 0.7, {
      steps: 8,
    });
    await page.mouse.up();
    await button('Use signature').click();
    await point(80, 180);
    await create('Upload', 'signature.png');
    await point(120, 210);
    await button('Pages').click();
    await page.getByRole('button', { name: /^Page 3,/ }).click();
    await button('Pages').click();
    await page
      .getByRole('button', { name: 'Close page manager', exact: true })
      .last()
      .click();
    await button('Extract pages').click();
    await page.getByLabel('Pages to extract').fill('0');
    await button('Create PDF').click();
    await page
      .getByRole('alert')
      .filter({ hasText: /positive whole numbers/ })
      .waitFor();
    await button('Cancel').click();
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    assert(
      await page.evaluate(
        () => getComputedStyle(document.body).overflow !== 'hidden',
      ),
    );
    await page.screenshot({
      path: `${root}/3g-mobile-${width}.png`,
      fullPage: true,
    });
    await input().fill('Mobile unsupported 漢字');
    await input().press('Enter');
    await button('Download PDF').click();
    await page.getByText(/unsupported by Standard Helvetica/).waitFor();
    await start('dismiss', 1);
    await start('accept', 1);
    await page.locator('.upload-layout').waitFor();
    record(
      `Mobile ${width}x${height}: forms, annotations, Draw/Type/Upload, field placement, pages/dialogs/reset/reduced motion`,
    );
  }
  await page.setViewportSize({ width: 1440, height: 1100 });
  for (const [name, count, forms] of [
    ['plain-100', 100, false],
    ['forms-80', 80, true],
  ]) {
    const doc = await lib.PDFDocument.create();
    for (let i = 0; i < count; i++) {
      const p = doc.addPage([500, 400]);
      p.drawText(`Performance page ${i + 1}`, { x: 25, y: 365, size: 15 });
      if (forms) {
        const f = doc.getForm().createTextField(`Field${i}`);
        f.setText(`Original ${i}`);
        f.addToPage(p, { x: 25, y: 300, width: 200, height: 25 });
      }
    }
    const file = `${root}/${name}.pdf`;
    await writeFile(file, await doc.save());
    const t = Date.now();
    await fresh(file);
    await settle();
    const loadMs = Date.now() - t;
    const bounds = await page.evaluate(() => ({
      pages: document.querySelectorAll('.pdf-canvas[data-ready=true]').length,
      thumbnails: document.querySelectorAll(
        '.thumbnail-canvas-shell[data-status=ready]',
      ).length,
      controls: document.querySelectorAll('.form-widget-layer input').length,
      heap: performance.memory?.usedJSHeapSize,
    }));
    const e = Date.now();
    const output = await download(`3g-${name}`);
    const exportMs = Date.now() - e;
    const reload = await lib.PDFDocument.load(await readFile(output), {
      throwOnInvalidObject: true,
    });
    assert.equal(reload.getPageCount(), count);
    assert.equal(reload.getForm().getFields().length, 0);
    record(`Performance ${name}`, { loadMs, exportMs, ...bounds });
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(requests, []);
  assert(
    await page.evaluate(
      () => localStorage.length === 0 && sessionStorage.length === 0,
    ),
  );
  record(
    'Privacy: no non-GET requests, no local/session persistence, no page errors',
  );
  console.log('PHASE_3G_BROWSER_PASSED');
} catch (error) {
  await page.screenshot({ path: `${root}/3g-failure.png`, fullPage: true });
  console.error(await page.locator('body').innerText());
  throw error;
} finally {
  await writeFile(
    `${root}/phase3g-browser-results.json`,
    JSON.stringify({ results, dialogs, errors, requests }, null, 2),
  );
  await browser.close();
}
