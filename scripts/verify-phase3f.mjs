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
page.on('dialog', (dialog) => dialog.accept());
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
  first.drawText('Kagaz Phase 3F synthetic verification', {
    x: 30,
    y: 365,
    size: 15,
  });
  for (let i = 1; i < count; i++)
    doc.addPage([500, 400]).drawText(`Page ${i + 1}`, { x: 30, y: 365 });
  if (forms) {
    const text = doc.getForm().createTextField('Name');
    text.addToPage(first, { x: 30, y: 300, width: 220, height: 25 });
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
try {
  const plain = await fixture('plain', { count: 2 });
  const rotated = await fixture('rotated', { rotation: 90 });
  const form = await fixture('form', { forms: true, signature: true });
  await fixture('signed', { signed: true });
  await page.goto('http://127.0.0.1:5173');
  const images = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 400;
    c.height = 120;
    const x = c.getContext('2d');
    x.strokeStyle = '#164ec8';
    x.lineWidth = 6;
    x.beginPath();
    x.moveTo(25, 95);
    x.lineTo(60, 20);
    x.lineTo(100, 90);
    x.lineTo(150, 40);
    x.lineTo(220, 80);
    x.lineTo(350, 30);
    x.stroke();
    const png = c.toDataURL('image/png').split(',')[1];
    x.globalCompositeOperation = 'destination-over';
    x.fillStyle = 'white';
    x.fillRect(0, 0, 400, 120);
    return { png, jpg: c.toDataURL('image/jpeg', 0.95).split(',')[1] };
  });
  await writeFile(`${root}/signature.png`, Buffer.from(images.png, 'base64'));
  await writeFile(`${root}/signature.jpg`, Buffer.from(images.jpg, 'base64'));
  for (const [method, value, name, input] of [
    ['Draw', '', 'draw', plain],
    ['Type', 'Ada Visual', 'type', plain],
    ['Upload', 'signature.png', 'png', plain],
    ['Upload', 'signature.jpg', 'jpeg', plain],
    ['Draw', '', 'draw-90', rotated],
  ]) {
    await fresh(input);
    await create(method, value);
    assert(
      await page
        .getByRole('button', { name: 'Download PDF', exact: true })
        .isDisabled(),
    );
    assert(
      (await page.locator('body').innerText()).includes(
        'pending visual signature',
      ),
    );
    await point(130, 220);
    await page.screenshot({
      path: `${root}/${name}-editor.png`,
      fullPage: true,
    });
    const { doc } = await inspect(
      await download(name),
      name,
      input === plain ? [1, 0] : [1],
    );
    if (name === 'png' || name === 'draw' || name === 'type')
      assert(
        doc.context
          .enumerateIndirectObjects()
          .some(
            ([, o]) =>
              o instanceof lib.PDFRawStream &&
              o.dict.has(lib.PDFName.of('SMask')),
          ),
      );
    if (name === 'draw') {
      await page.getByRole('button', { name: 'Undo', exact: true }).click();
      await inspect(await download('undo'), 'undo', [0, 0]);
      await page.getByRole('button', { name: 'Redo', exact: true }).click();
      await inspect(await download('redo'), 'redo', [1, 0]);
    }
  }
  await fresh(form);
  await page
    .getByRole('textbox', { name: 'Name', exact: true })
    .fill('Ada Form');
  await page.getByRole('textbox', { name: 'Name', exact: true }).press('Tab');
  await page.getByRole('checkbox', { name: 'Accepted', exact: true }).check();
  await create('Type', 'Ada Field', true);
  await page
    .getByRole('button', {
      name: 'Delete Typed signature in signature field',
      exact: true,
    })
    .click();
  assert(
    (await page
      .getByRole('button', { name: /Place visual signature in/ })
      .count()) === 1,
  );
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  assert(
    (await page
      .getByRole('button', { name: /Place visual signature in/ })
      .count()) === 1,
  );
  await inspect(await download('field-undo'), 'field-undo', [0]);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  assert(
    (await page
      .getByRole('button', { name: /Place visual signature in/ })
      .count()) === 0,
  );
  await page
    .getByRole('button', { name: 'Rectangle (R)', exact: true })
    .click();
  await dragSurface(60, 270, 220, 325);
  await page
    .getByLabel('Choose annotation image', { exact: true })
    .setInputFiles(`${root}/signature.png`);
  await point(320, 280);
  await page.screenshot({ path: `${root}/coexist-editor.png`, fullPage: true });
  const combined = await inspect(await download('coexist'), 'coexist', [2]);
  assert(combined.report[0].text.includes('Ada Form'));
  const rotatedForm = await fixture('form-90', {
    forms: true,
    signature: true,
    rotation: 90,
  });
  await fresh(rotatedForm);
  const fieldAction = page.getByRole('button', {
    name: /Place visual signature in/,
  });
  await fieldAction.focus();
  await fieldAction.press('Enter');
  await page.getByRole('tab', { name: 'Type', exact: true }).click();
  await page
    .getByLabel('Signature text', { exact: true })
    .fill('Keyboard Field');
  await page
    .getByRole('button', { name: 'Use signature', exact: true })
    .click();
  await inspect(await download('field-90'), 'field-90', [1]);
  await fresh(plain);
  await create('Type', 'Captured signature');
  await point(150, 230);
  await page.evaluate(() => {
    const original = Blob.prototype.arrayBuffer;
    window.releaseExport = null;
    Blob.prototype.arrayBuffer = async function () {
      if (this.type === 'image/png') {
        Blob.prototype.arrayBuffer = original;
        await new Promise((resolve) => {
          window.releaseExport = resolve;
        });
      }
      return original.call(this);
    };
  });
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download PDF', exact: true }).click();
  await page.waitForFunction(() => typeof window.releaseExport === 'function');
  await page
    .getByRole('button', { name: 'Move Typed signature right', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Delete Typed signature', exact: true })
    .click();
  await page.evaluate(() => window.releaseExport());
  const capturedDownload = await pending;
  await capturedDownload.saveAs(`${root}/captured.pdf`);
  await inspect(`${root}/captured.pdf`, 'captured', [1, 0]);
  await inspect(await download('after-delete'), 'after-delete', [0, 0]);
  await fresh(plain);
  await create('Type', 'Extract Visual');
  await point(150, 230);
  for (const [expression, name, count] of [
    ['1', 'extract-signature', 1],
    ['2', 'extract-unsigned', 0],
  ]) {
    await page
      .getByRole('button', { name: 'Extract pages', exact: true })
      .click();
    await page.getByLabel('Pages to extract').fill(expression);
    await inspect(
      await download(
        name,
        page.getByRole('button', { name: 'Create PDF', exact: true }),
      ),
      name,
      [count],
    );
  }
  await fresh([form, form]);
  const inputs = page.getByRole('textbox', { name: 'Name', exact: true });
  await inputs.nth(0).fill('SOURCE ALPHA');
  await inputs.nth(0).press('Tab');
  await inputs.nth(1).fill('SOURCE BETA');
  await inputs.nth(1).press('Tab');
  await create('Type', 'Alpha Signature', true);
  await create('Type', 'Beta Signature', true);
  const duplicate = await inspect(
    await download('duplicate'),
    'duplicate',
    [1, 1],
  );
  assert(duplicate.report[0].text.includes('SOURCE ALPHA'));
  assert(duplicate.report[1].text.includes('SOURCE BETA'));
  const hashes = (doc) =>
    doc.getPages().map((p) => {
      const x = p.node
        .Resources()
        .lookup(lib.PDFName.of('XObject'), lib.PDFDict);
      return x
        .values()
        .map((ref) => doc.context.lookup(ref))
        .filter(
          (o) =>
            o instanceof lib.PDFRawStream &&
            o.dict.get(lib.PDFName.of('Subtype'))?.toString() === '/Image',
        )
        .map((o) => Buffer.from(o.getContents()).toString('base64'))
        .join('|');
    });
  const before = hashes(duplicate.doc);
  assert.notEqual(before[0], before[1]);
  await page
    .getByRole('button', { name: 'Move page 2 up', exact: true })
    .click();
  const reordered = await inspect(
    await download('reordered'),
    'reordered',
    [1, 1],
  );
  assert(reordered.report[0].text.includes('SOURCE BETA'));
  assert.deepEqual(hashes(reordered.doc), [before[1], before[0]]);
  await page.screenshot({
    path: `${root}/duplicate-editor.png`,
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.screenshot({ path: `${root}/mobile-editor.png`, fullPage: true });
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  );
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto('http://127.0.0.1:5173');
  await page
    .locator('input[type=file][accept="application/pdf,.pdf"]')
    .setInputFiles(`${root}/signed.pdf`);
  await page.getByText(/changes can invalidate the signature/).waitFor();
  assert.equal(await page.locator('.pdf-page-surface').count(), 0);
  await page.screenshot({ path: `${root}/signed-block.png`, fullPage: true });
  assert.deepEqual(errors, []);
  assert.deepEqual(requests, []);
  console.log('ALL_SCENARIOS_PASSED');
} catch (error) {
  await page.screenshot({ path: `${root}/failure.png`, fullPage: true });
  console.error(await page.locator('body').innerText());
  throw error;
} finally {
  await writeFile(
    `${root}/browser-results.json`,
    JSON.stringify({ results, errors, requests }, null, 2),
  );
  await browser.close();
}
