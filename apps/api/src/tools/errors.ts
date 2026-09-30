import type {
  HeavyToolErrorCode,
  HeavyToolErrorResponse,
} from '@kagaz/shared-types';

const messages: Record<HeavyToolErrorCode, string> = {
  'invalid-request': 'Send exactly one PDF and a supported compression preset.',
  'invalid-pdf': 'This PDF is empty, damaged, or cannot be safely read.',
  'file-too-large': 'Compression supports PDFs up to 20 MiB.',
  'unsupported-pdf':
    'This PDF is encrypted, still contains interactive forms, or exceeds the supported 300-page limit.',
  'processing-timeout':
    'Processing took too long. Try a smaller PDF or try again.',
  'server-busy': 'The server is busy. Please try again in a moment.',
  'processing-failed':
    'The server could not safely compress this PDF. Your workspace is intact.',
  cancelled: 'Processing was cancelled.',
};

export class HeavyToolError extends Error {
  constructor(readonly code: HeavyToolErrorCode) {
    super(messages[code]);
    this.name = 'HeavyToolError';
  }

  get status(): number {
    switch (this.code) {
      case 'file-too-large':
        return 413;
      case 'unsupported-pdf':
        return 422;
      case 'server-busy':
        return 503;
      case 'processing-timeout':
        return 504;
      case 'processing-failed':
        return 500;
      case 'cancelled':
        return 499;
      default:
        return 400;
    }
  }

  get response(): HeavyToolErrorResponse {
    return { error: { code: this.code, message: this.message } };
  }
}

export function checkAbort(signal: AbortSignal): void {
  if (signal.aborted) {
    throw signal.reason instanceof HeavyToolError
      ? signal.reason
      : new HeavyToolError('cancelled');
  }
}
