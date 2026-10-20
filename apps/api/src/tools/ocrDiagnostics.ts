export const OCR_REJECTION_CATEGORIES = [
  'encrypted',
  'page-limit',
  'interactive-forms',
  'unsafe-structure',
  'annotations',
  'page-dimensions',
  'image-budget',
  'raster-budget',
  'resource-budget',
  'unreadable-pdf',
  'text-inventory',
  'inspection-rejected',
  'no-ocr-needed',
  'engine-failed',
  'output-integrity',
  'invalid-input',
  'timeout',
  'cancelled',
  'processing-failed',
] as const;
export type OcrRejectionCategory = (typeof OCR_REJECTION_CATEGORIES)[number];
export type OcrDiagnosticStage =
  'input-validation' | 'source-inspection' | 'engine' | 'output-validation';
export interface OcrDiagnostic {
  readonly event: 'ocr.request.rejected';
  readonly stage: OcrDiagnosticStage;
  readonly category: OcrRejectionCategory;
}
export type OcrDiagnosticSink = (diagnostic: OcrDiagnostic) => void;

/** Native stdout is untrusted; no native strings or extra fields enter diagnostics. */
export function readOcrRejection(stdout: string): OcrRejectionCategory {
  try {
    const data: unknown = JSON.parse(stdout);
    if (
      typeof data === 'object' &&
      data !== null &&
      'rejection' in data &&
      OCR_REJECTION_CATEGORIES.some((category) => category === data.rejection)
    )
      return data.rejection as OcrRejectionCategory;
  } catch {
    /* Fall back to a fixed label, never an exception message. */
  }
  return 'inspection-rejected';
}

export function reportOcrDiagnostic(
  diagnostic: OcrDiagnostic,
  sink?: OcrDiagnosticSink,
): void {
  try {
    if (sink) sink(diagnostic);
    else console.warn('OCR request rejected.', diagnostic);
  } catch {
    /* Diagnostics cannot alter processing or cleanup. */
  }
}
