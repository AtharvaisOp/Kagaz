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
