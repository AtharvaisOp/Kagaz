import type { ConversionMetadata, OfficeFormat } from '@kagaz/shared-types';
import {
  HeavyPdfError,
  uploadHeavyPdf,
} from '../pdf-heavy-tools/uploadHeavyPdf';

export const CONVERSION_ERRORS: Readonly<Record<string, string>> = {
  'invalid-request':
    'The server could not read the conversion request. Please retry.',
  'file-too-large':
    'Conversion supports documents up to 10 MiB. Choose a smaller document.',
  'unsupported-format':
    'Choose a DOCX, PPTX or XLSX file. Legacy and macro-enabled Office files are unsupported.',
  'unsafe-document':
    'This document is damaged, exceeds archive limits, or contains macros, external links or unsupported embedded content. Save a simpler copy with embedded PNG/JPEG images and no external resources.',
  'conversion-failed':
    'The server could not validate a converted PDF. Try a simpler document. Your workspace is intact.',
  'processing-failed': 'The conversion server is unavailable. Please retry.',
  'processing-timeout':
    'Conversion took too long. Choose a smaller document or retry.',
  'server-busy': 'The server is busy. Please try again in a moment.',
  cancelled: 'Conversion was cancelled.',
};
export function supportedOfficeFormat(name: string): OfficeFormat | null {
  const extension = name.split('.').at(-1)?.toLowerCase();
  return extension === 'docx' || extension === 'pptx' || extension === 'xlsx'
    ? extension
    : null;
}
export function readConversionMetadata(
  headers: Headers,
  originalBytes: number,
  actualBytes: number,
): ConversionMetadata {
  const value = (name: string) =>
    headers.get(name) === null ? NaN : Number(headers.get(name));
  const inputFormat = headers.get('X-Kagaz-Input-Format');
  const outputBytes = value('X-Kagaz-Output-Bytes'),
    pages = value('X-Kagaz-Pages');
  if (
    (inputFormat !== 'docx' &&
      inputFormat !== 'pptx' &&
      inputFormat !== 'xlsx') ||
    value('X-Kagaz-Original-Bytes') !== originalBytes ||
    !Number.isInteger(outputBytes) ||
    outputBytes < 8 ||
    outputBytes > 40 * 1024 * 1024 ||
    outputBytes !== actualBytes ||
    !Number.isInteger(pages) ||
    pages < 1 ||
    pages > 50
  )
    throw new HeavyPdfError(
      'The server returned an incomplete conversion result. Please retry.',
    );
  return { inputFormat, originalBytes, outputBytes, pages };
}
export async function uploadConversion(
  file: File,
  signal: AbortSignal,
  onProcessing: () => void,
  apiUrl = import.meta.env.VITE_API_URL ?? '',
) {
  const format = supportedOfficeFormat(file.name);
  if (!format) throw new HeavyPdfError(CONVERSION_ERRORS['unsupported-format']);
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(210_000)]);
  try {
    return await uploadHeavyPdf({
      file,
      uploadFilename: `selected-document.${format}`,
      signal: bounded,
      onProcessing,
      apiUrl,
      operation: 'convert-to-pdf',
      maximumInput: 10 * 1024 * 1024,
      sizeHeader: 'X-Kagaz-Output-Bytes',
      errors: CONVERSION_ERRORS,
      validate: (headers, size) =>
        readConversionMetadata(headers, file.size, size),
    });
  } catch (error) {
    if (bounded.aborted && !signal.aborted)
      throw new HeavyPdfError(CONVERSION_ERRORS['processing-timeout']);
    throw error;
  }
}
