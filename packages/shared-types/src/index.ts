export interface HealthResponse {
  status: 'ok';
  service: 'kagaz-api';
  timestamp: string;
}

export type CompressionPreset = 'high-quality' | 'balanced' | 'maximum';

export type HeavyToolErrorCode =
  | 'invalid-request'
  | 'invalid-pdf'
  | 'file-too-large'
  | 'unsupported-pdf'
  | 'processing-timeout'
  | 'server-busy'
  | 'processing-failed'
  | 'unsupported-language'
  | 'no-ocr-needed'
  | 'ocr-failed'
  | 'unsupported-format'
  | 'unsafe-document'
  | 'conversion-failed'
  | 'cancelled';

export interface HeavyToolErrorResponse {
  readonly error: {
    readonly code: HeavyToolErrorCode;
    readonly message: string;
  };
}

/** Response headers are exposed through CORS; sizes always describe returned bytes. */
export interface CompressionMetadata {
  readonly originalBytes: number;
  readonly compressedBytes: number;
  readonly savedBytes: number;
  readonly savedPercent: number;
  readonly preset: CompressionPreset;
  readonly outcome: 'compressed' | 'unchanged';
}

export interface OcrMetadata {
  readonly originalBytes: number;
  readonly outputBytes: number;
  readonly pages: number;
  readonly language: 'eng';
  /** Pages given a validated text layer, rather than an engine exit-code estimate. */
  readonly pagesOcred: number;
  readonly pagesSkipped: number;
}

export type OfficeFormat = 'docx' | 'pptx' | 'xlsx';
export interface ConversionMetadata {
  readonly inputFormat: OfficeFormat;
  readonly originalBytes: number;
  readonly outputBytes: number;
  readonly pages: number;
}
