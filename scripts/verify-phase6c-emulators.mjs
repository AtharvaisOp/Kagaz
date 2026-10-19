// Invoked by firebase emulators:exec. Starts only local test processes and never
// uses paid credentials. All operational limits still run in the real ledger.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, '127.0.0.1:9099');
assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8080');
const environment = {
  ...process.env,
  GCLOUD_PROJECT: 'demo-kagaz-phase6c',
  NODE_ENV: 'test',
  GROQ_API_KEY: '',
  KAGAZ_ARTIFACT_DIR:
    process.env.KAGAZ_ARTIFACT_DIR ||
    resolve(tmpdir(), 'kagaz-phase6c-verification'),
  VITE_FIREBASE_API_KEY: 'demo-key',
  VITE_FIREBASE_AUTH_DOMAIN: 'demo-kagaz-phase6c.firebaseapp.com',
  VITE_FIREBASE_PROJECT_ID: 'demo-kagaz-phase6c',
  VITE_FIREBASE_APP_ID: 'demo-web-app',
  VITE_FIREBASE_AUTH_EMULATOR_URL: 'http://127.0.0.1:9099',
  VITE_API_URL: 'http://127.0.0.1:4000',
};
const children = [];
function start(arguments_, cwd = process.cwd()) {
  const child = spawn(process.execPath, arguments_, {
    cwd,
    env: environment,
    stdio: 'inherit',
    windowsHide: true,
  });
  children.push(child);
  return child;
}
async function completed(child) {
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', resolve);
  });
  assert.equal(code, 0, 'Verification subprocess must succeed.');
}
async function ready(url) {
  for (let attempt = 0; attempt < 90; attempt += 1) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      /* Local server is starting. */
    }
    await delay(500);
  }
  throw new Error(`Local test server did not become ready: ${url}`);
}
try {
  await completed(
    start(
      [
        'node_modules/vitest/vitest.mjs',
        'run',
        'src/assistant/ledger.emulator.test.ts',
        '--maxWorkers=1',
      ],
      resolve('apps/api'),
    ),
  );
  start([
    '--import',
    './apps/api/node_modules/tsx/dist/loader.mjs',
    'scripts/phase6c-test-server.mjs',
  ]);
  await ready('http://127.0.0.1:4000/health');
  start(
    [
      'node_modules/vite/bin/vite.js',
      '--host',
      '127.0.0.1',
      '--port',
      '5173',
      '--strictPort',
    ],
    resolve('apps/web'),
  );
  await ready('http://127.0.0.1:5173');
  await completed(start(['scripts/verify-phase6c.mjs']));
} finally {
  for (const child of children)
    if (child.exitCode === null) child.kill('SIGTERM');
}
