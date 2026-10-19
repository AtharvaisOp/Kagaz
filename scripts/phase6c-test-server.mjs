// Test-only executable. It uses real Firebase emulators and a deterministic
// provider; production API code has no mock-provider switch or control endpoint.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
import { createApp } from '../apps/api/src/app.ts';
import { FirebaseGoogleAuthenticator } from '../apps/api/src/assistant/auth.ts';
import {
  AssistantLedger,
  FirestoreLedgerStore,
} from '../apps/api/src/assistant/ledger.ts';
import { AssistantService } from '../apps/api/src/assistant/service.ts';
import { GROQ_RESERVATION_MICRO_USD } from '../apps/api/src/assistant/groq.ts';

const require = createRequire(
  new URL('../apps/api/package.json', import.meta.url),
);
const express = require('express');
const { initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');
const projectId = 'demo-kagaz-phase6c';
assert.equal(process.env.GCLOUD_PROJECT, projectId);
assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, '127.0.0.1:9099');
assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8080');
assert.notEqual(process.env.NODE_ENV, 'production');
assert(
  !process.env.GROQ_API_KEY,
  'Never provide a real key to the mock harness.',
);
const firebase = initializeApp({ projectId }, 'phase6c-browser-tests');
const firestore = getFirestore(firebase);
let calls = 0;
let delayMs = 0;
let failure = false;
let enabled = true;
const provider = {
  async generate(context, signal) {
    calls += 1;
    if (delayMs) await delay(delayMs, undefined, { signal });
    if (failure) throw new Error('Deterministic provider failure.');
    return {
      answer: {
        status: 'answered',
        text: 'The selected passage states that payment is due within 30 days.',
        citations: [context.passages[0].passageId],
      },
      usage: { inputTokens: 300, outputTokens: 35 },
    };
  },
};
const options = {
  auth: new FirebaseGoogleAuthenticator(getAuth(firebase), projectId),
  ledger: new AssistantLedger(
    new FirestoreLedgerStore(firestore),
    3_000_000,
    GROQ_RESERVATION_MICRO_USD,
  ),
  provider,
  enabled,
  unavailableReason: 'AI Chat is disabled by the test owner.',
  allowLocalHttp: true,
};
const app = express();
app.use('/__test__', express.json({ limit: '2kb' }));
app.post('/__test__/control', (request, response) => {
  delayMs = Math.min(30_000, Math.max(0, Number(request.body.delayMs ?? 0)));
  failure = request.body.failure === true;
  enabled = request.body.enabled !== false;
  options.enabled = enabled;
  response.json({ calls, enabled });
});
app.get('/__test__/status', (_request, response) =>
  response.json({ calls, enabled }),
);
app.use(
  createApp(
    ['http://127.0.0.1:5173', 'http://localhost:5173'],
    undefined,
    new AssistantService(options),
  ),
);
const server = app.listen(4000, '127.0.0.1', () =>
  console.log('Phase 6C emulator API ready.'),
);
for (const signal of ['SIGTERM', 'SIGINT'])
  process.on(signal, () => server.close(() => process.exit(0)));
