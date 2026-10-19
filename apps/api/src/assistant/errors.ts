import type { AssistantErrorCode } from '@kagaz/shared-types';

export class AssistantError extends Error {
  constructor(
    readonly code: AssistantErrorCode,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'AssistantError';
  }
}

export function quotaUnavailable(): AssistantError {
  return new AssistantError(
    'quota-unavailable',
    503,
    'AI usage could not be verified. No new generation was started.',
  );
}
