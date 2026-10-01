import { afterEach, describe, expect, it, vi } from 'vitest';
import { readOcrMetadata, uploadOcr } from './ocrClient';
const input = new TextEncoder().encode('%PDF-1.7 current workspace');
const output = new TextEncoder().encode(
  '%PDF-1.7 a larger searchable derivative',
);
function headers() {
  return new Headers({
    'Content-Type': 'application/pdf',
    'X-Kagaz-Original-Bytes': String(input.length),
    'X-Kagaz-Output-Bytes': String(output.length),
    'X-Kagaz-Pages': '3',
    'X-Kagaz-Ocr-Language': 'eng',
    'X-Kagaz-Pages-Ocred': '2',
    'X-Kagaz-Pages-Skipped': '1',
  });
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
describe('explicit OCR upload and trusted response', () => {
  it('reports a friendly client deadline while preserving explicit cancellation', async () => {
    const deadline = new AbortController();
    deadline.abort(new DOMException('Timed out', 'TimeoutError'));
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(deadline.signal.reason));
    await expect(
      uploadOcr(input, 'eng', new AbortController().signal, () => {}),
    ).rejects.toThrow('OCR took too long');
  });
  it('uploads only the flattened derivative and English choice, then validates a larger download', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(output, { headers: headers() }));
    vi.stubGlobal('fetch', fetchMock);
    const processing = vi.fn();
    const result = await uploadOcr(
      input,
      'eng',
      new AbortController().signal,
      processing,
      'https://api.example/',
    );
    expect(result.bytes).toEqual(output);
    expect(result.metadata.pagesOcred).toBe(2);
    expect(processing).toHaveBeenCalledOnce();
    const [url, options] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.example/tools/ocr');
    expect(options?.credentials).toBe('omit');
    const body = options?.body;
    if (!(body instanceof FormData)) throw new Error('body');
    expect([...body.keys()]).toEqual(['file', 'language']);
    expect(body.get('language')).toBe('eng');
    const file = body.get('file');
    if (!(file instanceof File)) throw new Error('file');
    expect(file.name).toBe('workspace.pdf');
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(input);
  });
  it.each([
    ['X-Kagaz-Pages', '21'],
    ['X-Kagaz-Pages-Ocred', '0'],
    ['X-Kagaz-Pages-Skipped', '2'],
    ['X-Kagaz-Ocr-Language', 'auto'],
    ['X-Kagaz-Output-Bytes', '41943041'],
    ['X-Kagaz-Original-Bytes', '999'],
  ])('rejects inconsistent metadata %s=%s', (key, value) => {
    const h = headers();
    h.set(key, value);
    expect(() => readOcrMetadata(h, input.length, output.length)).toThrow(
      'incomplete',
    );
  });
  it.each([
    'server-busy',
    'ocr-failed',
    'no-ocr-needed',
    'unsupported-language',
    'file-too-large',
    'processing-timeout',
  ])('uses safe messages for %s, never stderr or OCR text', async (code) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: { code, message: 'native-secret OCR text /tmp/path' },
          }),
          { status: 500 },
        ),
      ),
    );
    await expect(
      uploadOcr(input, 'eng', new AbortController().signal, () => {}),
    ).rejects.not.toThrow('native-secret');
  });
  it('rejects oversized exports without a network request', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      uploadOcr(
        new Uint8Array(10 * 1024 * 1024 + 1),
        'eng',
        new AbortController().signal,
        () => {},
      ),
    ).rejects.toThrow('10 MiB');
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each([
    'missing-metadata',
    'wrong-type',
    'invalid-header',
    'too-many-bytes',
    'truncated',
  ])('rejects unsafe download %s', async (kind) => {
    const h = headers();
    if (kind === 'missing-metadata') h.delete('X-Kagaz-Pages');
    if (kind === 'wrong-type') h.set('Content-Type', 'text/html');
    const bytes =
      kind === 'invalid-header'
        ? new Uint8Array(output.length)
        : kind === 'too-many-bytes'
          ? new Uint8Array(output.length + 1)
          : kind === 'truncated'
            ? output.slice(0, 10)
            : output;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(bytes, { headers: h })),
    );
    await expect(
      uploadOcr(input, 'eng', new AbortController().signal, () => {}),
    ).rejects.toThrow();
  });
  it('reports network failure and forwards cancellation to fetch', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error('network-secret'));
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      uploadOcr(input, 'eng', new AbortController().signal, () => {}),
    ).rejects.toThrow('Check your connection');
    const controller = new AbortController();
    fetchMock.mockImplementation((_url, options) => {
      expect(options?.signal?.aborted).toBe(true);
      return Promise.reject(new DOMException('Aborted', 'AbortError'));
    });
    controller.abort();
    await expect(
      uploadOcr(input, 'eng', controller.signal, () => {}),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});
