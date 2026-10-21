import type { OcrMetadata, PdfRejectionReason } from '@kagaz/shared-types';
import {
  HeavyPdfError,
  uploadHeavyPdf,
} from '../pdf-heavy-tools/uploadHeavyPdf';

export const OCR_ERRORS: Readonly<Record<string, string>> = {
  'invalid-request': 'The server could not read the OCR request. Please retry.',
  'invalid-pdf': 'The generated PDF could not be safely read by the server.',
  'file-too-large':
    'OCR supports PDFs up to 10 MiB. Extract fewer pages and try again.',
  'unsupported-pdf':
    'OCR cannot safely accept this PDF. Limits are 20 pages, 14 inches per side, 400 DPI and 16 megapixels per image. Encryption, interactive forms, digital-signature structures, active content (including external hyperlink actions) and unflattened source annotations can also block processing. Your workspace is unchanged; no automatic conversion was performed.',
  'processing-timeout':
    'OCR took too long. Extract fewer pages or use a clearer scan and retry.',
  'server-busy': 'The server is busy. Please try again in a moment.',
  'processing-failed': 'The OCR server is unavailable. Please retry.',
  'unsupported-language': 'Only English OCR is supported.',
  'no-ocr-needed':
    'OCR skipped every page because it detected existing text or blank pages. Try selecting and copying readable text directly. Pages combining existing text and scanned regions are also skipped. This does not mean all visible characters are editable.',
  'ocr-failed':
    'The server could not validate searchable text. Try a clearer scan or fewer pages. Your workspace is intact.',
  cancelled: 'OCR was cancelled.',
};

const OCR_REJECTION_MESSAGES: Readonly<Record<PdfRejectionReason, string>> = {
  encrypted:
    'This PDF has password protection or encryption. Open an unencrypted copy you are allowed to use, then try OCR again. Your workspace is unchanged.',
  'page-limit':
    'This PDF exceeds the OCR limit of 20 pages. Extract a smaller page range and try again.',
  'interactive-forms':
    'This PDF still contains an interactive form. OCR requires a copy with form values flattened into the pages. Your workspace is unchanged.',
  'unsafe-structure':
    'This PDF contains a structure OCR does not support, such as external links, actions, attachments or digital signatures. Export a copy without those features from the source application. Kagaz has not removed them.',
  annotations:
    'This PDF contains source annotations or links that OCR cannot preserve. Simple internal links are supported. Export a copy with other annotations flattened from the source application, then try again. Your workspace is unchanged.',
  'page-dimensions':
    'At least one PDF page exceeds the OCR limit of 14 inches per side. Export that page at a smaller physical size and try again.',
  'image-budget':
    'An image in this PDF exceeds the OCR limit of 16 megapixels. Export a lower-resolution scan and try again.',
  'raster-budget':
    'A page exceeds the OCR rendering limit of 400 DPI or 16 megapixels. Export a lower-resolution scan and try again.',
  'resource-budget':
    'This PDF contains graphics too complex for the OCR processing limit. Extract fewer pages or export a simpler copy from the source application.',
  'unreadable-pdf':
    'OCR could not read this PDF reliably. Export a new PDF from the source application and try again. Your workspace is unchanged.',
  'text-inventory':
    'OCR could not verify the PDF’s text inventory. Export a new PDF from the source application and try again. Your workspace is unchanged.',
  'inspection-rejected': OCR_ERRORS['unsupported-pdf']!,
};
export function readOcrMetadata(
  headers: Headers,
  originalBytes: number,
  actualBytes: number,
): OcrMetadata {
  const number = (name: string) => {
    const value = headers.get(name);
    return value === null ? NaN : Number(value);
  };
  const outputBytes = number('X-Kagaz-Output-Bytes'),
    pages = number('X-Kagaz-Pages'),
    pagesOcred = number('X-Kagaz-Pages-Ocred'),
    pagesSkipped = number('X-Kagaz-Pages-Skipped');
  if (
    number('X-Kagaz-Original-Bytes') !== originalBytes ||
    !Number.isInteger(outputBytes) ||
    outputBytes < 8 ||
    outputBytes > 40 * 1024 * 1024 ||
    outputBytes !== actualBytes ||
    headers.get('X-Kagaz-Ocr-Language') !== 'eng' ||
    !Number.isInteger(pages) ||
    pages < 1 ||
    pages > 20 ||
    !Number.isInteger(pagesOcred) ||
    pagesOcred < 1 ||
    pagesOcred > pages ||
    !Number.isInteger(pagesSkipped) ||
    pagesSkipped < 0 ||
    pagesOcred + pagesSkipped !== pages
  )
    throw new HeavyPdfError(
      'The server returned an incomplete OCR result. Please retry.',
    );
  return {
    originalBytes,
    outputBytes,
    pages,
    language: 'eng',
    pagesOcred,
    pagesSkipped,
  };
}
export async function uploadOcr(
  bytes: Uint8Array,
  _language: 'eng',
  signal: AbortSignal,
  onProcessing: () => void,
  apiUrl = import.meta.env.VITE_API_URL ?? '',
) {
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(330_000)]);
  try {
    return await uploadHeavyPdf({
      bytes,
      signal: bounded,
      onProcessing,
      apiUrl,
      operation: 'ocr',
      field: 'language',
      value: 'eng',
      maximumInput: 10 * 1024 * 1024,
      sizeHeader: 'X-Kagaz-Output-Bytes',
      errors: OCR_ERRORS,
      errorReasons: { 'unsupported-pdf': OCR_REJECTION_MESSAGES },
      validate: (headers, size) =>
        readOcrMetadata(headers, bytes.byteLength, size),
    });
  } catch (error) {
    if (bounded.aborted && !signal.aborted)
      throw new HeavyPdfError(OCR_ERRORS['processing-timeout']);
    throw error;
  }
}
