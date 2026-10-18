import type {
  AssistantErrorCode,
  AssistantGroundedAnswer,
  ExplicitContextShareRequest,
} from '@kagaz/shared-types';
import { AssistantError } from './errors.js';

export interface ProviderGeneration {
  readonly answer: AssistantGroundedAnswer;
  readonly usage: {
    readonly inputTokens: number;
    readonly outputTokens: number;
  } | null;
}

export interface AssistantProvider {
  generate(
    context: ExplicitContextShareRequest,
    signal: AbortSignal,
  ): Promise<ProviderGeneration>;
}

export class ProviderError extends AssistantError {
  constructor(
    code: AssistantErrorCode,
    message: string,
    readonly billing: 'none' | 'uncertain' = 'uncertain',
  ) {
    super(
      code,
      code === 'provider-rate-limited' ? 429 : code === 'cancelled' ? 499 : 502,
      message,
    );
    this.name = 'ProviderError';
  }
}
