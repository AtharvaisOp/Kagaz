import { randomUUID } from 'node:crypto';
import { deleteApp, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  AssistantLedger,
  FirestoreLedgerStore,
  userLedgerKey,
} from './ledger.js';
import { FirebaseGoogleAuthenticator } from './auth.js';
import { AssistantService } from './service.js';
import { GROQ_FREE_PLAN_LIMITS } from './freePlan.js';

const enabled = Boolean(
  process.env.FIRESTORE_EMULATOR_HOST &&
  process.env.FIREBASE_AUTH_EMULATOR_HOST,
);
const suite = describe.skipIf(!enabled);
function hasErrorCode(value: unknown, code: string): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    'code' in value &&
    value.code === code
  );
}

suite(
  'actual Firebase emulators: shared transaction authority and Google identity',
  () => {
    const projectId = process.env.GCLOUD_PROJECT ?? 'demo-kagaz-phase6c';
    if (!projectId.startsWith('demo-'))
      throw new Error('Emulator tests require a demo Firebase project.');
    const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST;
    const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
    if (
      enabled &&
      (!firestoreHost?.startsWith('127.0.0.1:') ||
        !authHost?.startsWith('127.0.0.1:'))
    )
      throw new Error('Emulator tests require loopback services.');
    const app = initializeApp(
      { projectId },
      `assistant-emulator-${randomUUID()}`,
    );
    const firestore = getFirestore(app);
    const auth = getAuth(app);
    async function googleIdentity() {
      const subject = `google-${randomUUID()}`;
      const signIn = await fetch(
        `http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=demo-key`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            postBody: `providerId=google.com&id_token=${encodeURIComponent(JSON.stringify({ sub: subject, email: `${subject}@example.test`, email_verified: true }))}`,
            requestUri: 'http://localhost',
            returnSecureToken: true,
          }),
        },
      );
      expect(signIn.status).toBe(200);
      const response: unknown = await signIn.json();
      if (
        typeof response !== 'object' ||
        response === null ||
        !('idToken' in response) ||
        typeof response.idToken !== 'string'
      )
        throw new Error('Emulator Google sign-in failed');
      const identity = await new FirebaseGoogleAuthenticator(
        auth,
        projectId,
      ).authenticate(`Bearer ${response.idToken}`);
      return { uid: identity.uid, token: response.idToken };
    }
    beforeAll(async () => {
      const reset = await fetch(
        `http://${firestoreHost}/emulator/v1/projects/${projectId}/databases/(default)/documents`,
        { method: 'DELETE' },
      );
      expect(reset.status).toBe(200);
    });
    let fixtureIndex = 0;
    function fixture(budget = 3_000_000) {
      let clock =
        Date.parse('2031-01-01T12:00:00Z') + fixtureIndex++ * 86_400_000;
      const uid = `emulator-${randomUUID()}`;
      const store = new FirestoreLedgerStore(firestore);
      const ledger = new AssistantLedger(store, budget, 6_530, () => clock);
      return {
        uid,
        ledger,
        store,
        now: () => clock,
        advance: (ms: number) => {
          clock += ms;
        },
      };
    }
    afterAll(async () => {
      await deleteApp(app);
    });

    it('accepts only one of six simultaneous requests across backend instances', async () => {
      const { uid, ledger, store, now } = fixture();
      const secondInstance = new AssistantLedger(store, 3_000_000, 6_530, now);
      const results = await Promise.allSettled(
        Array.from({ length: 6 }, (_, index) =>
          (index % 2 ? ledger : secondInstance).reserve(uid, randomUUID()),
        ),
      );
      expect(
        results.filter((result) => result.status === 'fulfilled'),
      ).toHaveLength(1);
      expect(
        results.filter((result) => result.status === 'rejected'),
      ).toHaveLength(5);
      expect(await secondInstance.usage(uid)).toMatchObject({
        remaining: 4,
        active: true,
      });
    }, 20_000);

    it('keeps exactly five daily attempts across restarts and separate user limits', async () => {
      const { uid, store, now, advance } = fixture();
      for (let index = 0; index < 5; index += 1) {
        const restarted = new AssistantLedger(store, 3_000_000, 6_530, now);
        const reservation = await restarted.reserve(uid, randomUUID());
        await restarted.markDispatched(reservation);
        await restarted.settle(reservation, {
          billing: 'known',
          costMicroUsd: 100,
        });
        advance(61_000);
      }
      const restarted = new AssistantLedger(store, 3_000_000, 6_530, now);
      await expect(restarted.reserve(uid, randomUUID())).rejects.toMatchObject({
        code: 'daily-limit',
      });
      expect(await restarted.usage(uid)).toMatchObject({ remaining: 0 });
      expect(await restarted.usage(`${uid}-other`)).toMatchObject({
        remaining: 5,
      });
      await expect(
        restarted.reserve(`${uid}-other`, randomUUID()),
      ).resolves.toBeDefined();
    });

    it('atomically prevents multiple users from exceeding the application budget', async () => {
      const { uid, ledger } = fixture(13_060);
      const results = await Promise.allSettled(
        Array.from({ length: 8 }, (_, index) =>
          ledger.reserve(`${uid}-${index}`, randomUUID()),
        ),
      );
      expect(
        results.filter((result) => result.status === 'fulfilled'),
      ).toHaveLength(2);
      expect(
        results.filter((result) => result.status === 'rejected'),
      ).toHaveLength(6);
    });

    it('enforces a shared $0 Free Plan request cap across Firestore-backed instances', async () => {
      const { uid, store, now } = fixture(0);
      const firstInstance = new AssistantLedger(
        store,
        0,
        0,
        now,
        GROQ_FREE_PLAN_LIMITS,
      );
      const secondInstance = new AssistantLedger(
        store,
        0,
        0,
        now,
        GROQ_FREE_PLAN_LIMITS,
      );
      const results = await Promise.allSettled(
        Array.from({ length: 8 }, (_, index) =>
          (index % 2 ? firstInstance : secondInstance).reserve(
            `${uid}-${index}`,
            randomUUID(),
            500,
          ),
        ),
      );
      expect(
        results.filter((result) => result.status === 'fulfilled'),
      ).toHaveLength(GROQ_FREE_PLAN_LIMITS.requestsPerMinute);
      expect(
        results.filter(
          (result) =>
            result.status === 'rejected' &&
            hasErrorCode(result.reason, 'free-limit-exhausted'),
        ),
      ).toHaveLength(3);
    }, 20_000);

    it('enforces the rolling two-per-minute limit in Firestore', async () => {
      const { uid, ledger, advance } = fixture();
      for (let index = 0; index < 2; index += 1) {
        const reservation = await ledger.reserve(uid, randomUUID());
        await ledger.settle(reservation, {
          billing: 'known',
          costMicroUsd: 100,
        });
      }
      await expect(ledger.reserve(uid, randomUUID())).rejects.toMatchObject({
        code: 'burst-limit',
      });
      advance(60_000);
      await expect(ledger.reserve(uid, randomUUID())).resolves.toBeDefined();
    });

    it('persists replay protection without storing document or generated content', async () => {
      const { uid, ledger } = fixture();
      const id = randomUUID();
      const reservation = await ledger.reserve(uid, id);
      await ledger.markDispatched(reservation);
      await ledger.settle(reservation, { billing: 'uncertain' });
      await expect(ledger.reserve(uid, id)).rejects.toMatchObject({
        code: 'request-replayed',
      });
      const record = (
        await firestore
          .doc(`assistantRequests/${userLedgerKey(uid)}_${id}`)
          .get()
      ).data();
      expect(record).toMatchObject({
        state: 'uncertain',
        chargedMicroUsd: 6_530,
      });
      expect(record?.updatedAt).toBeDefined();
      expect(Object.keys(record ?? {}).sort()).toEqual([
        'chargedMicroUsd',
        'day',
        'expiresAtMs',
        'reservedMicroUsd',
        'state',
        'updatedAt',
      ]);
    });

    it('executes the provider once when an identical complete service request is replayed', async () => {
      const { uid, ledger, now } = fixture();
      const passageText = 'Payment is due in 30 days.';
      let calls = 0;
      const service = new AssistantService({
        ledger,
        enabled: true,
        unavailableReason: '',
        now,
        provider: {
          generate: () => {
            calls += 1;
            return Promise.resolve({
              answer: {
                status: 'answered',
                text: 'Payment is due in 30 days.',
                citations: ['passage-1'],
              },
              usage: { inputTokens: 100, outputTokens: 20 },
            });
          },
        },
      });
      const request = {
        requestId: randomUUID(),
        consent: { approved: true, reviewedAt: new Date(now()).toISOString() },
        context: {
          question: 'When is payment due?',
          selectedPassageIds: ['passage-1'],
          passages: [
            {
              passageId: 'passage-1',
              text: passageText,
              citation: { workspacePageId: 'page-1', pageNumber: 1 },
            },
          ],
          contextCharacters: passageText.length,
          documentTextTrust: 'untrusted_document_data',
          privacyDisclosure: 'Only reviewed passages are shared.',
        },
      };
      await expect(
        service.answer(uid, request, new AbortController().signal),
      ).resolves.toMatchObject({ requestId: request.requestId });
      await expect(
        service.answer(uid, request, new AbortController().signal),
      ).rejects.toMatchObject({ code: 'request-replayed' });
      expect(calls).toBe(1);
    });

    it('settles expiration across midnight against the original day and never resurrects it', async () => {
      const { uid, ledger, advance, now } = fixture();
      advance(11 * 3_600_000 + 59 * 60_000 + 30_000);
      const originalDay = new Date(now()).toISOString().slice(0, 10);
      const id = randomUUID();
      const reservation = await ledger.reserve(uid, id);
      advance(121_000);
      expect(await ledger.usage(uid)).toMatchObject({
        remaining: 5,
        active: false,
      });
      await expect(ledger.reserve(uid, id)).rejects.toMatchObject({
        code: 'request-replayed',
      });
      expect(await ledger.settle(reservation, { billing: 'none' })).toBe(false);
      expect(
        (await firestore.doc(`assistantBudgets/${originalDay}`).get()).data(),
      ).toMatchObject({ reservedMicroUsd: 0, spentMicroUsd: 6_530 });
      await expect(ledger.reserve(uid, randomUUID())).resolves.toBeDefined();
    });

    it('cannot dispatch a reservation first accepted before the UTC day reset', async () => {
      const { uid, ledger, advance } = fixture();
      advance(11 * 3_600_000 + 59 * 60_000 + 59_000);
      const reservation = await ledger.reserve(uid, randomUUID());
      advance(2_000);
      await expect(ledger.markDispatched(reservation)).rejects.toMatchObject({
        code: 'request-replayed',
      });
      await ledger.settle(reservation, { billing: 'none' });
      expect(await ledger.usage(uid)).toMatchObject({
        remaining: 5,
        active: false,
      });
    });

    it('holds uncertain remote work until expiry and charges it exactly once', async () => {
      const { uid, ledger, now, advance } = fixture();
      const day = new Date(now()).toISOString().slice(0, 10);
      const reservation = await ledger.reserve(uid, randomUUID());
      await ledger.markDispatched(reservation);
      await ledger.settle(reservation, { billing: 'uncertain' });
      await expect(ledger.reserve(uid, randomUUID())).rejects.toMatchObject({
        code: 'generation-active',
      });
      advance(120_001);
      expect(await ledger.usage(uid)).toMatchObject({
        active: false,
        remaining: 4,
      });
      expect(
        (await firestore.doc(`assistantBudgets/${day}`).get()).data(),
      ).toMatchObject({ spentMicroUsd: 6_530, reservedMicroUsd: 0 });
    });

    it('denies all unauthenticated client quota reads and writes through Firestore rules', async () => {
      const host = process.env.FIRESTORE_EMULATOR_HOST;
      const url = `http://${host}/v1/projects/${projectId}/databases/(default)/documents/assistantBudgets/client-forgery-${randomUUID()}`;
      const write = await fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fields: { spentMicroUsd: { integerValue: '0' } },
        }),
      });
      expect(write.status).toBe(403);
      expect((await fetch(url)).status).toBe(403);
    });

    it('denies authenticated Google clients every quota read, list, create, update and delete', async () => {
      const identity = await googleIdentity();
      const key = userLedgerKey(identity.uid);
      const base = `http://${firestoreHost}/v1/projects/${projectId}/databases/(default)/documents`;
      const headers = {
        Authorization: `Bearer ${identity.token}`,
        'Content-Type': 'application/json',
      };
      const paths = [
        `assistantUsers/${key}`,
        `assistantUserDays/${key}_2050-01-01`,
        `assistantUserDays/${userLedgerKey(`other-${randomUUID()}`)}_2050-01-01`,
        'assistantBudgets/2050-01-01',
        `assistantRequests/${key}_${randomUUID()}`,
      ];
      for (const path of paths) {
        await firestore.doc(path).set({ attempts: 0 });
        const collection = path.split('/')[0];
        expect((await fetch(`${base}/${path}`, { headers })).status).toBe(403);
        expect((await fetch(`${base}/${collection}`, { headers })).status).toBe(
          403,
        );
        expect(
          (
            await fetch(
              `${base}/${collection}?documentId=forged-${randomUUID()}`,
              {
                method: 'POST',
                headers,
                body: JSON.stringify({
                  fields: { attempts: { integerValue: '0' } },
                }),
              },
            )
          ).status,
        ).toBe(403);
        expect(
          (
            await fetch(`${base}/${path}`, {
              method: 'PATCH',
              headers,
              body: JSON.stringify({
                fields: { attempts: { integerValue: '0' } },
              }),
            })
          ).status,
        ).toBe(403);
        expect(
          (await fetch(`${base}/${path}`, { method: 'DELETE', headers }))
            .status,
        ).toBe(403);
      }
    }, 15_000);

    it('verifies actual emulator Google ID tokens and rejects anonymous or disabled users', async () => {
      const host = process.env.FIREBASE_AUTH_EMULATOR_HOST;
      const subject = `google-${randomUUID()}`;
      const signIn = await fetch(
        `http://${host}/identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=demo-key`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            postBody: `providerId=google.com&id_token=${encodeURIComponent(JSON.stringify({ sub: subject, email: `${subject}@example.test`, email_verified: true }))}`,
            requestUri: 'http://localhost',
            returnSecureToken: true,
          }),
        },
      );
      expect(signIn.status).toBe(200);
      const response: unknown = await signIn.json();
      if (
        typeof response !== 'object' ||
        response === null ||
        !('idToken' in response) ||
        typeof response.idToken !== 'string'
      )
        throw new Error('Emulator sign-in failed');
      const authenticator = new FirebaseGoogleAuthenticator(auth, projectId);
      const identity = await authenticator.authenticate(
        `Bearer ${response.idToken}`,
      );
      expect(identity.uid).toBeTruthy();
      await auth.updateUser(identity.uid, { disabled: true });
      await expect(
        authenticator.authenticate(`Bearer ${response.idToken}`),
      ).rejects.toMatchObject({ code: 'invalid-authentication' });

      const anonymous = await fetch(
        `http://${host}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-key`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ returnSecureToken: true }),
        },
      );
      const anonymousValue: unknown = await anonymous.json();
      if (
        typeof anonymousValue !== 'object' ||
        anonymousValue === null ||
        !('idToken' in anonymousValue) ||
        typeof anonymousValue.idToken !== 'string'
      )
        throw new Error('Anonymous emulator sign-in failed');
      await expect(
        authenticator.authenticate(`Bearer ${anonymousValue.idToken}`),
      ).rejects.toMatchObject({ code: 'google-sign-in-required' });
    });
  },
);
