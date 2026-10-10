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
async function pauseBlob(type) {
  await page.evaluate((mime) => {
    const original = Blob.prototype.arrayBuffer;
    window.releaseRead = null;
    Blob.prototype.arrayBuffer = async function () {
      if (this.type === mime) {
        Blob.prototype.arrayBuffer = original;
        await new Promise((resolve) => {
          window.releaseRead = resolve;
        });
      }
      return original.call(this);
    };
  }, type);
}
try {
  const form = await fixture('3g-lifecycle', {
    forms: true,
    signature: true,
    count: 2,
  });
  await fresh(form);
  await create('Type', 'Snapshot mark', true);
  await pauseBlob('image/png');
  let downloads = 0;
  page.on('download', () => downloads++);
  await button('Download PDF').click();
  await page.waitForFunction(() => window.releaseRead !== null);
  await start('accept', 1);
  await page.evaluate(() => window.releaseRead());
  await freshBaseline(form);
  await settle();
  assert.equal(downloads, 0);
  record(
    'Export cancelled by Start Over: stale completion cannot download or mutate reopened state',
  );

  await pauseBlob('image/jpeg');
  await page
    .getByLabel('Choose annotation image', { exact: true })
    .setInputFiles(`${root}/signature.jpg`);
  await page.waitForFunction(() => window.releaseRead !== null);
  await start('accept', 0);
  await page.evaluate(() => window.releaseRead());
  await freshBaseline(form);
  await settle();
  assert(
    !(await page.locator('body').innerText()).includes('Click a page to place'),
  );
  record('Image read cancelled by reset: no old pending asset after reopen');

  await start('accept', 0);
  await pauseBlob('application/pdf');
  await page
    .locator('input[type=file][accept="application/pdf,.pdf"]')
    .setInputFiles(form);
  await page.waitForFunction(() => window.releaseRead !== null);
  await button('Start over').click();
  await page.evaluate(() => window.releaseRead());
  await freshBaseline(form);
  assert.equal(await page.locator('.thumbnail-item').count(), 2);
  record(
    'Rapid file replacement: cancelled source never joins the replacement workspace',
  );

  // Add a new source after an edit and undo the old edit without losing the new baseline.
  await input().fill('Older edit');
  await input().press('Enter');
  await page
    .locator('input[type=file][accept="application/pdf,.pdf"]')
    .setInputFiles(form);
  await page.waitForFunction(
    () =>
      document.querySelectorAll('.thumbnail-item').length === 4 &&
      !document.body.innerText.includes('Checking this PDF'),
  );
  await button('Undo').click();
  const names = page.getByRole('textbox', { name: 'Name', exact: true });
  await names.nth(1).scrollIntoViewIfNeeded();
  assert.equal(await names.nth(1).inputValue(), 'Original');
  assert.equal(await names.nth(0).inputValue(), 'Original');
  record(
    'New-source baseline survives Undo of edits made before source addition',
  );

  // Several supported kinds, repeated widget, and independent duplicate source.
  const doc = await lib.PDFDocument.create();
  const p = doc.addPage([500, 600]);
  const f = doc.getForm();
  const text = f.createTextField('Text');
  text.setText('Initial');
  text.addToPage(p, { x: 20, y: 540, width: 190, height: 25 });
  text.addToPage(p, { x: 250, y: 540, width: 190, height: 25 });
  const multi = f.createTextField('Multiline');
  multi.enableMultiline();
  multi.addToPage(p, { x: 20, y: 420, width: 200, height: 90 });
  const check = f.createCheckBox('Check');
  check.addToPage(p, { x: 20, y: 360, width: 24, height: 24 });
  const radio = f.createRadioGroup('Radio');
  radio.addOptionToPage('A', p, { x: 80, y: 360, width: 24, height: 24 });
  radio.addOptionToPage('B', p, { x: 130, y: 360, width: 24, height: 24 });
  const choice = f.createDropdown('Dropdown');
  choice.addOptions(['Alpha', 'Beta']);
  choice.select('Alpha');
  choice.addToPage(p, { x: 20, y: 280, width: 200, height: 30 });
  const list = f.createOptionList('Options');
  list.addOptions(['One', 'Two', 'Three']);
  list.enableMultiselect();
  list.addToPage(p, { x: 20, y: 150, width: 200, height: 100 });
  const file = `${root}/3g-thumbnail.pdf`;
  await writeFile(file, await doc.save());
  await fresh([file, file]);
  await settle();
  assert.deepEqual(
    await page
      .getByRole('textbox', { name: 'Text', exact: true })
      .evaluateAll((xs) => xs.map((x) => x.value)),
    ['Initial', 'Initial', 'Initial', 'Initial'],
  );
  const thumb = () =>
    page
      .locator('.thumbnail-annotation-canvas')
      .first()
      .evaluate((x) => x.toDataURL());
  await page
    .locator('.thumbnail-canvas-shell[data-status=ready]')
    .first()
    .waitFor();
  await settle();
  for (const [name, edit] of [
    [
      'text and repeated widgets',
      async () => {
        const t = page.getByRole('textbox', { name: 'Text', exact: true });
        await t.nth(0).fill('Edited thumbnail');
        await t.nth(0).press('Enter');
        assert.equal(await t.nth(1).inputValue(), 'Edited thumbnail');
      },
    ],
    [
      'multiline',
      async () => {
        const t = page
          .getByRole('textbox', { name: 'Multiline', exact: true })
          .first();
        await t.fill('First line\nSecond line');
        await t.press('Tab');
      },
    ],
    [
      'checkbox',
      async () =>
        page
          .getByRole('checkbox', { name: 'Check', exact: true })
          .first()
          .check(),
    ],
    ['radio', async () => page.getByRole('radio').first().check()],
    [
      'dropdown',
      async () =>
        page
          .getByRole('combobox', { name: 'Dropdown', exact: true })
          .first()
          .selectOption('Beta'),
    ],
    [
      'option-list',
      async () =>
        page
          .getByRole('listbox', { name: 'Options', exact: true })
          .first()
          .selectOption(['Two', 'Three']),
    ],
  ]) {
    const before = await thumb();
    await edit();
    await settle();
    assert.notEqual(await thumb(), before, name);
    await button('Undo').click();
    await settle();
    assert.equal(await thumb(), before, `${name} Undo`);
    await button('Redo').click();
  }
  await page
    .getByRole('textbox', { name: 'Text', exact: true })
    .nth(2)
    .scrollIntoViewIfNeeded();
  assert.equal(
    await page
      .getByRole('textbox', { name: 'Text', exact: true })
      .nth(2)
      .inputValue(),
    'Initial',
  );
  assert.equal(
    await page
      .locator(
        '.thumbnail-rail input, .thumbnail-rail select, .thumbnail-rail .konvajs-content',
      )
      .count(),
    0,
  );
  await page.getByRole('button', { name: /^Page 1,/ }).click();
  await page.screenshot({ path: `${root}/3g-thumbnails.png`, fullPage: true });
  record(
    'Thumbnail pixels: text/repeated/multiline/checkbox/radio/dropdown/list, Undo/Redo, duplicate isolation, no controls',
  );

  // Malformed fixtures exercise the actual browser admission boundary.
  for (const kind of [
    'cycle',
    'duplicate-widget',
    'invalid-rect',
    'dangling-field',
    'signature-value',
    'byte-range',
    'javascript',
  ]) {
    const bad = await lib.PDFDocument.create();
    const bp = bad.addPage();
    const bf = bad.getForm().createTextField('Bad');
    bf.addToPage(bp);
    const kids = bf.acroField.Kids();
    if (kind === 'cycle') kids.push(bf.ref);
    if (kind === 'duplicate-widget') bp.node.addAnnot(kids.get(0));
    if (kind === 'invalid-rect')
      bf.acroField
        .getWidgets()[0]
        .dict.set(lib.PDFName.of('Rect'), bad.context.obj([0, 0, 0, 0]));
    if (kind === 'dangling-field')
      bad.catalog.getOrCreateAcroForm().addField(lib.PDFRef.of(999));
    if (kind === 'signature-value') {
      bf.acroField.dict.set(lib.PDFName.of('FT'), lib.PDFName.of('Sig'));
      bf.acroField.dict.set(lib.PDFName.of('V'), lib.PDFRef.of(998));
    }
    if (kind === 'byte-range')
      bad.context.register(bad.context.obj({ ByteRange: [0, -1, 9999999] }));
    if (kind === 'javascript')
      bad.catalog.set(
        lib.PDFName.of('OpenAction'),
        bad.context.obj({
          S: 'JavaScript',
          JS: lib.PDFHexString.fromText('synthetic()'),
        }),
      );
    const path = `${root}/3g-bad-${kind}.pdf`;
    await writeFile(path, await bad.save({ updateFieldAppearances: false }));
    await page.goto('http://127.0.0.1:5173');
    await page
      .locator('input[type=file][accept="application/pdf,.pdf"]')
      .setInputFiles(path);
    await page.locator('.upload-layout').waitFor();
    await page.getByText(/cannot safely|changes can invalidate/).waitFor();
    assert.equal(await page.locator('.pdf-page-surface').count(), 0);
    record(`Malformed browser import: ${kind} rejected`);
  }
  // Multi-source workspace with several independently snapshotted visual assets.
  const t = Date.now();
  await fresh([form, form, form]);
  for (let i = 0; i < 3; i++) await create('Type', `Source ${i}`, true);
  const image = page.getByLabel('Choose annotation image', { exact: true });
  for (let i = 0; i < 2; i++) {
    await image.setInputFiles(`${root}/signature.png`);
    await point(70 + i * 120, 280);
  }
  const loadAndEditMs = Date.now() - t,
    e = Date.now();
  const output = await download('3g-multi-assets');
  const exportMs = Date.now() - e;
  const loaded = await lib.PDFDocument.load(await readFile(output), {
    throwOnInvalidObject: true,
  });
  assert.equal(loaded.getPageCount(), 6);
  record('Performance multi-source / multiple signatures/images/forms', {
    loadAndEditMs,
    exportMs,
    sources: 3,
    pages: 6,
  });
  assert.deepEqual(errors, []);
  assert.deepEqual(requests, []);
  console.log('PHASE_3G_LIFECYCLE_PASSED');
} catch (error) {
  await page.screenshot({
    path: `${root}/3g-lifecycle-failure.png`,
    fullPage: true,
  });
  console.error(await page.locator('body').innerText());
  throw error;
} finally {
  await writeFile(
    `${root}/phase3g-lifecycle-results.json`,
    JSON.stringify({ results, dialogs, errors, requests }, null, 2),
  );
  await browser.close();
}
