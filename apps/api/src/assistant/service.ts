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
import { ProviderError } from './provider.js';
import type { AssistantProvider } from './provider.js';
import { validateAnswerRequest } from './validation.js';

export interface AssistantServiceOptions {
  readonly auth?: AssistantAuthenticator;
  readonly ledger?: AssistantLedger;
  readonly provider?: AssistantProvider;
  readonly enabled: boolean;
  readonly unavailableReason: string;
  readonly allowLocalHttp?: boolean;
  readonly renderProxy?: boolean;
  readonly now?: () => number;
  readonly deadlineMs?: number;
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
    const reservation = await ledger.reserve(uid, request.requestId);
    let dispatched = false;
    let settled = false;
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
      const result = await provider.generate(
        request.context,
        controller.signal,
      );
      const billing = result.usage
        ? {
            billing: 'known' as const,
            // Keep the same 25% pricing safety margin after actual-use reconciliation.
            costMicroUsd: Math.ceil(groqCostMicroUsd(result.usage) * 1.25),
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
      return {
        requestId: request.requestId,
        answer: result.answer,
        usage: await this.usage(uid),
      };
    } catch (error) {
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
        GROQ_RESERVATION_MICRO_USD,
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
