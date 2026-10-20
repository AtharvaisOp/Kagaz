import {
  applicationDefault,
  cert,
  getApps,
  initializeApp,
} from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import type {
  AssistantAnswerResponse,
  AssistantUsageStatus,
} from '@kagaz/shared-types';
import type { Request } from 'express';
import type { AssistantAuthenticator, AssistantIdentity } from './auth.js';
import { FirebaseGoogleAuthenticator } from './auth.js';
import { readAssistantConfig } from './config.js';
import { AssistantError, quotaUnavailable } from './errors.js';
import {
  GroqProvider,
  GROQ_RESERVATION_MICRO_USD,
  groqCostMicroUsd,
} from './groq.js';
import { AssistantLedger, FirestoreLedgerStore } from './ledger.js';
import { GROQ_FREE_PLAN_LIMITS } from './freePlan.js';
import { ProviderError } from './provider.js';
import type { AssistantProvider } from './provider.js';
import { validateAnswerRequest } from './validation.js';
import { performance } from 'node:perf_hooks';
import { boundedDurationMs, reportAssistantDiagnostic } from './diagnostics.js';
import type { AssistantDiagnosticSink } from './diagnostics.js';

export interface AssistantServiceOptions {
  readonly auth?: AssistantAuthenticator;
  readonly ledger?: AssistantLedger;
  readonly provider?: AssistantProvider;
  readonly enabled: boolean;
  readonly unavailableReason: string;
  readonly allowLocalHttp?: boolean;
  readonly renderProxy?: boolean;
  readonly freePlanMode?: boolean;
  readonly now?: () => number;
  readonly deadlineMs?: number;
  readonly diagnosticSink?: AssistantDiagnosticSink;
}

export class AssistantService {
  constructor(private readonly options: AssistantServiceOptions) {}

  async authorize(request: Request): Promise<AssistantIdentity> {
    const remote = request.socket.remoteAddress;
    const loopback =
      remote === '127.0.0.1' ||
      remote === '::1' ||
      remote === '::ffff:127.0.0.1';
    // Render terminates TLS and overwrites this header at its ingress. Never trust
    // arbitrary proxy headers on other hosts or enable Express's global proxy trust.
    const https =
      request.secure ||
      (this.options.renderProxy === true &&
        request.headers['x-forwarded-proto'] === 'https');
    if (!https && !(this.options.allowLocalHttp && loopback))
      throw new AssistantError(
        'https-required',
        400,
        'AI Chat requires an HTTPS connection.',
      );
    if (!request.headers.authorization)
      throw new AssistantError(
        'authentication-required',
        401,
        'Sign in with Google to use AI Chat.',
      );
    if (!this.options.auth)
      throw new AssistantError(
        'assistant-unavailable',
        503,
        this.options.unavailableReason ||
          'Firebase authentication is unavailable.',
      );
    return this.options.auth.authenticate(request.headers.authorization);
  }

  async usage(uid: string): Promise<AssistantUsageStatus> {
    if (!this.options.ledger) throw quotaUnavailable();
    const usage = await this.options.ledger.usage(uid);
    return this.options.enabled && this.options.provider
      ? usage
      : {
          ...usage,
          available: false,
          unavailableReason:
            this.options.unavailableReason || 'AI Chat is unavailable.',
        };
  }

  async answer(
    uid: string,
    body: unknown,
    signal: AbortSignal,
  ): Promise<AssistantAnswerResponse> {
    const request = validateAnswerRequest(
      body,
      (this.options.now ?? Date.now)(),
    );
    const { ledger, provider } = this.options;
    if (!this.options.enabled || !provider)
      throw new AssistantError(
        'assistant-unavailable',
        503,
        this.options.unavailableReason || 'AI Chat is unavailable.',
      );
    if (!ledger) throw quotaUnavailable();
    let tokenCeiling: number | undefined;
    if (this.options.freePlanMode) {
      if (!provider.reservationTokenCeiling)
        throw new AssistantError(
          'assistant-unavailable',
          503,
          'Groq Free Plan token limits could not be enforced. AI Chat remains disabled.',
        );
      tokenCeiling = provider.reservationTokenCeiling(request.context);
    }
    const reservation =
      tokenCeiling === undefined
        ? await ledger.reserve(uid, request.requestId)
        : await ledger.reserve(uid, request.requestId, tokenCeiling);
    let dispatched = false;
    let settled = false;
    let providerResponseReceived = false;
    let postProviderFailureStage: 'quota-settlement' | 'quota-usage-read' =
      'quota-settlement';
    let providerStartedAt = 0;
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, this.options.deadlineMs ?? 30_000);
    timer.unref();
    try {
      if (signal.aborted) controller.abort();
      if (controller.signal.aborted)
        throw new ProviderError(
          'cancelled',
          'Generation was cancelled before transmission.',
          'none',
        );
      await ledger.markDispatched(reservation);
      if (controller.signal.aborted)
        throw new ProviderError(
          'cancelled',
          'Generation was cancelled before transmission.',
          'none',
        );
      dispatched = true;
      providerStartedAt = performance.now();
      const result = await provider.generate(
        request.context,
        controller.signal,
      );
      providerResponseReceived = true;
      postProviderFailureStage = 'quota-settlement';
      const billing = result.usage
        ? {
            billing: 'known' as const,
            // Dollar accounting remains active only in the hypothetical paid mode.
            costMicroUsd: this.options.freePlanMode
              ? 0
              : Math.ceil(groqCostMicroUsd(result.usage) * 1.25),
            tokenCount: result.usage.inputTokens + result.usage.outputTokens,
          }
        : { billing: 'uncertain' as const };
      const current = await ledger.settle(reservation, billing);
      settled = true;
      if (!current)
        throw new AssistantError(
          'request-replayed',
          409,
          'The generation expired. Its result cannot be presented as current.',
        );
      if (controller.signal.aborted)
        throw new ProviderError(
          'cancelled',
          'Generation was cancelled. Already transmitted passages cannot be retracted.',
        );
      postProviderFailureStage = 'quota-usage-read';
      const usage = await this.usage(uid);
      return {
        requestId: request.requestId,
        answer: result.answer,
        usage,
      };
    } catch (error) {
      if (providerResponseReceived) {
        const errorCategory =
          error instanceof ProviderError && error.code === 'cancelled'
            ? 'cancelled'
            : error instanceof AssistantError
              ? 'quota-error'
              : 'unexpected-error';
        reportAssistantDiagnostic(
          {
            event: 'assistant.request.failure',
            failureStage: postProviderFailureStage,
            errorCategory,
            providerHttpStatus: null,
            responseReceived: true,
            durationMs: boundedDurationMs(providerStartedAt, performance.now()),
          },
          this.options.diagnosticSink,
        );
      }
      if (!settled) {
        try {
          await ledger.settle(reservation, {
            billing:
              !dispatched ||
              (error instanceof ProviderError && error.billing === 'none')
                ? 'none'
                : 'uncertain',
          });
        } catch {
          throw new AssistantError(
            'quota-unavailable',
            503,
            dispatched
              ? 'Generation may have completed and this attempt may count. Usage could not be confirmed.'
              : 'No provider request was sent. The reserved allowance could not be released and may temporarily count.',
          );
        }
      }
      if (
        dispatched &&
        error instanceof AssistantError &&
        error.code === 'quota-unavailable'
      )
        throw new AssistantError(
          'quota-unavailable',
          503,
          'Generation may have completed and this attempt may count. Usage could not be confirmed.',
        );
      if (error instanceof AssistantError) throw error;
      throw new ProviderError(
        'provider-unavailable',
        'The AI provider did not return a usable response. The attempt may count toward today’s allowance.',
      );
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
    }
  }
}

/** Configuration failures disable only remote AI; the editor and native tools still start. */
export function createDefaultAssistantService(
  environment: NodeJS.ProcessEnv = process.env,
): AssistantService {
  const config = readAssistantConfig(environment);
  const base = {
    enabled: false,
    unavailableReason: config.unavailableReason,
    allowLocalHttp: config.allowLocalHttp,
    renderProxy: config.renderProxy,
    freePlanMode: config.providerMode === 'groq-free',
  };
  if (
    !config.projectId ||
    (environment.NODE_ENV === 'production' &&
      (environment.FIREBASE_AUTH_EMULATOR_HOST ||
        environment.FIRESTORE_EMULATOR_HOST))
  )
    return new AssistantService(base);
  try {
    let credential = applicationDefault();
    if (environment.FIREBASE_SERVICE_ACCOUNT_JSON) {
      const value: unknown = JSON.parse(
        environment.FIREBASE_SERVICE_ACCOUNT_JSON,
      );
      if (
        typeof value !== 'object' ||
        value === null ||
        !('project_id' in value) ||
        value.project_id !== config.projectId ||
        !('client_email' in value) ||
        typeof value.client_email !== 'string' ||
        !('private_key' in value) ||
        typeof value.private_key !== 'string'
      )
        throw new Error('Invalid Firebase credentials.');
      credential = cert({
        projectId: config.projectId,
        clientEmail: value.client_email,
        privateKey: value.private_key,
      });
    }
    const name = `kagaz-assistant-${config.projectId}`;
    const app =
      getApps().find((candidate) => candidate.name === name) ??
      initializeApp({ projectId: config.projectId, credential }, name);
    return new AssistantService({
      ...base,
      enabled: config.enabled,
      auth: new FirebaseGoogleAuthenticator(getAuth(app), config.projectId),
      ledger: new AssistantLedger(
        new FirestoreLedgerStore(getFirestore(app)),
        config.dailyBudgetMicroUsd,
        config.providerMode === 'groq-free' ? 0 : GROQ_RESERVATION_MICRO_USD,
        Date.now,
        config.providerMode === 'groq-free' ? GROQ_FREE_PLAN_LIMITS : undefined,
      ),
      ...(config.enabled
        ? {
            provider: new GroqProvider({
              apiKey: environment.GROQ_API_KEY ?? '',
            }),
          }
        : {}),
    });
  } catch {
    return new AssistantService({
      ...base,
      unavailableReason:
        'Firebase server credentials could not be initialized. AI Chat remains disabled.',
    });
  }
}
