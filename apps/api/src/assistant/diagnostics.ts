/** Only allowlisted failure metadata belongs in assistant diagnostics. */
export type AssistantDiagnostic =
  | {
      readonly event: 'assistant.provider.failure';
      readonly failureStage:
        | 'provider-fetch'
        | 'provider-http-response'
        | 'provider-response-read'
        | 'provider-response-validation';
      readonly errorCategory:
        | 'provider-auth'
        | 'provider-rate-limit'
        | 'provider-http-error'
        | 'timeout'
        | 'cancelled'
        | 'transport-error'
        | 'invalid-response'
        | 'response-processing-error';
      readonly providerHttpStatus: number | null;
      readonly responseReceived: boolean;
      readonly durationMs: number;
    }
  | {
      readonly event: 'assistant.request.failure';
      readonly failureStage: 'quota-settlement' | 'quota-usage-read';
      readonly errorCategory: 'quota-error' | 'cancelled' | 'unexpected-error';
      readonly providerHttpStatus: null;
      readonly responseReceived: true;
      readonly durationMs: number;
    };

export type AssistantDiagnosticSink = (diagnostic: AssistantDiagnostic) => void;

/** Logging is intentionally limited to the constructed metadata object. */
export function reportAssistantDiagnostic(
  diagnostic: AssistantDiagnostic,
  sink?: AssistantDiagnosticSink,
): void {
  try {
    if (sink) sink(diagnostic);
    else console.warn('Assistant request failure.', diagnostic);
  } catch {
    // Diagnostics must never change provider or quota behavior.
  }
}

export function boundedDurationMs(startedAt: number, now: number): number {
  return Math.min(31_000, Math.max(0, Math.round(now - startedAt)));
}
