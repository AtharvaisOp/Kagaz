import type {
  CompressionMetadata,
  CompressionPreset,
  HeavyToolErrorResponse,
} from '@kagaz/shared-types';

import {
  HeavyPdfError as CompressionError,
  uploadHeavyPdf,
} from '../pdf-heavy-tools/uploadHeavyPdf';
export { CompressionError };

export function readCompressionMetadata(
  headers: Headers,
  preset: CompressionPreset,
  originalBytes: number,
  actualBytes: number,
): CompressionMetadata {
  const number = (name: string) => {
    const value = headers.get(name);
    return value === null ? NaN : Number(value);
  };
  const compressedBytes = number('X-Kagaz-Compressed-Bytes');
  const savedBytes = number('X-Kagaz-Saved-Bytes');
  const savedPercent = number('X-Kagaz-Saved-Percent');
  const outcome = headers.get('X-Kagaz-Outcome');
  if (
    number('X-Kagaz-Original-Bytes') !== originalBytes ||
    compressedBytes !== actualBytes ||
    compressedBytes <= 0 ||
    compressedBytes > originalBytes ||
    savedBytes !== originalBytes - compressedBytes ||
    !Number.isFinite(savedPercent) ||
    Math.abs(savedPercent - (savedBytes / originalBytes) * 100) > 0.001 ||
    headers.get('X-Kagaz-Preset') !== preset ||
    (outcome !== 'compressed' && outcome !== 'unchanged') ||
    (outcome === 'unchanged') !== (savedBytes === 0)
  ) {
    throw new CompressionError(
      'The server returned an incomplete compression result. Please retry.',
    );
  }
  return {
    originalBytes,
    compressedBytes,
    savedBytes,
    savedPercent,
    preset,
    outcome,
  };
}

const FRIENDLY_ERRORS: Readonly<
  Record<HeavyToolErrorResponse['error']['code'], string>
> = {
  'invalid-request':
    'The server could not read the compression request. Please retry.',
  'invalid-pdf': 'The generated PDF could not be safely read by the server.',
  'file-too-large':
    'Compression supports PDFs up to 20 MiB. Extract fewer pages and try again.',
  'unsupported-pdf':
    'The server cannot process encrypted PDFs, interactive forms, or PDFs over 300 pages.',
  'processing-timeout': 'The server took too long. Try a smaller PDF or retry.',
  'server-busy': 'The server is busy. Please try again in a moment.',
  'processing-failed':
    'The server could not safely compress this PDF. Please retry.',
  cancelled: 'Compression was cancelled.',
  'unsupported-language': 'Only English OCR is supported.',
  'no-ocr-needed': 'This PDF does not need OCR.',
  'ocr-failed': 'The server could not validate a searchable PDF.',
  'unsupported-format': 'Choose a supported document format for conversion.',
  'unsafe-document': 'The document contains unsupported or unsafe content.',
  'conversion-failed': 'The document could not be safely converted.',
};

export async function uploadCompression(
  bytes: Uint8Array,
  preset: CompressionPreset,
  signal: AbortSignal,
  onProcessing: () => void,
  apiUrl = import.meta.env.VITE_API_URL ?? '',
): Promise<{ bytes: Uint8Array; metadata: CompressionMetadata }> {
  return uploadHeavyPdf({
    bytes,
    signal,
    onProcessing,
    apiUrl,
    operation: 'compress',
    field: 'preset',
    value: preset,
    maximumInput: 20 * 1024 * 1024,
    sizeHeader: 'X-Kagaz-Compressed-Bytes',
    errors: FRIENDLY_ERRORS,
    validate: (headers, size) =>
      readCompressionMetadata(headers, preset, bytes.byteLength, size),
  });
}
