import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import {
  officeAttack,
  officeFixture,
  OFFICE_ATTACKS,
} from './office-fixtures.mjs';

const require = createRequire(import.meta.url);
const { PDFDocument } = require('../apps/web/node_modules/pdf-lib');
let container = `kagaz-office-verify-${process.pid}-phase4b`;
let activeCpuCores = 0.5;
let started = false;
const results = [];
const artifacts = process.env.KAGAZ_ARTIFACT_DIR;
assert(artifacts, 'Set KAGAZ_ARTIFACT_DIR outside the repository.');
await mkdir(artifacts, { recursive: true });
const workspaceSamplerSource = await readFile(
  new URL('./workspace-sample.mjs', import.meta.url),
  'utf8',
);
const sampleCode = `${workspaceSamplerSource}\nprocess.stdout.write(String(sampleWorkspaceBytes('/tmp')));`;

function docker(args, input) {
  const result = spawnSync('docker', args, {
    encoding: 'utf8',
    input,
    timeout: 60_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  return result.stdout.trim();
}

function dockerStatus(args, input) {
  const result = spawnSync('docker', args, {
    encoding: 'utf8',
    input,
    timeout: 60_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  return {
    status: result.status,
    stdout: result.stdout.trim(),
    stderr: result.stderr,
  };
}

const pdfPath = '/tmp/kagaz-4c-independent.pdf';
const copyToContainer = (bytes) =>
  docker(
    [
      'exec',
      '-i',
      container,
      'node',
      '-e',
      "require('node:fs').writeFileSync(process.argv[1], require('node:fs').readFileSync(0), {mode: 0o600})",
      pdfPath,
    ],
    bytes,
  );

async function postOffice(bytes, filename) {
  const body = new FormData();
  body.append('file', new Blob([bytes]), filename);
  return fetch('http://127.0.0.1:4000/tools/convert-to-pdf', {
    method: 'POST',
    body,
    signal: AbortSignal.timeout(210_000),
  });
}

async function verifyAbortedUploadCleanup() {
  const boundary = `kagaz-abort-${process.pid}`;
  const input = await officeFixture('paragraphs.docx');
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="selected-document.docx"\r\nContent-Type: application/octet-stream\r\n\r\n`,
        ),
      );
      controller.enqueue(input);
      // Keep the multipart part open until the client explicitly cancels.
    },
  });
  const controller = new AbortController();
  const pending = fetch('http://127.0.0.1:4000/tools/convert-to-pdf', {
    method: 'POST',
    headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
    body: stream,
    duplex: 'half',
    signal: controller.signal,
  }).then(
    (response) => response,
    (error) => error,
  );
  let uploadPath = '';
  for (let n = 0; n < 40; n++) {
    uploadPath = docker([
      'exec',
      container,
      'find',
      '/tmp',
      '-mindepth',
      '2',
      '-maxdepth',
      '2',
      '-name',
      'input.pdf',
    ]);
    if (uploadPath) break;
    await delay(50);
  }
  assert(uploadPath, 'The production API did not begin the streaming upload.');
  controller.abort();
  assert((await pending) instanceof Error, 'The aborted upload completed.');
  let leftovers = '';
  for (let n = 0; n < 40; n++) {
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
  assert.equal(leftovers, '', 'An aborted upload left a private workspace.');
  console.log(JSON.stringify({ abortedUpload: true, workspaceCleaned: true }));
}

async function verifyConversion(name, format, expectedPages) {
  const input = await officeFixture(name);
  let peakWorkspaceBytes = 0;
  let sampling = true;
  const sampler = (async () => {
    while (sampling) {
      const sample = docker([
        'exec',
        container,
        'node',
        '--input-type=module',
        '-e',
        sampleCode,
      ]);
      peakWorkspaceBytes = Math.max(peakWorkspaceBytes, Number(sample) || 0);
      await delay(150);
    }
  })();
  const started = Date.now();
  let response;
  let output;
  try {
    response = await postOffice(input, `selected-document.${format}`);
    if (response.status !== 200) assert.fail(await response.text());
    assert.match(
      response.headers.get('content-type') ?? '',
      /^application\/pdf\b/,
    );
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('x-kagaz-input-format'), format);
    assert.equal(
      response.headers.get('x-kagaz-original-bytes'),
      String(input.byteLength),
    );
    assert.equal(response.headers.get('x-kagaz-pages'), String(expectedPages));
    output = Buffer.from(await response.arrayBuffer());
  } finally {
    sampling = false;
    await sampler;
  }
  assert.equal(
    Number(response.headers.get('x-kagaz-output-bytes')),
    output.byteLength,
  );
  assert(output.byteLength <= 40 * 1024 * 1024);
  const parsed = await PDFDocument.load(output, { throwOnInvalidObject: true });
  assert.equal(parsed.getPageCount(), expectedPages);
  await writeFile(`${artifacts}/${name}.pdf`, output);
  copyToContainer(output);
  docker(['exec', container, 'qpdf', '--check', pdfPath]);
  const encrypted = dockerStatus([
    'exec',
    container,
    'qpdf',
    '--is-encrypted',
    pdfPath,
  ]);
  assert.equal(encrypted.status, 2, encrypted.stderr || encrypted.stdout);
  assert.equal(
    docker(['exec', container, 'qpdf', '--show-npages', pdfPath]),
    String(expectedPages),
  );
  docker(['exec', container, 'rm', pdfPath]);
  const result = {
    fixture: name,
    format,
    inputBytes: input.byteLength,
    outputBytes: output.byteLength,
    runtimeMs: Date.now() - started,
    pages: expectedPages,
    cpuCores: activeCpuCores,
    sampledPeakWorkspaceBytes: peakWorkspaceBytes,
  };
  results.push(result);
  console.log(JSON.stringify(result));
}

async function expectApiError(bytes, filename, code, status = 422) {
  const response = await postOffice(bytes, filename);
  assert.equal(response.status, status, await response.clone().text());
  assert.match(
    response.headers.get('content-type') ?? '',
    /^application\/json\b/,
  );
  assert.equal((await response.json()).error.code, code);
}

async function startContainer(cpuCores, label) {
  container = `kagaz-office-verify-${process.pid}-${label}`;
  activeCpuCores = cpuCores;
  docker([
    'run',
    '-d',
    '--name',
    container,
    '--init',
    '--memory=512m',
    `--cpus=${cpuCores}`,
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
  started = true;
  let healthy = false;
  for (let n = 0; n < 40; n++) {
    try {
      const response = await fetch('http://127.0.0.1:4000/health');
      healthy = response.ok && (await response.json()).status === 'ok';
      if (healthy) break;
    } catch {}
    await delay(500);
  }
  assert(healthy, 'Production container health failed.');
  assert.equal(docker(['exec', container, 'id', '-u']), '1000');
  const rootMount = docker([
    'exec',
    container,
    'node',
    '-e',
    "process.stdout.write(require('node:fs').readFileSync('/proc/mounts','utf8').split('\\n').find((line)=>line.split(' ')[1]==='/')??'missing')",
  ]);
  assert.match(
    rootMount,
    /\sro(?:,|\s)/,
    'The production root filesystem must be mounted read-only.',
  );
}

function stopContainer() {
  if (!started) return;
  spawnSync('docker', ['logs', container], { stdio: 'inherit' });
  spawnSync('docker', ['rm', '-f', container], { stdio: 'inherit' });
  started = false;
}

try {
  const imageBytes = Number(
    docker(['image', 'inspect', 'kagaz-api:verify', '--format', '{{.Size}}']),
  );
  const baselineBytes = Number(
    docker(['image', 'inspect', 'kagaz-api:baseline', '--format', '{{.Size}}']),
  );
  // Match Phase 4B first, then repeat one fixture from every family at Render's
  // published Free web-service CPU allocation with the same 512 MiB memory cap.
  await startContainer(0.5, 'phase4b');
  const versions = {
    libreoffice: docker([
      'exec',
      container,
      '/usr/lib/libreoffice/program/oosplash',
      '--version',
    ]),
  };
  versions.qpdf = docker(['exec', container, 'qpdf', '--version']).split(
    '\n',
  )[0];
  versions.ghostscript = docker(['exec', container, 'gs', '--version']);
  versions.ocrmypdf = docker(['exec', container, 'ocrmypdf', '--version']);
  versions.tesseract = docker([
    'exec',
    container,
    'tesseract',
    '--version',
  ]).split('\n')[0];
  versions.liberationSans = docker([
    'exec',
    container,
    'fc-match',
    'Liberation Sans',
  ]).split('\n')[0];
  versions.packages = docker([
    'exec',
    container,
    'dpkg-query',
    '-W',
    '-f=${Package}=${Version}\\n',
    'libreoffice-writer-nogui',
    'libreoffice-impress-nogui',
    'libreoffice-calc-nogui',
    'fonts-liberation',
    'fonts-dejavu-core',
    'libseccomp2',
  ]);
  const networkProbe = [
    'import socket',
    'left, right = socket.socketpair(socket.AF_UNIX, socket.SOCK_STREAM)',
    'left.close(); right.close()',
    'try:',
    '    socket.socket(socket.AF_INET, socket.SOCK_STREAM)',
    'except OSError:',
    '    print("unix-ok;internet-blocked")',
    'else:',
    '    print("internet-available")',
  ].join('\n');
  assert.equal(
    docker([
      'exec',
      container,
      'python3',
      '/app/native/office_sandbox.py',
      '/usr/bin/python3',
      '-c',
      networkProbe,
    ]),
    'unix-ok;internet-blocked',
  );

  console.log(
    JSON.stringify({
      imageBytes,
      baselineBytes,
      imageIncreaseBytes: imageBytes - baselineBytes,
      limits: {
        memoryBytes: 512 * 1024 * 1024,
        cpuCores: 0.5,
        tmpfsBytes: 256 * 1024 * 1024,
        pids: 64,
      },
      versions,
    }),
  );

  await verifyConversion('paragraphs.docx', 'docx', 1);
  await verifyConversion('image-page-break.docx', 'docx', 2);
  await verifyConversion('slides.pptx', 'pptx', 3);
  await verifyConversion('sheet.xlsx', 'xlsx', 1);
  await verifyConversion('sheets.xlsx', 'xlsx', 2);

  const hostileName = await postOffice(
    await officeFixture('paragraphs.docx'),
    '../../--headless;touch-outside.docx',
  );
  if (hostileName.status !== 200) assert.fail(await hostileName.text());
  await hostileName.arrayBuffer();
  for (const [attack, family] of OFFICE_ATTACKS.map((name) => [
    name,
    name.startsWith('pptm-')
      ? 'pptx'
      : name.startsWith('xlsm-') ||
          [
            'remote-formula',
            'remote-defined-name',
            'dangerous-defined-name',
          ].includes(name)
        ? 'xlsx'
        : 'docx',
  ])) {
    const filename = `selected-document.${family}`;
    const attackBytes = await officeAttack(attack);
    assert(
      attackBytes.byteLength <= 10 * 1024 * 1024,
      `${attack} must reach OOXML validation within the multipart limit.`,
    );
    const response = await postOffice(attackBytes, filename);
    if (response.status !== 422)
      assert.fail(`${attack}: ${await response.text()}`);
    assert.match(
      response.headers.get('content-type') ?? '',
      /^application\/json\b/,
    );
    assert(
      ['unsupported-format', 'unsafe-document'].includes(
        (await response.json()).error.code,
      ),
      attack,
    );
  }
  await expectApiError(
    await officeFixture('paragraphs.docx'),
    'renamed.xlsx',
    'unsupported-format',
  );
  await verifyAbortedUploadCleanup();
  const malformed = await fetch('http://127.0.0.1:4000/tools/convert-to-pdf', {
    method: 'POST',
    headers: { 'Content-Type': 'multipart/form-data' },
    body: 'malformed multipart without a boundary',
  });
  assert.equal(malformed.status, 400);
  assert.match(
    malformed.headers.get('content-type') ?? '',
    /^application\/json\b/,
  );
  assert.equal((await malformed.json()).error.code, 'invalid-request');
  const denied = await fetch('http://127.0.0.1:4000/tools/convert-to-pdf', {
    method: 'POST',
    headers: { Origin: 'https://hostile.invalid' },
    body: new FormData(),
  });
  assert.equal(denied.status, 403);
  assert.equal((await denied.json()).error.code, 'invalid-request');

  let leftovers = '';
  for (let n = 0; n < 40; n++) {
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
  assert.equal(
    leftovers,
    '',
    'Private workspaces or profiles remained after conversions.',
  );
  const phase4bMemoryPeakBytes = Number(
    docker(['exec', container, 'cat', '/sys/fs/cgroup/memory.peak']),
  );
  const phase4bCgroupCpu = docker([
    'exec',
    container,
    'cat',
    '/sys/fs/cgroup/cpu.max',
  ]);

  stopContainer();
  await startContainer(0.1, 'render-free');
  await verifyConversion('paragraphs.docx', 'docx', 1);
  await verifyConversion('slides.pptx', 'pptx', 3);
  await verifyConversion('sheet.xlsx', 'xlsx', 1);
  leftovers = '';
  for (let n = 0; n < 40; n++) {
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
  assert.equal(
    leftovers,
    '',
    'Private workspaces or profiles remained after Render-limit conversions.',
  );
  const renderFreeMemoryPeakBytes = Number(
    docker(['exec', container, 'cat', '/sys/fs/cgroup/memory.peak']),
  );
  const renderFreeCgroupCpu = docker([
    'exec',
    container,
    'cat',
    '/sys/fs/cgroup/cpu.max',
  ]);
  const report = {
    imageBytes,
    baselineBytes,
    imageIncreaseBytes: imageBytes - baselineBytes,
    environments: {
      phase4b: {
        memoryBytes: 512 * 1024 * 1024,
        cpuCores: 0.5,
        tmpfsBytes: 256 * 1024 * 1024,
        cgroupCpu: phase4bCgroupCpu,
        memoryPeakBytes: phase4bMemoryPeakBytes,
      },
      renderFree: {
        memoryBytes: 512 * 1024 * 1024,
        cpuCores: 0.1,
        tmpfsBytes: 256 * 1024 * 1024,
        cgroupCpu: renderFreeCgroupCpu,
        memoryPeakBytes: renderFreeMemoryPeakBytes,
      },
    },
    versions,
    results,
    rejectedOfficeAttacks: OFFICE_ATTACKS.length,
  };
  await writeFile(
    `${artifacts}/phase4c-container.json`,
    JSON.stringify(report, null, 2),
  );
  console.log(
    JSON.stringify({
      phase4bMemoryPeakBytes,
      renderFreeMemoryPeakBytes,
      rejectedOfficeAttacks: OFFICE_ATTACKS.length,
    }),
  );
  console.log('PHASE_4C_CONTAINER_PASSED');
} finally {
  if (started) {
    spawnSync('docker', ['logs', container], { stdio: 'inherit' });
    spawnSync('docker', ['rm', '-f', container], { stdio: 'inherit' });
  }
}
