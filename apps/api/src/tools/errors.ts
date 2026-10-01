import type {
  HeavyToolErrorCode,
  HeavyToolErrorResponse,
} from '@kagaz/shared-types';

const messages: Record<HeavyToolErrorCode, string> = {
  'invalid-request': 'Send exactly one PDF and supported tool options.',
  'invalid-pdf': 'This PDF is empty, damaged, or cannot be safely read.',
  'file-too-large':
    'This file exceeds the tool limit: 20 MiB for compression or 10 MiB for OCR.',
  'unsupported-pdf':
    'This PDF is encrypted, contains unsafe or interactive structures, or exceeds this tool’s page or image limits.',
  'processing-timeout':
    'Processing took too long. Try a smaller PDF or try again.',
  'server-busy': 'The server is busy. Please try again in a moment.',
  'processing-failed':
    'The server could not safely process this PDF. Your workspace is intact.',
  'unsupported-language':
    'Only English OCR is supported. Select English and retry.',
  'no-ocr-needed':
    'No scanned pages need OCR. Existing text remains usable; blank pages have no text to recognize.',
  'ocr-failed':
    'The server could not validate a searchable PDF. Try a clearer scan or fewer pages. Your workspace is intact.',
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
      case 'unsupported-language':
      case 'no-ocr-needed':
        return 422;
      case 'server-busy':
        return 503;
      case 'processing-timeout':
        return 504;
      case 'processing-failed':
      case 'ocr-failed':
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
