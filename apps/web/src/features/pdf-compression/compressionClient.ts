import type {
  CompressionMetadata,
  CompressionPreset,
  HeavyToolErrorResponse,
} from '@kagaz/shared-types';

export class CompressionError extends Error {}

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

const FRIENDLY_ERRORS: Record<HeavyToolErrorResponse['error']['code'], string> =
  {
    'invalid-request':
      'The server could not read the compression request. Please retry.',
    'invalid-pdf': 'The generated PDF could not be safely read by the server.',
    'file-too-large':
      'Compression supports PDFs up to 20 MiB. Extract fewer pages and try again.',
    'unsupported-pdf':
      'The server cannot process encrypted PDFs, interactive forms, or PDFs over 300 pages.',
    'processing-timeout':
      'The server took too long. Try a smaller PDF or retry.',
    'server-busy': 'The server is busy. Please try again in a moment.',
    'processing-failed':
      'The server could not safely compress this PDF. Please retry.',
    cancelled: 'Compression was cancelled.',
  };

export async function uploadCompression(
  bytes: Uint8Array,
  preset: CompressionPreset,
  signal: AbortSignal,
  onProcessing: () => void,
  apiUrl = import.meta.env.VITE_API_URL ?? '',
): Promise<{ bytes: Uint8Array; metadata: CompressionMetadata }> {
  if (bytes.byteLength > 20 * 1024 * 1024)
    throw new CompressionError(FRIENDLY_ERRORS['file-too-large']);
  const form = new FormData();
  form.append(
    'file',
    new Blob([bytes.slice()], { type: 'application/pdf' }),
    'workspace.pdf',
  );
  form.append('preset', preset);
  // Fetch has no trustworthy upload percentage. Report an indeterminate network stage.
  onProcessing();
  let response: Response;
  try {
    response = await fetch(`${apiUrl.replace(/\/$/, '')}/tools/compress`, {
      method: 'POST',
      body: form,
      signal,
      credentials: 'omit',
      cache: 'no-store',
    });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new CompressionError(
      'Could not reach the compression server. Check your connection and retry.',
    );
  }
  if (!response.ok) {
    let message = 'The compression server is unavailable. Please retry.';
    try {
      const payload: unknown = await response.json();
      if (
        typeof payload === 'object' &&
        payload !== null &&
        'error' in payload &&
        typeof payload.error === 'object' &&
        payload.error !== null &&
        'code' in payload.error &&
        typeof payload.error.code === 'string' &&
        Object.hasOwn(FRIENDLY_ERRORS, payload.error.code)
      ) {
        message =
          FRIENDLY_ERRORS[
            payload.error.code as HeavyToolErrorResponse['error']['code']
          ];
      }
    } catch {
      /* Proxies may return HTML; never expose it to the user. */
    }
    throw new CompressionError(message);
  }
  if (!response.headers.get('Content-Type')?.startsWith('application/pdf'))
    throw new CompressionError(
      'The server did not return a PDF. Please retry.',
    );
  const declaredSize = Number(response.headers.get('X-Kagaz-Compressed-Bytes'));
  try {
    readCompressionMetadata(
      response.headers,
      preset,
      bytes.byteLength,
      declaredSize,
    );
  } catch (error) {
    await response.body?.cancel().catch(() => {});
    throw error;
  }
  const chunks: Uint8Array[] = [];
  let length = 0;
  const reader = response.body?.getReader();
  if (!reader)
    throw new CompressionError(
      'The server returned an empty result. Please retry.',
    );
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.length;
      if (length > declaredSize)
        throw new CompressionError(
          'The server returned an oversized result. Please retry.',
        );
      chunks.push(chunk.value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    if (signal.aborted || error instanceof CompressionError) throw error;
    throw new CompressionError(
      'The download was interrupted. Check your connection and retry.',
    );
  } finally {
    reader.releaseLock();
  }
  const output = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  if (new TextDecoder().decode(output.subarray(0, 5)) !== '%PDF-')
    throw new CompressionError(
      'The server returned an invalid PDF. Please retry.',
    );
  const metadata = readCompressionMetadata(
    response.headers,
    preset,
    bytes.byteLength,
    output.byteLength,
  );
  return { bytes: output, metadata };
}
