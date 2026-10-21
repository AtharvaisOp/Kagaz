import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { AssistantLedger } from './ledger.js';
import type { LedgerStore, LedgerTransaction } from './ledger.js';
import { GROQ_FREE_PLAN_LIMITS } from './freePlan.js';

/** Serial copy-on-commit fake is only a unit-test seam; emulator tests exercise Firestore. */
class TestStore implements LedgerStore {
  readonly documents = new Map<string, unknown>();
  fail = false;
  private tail = Promise.resolve();
  async transaction<T>(
    operation: (transaction: LedgerTransaction) => Promise<T>,
  ): Promise<T> {
    const previous = this.tail;
    let release = () => {};
    this.tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      const changes = new Map<string, unknown>();
      const value = await operation({
        get: (path) =>
          Promise.resolve(structuredClone(this.documents.get(path))),
        set: (path, data) => {
          changes.set(path, structuredClone(data));
        },
      });
      if (this.fail) throw new Error('Firestore unavailable secret');
      for (const [path, data] of changes) this.documents.set(path, data);
      return value;
    } finally {
      release();
    }
  }
}

function hasErrorCode(value: unknown, code: string): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    'code' in value &&
    value.code === code
  );
}

function fixture(budget = 3_000_000) {
  const store = new TestStore();
  let clock = Date.parse('2026-10-18T12:00:00Z');
  const ledger = new AssistantLedger(store, budget, 6_530, () => clock);
  return {
    store,
    ledger,
    advance: (ms: number) => {
      clock += ms;
    },
    now: () => clock,
  };
}

function freeFixture(start = '2026-10-18T12:00:00Z') {
  const store = new TestStore();
  let clock = Date.parse(start);
  const ledger = new AssistantLedger(
    store,
    0,
    0,
    () => clock,
    GROQ_FREE_PLAN_LIMITS,
  );
  return {
    store,
    ledger,
    advance: (ms: number) => {
      clock += ms;
    },
    now: () => clock,
  };
}

describe('shared assistant accounting lifecycle', () => {
  it('permits one of six simultaneous attempts and cannot exceed five accepted attempts', async () => {
    const { ledger, advance } = fixture();
    const simultaneous = await Promise.allSettled(
      Array.from({ length: 6 }, () =>
        ledger.reserve('google-user', randomUUID()),
      ),
    );
    expect(
      simultaneous.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    const first = simultaneous.find((result) => result.status === 'fulfilled');
    if (first?.status !== 'fulfilled')
      throw new Error('No accepted reservation');
    await ledger.markDispatched(first.value);
    await ledger.settle(first.value, { billing: 'known', costMicroUsd: 100 });
    for (let index = 0; index < 4; index += 1) {
      advance(61_000);
      const reservation = await ledger.reserve('google-user', randomUUID());
      await ledger.markDispatched(reservation);
      await ledger.settle(reservation, { billing: 'known', costMicroUsd: 100 });
    }
    advance(61_000);
    await expect(
      ledger.reserve('google-user', randomUUID()),
    ).rejects.toMatchObject({ code: 'daily-limit' });
    expect(await ledger.usage('google-user')).toMatchObject({
      remaining: 0,
      dailyLimit: 5,
      active: false,
    });
  });

  it('enforces two attempts in a rolling minute, including refunded unbilled failures', async () => {
    const { ledger, advance } = fixture();
    for (let index = 0; index < 2; index += 1) {
      const reservation = await ledger.reserve('user', randomUUID());
      await ledger.settle(reservation, { billing: 'none' });
    }
    expect(await ledger.usage('user')).toMatchObject({
      remaining: 5,
      available: false,
      unavailableReason: 'Wait a minute before another AI generation.',
    });
    await expect(ledger.reserve('user', randomUUID())).rejects.toMatchObject({
      code: 'burst-limit',
    });
    advance(60_000);
    await expect(ledger.reserve('user', randomUUID())).resolves.toBeDefined();
  });

  it('shares persistent limits across instances and restarts while users remain independent', async () => {
    const { store, ledger, now } = fixture();
    const reservation = await ledger.reserve('one', randomUUID());
    const restarted = new AssistantLedger(store, 3_000_000, 6_530, now);
    await expect(restarted.reserve('one', randomUUID())).rejects.toMatchObject({
      code: 'generation-active',
    });
    await expect(restarted.reserve('two', randomUUID())).resolves.toBeDefined();
    await restarted.settle(reservation, { billing: 'uncertain' });
    expect(await ledger.usage('one')).toMatchObject({
      remaining: 4,
      active: true,
    });
  });

  it('atomically reserves a shared budget and reconciles the trustworthy cost', async () => {
    const { ledger } = fixture(13_060);
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, (_, index) =>
        ledger.reserve(`user-${index}`, randomUUID()),
      ),
    );
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(2);
    const accepted = results
      .filter((result) => result.status === 'fulfilled')
      .map((result) => result.value);
    const first = accepted[0];
    if (!first) throw new Error('Missing reservation');
    await ledger.settle(first, { billing: 'known', costMicroUsd: 100 });
    await expect(ledger.reserve('another', randomUUID())).rejects.toMatchObject(
      { code: 'budget-exhausted' },
    );
    const second = accepted[1];
    if (!second) throw new Error('Missing reservation');
    await ledger.settle(second, { billing: 'none' });
    await expect(
      ledger.reserve('another', randomUUID()),
    ).resolves.toBeDefined();
  });

  it('keeps permanent replay tombstones without persisting prompts or answers', async () => {
    const { ledger, store } = fixture();
    const requestId = randomUUID();
    const reservation = await ledger.reserve('user', requestId);
    await expect(ledger.reserve('user', requestId)).rejects.toMatchObject({
      code: 'request-replayed',
    });
    await ledger.settle(reservation, { billing: 'none' });
    await expect(ledger.reserve('user', requestId)).rejects.toMatchObject({
      code: 'request-replayed',
    });
    const persisted = JSON.stringify([...store.documents]);
    expect(persisted).not.toMatch(
      /question|passages|answer|transcript|google-user/,
    );
  });

  it('charges expired reservations conservatively and prevents late settlement from refunding', async () => {
    const { ledger, advance, store } = fixture();
    const reservation = await ledger.reserve('user', randomUUID());
    await ledger.markDispatched(reservation);
    advance(120_001);
    expect(await ledger.usage('user')).toMatchObject({
      remaining: 4,
      active: false,
    });
    expect(await ledger.settle(reservation, { billing: 'none' })).toBe(false);
    const budget = store.documents.get('assistantBudgets/2026-10-18');
    expect(budget).toEqual({ spentMicroUsd: 6_530, reservedMicroUsd: 0 });
    await expect(ledger.markDispatched(reservation)).rejects.toMatchObject({
      code: 'request-replayed',
    });
  });

  it('never transfers an old request or budget to the new UTC day', async () => {
    const { ledger, advance, store, now } = fixture();
    advance(Date.parse('2026-10-18T23:59:30Z') - now());
    const id = randomUUID();
    const old = await ledger.reserve('user', id);
    advance(31_000);
    expect(await ledger.usage('user')).toMatchObject({
      remaining: 5,
      active: true,
      resetAt: '2026-10-20T00:00:00.000Z',
    });
    await expect(ledger.reserve('user', id)).rejects.toMatchObject({
      code: 'request-replayed',
    });
    advance(90_000);
    const fresh = await ledger.reserve('user', randomUUID());
    expect(fresh.day).toBe('2026-10-19');
    expect(await ledger.settle(old, { billing: 'none' })).toBe(false);
    expect(store.documents.get('assistantBudgets/2026-10-18')).toEqual({
      spentMicroUsd: 6_530,
      reservedMicroUsd: 0,
    });
    expect(store.documents.get('assistantBudgets/2026-10-19')).toEqual({
      spentMicroUsd: 0,
      reservedMicroUsd: 6_530,
    });
  });

  it('cannot dispatch a previous-day reservation after the UTC reset', async () => {
    const { ledger, advance, now } = fixture();
    advance(Date.parse('2026-10-18T23:59:59Z') - now());
    const reservation = await ledger.reserve('user', randomUUID());
    advance(2_000);
    await expect(ledger.markDispatched(reservation)).rejects.toMatchObject({
      code: 'request-replayed',
    });
    await ledger.settle(reservation, { billing: 'none' });
    expect(await ledger.usage('user')).toMatchObject({
      remaining: 5,
      active: false,
    });
  });

  it('fails closed when committing a reservation fails', async () => {
    const { ledger, store } = fixture();
    store.fail = true;
    await expect(ledger.reserve('user', randomUUID())).rejects.toMatchObject({
      code: 'quota-unavailable',
    });
    expect(store.documents.size).toBe(0);
  });

  it('uses the maximum reservation when supplied actual accounting is unsafe', async () => {
    const { ledger, store } = fixture();
    const reservation = await ledger.reserve('user', randomUUID());
    await ledger.settle(reservation, {
      billing: 'known',
      costMicroUsd: 99_000,
    });
    expect(store.documents.get('assistantBudgets/2026-10-18')).toEqual({
      reservedMicroUsd: 0,
      spentMicroUsd: 6_530,
    });
    expect(await ledger.usage('user')).toMatchObject({ remaining: 4 });
  });

  it('retains an uncertain remote execution lease until expiry without charging twice', async () => {
    const { ledger, store, advance } = fixture();
    const reservation = await ledger.reserve('user', randomUUID());
    await ledger.markDispatched(reservation);
    await ledger.settle(reservation, { billing: 'uncertain' });
    await expect(ledger.reserve('user', randomUUID())).rejects.toMatchObject({
      code: 'generation-active',
    });
    expect(await ledger.usage('user')).toMatchObject({
      active: true,
      remaining: 4,
    });
    advance(120_001);
    expect(await ledger.usage('user')).toMatchObject({
      active: false,
      remaining: 4,
    });
    expect(store.documents.get('assistantBudgets/2026-10-18')).toEqual({
      reservedMicroUsd: 0,
      spentMicroUsd: 6_530,
    });
  });

  it('rejects corrupted persisted accounting and an expanded daily budget', async () => {
    const { ledger, store } = fixture();
    store.documents.set('assistantBudgets/2026-10-18', {
      reservedMicroUsd: -1,
      spentMicroUsd: 0,
    });
    await expect(ledger.reserve('user', randomUUID())).rejects.toMatchObject({
      code: 'quota-unavailable',
    });
    expect(() => new AssistantLedger(store, 3_000_001, 6_530)).toThrow(
      'Invalid assistant budget',
    );
  });
});

describe('shared Groq Free Plan limits', () => {
  it('distinguishes oversized context from temporary exhaustion without debiting usage', async () => {
    const { store, ledger } = freeFixture();
    await expect(
      ledger.reserve(
        'oversized',
        randomUUID(),
        GROQ_FREE_PLAN_LIMITS.maxTokensPerRequest + 1,
      ),
    ).rejects.toMatchObject({ code: 'context-too-large', status: 422 });
    expect(store.documents.size).toBe(0);
    expect(await ledger.usage('oversized')).toMatchObject({
      remaining: 5,
      available: true,
      active: false,
    });
    await expect(
      ledger.reserve('oversized', randomUUID(), 500),
    ).resolves.toBeDefined();
    expect(store.documents.get('assistantFreeUsage/2026-10-18')).toMatchObject({
      requests: 1,
      reservedTokens: 500,
      usedTokens: 0,
    });
  });
  it.each([undefined, 0, -1, 1.5, NaN])(
    'fails quota verification for invalid token estimate %s without accounting writes',
    async (tokens) => {
      const { store, ledger } = freeFixture();
      await expect(
        ledger.reserve('invalid-estimate', randomUUID(), tokens),
      ).rejects.toMatchObject({ code: 'quota-unavailable' });
      expect(store.documents.size).toBe(0);
    },
  );
  it('shares the request-per-minute cap atomically across users and instances at $0', async () => {
    const { store, ledger, now } = freeFixture();
    const secondInstance = new AssistantLedger(
      store,
      0,
      0,
      now,
      GROQ_FREE_PLAN_LIMITS,
    );
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, (_, index) =>
        (index % 2 ? ledger : secondInstance).reserve(
          `user-${index}`,
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
    expect(store.documents.get('assistantBudgets/2026-10-18')).toEqual({
      reservedMicroUsd: 0,
      spentMicroUsd: 0,
    });
    const usage = await secondInstance.usage('new-google-user');
    expect(usage.available).toBe(false);
    expect(usage.unavailableReason).toContain('Free Plan allowance');
  });

  it('enforces shared TPM with conservative token reservations and reconciles actual use', async () => {
    const { ledger } = freeFixture();
    const first = await ledger.reserve('one', randomUUID(), 2_500);
    const second = await ledger.reserve('two', randomUUID(), 2_500);
    await expect(
      ledger.reserve('three', randomUUID(), 2_000),
    ).rejects.toMatchObject({ code: 'free-limit-exhausted' });
    await ledger.markDispatched(first);
    await ledger.settle(first, {
      billing: 'known',
      costMicroUsd: 0,
      tokenCount: 100,
    });
    await expect(
      ledger.reserve('three', randomUUID(), 3_000),
    ).resolves.toBeDefined();
    await ledger.markDispatched(second);
    await ledger.settle(second, { billing: 'uncertain' });
  });

  it('enforces the shared daily token limit and does not refund dispatched 429-style uncertainty', async () => {
    const { ledger, advance } = freeFixture();
    for (let index = 0; index < 4; index += 1) {
      const reservation = await ledger.reserve(
        `user-${index}`,
        randomUUID(),
        5_000,
      );
      await ledger.markDispatched(reservation);
      await ledger.settle(reservation, { billing: 'uncertain' });
      advance(60_000);
    }
    await expect(ledger.reserve('next', randomUUID(), 1)).rejects.toMatchObject(
      { code: 'free-limit-exhausted' },
    );
  });

  it('enforces the shared daily request cap across rolling-minute windows', async () => {
    const { ledger, advance } = freeFixture();
    for (
      let index = 0;
      index < GROQ_FREE_PLAN_LIMITS.requestsPerDay;
      index += 1
    ) {
      if (index > 0 && index % GROQ_FREE_PLAN_LIMITS.requestsPerMinute === 0)
        advance(60_000);
      const reservation = await ledger.reserve(
        `user-${index}`,
        randomUUID(),
        100,
      );
      await ledger.markDispatched(reservation);
      await ledger.settle(reservation, {
        billing: 'known',
        costMicroUsd: 0,
        tokenCount: 100,
      });
    }
    await expect(
      ledger.reserve('one-more', randomUUID(), 100),
    ).rejects.toMatchObject({ code: 'free-limit-exhausted' });
  });

  it('keeps the shared rolling-minute limit across the UTC daily reset', async () => {
    const { ledger, advance } = freeFixture('2026-10-18T23:59:59Z');
    for (
      let index = 0;
      index < GROQ_FREE_PLAN_LIMITS.requestsPerMinute;
      index += 1
    )
      await ledger.reserve(`before-midnight-${index}`, randomUUID(), 100);
    advance(1_000);
    await expect(
      ledger.reserve('after-midnight', randomUUID(), 100),
    ).rejects.toMatchObject({ code: 'free-limit-exhausted' });
  });

  it('rolls back a reserved but undispatched request without opening a paid budget', async () => {
    const { ledger, store } = freeFixture();
    const reservation = await ledger.reserve('cancelled', randomUUID(), 1_000);
    await ledger.settle(reservation, { billing: 'none' });
    await expect(
      ledger.reserve('next', randomUUID(), 1_000),
    ).resolves.toBeDefined();
    expect(store.documents.get('assistantFreeUsage/2026-10-18')).toMatchObject({
      requests: 1,
      reservedTokens: 1_000,
      usedTokens: 0,
    });
    expect(store.documents.get('assistantBudgets/2026-10-18')).toEqual({
      reservedMicroUsd: 0,
      spentMicroUsd: 0,
    });
  });
});
