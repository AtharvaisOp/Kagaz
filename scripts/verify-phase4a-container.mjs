import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
const require = createRequire(import.meta.url);
const lib = require('../apps/web/node_modules/pdf-lib');
const container = `kagaz-verify-${process.pid}`;
function docker(args) {
  const result = spawnSync('docker', args, {
    encoding: 'utf8',
    timeout: 30000,
  });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  return result.stdout.trim();
}
try {
  console.log(
    'Image bytes:',
    docker(['image', 'inspect', 'kagaz-api:verify', '--format', '{{.Size}}']),
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
    '/tmp:rw,noexec,nosuid,size=192m',
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
      const response = await fetch('http://127.0.0.1:4000/health');
      healthy = response.ok && (await response.json()).status === 'ok';
      if (healthy) break;
    } catch {}
    await delay(500);
  }
  assert(healthy, 'Container health failed');
  console.log('Ghostscript:', docker(['exec', container, 'gs', '--version']));
  console.log('qpdf:', docker(['exec', container, 'qpdf', '--version']));
  assert.equal(docker(['exec', container, 'id', '-u']), '1000');
  const doc = await lib.PDFDocument.create();
  doc.addPage().drawText('Container compression');
  doc.setSubject('Padding '.repeat(2000));
  const input = await doc.save({ useObjectStreams: false });
  for (const preset of ['high-quality', 'balanced', 'maximum']) {
    const body = new FormData();
    body.append('file', new Blob([input]), '../../hostile.pdf');
    body.append('preset', preset);
    const started = Date.now();
    const response = await fetch('http://127.0.0.1:4000/tools/compress', {
      method: 'POST',
      body,
    });
    assert.equal(response.status, 200, await response.clone().text());
    const output = new Uint8Array(await response.arrayBuffer());
    assert.equal((await lib.PDFDocument.load(output)).getPageCount(), 1);
    assert(output.length <= input.length);
    console.log(
      JSON.stringify({
        preset,
        input: input.length,
        output: output.length,
        milliseconds: Date.now() - started,
      }),
    );
  }
  for (const content of ['', 'wrong content', '%PDF-1.7\nmalformed']) {
    const body = new FormData();
    body.append('file', new Blob([content]), 'file.pdf');
    body.append('preset', 'balanced');
    const response = await fetch('http://127.0.0.1:4000/tools/compress', {
      method: 'POST',
      body,
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, 'invalid-pdf');
  }
  // Cleanup happens after response streaming; wait for the route's finally to settle.
  let leftovers = '';
  for (let n = 0; n < 20; n++) {
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
  console.log(
    docker([
      'stats',
      '--no-stream',
      container,
      '--format',
      '{{.MemUsage}} {{.PIDs}}',
    ]),
  );
  console.log(
    'Cgroup peak bytes:',
    docker(['exec', container, 'cat', '/sys/fs/cgroup/memory.peak']),
  );
  console.log('PHASE_4A_CONTAINER_PASSED');
} finally {
  spawnSync('docker', ['logs', container], { stdio: 'inherit' });
  spawnSync('docker', ['rm', '-f', container], { stdio: 'inherit' });
}
