export class HeavyPdfError extends Error {}

export async function uploadHeavyPdf<M>(
  options: (
    | {
        readonly bytes: Uint8Array;
        readonly file?: never;
        readonly field: string;
        readonly value: string;
      }
    | {
        readonly file: File;
        readonly uploadFilename?: string;
        readonly bytes?: never;
        readonly field?: never;
        readonly value?: never;
      }
  ) & {
    readonly signal: AbortSignal;
    readonly onProcessing: () => void;
    readonly apiUrl: string;
    readonly operation: 'compress' | 'ocr' | 'convert-to-pdf';
    readonly maximumInput: number;
    readonly sizeHeader: string;
    readonly errors: Readonly<Record<string, string>>;
    readonly validate: (headers: Headers, actualBytes: number) => M;
  },
): Promise<{ bytes: Uint8Array; metadata: M }> {
  const { signal, onProcessing, apiUrl } = options;
  signal.throwIfAborted();
  if (
    (options.file?.size ?? options.bytes?.byteLength ?? 0) >
    options.maximumInput
  )
    throw new HeavyPdfError(options.errors['file-too-large']);
  const form = new FormData();
  if (options.file)
    form.append(
      'file',
      options.file,
      options.uploadFilename ?? 'selected-document',
    );
  else
    form.append(
      'file',
      new Blob([options.bytes.slice()], { type: 'application/pdf' }),
      'workspace.pdf',
    );
  if (options.field) form.append(options.field, options.value);
  // Fetch has no trustworthy upload percentage. Report an indeterminate network stage.
  onProcessing();
  let response: Response;
  try {
    response = await fetch(
      `${apiUrl.replace(/\/$/, '')}/tools/${options.operation}`,
      {
        method: 'POST',
        body: form,
        signal,
        credentials: 'omit',
        cache: 'no-store',
      },
    );
  } catch (error) {
    if (signal.aborted) throw error;
    throw new HeavyPdfError(
      'Could not reach the processing server. Check your connection and retry.',
    );
  }
  if (!response.ok) {
    let message = 'The processing server is unavailable. Please retry.';
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
        Object.hasOwn(options.errors, payload.error.code)
      ) {
        message = options.errors[payload.error.code]!;
      }
    } catch {
      /* Proxies may return HTML; never expose it to the user. */
    }
    throw new HeavyPdfError(message);
  }
  if (!response.headers.get('Content-Type')?.startsWith('application/pdf'))
    throw new HeavyPdfError('The server did not return a PDF. Please retry.');
  const declaredSize = Number(response.headers.get(options.sizeHeader));
  try {
    options.validate(response.headers, declaredSize);
  } catch (error) {
    await response.body?.cancel().catch(() => {});
    throw error;
  }
  const chunks: Uint8Array[] = [];
  let length = 0;
  const reader = response.body?.getReader();
  if (!reader)
    throw new HeavyPdfError(
      'The server returned an empty result. Please retry.',
    );
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.length;
      if (length > declaredSize)
        throw new HeavyPdfError(
          'The server returned an oversized result. Please retry.',
        );
      chunks.push(chunk.value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    if (signal.aborted || error instanceof HeavyPdfError) throw error;
    throw new HeavyPdfError(
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
    throw new HeavyPdfError(
      'The server returned an invalid PDF. Please retry.',
    );
  const metadata = options.validate(response.headers, output.byteLength);
  return { bytes: output, metadata };
}
