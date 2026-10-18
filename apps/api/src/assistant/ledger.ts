import { createHash } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import type { Firestore } from 'firebase-admin/firestore';
import type { AssistantUsageStatus } from '@kagaz/shared-types';
import { AssistantError, quotaUnavailable } from './errors.js';

export interface LedgerTransaction {
  get(path: string): Promise<unknown>;
  set(path: string, data: Record<string, unknown>): void;
}
export interface LedgerStore {
  transaction<T>(
    operation: (transaction: LedgerTransaction) => Promise<T>,
  ): Promise<T>;
}

/** This is the production authority: Firestore retries and commits atomically across instances. */
export class FirestoreLedgerStore implements LedgerStore {
  constructor(private readonly firestore: Firestore) {}
  transaction<T>(
    operation: (transaction: LedgerTransaction) => Promise<T>,
  ): Promise<T> {
    return this.firestore.runTransaction((transaction) =>
      operation({
        get: async (path) =>
          (await transaction.get(this.firestore.doc(path))).data(),
        set: (path, data) => {
          transaction.set(this.firestore.doc(path), {
            ...data,
            updatedAt: FieldValue.serverTimestamp(),
          });
        },
      }),
    );
  }
}

interface UserRecord {
  readonly active: {
    readonly requestId: string;
    readonly day: string;
    readonly expiresAtMs: number;
  } | null;
  readonly recentAttemptsMs: readonly number[];
}
interface DayRecord {
  readonly attempts: number;
}
interface BudgetRecord {
  readonly reservedMicroUsd: number;
  readonly spentMicroUsd: number;
}
type RequestState =
  'reserved' | 'dispatching' | 'completed' | 'failed' | 'uncertain' | 'expired';
interface RequestRecord {
  readonly day: string;
  readonly state: RequestState;
  readonly expiresAtMs: number;
  readonly reservedMicroUsd: number;
  readonly chargedMicroUsd: number;
}
export interface AssistantReservation {
  readonly userKey: string;
  readonly requestId: string;
  readonly day: string;
  readonly expiresAtMs: number;
  readonly reservedMicroUsd: number;
}
export type Settlement =
  | { readonly billing: 'none' | 'uncertain' }
  | { readonly billing: 'known'; readonly costMicroUsd: number };

const USER_LIMIT = 5;
const LEASE_MS = 120_000;
const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const REQUEST_STATES = new Set<RequestState>([
  'reserved',
  'dispatching',
  'completed',
  'failed',
  'uncertain',
  'expired',
]);
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function integer(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
function dayRecord(value: unknown): DayRecord {
  if (value === undefined) return { attempts: 0 };
  if (!record(value) || !integer(value.attempts) || value.attempts > USER_LIMIT)
    throw quotaUnavailable();
  return { attempts: value.attempts };
}
function budgetRecord(value: unknown): BudgetRecord {
  if (value === undefined) return { reservedMicroUsd: 0, spentMicroUsd: 0 };
  if (
    !record(value) ||
    !integer(value.reservedMicroUsd) ||
    !integer(value.spentMicroUsd)
  )
    throw quotaUnavailable();
  return {
    reservedMicroUsd: value.reservedMicroUsd,
    spentMicroUsd: value.spentMicroUsd,
  };
}
function userRecord(value: unknown): UserRecord {
  if (value === undefined) return { active: null, recentAttemptsMs: [] };
  if (
    !record(value) ||
    !Array.isArray(value.recentAttemptsMs) ||
    value.recentAttemptsMs.length > 2 ||
    !value.recentAttemptsMs.every(integer)
  )
    throw quotaUnavailable();
  if (value.active === null)
    return { active: null, recentAttemptsMs: value.recentAttemptsMs };
  const active = value.active;
  if (
    !record(active) ||
    typeof active.requestId !== 'string' ||
    typeof active.day !== 'string' ||
    !DAY_PATTERN.test(active.day) ||
    !integer(active.expiresAtMs)
  )
    throw quotaUnavailable();
  return {
    active: {
      requestId: active.requestId,
      day: active.day,
      expiresAtMs: active.expiresAtMs,
    },
    recentAttemptsMs: value.recentAttemptsMs,
  };
}
function requestRecord(value: unknown): RequestRecord | undefined {
  if (value === undefined) return undefined;
  if (
    !record(value) ||
    typeof value.day !== 'string' ||
    !DAY_PATTERN.test(value.day) ||
    typeof value.state !== 'string' ||
    !REQUEST_STATES.has(value.state as RequestState) ||
    !integer(value.expiresAtMs) ||
    !integer(value.reservedMicroUsd) ||
    !integer(value.chargedMicroUsd)
  )
    throw quotaUnavailable();
  return {
    day: value.day,
    state: value.state as RequestState,
    expiresAtMs: value.expiresAtMs,
    reservedMicroUsd: value.reservedMicroUsd,
    chargedMicroUsd: value.chargedMicroUsd,
  };
}
export function utcDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}
export function userLedgerKey(uid: string): string {
  return createHash('sha256').update(uid).digest('hex');
}
const userPath = (key: string) => `assistantUsers/${key}`;
const dayPath = (key: string, day: string) => `assistantUserDays/${key}_${day}`;
const budgetPath = (day: string) => `assistantBudgets/${day}`;
const requestPath = (key: string, requestId: string) =>
  `assistantRequests/${key}_${requestId}`;

export class AssistantLedger {
  constructor(
    private readonly store: LedgerStore,
    private readonly budgetMicroUsd: number,
    private readonly reserveMicroUsd: number,
    private readonly now: () => number = Date.now,
  ) {
    if (
      !integer(budgetMicroUsd) ||
      budgetMicroUsd > 3_000_000 ||
      !integer(reserveMicroUsd) ||
      reserveMicroUsd === 0
    )
      throw new Error('Invalid assistant budget.');
  }

  private async transaction<T>(
    operation: (transaction: LedgerTransaction) => Promise<T>,
  ): Promise<T> {
    try {
      return await this.store.transaction(operation);
    } catch (error) {
      if (error instanceof AssistantError) throw error;
      throw quotaUnavailable();
    }
  }

  /** An expired lease is always charged at its maximum. No worker can revive it. */
  private expire(
    transaction: LedgerTransaction,
    key: string,
    user: UserRecord,
    oldRequest: RequestRecord | undefined,
    oldBudget: BudgetRecord,
  ): UserRecord {
    if (!user.active || !oldRequest || oldRequest.day !== user.active.day)
      throw quotaUnavailable();
    if (oldRequest.state === 'uncertain') {
      // Unknown billing was already charged at maximum, but its remote execution
      // may outlive HTTP cancellation. Retain the user lease until this expiry.
      transaction.set(requestPath(key, user.active.requestId), {
        ...oldRequest,
        state: 'expired',
      });
      return { ...user, active: null };
    }
    if (oldRequest.state !== 'reserved' && oldRequest.state !== 'dispatching')
      throw quotaUnavailable();
    if (oldBudget.reservedMicroUsd < oldRequest.reservedMicroUsd)
      throw quotaUnavailable();
    transaction.set(budgetPath(oldRequest.day), {
      reservedMicroUsd:
        oldBudget.reservedMicroUsd - oldRequest.reservedMicroUsd,
      spentMicroUsd: oldBudget.spentMicroUsd + oldRequest.reservedMicroUsd,
    });
    transaction.set(requestPath(key, user.active.requestId), {
      ...oldRequest,
      state: 'expired',
      chargedMicroUsd: oldRequest.reservedMicroUsd,
    });
    return { ...user, active: null };
  }

  async reserve(uid: string, requestId: string): Promise<AssistantReservation> {
    const now = this.now(),
      day = utcDay(now),
      key = userLedgerKey(uid);
    return this.transaction(async (transaction) => {
      const [rawUser, rawDay, rawBudget, rawRequest] = await Promise.all([
        transaction.get(userPath(key)),
        transaction.get(dayPath(key, day)),
        transaction.get(budgetPath(day)),
        transaction.get(requestPath(key, requestId)),
      ]);
      let user = userRecord(rawUser);
      const daily = dayRecord(rawDay);
      let budget = budgetRecord(rawBudget);
      // Permanent tombstones deliberately have no TTL: midnight cannot replay a request.
      if (rawRequest !== undefined)
        throw new AssistantError(
          'request-replayed',
          409,
          'This request was already accepted. Review again to make a new request.',
        );
      if (user.active) {
        if (user.active.expiresAtMs > now)
          throw new AssistantError(
            'generation-active',
            409,
            'A generation is already active for this account.',
          );
        const oldRequest = requestRecord(
          await transaction.get(requestPath(key, user.active.requestId)),
        );
        const oldBudget =
          user.active.day === day
            ? budget
            : budgetRecord(await transaction.get(budgetPath(user.active.day)));
        user = this.expire(transaction, key, user, oldRequest, oldBudget);
        if (oldRequest?.day === day && oldRequest.state !== 'uncertain')
          budget = {
            reservedMicroUsd:
              budget.reservedMicroUsd - oldRequest.reservedMicroUsd,
            spentMicroUsd: budget.spentMicroUsd + oldRequest.reservedMicroUsd,
          };
      }
      if (daily.attempts >= USER_LIMIT)
        throw new AssistantError(
          'daily-limit',
          429,
          'The five daily AI generations have been used. Try after the UTC reset.',
        );
      const recent = user.recentAttemptsMs.filter(
        (time) => time > now - MINUTE_MS,
      );
      if (recent.length >= 2)
        throw new AssistantError(
          'burst-limit',
          429,
          'Wait a minute before another AI generation.',
        );
      if (
        budget.spentMicroUsd + budget.reservedMicroUsd + this.reserveMicroUsd >
        this.budgetMicroUsd
      )
        throw new AssistantError(
          'budget-exhausted',
          429,
          'Kagaz’s shared daily AI budget is unavailable. Try after the UTC reset.',
        );
      const expiresAtMs = now + LEASE_MS;
      transaction.set(userPath(key), {
        active: { requestId, day, expiresAtMs },
        recentAttemptsMs: [...recent, now],
      });
      transaction.set(dayPath(key, day), { attempts: daily.attempts + 1 });
      transaction.set(budgetPath(day), {
        ...budget,
        reservedMicroUsd: budget.reservedMicroUsd + this.reserveMicroUsd,
      });
      transaction.set(requestPath(key, requestId), {
        day,
        state: 'reserved',
        expiresAtMs,
        reservedMicroUsd: this.reserveMicroUsd,
        chargedMicroUsd: 0,
      });
      return {
        userKey: key,
        requestId,
        day,
        expiresAtMs,
        reservedMicroUsd: this.reserveMicroUsd,
      };
    });
  }

  async markDispatched(reservation: AssistantReservation): Promise<void> {
    await this.transaction(async (transaction) => {
      const request = requestRecord(
        await transaction.get(
          requestPath(reservation.userKey, reservation.requestId),
        ),
      );
      if (
        !request ||
        request.state !== 'reserved' ||
        request.expiresAtMs <= this.now() ||
        request.day !== reservation.day ||
        request.day !== utcDay(this.now())
      )
        throw new AssistantError(
          'request-replayed',
          409,
          'The generation reservation expired or crossed the UTC reset. Review again.',
        );
      transaction.set(requestPath(reservation.userKey, reservation.requestId), {
        ...request,
        state: 'dispatching',
      });
    });
  }

  async settle(
    reservation: AssistantReservation,
    settlement: Settlement,
  ): Promise<boolean> {
    return this.transaction(async (transaction) => {
      const key = reservation.userKey;
      const [rawRequest, rawUser, rawDay, rawBudget] = await Promise.all([
        transaction.get(requestPath(key, reservation.requestId)),
        transaction.get(userPath(key)),
        transaction.get(dayPath(key, reservation.day)),
        transaction.get(budgetPath(reservation.day)),
      ]);
      const request = requestRecord(rawRequest),
        user = userRecord(rawUser),
        daily = dayRecord(rawDay),
        budget = budgetRecord(rawBudget);
      if (
        !request ||
        (request.state !== 'reserved' && request.state !== 'dispatching')
      )
        return false;
      if (
        request.day !== reservation.day ||
        budget.reservedMicroUsd < request.reservedMicroUsd ||
        daily.attempts < 1
      )
        throw quotaUnavailable();
      const expired = request.expiresAtMs <= this.now();
      const noBilling = !expired && settlement.billing === 'none';
      const known =
        !expired &&
        settlement.billing === 'known' &&
        integer(settlement.costMicroUsd) &&
        settlement.costMicroUsd <= request.reservedMicroUsd;
      const chargedMicroUsd = noBilling
        ? 0
        : known
          ? settlement.costMicroUsd
          : request.reservedMicroUsd;
      transaction.set(budgetPath(request.day), {
        reservedMicroUsd: budget.reservedMicroUsd - request.reservedMicroUsd,
        spentMicroUsd: budget.spentMicroUsd + chargedMicroUsd,
      });
      transaction.set(requestPath(key, reservation.requestId), {
        ...request,
        state: expired
          ? 'expired'
          : noBilling
            ? 'failed'
            : known
              ? 'completed'
              : 'uncertain',
        chargedMicroUsd,
      });
      if (noBilling)
        transaction.set(dayPath(key, request.day), {
          attempts: daily.attempts - 1,
        });
      if (
        user.active?.requestId === reservation.requestId &&
        (expired || noBilling || known)
      )
        transaction.set(userPath(key), { ...user, active: null });
      return !expired;
    });
  }

  async usage(uid: string): Promise<AssistantUsageStatus> {
    const now = this.now(),
      day = utcDay(now),
      key = userLedgerKey(uid);
    return this.transaction(async (transaction) => {
      const [rawUser, rawDay, rawBudget] = await Promise.all([
        transaction.get(userPath(key)),
        transaction.get(dayPath(key, day)),
        transaction.get(budgetPath(day)),
      ]);
      let user = userRecord(rawUser);
      const daily = dayRecord(rawDay),
        budget = budgetRecord(rawBudget);
      if (user.active && user.active.expiresAtMs <= now) {
        const oldRequest = requestRecord(
          await transaction.get(requestPath(key, user.active.requestId)),
        );
        const oldBudget =
          user.active.day === day
            ? budget
            : budgetRecord(await transaction.get(budgetPath(user.active.day)));
        user = this.expire(transaction, key, user, oldRequest, oldBudget);
        transaction.set(userPath(key), { ...user });
      }
      const remaining = Math.max(0, USER_LIMIT - daily.attempts);
      const active = user.active !== null;
      const burstAvailable =
        user.recentAttemptsMs.filter((time) => time > now - MINUTE_MS).length <
        2;
      const budgetAvailable =
        budget.reservedMicroUsd + budget.spentMicroUsd + this.reserveMicroUsd <=
        this.budgetMicroUsd;
      const unavailableReason = active
        ? 'A generation is already active.'
        : remaining === 0
          ? 'The five daily AI generations have been used.'
          : !burstAvailable
            ? 'Wait a minute before another AI generation.'
            : !budgetAvailable
              ? 'The shared daily AI budget is unavailable.'
              : undefined;
      return {
        dailyLimit: 5,
        remaining,
        resetAt: new Date(
          (Math.floor(now / DAY_MS) + 1) * DAY_MS,
        ).toISOString(),
        available: !unavailableReason,
        ...(unavailableReason ? { unavailableReason } : {}),
        active,
      };
    });
  }
}
