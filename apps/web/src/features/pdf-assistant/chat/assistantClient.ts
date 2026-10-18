import type {
  AssistantAnswerRequest,
  AssistantAnswerResponse,
  AssistantUsageStatus,
} from '@kagaz/shared-types';
import { belongsToReviewedContext } from './consent';

const ERROR_MESSAGES: Readonly<Record<string, string>> = {
  'authentication-required': 'Sign in with Google to use AI Chat.',
  'invalid-authentication':
    'Your Google session could not be verified. Sign out and sign in again.',
  'google-sign-in-required': 'AI Chat requires a Google sign-in.',
  'https-required': 'AI Chat requires a secure HTTPS connection.',
  'assistant-unavailable':
    'AI Chat is unavailable. The owner must finish the server, provider and budget configuration.',
  'quota-unavailable':
    'Usage could not be verified. Generation is disabled until the usage store is available.',
  'daily-limit':
    'You have used today’s AI allowance. It resets at midnight UTC.',
  'burst-limit': 'Please wait a minute before another generation.',
  'generation-active':
    'A generation is already active for your account. Wait for it to finish.',
  'budget-exhausted':
    'Kagaz’s daily AI budget is exhausted. Try again after midnight UTC.',
  'request-replayed':
    'This request has already been handled. Review the passages again for a new request.',
  'provider-unauthorized':
    'The AI provider is unavailable. The owner must check its configuration.',
  'provider-rate-limited':
    'Groq is busy. Review and try again later; a generation attempt may have been counted.',
  'provider-unavailable':
    'Groq could not complete the answer. A generation attempt may have been counted.',
  'provider-timeout':
    'The AI request timed out. A generation attempt may have been counted.',
  'provider-invalid-response':
    'The AI response could not be verified and was not displayed. A generation attempt may have been counted.',
  'invalid-request':
    'The reviewed context was rejected. Search and review the passages again.',
  cancelled:
    'The request was cancelled. Already transmitted text cannot be retracted; a generation attempt may be counted.',
};

export class AssistantClientError extends Error {
  constructor(
    readonly code: string,
    readonly usage?: AssistantUsageStatus,
  ) {
    super(
      ERROR_MESSAGES[code] ??
        'AI Chat could not connect. Check your connection; a generation attempt may have been counted.',
    );
    this.name = 'AssistantClientError';
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function readUsage(value: unknown): AssistantUsageStatus | null {
  if (
    !record(value) ||
    value.dailyLimit !== 5 ||
    typeof value.remaining !== 'number' ||
    !Number.isInteger(value.remaining) ||
    value.remaining < 0 ||
    value.remaining > 5 ||
    typeof value.available !== 'boolean' ||
    typeof value.active !== 'boolean' ||
    typeof value.resetAt !== 'string' ||
    !Number.isFinite(Date.parse(value.resetAt)) ||
    (value.unavailableReason !== undefined &&
      typeof value.unavailableReason !== 'string')
  )
    return null;
  return {
    dailyLimit: 5,
    remaining: value.remaining,
    available: value.available,
    active: value.active,
    resetAt: value.resetAt,
    ...(typeof value.unavailableReason === 'string'
      ? { unavailableReason: value.unavailableReason }
      : {}),
  };
}

export function readAnswer(
  value: unknown,
  request: AssistantAnswerRequest,
): AssistantAnswerResponse | null {
  if (
    !record(value) ||
    !record(value.answer) ||
    value.requestId !== request.requestId ||
    typeof value.answer.text !== 'string' ||
    !value.answer.text.trim() ||
    value.answer.text.length > 2_400 ||
    typeof value.answer.status !== 'string' ||
    !['answered', 'insufficient-evidence', 'refused'].includes(
      value.answer.status,
    ) ||
    !Array.isArray(value.answer.citations) ||
    value.answer.citations.length > 5 ||
    !value.answer.citations.every((id: unknown) => typeof id === 'string') ||
    new Set(value.answer.citations).size !== value.answer.citations.length
  )
    return null;
  const usage = readUsage(value.usage);
  if (!usage) return null;
  const response: AssistantAnswerResponse = {
    requestId: request.requestId,
    usage,
    answer: {
      text: value.answer.text,
      status: value.answer
        .status as AssistantAnswerResponse['answer']['status'],
      citations: value.answer.citations,
    },
  };
  return belongsToReviewedContext(response, request) ? response : null;
}

async function send(
  path: string,
  token: string,
  signal: AbortSignal,
  body?: AssistantAnswerRequest,
): Promise<unknown> {
  const base = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/u, '');
  const url = new URL(`${base}/assistant/${path}`, window.location.origin);
  if (
    url.protocol !== 'https:' &&
    !(
      import.meta.env.DEV &&
      ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    )
  )
    throw new AssistantClientError('https-required');
  const response = await fetch(url, {
    method: body ? 'POST' : 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.any([signal, AbortSignal.timeout(45_000)]),
    credentials: 'omit',
    cache: 'no-store',
    redirect: 'error',
    referrerPolicy: 'no-referrer',
  });
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw new AssistantClientError('provider-invalid-response');
  }
  if (!response.ok) {
    const code =
      record(value) &&
      record(value.error) &&
      typeof value.error.code === 'string'
        ? value.error.code
        : 'network';
    throw new AssistantClientError(
      code,
      record(value) ? (readUsage(value.usage) ?? undefined) : undefined,
    );
  }
  return value;
}

export async function fetchAssistantUsage(
  token: string,
  signal: AbortSignal,
): Promise<AssistantUsageStatus> {
  const value = await send('usage', token, signal);
  const usage = readUsage(value);
  if (!usage) throw new AssistantClientError('quota-unavailable');
  return usage;
}

export async function generateAssistantAnswer(
  request: AssistantAnswerRequest,
  token: string,
  signal: AbortSignal,
): Promise<AssistantAnswerResponse> {
  const value = await send('answer', token, signal, request);
  const answer = readAnswer(value, request);
  if (!answer) throw new AssistantClientError('provider-invalid-response');
  return answer;
}
