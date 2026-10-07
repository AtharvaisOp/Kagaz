import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { officeFixture } from './office-fixtures.mjs';

const require = createRequire(import.meta.url);
const lib = require('../apps/web/node_modules/pdf-lib');
const artifacts = process.env.KAGAZ_ARTIFACT_DIR;
assert(artifacts, 'Set KAGAZ_ARTIFACT_DIR outside the repository.');
await mkdir(artifacts, { recursive: true });
const container = `kagaz-audit-${process.pid}`;
const api = 'http://127.0.0.1:4000';
const results = [];
let runtime;

async function saveReport() {
  await writeFile(
    `${artifacts}/phase4d-container.json`,
    JSON.stringify(
      {
        samplingIntervalMs: 250,
        runtime,
        limits: {
          memoryBytes: 512 * 1024 * 1024,
          tmpfsBytes: 256 * 1024 * 1024,
          pids: 64,
        },
        results,
      },
      null,
      2,
    ),
  );
}

function docker(args, input, timeout = 30_000) {
  const result = spawnSync('docker', args, {
    input,
    encoding: 'utf8',
    timeout,
    maxBuffer: 4 * 1024 * 1024,
  });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  return result.stdout.trim();
}

// The sampler is inside the cgroup and its overhead is included. It retains only
// numeric resource counters, never document data, filenames or private paths.
const sampler = `
import json, os, stat, time
from pathlib import Path
peak = {'memoryCurrentBytes': 0, 'processRssBytes': 0, 'processes': 0,
        'cgroupTasks': 0,
        'workspaceLogicalBytes': 0, 'workspaceAllocatedBytes': 0, 'tmpUsedBytes': 0}
samples = 0
while not Path('/tmp/audit-stop').exists():
    logical = allocated = rss = processes = 0
    for base in Path('/tmp').glob('kagaz-*'):
        for root, directories, files in os.walk(base, followlinks=False):
            for name in files + directories:
                try:
                    info = os.lstat(os.path.join(root, name))
                    allocated += info.st_blocks * 512
                    if stat.S_ISREG(info.st_mode) or stat.S_ISLNK(info.st_mode):
                        logical += info.st_size
                except FileNotFoundError:
                    pass
    for proc in Path('/proc').glob('[0-9]*/status'):
        try:
            processes += 1
            for line in proc.read_text().splitlines():
                if line.startswith('VmRSS:'):
                    rss += int(line.split()[1]) * 1024
        except (FileNotFoundError, ProcessLookupError):
            pass
    disk = os.statvfs('/tmp')
    now = {'memoryCurrentBytes': int(Path('/sys/fs/cgroup/memory.current').read_text()),
           'processRssBytes': rss, 'processes': processes,
           'cgroupTasks': int(Path('/sys/fs/cgroup/pids.current').read_text()),
           'workspaceLogicalBytes': logical, 'workspaceAllocatedBytes': allocated,
           'tmpUsedBytes': (disk.f_blocks - disk.f_bfree) * disk.f_frsize}
    for key, value in now.items(): peak[key] = max(peak[key], value)
    samples += 1
    Path('/tmp/audit-metrics.json').write_text(json.dumps({'samples': samples, 'sampledPeaks': peak}))
    time.sleep(0.25)
`;

async function start(cpuCores, superviseShutdown = false) {
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
    ...(superviseShutdown
      ? [
          'node',
          '--input-type=module',
          '-e',
          `
      import { spawn } from 'node:child_process';
      import { readdirSync, readFileSync } from 'node:fs';
      const child = spawn(process.execPath, ['dist/index.js'], {stdio: 'inherit'});
      process.on('SIGTERM', () => child.kill('SIGTERM'));
      child.on('close', code => {
        const count = readdirSync('/tmp').filter(name => name.startsWith('kagaz-')).length;
        let native = 0;
        for (const pid of readdirSync('/proc').filter(name => /^\\d+$/.test(name))) {
          try {
            if (['ocrmypdf', 'tesseract', 'gs', 'soffice.bin'].includes(readFileSync('/proc/'+pid+'/comm', 'utf8').trim())) native++;
          } catch (error) { if (!['ENOENT', 'ESRCH'].includes(error.code)) throw error; }
        }
        console.log(JSON.stringify({ shutdownWorkspaceCount: count, shutdownNativeCount: native }));
        process.exit(code ?? 1);
      });
    `,
        ]
      : []),
  ]);
  const started = Date.now();
  for (let n = 0; n < 60; n++) {
    try {
      if (
        (await fetch(`${api}/health`, { signal: AbortSignal.timeout(2000) })).ok
      )
        return Date.now() - started;
    } catch {}
    await delay(250);
  }
  assert.fail('Container health never became available.');
}

function stop() {
  spawnSync('docker', ['rm', '-f', container], { stdio: 'ignore' });
}

async function clean() {
  for (let n = 0; n < 80; n++) {
    const count = Number(
      docker([
        'exec',
        container,
        'python3',
        '-c',
        "from pathlib import Path; print(len(list(Path('/tmp').glob('kagaz-*'))))",
      ]),
    );
    if (!count) return;
    await delay(100);
  }
  assert.fail('Private workspaces survived the completed request.');
}

function cpuUsage() {
  return Number(
    /usage_usec (\d+)/.exec(
      docker(['exec', container, 'cat', '/sys/fs/cgroup/cpu.stat']),
    )[1],
  );
}

async function post(operation, input, signal = AbortSignal.timeout(335_000)) {
  const form = new FormData();
  form.append(
    'file',
    new Blob([input]),
    operation === 'convert-to-pdf' ? 'selected-document.docx' : 'workspace.pdf',
  );
  if (operation === 'compress') form.append('preset', 'balanced');
  if (operation === 'ocr') form.append('language', 'eng');
  return fetch(`${api}/tools/${operation}`, {
    method: 'POST',
    body: form,
    signal,
  });
}

async function measure(name, operation, input, pages, cpuCores) {
  stop();
  const healthStartupMs = await start(cpuCores);
  const cpuBefore = cpuUsage();
  docker(['exec', '-d', container, 'python3', '-c', sampler]);
  const started = Date.now();
  const response = await post(operation, input);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  let outputBytes = 0,
    errorCode = null;
  if (response.ok) {
    const output = new Uint8Array(await response.arrayBuffer());
    outputBytes = output.byteLength;
    assert.equal((await lib.PDFDocument.load(output)).getPageCount(), pages);
    const header =
      operation === 'compress'
        ? 'x-kagaz-compressed-bytes'
        : 'x-kagaz-output-bytes';
    assert.equal(Number(response.headers.get(header)), outputBytes);
    assert.equal(response.headers.get('content-type'), 'application/pdf');
  } else {
    assert.equal(
      response.headers.get('content-type')?.split(';')[0],
      'application/json',
    );
    errorCode = (await response.json()).error.code;
    // Admission limits are bounds, not a promise that every complex file fits a
    // Free CPU deadline. Resource failures must be typed, clean and recoverable.
    assert(
      ['processing-timeout', 'ocr-failed', 'processing-failed'].includes(
        errorCode,
      ),
    );
    assert(
      name.includes('ceiling'),
      `${name} unexpectedly failed: ${errorCode}`,
    );
  }
  const runtimeMs = Date.now() - started;
  await clean();
  docker([
    'exec',
    container,
    'python3',
    '-c',
    "from pathlib import Path; Path('/tmp/audit-stop').touch()",
  ]);
  await delay(350);
  const metrics = JSON.parse(
    docker(['exec', container, 'cat', '/tmp/audit-metrics.json']),
  );
  const memoryEvents = docker([
    'exec',
    container,
    'cat',
    '/sys/fs/cgroup/memory.events',
  ]);
  assert.match(memoryEvents, /oom_kill 0(?:\n|$)/);
  const pidsEvents = docker([
    'exec',
    container,
    'cat',
    '/sys/fs/cgroup/pids.events',
  ]);
  assert.match(pidsEvents, /max 0(?:\n|$)/);
  const result = {
    name,
    operation,
    cpuCores,
    inputBytes: input.byteLength,
    outputBytes,
    pages,
    runtimeMs,
    errorCode,
    healthStartupMs,
    cgroupCpuUseMs: (cpuUsage() - cpuBefore) / 1000,
    cgroupMemoryPeakBytes: Number(
      docker(['exec', container, 'cat', '/sys/fs/cgroup/memory.peak']),
    ),
    ...metrics,
    memoryEvents,
    pidsEvents,
  };
  assert(result.sampledPeaks.processes < 64);
  assert(result.sampledPeaks.cgroupTasks < 64);
  assert(result.sampledPeaks.workspaceLogicalBytes < 256 * 1024 * 1024);
  results.push(result);
  await saveReport();
  console.log(JSON.stringify(result));
}

async function compressionFixture(images, pages = images || 1) {
  const doc = await lib.PDFDocument.create();
  for (let n = 0; n < pages; n++) {
    const page = doc.addPage([576, 720]);
    page.drawText('Synthetic resource audit', { x: 30, y: 680, size: 14 });
    if (n >= images) continue;
    const pixels = Buffer.alloc(900 * 900 * 3);
    let seed = n + 123;
    for (let offset = 0; offset < pixels.length; offset++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      pixels[offset] = seed >>> 24;
    }
    const ref = doc.context.register(
      doc.context.stream(pixels, {
        Type: 'XObject',
        Subtype: 'Image',
        Width: 900,
        Height: 900,
        ColorSpace: 'DeviceRGB',
        BitsPerComponent: 8,
      }),
    );
    const key = page.node.newXObject('Photo', ref);
    page.pushOperators(
      lib.pushGraphicsState(),
      lib.concatTransformationMatrix(200, 0, 0, 200, 30, 50),
      lib.drawObject(key),
      lib.popGraphicsState(),
    );
  }
  return doc.save({ useObjectStreams: false });
}

async function independentScans(pages) {
  const doc = await lib.PDFDocument.create();
  const png = await readFile(
    new URL('../apps/api/src/tools/fixtures/english-scan.png', import.meta.url),
  );
  for (let n = 0; n < pages; n++) {
    // Separate embedded streams, unlike Phase 4B's shared image. The synthetic
    // text is intentionally identical, so these are not diverse photo workloads.
    const image = await doc.embedPng(png);
    doc
      .addPage([576, 720])
      .drawImage(image, { x: 0, y: 0, width: 576, height: 720 });
  }
  return doc.save();
}

async function maximumRasterScan() {
  const source = await readFile(
    new URL('../apps/api/src/tools/fixtures/english-scan.png', import.meta.url),
  );
  // Pillow is an existing production OCR dependency. Public fixture text is
  // enlarged and padded to exactly 16 MP, preserving a readable synthetic scan.
  const encoded = docker(
    [
      'exec',
      '-i',
      container,
      'python3',
      '-c',
      "import base64, io, sys; from PIL import Image; original=Image.open(io.BytesIO(sys.stdin.buffer.read())).convert('RGB'); canvas=Image.new('RGB',(3200,5000),'white'); canvas.paste(original.resize((3200,4000)),(0,0)); output=io.BytesIO(); canvas.save(output,format='PNG'); print(base64.b64encode(output.getvalue()).decode('ascii'))",
    ],
    source,
  );
  const doc = await lib.PDFDocument.create();
  const image = await doc.embedPng(Buffer.from(encoded, 'base64'));
  doc
    .addPage([576, 900])
    .drawImage(image, { x: 0, y: 0, width: 576, height: 900 });
  return doc.save();
}

async function activeNative() {
  return Number(
    docker([
      'exec',
      container,
      'python3',
      '-c',
      [
        'from pathlib import Path',
        'count = 0',
        "for p in Path('/proc').glob('[0-9]*/comm'):",
        '    try:',
        "        count += p.read_text().strip() in ('ocrmypdf', 'tesseract', 'gs', 'soffice.bin')",
        '    except (FileNotFoundError, ProcessLookupError): pass',
        'print(count)',
      ].join('\n'),
    ]),
  );
}

async function waitNative() {
  for (let n = 0; n < 120; n++) {
    if (await activeNative()) return;
    await delay(100);
  }
  assert.fail('No native process was observed before cancellation.');
}

async function verifyLifecycle(input) {
  stop();
  await start(0.5, true);
  const controller = new AbortController();
  const pending = post('ocr', input, controller.signal).then(
    () => 'completed',
    () => 'aborted',
  );
  await waitNative();
  const started = Date.now();
  controller.abort();
  assert.equal(await pending, 'aborted');
  await clean();
  assert.equal(await activeNative(), 0);
  const cancellationCleanupMs = Date.now() - started;
  // Recovery proves the slot was released after native termination and cleanup.
  const recovery = await post('compress', await compressionFixture(0));
  assert.equal(recovery.status, 200, await recovery.clone().text());
  await recovery.arrayBuffer();
  await clean();

  let activeSettled = false,
    queuedSettled = false;
  const active = post('ocr', input)
    .then(
      async (r) => ({ status: r.status, body: await r.text() }),
      () => null,
    )
    .finally(() => {
      activeSettled = true;
    });
  await waitNative();
  const queued = post('compress', await compressionFixture(0))
    .then(
      async (r) => ({ status: r.status, body: await r.text() }),
      () => null,
    )
    .finally(() => {
      queuedSettled = true;
    });
  await delay(150);
  assert(
    !activeSettled && !queuedSettled,
    'Shutdown did not interrupt active and queued work.',
  );
  const shutdownStarted = Date.now();
  docker(['kill', '--signal=TERM', container]);
  assert.equal(docker(['wait', container]), '0');
  for (const outcome of await Promise.all([active, queued])) {
    if (outcome) {
      assert.equal(outcome.status, 503);
      assert.equal(JSON.parse(outcome.body).error.code, 'server-busy');
    }
  }
  const shutdownMs = Date.now() - shutdownStarted;
  assert(shutdownMs < 30_000, 'Shutdown exceeded Render default grace period.');
  const logs = docker(['logs', container]);
  assert(
    logs.includes('"shutdownWorkspaceCount":0,"shutdownNativeCount":0'),
    'Shutdown left private files or native processes.',
  );
  assert(
    !/\/tmp\/kagaz-|Traceback|selected-document|Synthetic resource audit/.test(
      logs,
    ),
  );
  results.push({
    lifecycle: true,
    cancellationCleanupMs,
    shutdownMs,
    noNativeAfterCancel: true,
    admissionRecovered: true,
    cleanShutdownExit: 0,
  });
  await saveReport();
}

async function verifyQueue(input) {
  stop();
  await start(0.5);
  const small = await compressionFixture(0);
  const active = post('ocr', input).then(async (response) => {
    assert.equal(response.status, 200, await response.clone().text());
    await response.arrayBuffer();
    return Date.now();
  });
  await waitNative();
  const queueStarted = Date.now();
  let firstSettled = false;
  const first = post('compress', small).then(async (response) => {
    firstSettled = true;
    assert.equal(response.status, 200, await response.clone().text());
    await response.arrayBuffer();
    return Date.now();
  });
  const controller = new AbortController();
  const second = post('compress', small, controller.signal).then(
    () => 'completed',
    () => 'aborted',
  );
  await delay(200);
  assert(!firstSettled, 'A second native job overlapped the admitted OCR.');
  const overflow = await post('compress', small);
  assert.equal(overflow.status, 503);
  assert.equal(overflow.headers.get('retry-after'), '5');
  assert.equal((await overflow.json()).error.code, 'server-busy');
  controller.abort();
  assert.equal(await second, 'aborted');
  const activeDone = await active;
  const queuedDone = await first;
  assert(queuedDone > activeDone);
  await clean();
  results.push({
    queue: true,
    activeResponseDelayAfterQueueMs: activeDone - queueStarted,
    queuedRequestMs: queuedDone - queueStarted,
    overflowStatus: 503,
    queuedCancellation: true,
    oneSlotObserved: true,
  });
  await saveReport();
}

async function profileStages(operation, bytes) {
  docker(
    [
      'exec',
      '-i',
      container,
      'node',
      '-e',
      "require('node:fs').writeFileSync('/tmp/audit-fixture',require('node:fs').readFileSync(0))",
    ],
    bytes,
  );
  const profile = JSON.parse(
    docker(
      [
        'exec',
        container,
        'node',
        '--input-type=module',
        '-e',
        `
    import { copyFile, rm } from 'node:fs/promises';
    import { basename } from 'node:path';
    import { compressPdf } from './dist/tools/compress.js';
    import { convertToPdf } from './dist/tools/convert.js';
    import { ocrPdf } from './dist/tools/ocr.js';
    import { runNative } from './dist/tools/nativeRunner.js';
    import { createTempWorkspace } from './dist/tools/workspace.js';
    const workspace = await createTempWorkspace();
    const stages = [];
    const runner = async request => {
      const started = performance.now();
      const result = await runNative(request);
      stages.push({ tool: basename(request.executable),
        stage: request.args[0].endsWith('.py') ? basename(request.args[0]) : request.args[0],
        elapsedMs: Math.round(performance.now() - started), exitCode: result.exitCode,
        fileSizeLimitDetected: /File too large|file size limit|SIGXFSZ/i.test(result.stderr) });
      return result;
    };
    try {
      await copyFile('/tmp/audit-fixture', workspace.input);
      const signal = AbortSignal.timeout(180_000);
      if (process.argv[1] === 'compress')
        await compressPdf(workspace.input, workspace.output, 'balanced', signal, { runner });
      else if (process.argv[1] === 'ocr') {
        let failureCode;
        try { await ocrPdf(workspace.input, workspace.output, signal, { runner }); }
        catch (error) { failureCode = error.code; }
        if (failureCode && !['ocr-failed', 'processing-timeout', 'processing-failed'].includes(failureCode))
          throw new Error('Unexpected raster error contract');
        console.log(JSON.stringify({ nativeStages: true, operation: 'ocr-raster-ceiling', cpuCores: 0.1, failureCode, stages }));
      } else await convertToPdf(workspace.input, 'docx', signal, { runner });
      if (process.argv[1] !== 'ocr') console.log(JSON.stringify({ nativeStages: true, operation: process.argv[1], cpuCores: 0.1, stages }));
    } finally { await workspace.cleanup(); await rm('/tmp/audit-fixture'); }
  `,
        operation,
      ],
      undefined,
      210_000,
    ),
  );
  results.push(profile);
  await saveReport();
  console.log(JSON.stringify(profile));
}

try {
  await measure(
    'compression-startup',
    'compress',
    await compressionFixture(0),
    1,
    0.1,
  );
  runtime = {
    node: docker(['exec', container, 'node', '--version']),
    python: docker(['exec', container, 'python3', '--version']),
    packages: docker([
      'exec',
      container,
      'dpkg-query',
      '-W',
      '-f=${Package}=${Version}\\n',
      'ghostscript',
      'qpdf',
      'ocrmypdf',
      'tesseract-ocr',
      'tesseract-ocr-eng',
      'python3-pikepdf',
      'python3-pdfminer',
      'libreoffice-core-nogui',
      'libseccomp2',
      'util-linux',
    ]).split('\n'),
    largestPackages: docker([
      'exec',
      container,
      'python3',
      '-c',
      "import json, subprocess; rows = subprocess.check_output(['dpkg-query','-W','-f=${Installed-Size} ${Package}\\n'], text=True).splitlines(); print(json.dumps(sorted([{'installedKiB': int(r.split()[0]), 'package': r.split()[1]} for r in rows if len(r.split()) == 2], key=lambda r: r['installedKiB'], reverse=True)[:15]))",
    ]),
  };
  // Upstream --version omits Debian security revisions. Prevent a successful
  // build from silently reintroducing the audited vulnerable package floors.
  for (const [name, minimum] of [
    ['ghostscript', '10.05.1~dfsg-1+deb13u2'],
    ['libreoffice-core-nogui', '4:25.2.3-2+deb13u8'],
  ]) {
    const installed = runtime.packages
      .find((row) => row.startsWith(`${name}=`))
      ?.slice(name.length + 1);
    assert(installed, `Missing audited package ${name}`);
    docker([
      'exec',
      container,
      'dpkg',
      '--compare-versions',
      installed,
      'ge',
      minimum,
    ]);
  }
  await saveReport();
  const maximumRaster = await maximumRasterScan();
  await measure(
    'compression-input-ceiling',
    'compress',
    await compressionFixture(8),
    8,
    0.1,
  );
  await measure(
    'compression-page-ceiling',
    'compress',
    await compressionFixture(0, 300),
    300,
    0.1,
  );
  for (const pages of [1, 10, 20])
    await measure(
      `ocr-${pages}-independent${pages === 20 ? '-ceiling' : ''}`,
      'ocr',
      await independentScans(pages),
      pages,
      0.1,
    );
  await measure('ocr-raster-ceiling', 'ocr', maximumRaster, 1, 0.1);
  await measure(
    'office-fresh-profile',
    'convert-to-pdf',
    await officeFixture('paragraphs.docx'),
    1,
    0.1,
  );
  await profileStages('compress', await compressionFixture(0));
  await profileStages('convert-to-pdf', await officeFixture('paragraphs.docx'));
  await profileStages('ocr', maximumRaster);
  await verifyQueue(await independentScans(10));
  await verifyLifecycle(await independentScans(20));
  const report = {
    samplingIntervalMs: 250,
    runtime,
    limits: {
      memoryBytes: 512 * 1024 * 1024,
      tmpfsBytes: 256 * 1024 * 1024,
      pids: 64,
    },
    results,
  };
  await writeFile(
    `${artifacts}/phase4d-container.json`,
    JSON.stringify(report, null, 2),
  );
  console.log('PHASE_4D_CONTAINER_PASSED');
} finally {
  stop();
}
