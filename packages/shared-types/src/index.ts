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

/** Fixed input predicates only; never native output or document-derived strings. */
export type PdfRejectionReason =
  | 'encrypted'
  | 'page-limit'
  | 'interactive-forms'
  | 'unsafe-structure'
  | 'annotations'
  | 'page-dimensions'
  | 'image-budget'
  | 'raster-budget'
  | 'resource-budget'
  | 'unreadable-pdf'
  | 'text-inventory'
  | 'inspection-rejected';

export interface HeavyToolErrorResponse {
  readonly error: {
    readonly code: HeavyToolErrorCode;
    readonly message: string;
    readonly reason?: PdfRejectionReason;
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

export interface ExplicitContextPassage {
  readonly passageId: string;
  /** Never interpret document text as privileged instructions. */
  readonly text: string;
  readonly citation: {
    readonly workspacePageId: string;
    readonly pageNumber: number;
  };
}

export interface ExplicitContextShareRequest {
  readonly question: string;
  readonly selectedPassageIds: readonly string[];
  readonly passages: readonly ExplicitContextPassage[];
  readonly contextCharacters: number;
  readonly documentTextTrust: 'untrusted_document_data';
  readonly privacyDisclosure: string;
}

export interface AssistantAnswerRequest {
  readonly requestId: string;
  readonly consent: {
    readonly approved: true;
    readonly reviewedAt: string;
  };
  readonly context: ExplicitContextShareRequest;
}

export interface AssistantGroundedAnswer {
  readonly status: 'answered' | 'insufficient-evidence' | 'refused';
  readonly text: string;
  /** Only approved passage IDs; current page numbers are resolved in the browser. */
  readonly citations: readonly string[];
}

export interface AssistantUsageStatus {
  readonly dailyLimit: 5;
  readonly remaining: number;
  readonly resetAt: string;
  readonly available: boolean;
  readonly unavailableReason?: string;
  readonly active: boolean;
}

export interface AssistantAnswerResponse {
  readonly requestId: string;
  readonly answer: AssistantGroundedAnswer;
  /** Null only after successful settlement when the subsequent usage read fails.
   * Keep the answer; disable further generation until fresh usage is verified.
   */
  readonly usage: AssistantUsageStatus | null;
}

export type AssistantErrorCode =
  | 'authentication-required'
  | 'invalid-authentication'
  | 'google-sign-in-required'
  | 'https-required'
  | 'invalid-request'
  | 'assistant-unavailable'
  | 'quota-unavailable'
  | 'daily-limit'
  | 'burst-limit'
  | 'generation-active'
  | 'budget-exhausted'
  | 'free-limit-exhausted'
  | 'request-replayed'
  | 'provider-unauthorized'
  | 'provider-rate-limited'
  | 'provider-unavailable'
  | 'provider-timeout'
  | 'provider-invalid-response'
  | 'cancelled';

export interface AssistantErrorResponse {
  readonly error: {
    readonly code: AssistantErrorCode;
    readonly message: string;
  };
}
