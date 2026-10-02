import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { scanFixture, inspectPdf } from './ocr-fixtures.mjs';
const require = createRequire(import.meta.url);
const lib = require('../apps/web/node_modules/pdf-lib');
const container = `kagaz-ocr-verify-${process.pid}`,
  results = [];
const root = process.env.KAGAZ_ARTIFACT_DIR;
assert(root, 'Set KAGAZ_ARTIFACT_DIR outside the repository.');
await mkdir(root, { recursive: true });
const docker = (args) => {
  const result = spawnSync('docker', args, {
    encoding: 'utf8',
    timeout: 30000,
  });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  return result.stdout.trim();
};
let browser;
try {
  const imageBytes = Number(
    docker(['image', 'inspect', 'kagaz-api:verify', '--format', '{{.Size}}']),
  );
  const baselineBytes = Number(
    docker(['image', 'inspect', 'kagaz-api:baseline', '--format', '{{.Size}}']),
  );
  const versions = Object.fromEntries(
    ['gs', 'qpdf', 'tesseract', 'ocrmypdf'].map((tool) => [
      tool,
      docker(['run', '--rm', 'kagaz-api:verify', tool, '--version']).split(
        '\n',
      )[0],
    ]),
  );
  console.log(
    JSON.stringify({
      versions,
      imageBytes,
      baselineBytes,
      increaseBytes: imageBytes - baselineBytes,
    }),
  );
  docker([
    'run',
    '-d',
    '--name',
    container,
    '--init',
    '--memory=512m',
    '--cpus=0.5',
    '--read-only',
    '--tmpfs',
    '/tmp:rw,noexec,nosuid,size=256m',
    '--cap-drop=ALL',
    '--security-opt=no-new-privileges',
    '--pids-limit=64',
    '-p',
    '127.0.0.1:4000:4000',
    'kagaz-api:verify',
  ]);
  let healthy = false;
  for (let n = 0; n < 30; n++) {
    try {
      healthy = (await fetch('http://localhost:4000/health')).ok;
      if (healthy) break;
    } catch {}
    await delay(500);
  }
  assert(healthy);
  assert.equal(docker(['exec', container, 'id', '-u']), '1000');
  const languages = docker(['exec', container, 'tesseract', '--list-langs']);
  assert(languages.includes('eng'));
  assert(!languages.includes('\nfra'));
  assert(
    !docker(['exec', container, 'sh', '-c', 'command -v soffice || true']),
  );
  // Diagnose only this public synthetic fixture, outside the HTTP/logging path.
  // Use exactly the production runner and limits before expensive browser checks.
  await writeFile(`${root}/native-diagnostic.pdf`, await scanFixture());
  docker([
    'cp',
    `${root}/native-diagnostic.pdf`,
    `${container}:/tmp/ocr-fixture.pdf`,
  ]);
  docker([
    'exec',
    container,
    'node',
    '--input-type=module',
    '-e',
    `
    import { copyFile } from 'node:fs/promises';
    import { basename } from 'node:path';
    import { ocrPdf } from './dist/tools/ocr.js';
    import { runNative } from './dist/tools/nativeRunner.js';
    import { createTempWorkspace } from './dist/tools/workspace.js';
    const workspace = await createTempWorkspace();
    try {
      await copyFile('/tmp/ocr-fixture.pdf', workspace.input);
      await ocrPdf(workspace.input, workspace.output, new AbortController().signal, {
        runner: async (request) => {
          const result = await runNative(request);
          if (result.exitCode !== 0) console.error(JSON.stringify({
            syntheticFixture: true, tool: basename(request.executable), exitCode: result.exitCode,
            diagnostic: (result.stderr || result.stdout).replaceAll(workspace.directory, '<synthetic>'),
          }));
          return result;
        },
      });
    } finally { await workspace.cleanup(); }
  `,
  ]);
  docker(['exec', container, 'rm', '/tmp/ocr-fixture.pdf']);
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(process.env.KAGAZ_WEB_URL ?? 'http://localhost:5173');
  for (const fixture of [
    { name: 'one-page', pages: 1 },
    { name: 'ten-page', pages: 10 },
    { name: 'mixed', pages: 3, digital: true },
    { name: 'skewed', quality: 'rotated' },
    { name: 'low-quality', quality: 'low-quality' },
    { name: 'blank-with-scan', blank: true },
  ]) {
    const input = await scanFixture(fixture),
      body = new FormData();
    body.append('file', new Blob([input]), '../../hostile.pdf');
    body.append('language', 'eng');
    const reference = await inspectPdf(page, input),
      started = Date.now();
    const response = await fetch('http://localhost:4000/tools/ocr', {
      method: 'POST',
      body,
    });
    assert.equal(response.status, 200, await response.clone().text());
    const output = new Uint8Array(await response.arrayBuffer());
    await writeFile(`${root}/container-${fixture.name}.pdf`, output);
    const returned = await inspectPdf(page, output);
    assert.equal(returned.pages.length, reference.pages.length);
    assert.equal(returned.forms, 0);
    for (let n = 0; n < returned.pages.length; n++) {
      const a = reference.pages[n],
        b = returned.pages[n];
      assert.equal(a.width, b.width);
      assert.equal(a.height, b.height);
      if (fixture.digital && n === 0)
        assert.equal(a.text.replace(/\s/g, ''), b.text.replace(/\s/g, ''));
      else if (!(fixture.blank && n === returned.pages.length - 1)) {
        const text = b.text.toLowerCase().replace(/\s/g, '');
        assert(
          text.includes('kagaz') &&
            text.includes('english') &&
            text.includes('12345'),
        );
      }
      let difference = 0;
      for (let p = 0; p < a.pixels.length; p++)
        difference += Math.abs(a.pixels[p] - b.pixels[p]);
      assert(difference / a.pixels.length < 0.15);
    }
    // Structural checks also run in the route; check independently by copying the returned bytes.
    // The image's non-root user reads only this synthetic fixture in /tmp.
    docker([
      'cp',
      `${root}/container-${fixture.name}.pdf`,
      `${container}:/tmp/verify-output.pdf`,
    ]);
    docker(['exec', container, 'qpdf', '--check', '/tmp/verify-output.pdf']);
    docker(['exec', container, 'rm', '/tmp/verify-output.pdf']);
    results.push({
      name: fixture.name,
      input: input.length,
      output: output.length,
      milliseconds: Date.now() - started,
      pages: returned.pages.length,
    });
    console.log(JSON.stringify(results.at(-1)));
  }
  const digital = await lib.PDFDocument.create();
  digital.addPage().drawText('Existing digital text');
  const empty = await lib.PDFDocument.create();
  empty.addPage();
  for (const [input, language, status, code] of [
    [await digital.save(), 'eng', 422, 'no-ocr-needed'],
    [await empty.save(), 'eng', 422, 'no-ocr-needed'],
    [new TextEncoder().encode('%PDF-1.7 broken'), 'eng', 400, 'invalid-pdf'],
    [await scanFixture(), 'fra', 422, 'unsupported-language'],
  ]) {
    const body = new FormData();
    body.append('file', new Blob([input]), 'fixture.pdf');
    body.append('language', language);
    const response = await fetch('http://localhost:4000/tools/ocr', {
      method: 'POST',
      body,
    });
    assert.equal(response.status, status);
    assert.equal((await response.json()).error.code, code);
  }
  // The existing all-preset compression smoke runs on this same production image in CI.
  let leftovers = '';
  for (let n = 0; n < 30; n++) {
    leftovers = docker([
      'exec',
      container,
      'find',
      '/tmp',
      '-maxdepth',
      '1',
      '-name',
      'kagaz-*',
    ]);
    if (!leftovers) break;
    await delay(100);
  }
  assert.equal(leftovers, '');
  const memoryPeakBytes = Number(
    docker(['exec', container, 'cat', '/sys/fs/cgroup/memory.peak']),
  );
  console.log(JSON.stringify({ memoryPeakBytes }));
  await writeFile(
    `${root}/phase4b-container.json`,
    JSON.stringify(
      {
        imageBytes,
        baselineBytes,
        increaseBytes: imageBytes - baselineBytes,
        versions,
        memoryPeakBytes,
        results,
      },
      null,
      2,
    ),
  );
  console.log('PHASE_4B_CONTAINER_PASSED');
} finally {
  await browser?.close();
  spawnSync('docker', ['logs', container], { stdio: 'inherit' });
  spawnSync('docker', ['rm', '-f', container], { stdio: 'inherit' });
}
