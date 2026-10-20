import type { OcrMetadata } from '@kagaz/shared-types';
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
      validate: (headers, size) =>
        readOcrMetadata(headers, bytes.byteLength, size),
    });
  } catch (error) {
    if (bounded.aborted && !signal.aborted)
      throw new HeavyPdfError(OCR_ERRORS['processing-timeout']);
    throw error;
  }
}
