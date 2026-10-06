import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  readCompressionMetadata,
  uploadCompression,
} from './compressionClient';

const input = new TextEncoder().encode('%PDF-1.7 original workspace bytes');
const output = new TextEncoder().encode('%PDF-1.7 result');
function headers() {
  return new Headers({
    'Content-Type': 'application/pdf',
    'X-Kagaz-Original-Bytes': String(input.length),
    'X-Kagaz-Compressed-Bytes': String(output.length),
    'X-Kagaz-Saved-Bytes': String(input.length - output.length),
    'X-Kagaz-Saved-Percent': String(
      ((input.length - output.length) / input.length) * 100,
    ),
    'X-Kagaz-Preset': 'balanced',
    'X-Kagaz-Outcome': 'compressed',
  });
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
describe('explicit compression upload', () => {
  it('bounds a stalled server with a friendly deadline and preserves user cancellation', async () => {
    const deadline = new AbortController();
    deadline.abort(new DOMException('Timed out', 'TimeoutError'));
    const timeout = vi
      .spyOn(AbortSignal, 'timeout')
      .mockReturnValue(deadline.signal);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      uploadCompression(
        input,
        'balanced',
        new AbortController().signal,
        () => {},
      ),
    ).rejects.toThrow('server took too long');
    expect(timeout).toHaveBeenCalledWith(150_000);
    expect(fetchMock).not.toHaveBeenCalled();
    const controller = new AbortController();
    controller.abort();
    await expect(
      uploadCompression(input, 'balanced', controller.signal, () => {}),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
  it('bounds streamed response bytes even when the server lies about the body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(new Uint8Array(input.length * 2), {
          headers: headers(),
        }),
      ),
    );
    await expect(
      uploadCompression(
        input,
        'balanced',
        new AbortController().signal,
        () => {},
      ),
    ).rejects.toThrow('oversized');
  });
  it('uploads only one generated PDF and preset, with no source filenames or credentials', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(output, { headers: headers() }));
    vi.stubGlobal('fetch', fetchMock);
    const processing = vi.fn(),
      signal = new AbortController().signal;
    const result = await uploadCompression(
      input,
      'balanced',
      signal,
      processing,
      'https://api.example/',
    );
    expect(processing).toHaveBeenCalledOnce();
    const [url, options] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.example/tools/compress');
    expect(options?.signal).toBeInstanceOf(AbortSignal);
    expect(options?.signal?.aborted).toBe(false);
    expect(options?.credentials).toBe('omit');
    const body = options?.body;
    expect(body).toBeInstanceOf(FormData);
    if (!(body instanceof FormData)) throw new Error();
    expect([...body.keys()]).toEqual(['file', 'preset']);
    const file = body.get('file');
    if (!(file instanceof File)) throw new Error();
    expect(file.name).toBe('workspace.pdf');
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(input);
    expect(result.bytes).toEqual(output);
    expect(result.metadata.savedPercent).toBeCloseTo(
      ((input.length - output.length) / input.length) * 100,
    );
  });
  it('calculates zero savings for unchanged output and rejects contradictory metadata', () => {
    const h = headers();
    h.set('X-Kagaz-Compressed-Bytes', String(input.length));
    h.set('X-Kagaz-Saved-Bytes', '0');
    h.set('X-Kagaz-Saved-Percent', '0');
    h.set('X-Kagaz-Outcome', 'unchanged');
    expect(
      readCompressionMetadata(h, 'balanced', input.length, input.length)
        .savedPercent,
    ).toBe(0);
    h.set('X-Kagaz-Saved-Percent', '50');
    expect(() =>
      readCompressionMetadata(h, 'balanced', input.length, input.length),
    ).toThrow('incomplete');
  });
  it.each([
    'X-Kagaz-Original-Bytes',
    'X-Kagaz-Preset',
    'X-Kagaz-Outcome',
    'X-Kagaz-Saved-Bytes',
  ])('rejects incomplete result header %s', (key) => {
    const h = headers();
    h.delete(key);
    expect(() =>
      readCompressionMetadata(h, 'balanced', input.length, output.length),
    ).toThrow('incomplete');
  });
  it.each([
    'server-busy',
    'processing-timeout',
    'invalid-pdf',
    'unsupported-pdf',
    'processing-failed',
    'file-too-large',
  ])(
    'uses trusted human messages for %s, ignoring raw server text',
    async (code) => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          new Response(
            JSON.stringify({
              error: { code, message: 'native stderr /tmp/private' },
            }),
            { status: 503 },
          ),
        ),
      );
      await expect(
        uploadCompression(
          input,
          'balanced',
          new AbortController().signal,
          () => {},
        ),
      ).rejects.not.toThrow('native stderr');
    },
  );
  it('reports network failure and preserves cancellation', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('raw network internals')),
    );
    await expect(
      uploadCompression(
        input,
        'balanced',
        new AbortController().signal,
        () => {},
      ),
    ).rejects.toThrow('Check your connection');
    const fetchMock = vi
      .fn()
      .mockRejectedValue(new Error('raw network internals'));
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();
    controller.abort();
    await expect(
      uploadCompression(input, 'balanced', controller.signal, () => {}),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('rejects oversized generated PDF before starting a request', async () => {
    const mock = vi.fn();
    vi.stubGlobal('fetch', mock);
    await expect(
      uploadCompression(
        new Uint8Array(20 * 1024 * 1024 + 1),
        'balanced',
        new AbortController().signal,
        () => {},
      ),
    ).rejects.toThrow('20 MiB');
    expect(mock).not.toHaveBeenCalled();
  });
  it.each(['wrong-type', 'wrong-magic', 'html-error'])(
    'does not accept proxy or invalid results: %s',
    async (mode) => {
      const response =
        mode === 'html-error'
          ? new Response('<html>private</html>', { status: 502 })
          : new Response(mode === 'wrong-magic' ? 'broken' : output, {
              headers:
                mode === 'wrong-type'
                  ? { 'Content-Type': 'text/plain' }
                  : headers(),
            });
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
      await expect(
        uploadCompression(
          input,
          'balanced',
          new AbortController().signal,
          () => {},
        ),
      ).rejects.toThrow();
    },
  );
});
