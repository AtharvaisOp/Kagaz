import { createHash } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import type { Firestore } from 'firebase-admin/firestore';
import type { AssistantUsageStatus } from '@kagaz/shared-types';
import { AssistantError, quotaUnavailable } from './errors.js';
import type { FreePlanLimits } from './freePlan.js';

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
interface FreeUsageEvent {
  readonly id: string;
  readonly atMs: number;
  readonly tokens: number;
}
interface FreeUsageRecord {
  readonly requests: number;
  readonly reservedTokens: number;
  readonly usedTokens: number;
  readonly recent: readonly FreeUsageEvent[];
}
interface FreeReservation {
  readonly eventId: string;
  readonly tokenCeiling: number;
}
type RequestState =
  'reserved' | 'dispatching' | 'completed' | 'failed' | 'uncertain' | 'expired';
interface RequestRecord {
  readonly day: string;
  readonly state: RequestState;
  readonly expiresAtMs: number;
  readonly reservedMicroUsd: number;
  readonly chargedMicroUsd: number;
  readonly freeReservation?: FreeReservation;
}
export interface AssistantReservation {
  readonly userKey: string;
  readonly requestId: string;
  readonly day: string;
  readonly expiresAtMs: number;
  readonly reservedMicroUsd: number;
  readonly freeReservation?: FreeReservation;
}
export type Settlement =
  | { readonly billing: 'none' | 'uncertain' }
  | {
      readonly billing: 'known';
      readonly costMicroUsd: number;
      readonly tokenCount?: number;
    };

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
function freeUsageRecord(
  value: unknown,
  limits: FreePlanLimits,
): FreeUsageRecord {
  if (value === undefined)
    return { requests: 0, reservedTokens: 0, usedTokens: 0, recent: [] };
  if (
    !record(value) ||
    !integer(value.requests) ||
    value.requests > limits.requestsPerDay ||
    !integer(value.reservedTokens) ||
    !integer(value.usedTokens) ||
    value.reservedTokens + value.usedTokens > limits.tokensPerDay ||
    !Array.isArray(value.recent) ||
    value.recent.length > limits.requestsPerDay ||
    value.recent.length > value.requests
  )
    throw quotaUnavailable();
  const recent: FreeUsageEvent[] = [];
  for (const item of value.recent) {
    if (
      !record(item) ||
      typeof item.id !== 'string' ||
      !/^[a-f0-9]{64}$/u.test(item.id) ||
      recent.some((event) => event.id === item.id) ||
      !integer(item.atMs) ||
      !integer(item.tokens) ||
      item.tokens > limits.maxTokensPerRequest
    )
      throw quotaUnavailable();
    recent.push({ id: item.id, atMs: item.atMs, tokens: item.tokens });
  }
  return {
    requests: value.requests,
    reservedTokens: value.reservedTokens,
    usedTokens: value.usedTokens,
    recent,
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
  let freeReservation: FreeReservation | undefined;
  if (value.freeReservation !== undefined) {
    if (
      !record(value.freeReservation) ||
      typeof value.freeReservation.eventId !== 'string' ||
      !/^[a-f0-9]{64}$/u.test(value.freeReservation.eventId) ||
      !integer(value.freeReservation.tokenCeiling) ||
      value.freeReservation.tokenCeiling < 1
    )
      throw quotaUnavailable();
    freeReservation = {
      eventId: value.freeReservation.eventId,
      tokenCeiling: value.freeReservation.tokenCeiling,
    };
  }
  return {
    day: value.day,
    state: value.state as RequestState,
    expiresAtMs: value.expiresAtMs,
    reservedMicroUsd: value.reservedMicroUsd,
    chargedMicroUsd: value.chargedMicroUsd,
    ...(freeReservation ? { freeReservation } : {}),
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
const freeUsagePath = (day: string) => `assistantFreeUsage/${day}`;
const requestPath = (key: string, requestId: string) =>
  `assistantRequests/${key}_${requestId}`;

export class AssistantLedger {
  constructor(
    private readonly store: LedgerStore,
    private readonly budgetMicroUsd: number,
    private readonly reserveMicroUsd: number,
    private readonly now: () => number = Date.now,
    private readonly freePlanLimits?: FreePlanLimits,
  ) {
    if (
      !integer(budgetMicroUsd) ||
      budgetMicroUsd > 3_000_000 ||
      !integer(reserveMicroUsd) ||
      (freePlanLimits
        ? budgetMicroUsd !== 0 || reserveMicroUsd !== 0
        : reserveMicroUsd === 0)
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

  async reserve(
    uid: string,
    requestId: string,
    tokenCeiling?: number,
  ): Promise<AssistantReservation> {
    const now = this.now(),
      day = utcDay(now),
      key = userLedgerKey(uid),
      checkPreviousMinute = now % DAY_MS < MINUTE_MS;
    return this.transaction(async (transaction) => {
      const [
        rawUser,
        rawDay,
        rawBudget,
        rawRequest,
        rawFreeUsage,
        rawPreviousFreeUsage,
      ] = await Promise.all([
        transaction.get(userPath(key)),
        transaction.get(dayPath(key, day)),
        transaction.get(budgetPath(day)),
        transaction.get(requestPath(key, requestId)),
        this.freePlanLimits
          ? transaction.get(freeUsagePath(day))
          : Promise.resolve(undefined),
        this.freePlanLimits && checkPreviousMinute
          ? transaction.get(freeUsagePath(utcDay(now - DAY_MS)))
          : Promise.resolve(undefined),
      ]);
      let user = userRecord(rawUser);
      const daily = dayRecord(rawDay);
      let budget = budgetRecord(rawBudget);
      let freeUsage = this.freePlanLimits
        ? freeUsageRecord(rawFreeUsage, this.freePlanLimits)
        : undefined;
      const previousFreeUsage = this.freePlanLimits
        ? freeUsageRecord(rawPreviousFreeUsage, this.freePlanLimits)
        : undefined;
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
      let freeReservation: FreeReservation | undefined;
      if (this.freePlanLimits) {
        const limits = this.freePlanLimits;
        if (!integer(tokenCeiling) || tokenCeiling < 1)
          throw quotaUnavailable();
        if (tokenCeiling > limits.maxTokensPerRequest)
          throw new AssistantError(
            'context-too-large',
            422,
            'This request exceeds Kagaz’s shared Groq Free Plan token allowance. Select a shorter passage and try again.',
          );
        if (!freeUsage) throw quotaUnavailable();
        const recentFree = [
          ...(previousFreeUsage?.recent ?? []),
          ...freeUsage.recent,
        ].filter((event) => event.atMs > now - MINUTE_MS);
        const recentTokens = recentFree.reduce(
          (sum, event) => sum + event.tokens,
          0,
        );
        if (
          freeUsage.requests >= limits.requestsPerDay ||
          recentFree.length >= limits.requestsPerMinute ||
          recentTokens + tokenCeiling > limits.tokensPerMinute ||
          freeUsage.reservedTokens + freeUsage.usedTokens + tokenCeiling >
            limits.tokensPerDay
        )
          throw new AssistantError(
            'free-limit-exhausted',
            429,
            'Kagaz’s shared Groq Free Plan allowance is temporarily exhausted. Try again later or after the UTC reset.',
          );
        const eventId = createHash('sha256')
          .update(`${key}:${requestId}`)
          .digest('hex');
        freeReservation = { eventId, tokenCeiling };
        freeUsage = {
          requests: freeUsage.requests + 1,
          reservedTokens: freeUsage.reservedTokens + tokenCeiling,
          usedTokens: freeUsage.usedTokens,
          recent: [
            ...recentFree,
            { id: eventId, atMs: now, tokens: tokenCeiling },
          ],
        };
      }
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
      if (freeUsage) transaction.set(freeUsagePath(day), { ...freeUsage });
      transaction.set(requestPath(key, requestId), {
        day,
        state: 'reserved',
        expiresAtMs,
        reservedMicroUsd: this.reserveMicroUsd,
        chargedMicroUsd: 0,
        ...(freeReservation ? { freeReservation } : {}),
      });
      return {
        userKey: key,
        requestId,
        day,
        expiresAtMs,
        reservedMicroUsd: this.reserveMicroUsd,
        ...(freeReservation ? { freeReservation } : {}),
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
      const [rawRequest, rawUser, rawDay, rawBudget, rawFreeUsage] =
        await Promise.all([
          transaction.get(requestPath(key, reservation.requestId)),
          transaction.get(userPath(key)),
          transaction.get(dayPath(key, reservation.day)),
          transaction.get(budgetPath(reservation.day)),
          this.freePlanLimits && reservation.freeReservation
            ? transaction.get(freeUsagePath(reservation.day))
            : Promise.resolve(undefined),
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
      const free = this.freePlanLimits !== undefined;
      if (free !== (request.freeReservation !== undefined))
        throw quotaUnavailable();
      if (
        free &&
        (!reservation.freeReservation ||
          reservation.freeReservation.eventId !==
            request.freeReservation!.eventId ||
          reservation.freeReservation.tokenCeiling !==
            request.freeReservation!.tokenCeiling ||
          request.freeReservation!.tokenCeiling >
            this.freePlanLimits.maxTokensPerRequest)
      )
        throw quotaUnavailable();
      const knownTokens =
        free &&
        !expired &&
        settlement.billing === 'known' &&
        integer(settlement.tokenCount) &&
        settlement.tokenCount <= request.freeReservation!.tokenCeiling;
      const knownPaid =
        !free &&
        !expired &&
        settlement.billing === 'known' &&
        integer(settlement.costMicroUsd) &&
        settlement.costMicroUsd <= request.reservedMicroUsd;
      const known = knownTokens || knownPaid;
      const tokenOverrun =
        free && settlement.billing === 'known' && !knownTokens && !expired;
      const freeUsage =
        free && this.freePlanLimits
          ? freeUsageRecord(rawFreeUsage, this.freePlanLimits)
          : undefined;
      if (free) {
        const tokenCeiling = request.freeReservation!.tokenCeiling;
        if (
          !freeUsage ||
          freeUsage.reservedTokens < tokenCeiling ||
          freeUsage.requests < 1
        )
          throw quotaUnavailable();
        const actualTokens = noBilling
          ? 0
          : knownTokens
            ? settlement.tokenCount
            : tokenCeiling;
        const releaseUnsent = noBilling && request.state === 'reserved';
        const eventIndex = freeUsage.recent.findIndex(
          (event) => event.id === request.freeReservation!.eventId,
        );
        const recent = [...freeUsage.recent];
        if (releaseUnsent) {
          if (eventIndex >= 0) recent.splice(eventIndex, 1);
        } else if (eventIndex >= 0) {
          const event = recent[eventIndex];
          if (!event) throw quotaUnavailable();
          recent[eventIndex] = { ...event, tokens: actualTokens };
        }
        transaction.set(freeUsagePath(request.day), {
          requests: freeUsage.requests - (releaseUnsent ? 1 : 0),
          reservedTokens: freeUsage.reservedTokens - tokenCeiling,
          usedTokens: freeUsage.usedTokens + actualTokens,
          recent,
        });
      }
      const chargedMicroUsd = free
        ? 0
        : noBilling
          ? 0
          : knownPaid
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
            : tokenOverrun
              ? 'uncertain'
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
        (expired || noBilling || (known && !tokenOverrun))
      )
        transaction.set(userPath(key), { ...user, active: null });
      return !expired && !tokenOverrun;
    });
  }

  async usage(uid: string): Promise<AssistantUsageStatus> {
    const now = this.now(),
      day = utcDay(now),
      key = userLedgerKey(uid),
      checkPreviousMinute = now % DAY_MS < MINUTE_MS;
    return this.transaction(async (transaction) => {
      const [rawUser, rawDay, rawBudget, rawFreeUsage, rawPreviousFreeUsage] =
        await Promise.all([
          transaction.get(userPath(key)),
          transaction.get(dayPath(key, day)),
          transaction.get(budgetPath(day)),
          this.freePlanLimits
            ? transaction.get(freeUsagePath(day))
            : Promise.resolve(undefined),
          this.freePlanLimits && checkPreviousMinute
            ? transaction.get(freeUsagePath(utcDay(now - DAY_MS)))
            : Promise.resolve(undefined),
        ]);
      let user = userRecord(rawUser);
      const daily = dayRecord(rawDay),
        budget = budgetRecord(rawBudget);
      const freeUsage = this.freePlanLimits
        ? freeUsageRecord(rawFreeUsage, this.freePlanLimits)
        : undefined;
      const previousFreeUsage = this.freePlanLimits
        ? freeUsageRecord(rawPreviousFreeUsage, this.freePlanLimits)
        : undefined;
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
      const recentFree = [
        ...(previousFreeUsage?.recent ?? []),
        ...(freeUsage?.recent ?? []),
      ].filter((event) => event.atMs > now - MINUTE_MS);
      const freeAvailable = this.freePlanLimits
        ? Boolean(
            freeUsage &&
            freeUsage.requests < this.freePlanLimits.requestsPerDay &&
            (recentFree?.length ?? 0) < this.freePlanLimits.requestsPerMinute &&
            (recentFree?.reduce((sum, event) => sum + event.tokens, 0) ?? 0) <
              this.freePlanLimits.tokensPerMinute &&
            freeUsage.reservedTokens + freeUsage.usedTokens <
              this.freePlanLimits.tokensPerDay,
          )
        : true;
      const unavailableReason = active
        ? 'A generation is already active.'
        : remaining === 0
          ? 'The five daily AI generations have been used.'
          : !burstAvailable
            ? 'Wait a minute before another AI generation.'
            : !budgetAvailable
              ? 'The shared daily AI budget is unavailable.'
              : !freeAvailable
                ? 'Kagaz’s shared Groq Free Plan allowance is temporarily exhausted. Try again later or after the UTC reset.'
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
