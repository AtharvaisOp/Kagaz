import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { AssistantLedger } from './ledger.js';
import type { LedgerStore, LedgerTransaction } from './ledger.js';

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
