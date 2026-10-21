import { once } from 'node:events';
import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { uploadCompression } from '../pdf-compression/compressionClient';
import { uploadOcr } from '../pdf-ocr/ocrClient';

const input = new TextEncoder().encode('%PDF-1.7 original workspace bytes');
const output = new TextEncoder().encode('%PDF-1.7 result');
const upload = (signal = new AbortController().signal) =>
  uploadCompression(input, 'balanced', signal, () => {});
function serverUrl(server: Server) {
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('address');
  return `http://127.0.0.1:${address.port}`;
}
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

describe('bounded shared heavy-tool response transport', () => {
  it.each([307, 308])(
    'does not resend an OCR upload to another origin after HTTP %s',
    async (status) => {
      let sourceRequests = 0;
      let redirectedUploads = 0;
      const target = createServer((request, response) => {
        redirectedUploads++;
        request.resume();
        response.writeHead(502);
        response.end();
      });
      const source = createServer((request, response) => {
        sourceRequests++;
        request.resume();
        response.writeHead(status, { Location: `${serverUrl(target)}/upload` });
        response.end();
      });
      try {
        target.listen(0, '127.0.0.1');
        await once(target, 'listening');
        source.listen(0, '127.0.0.1');
        await once(source, 'listening');
        await expect(
          uploadOcr(
            input,
            'eng',
            new AbortController().signal,
            () => {},
            serverUrl(source),
          ),
        ).rejects.toThrow();
        expect(sourceRequests).toBe(1);
        expect(redirectedUploads).toBe(0);
      } finally {
        for (const server of [source, target]) server.closeAllConnections();
        await Promise.all(
          [source, target].map(
            (server) =>
              new Promise<void>((resolve) => server.close(() => resolve())),
          ),
        );
      }
    },
  );
  it.each([
    ['compression', () => upload()],
    [
      'OCR',
      () => uploadOcr(input, 'eng', new AbortController().signal, () => {}),
    ],
  ] as const)(
    'explains the active-content policy for %s rejection',
    async (operation, request) => {
      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockResolvedValue(
            new Response(
              JSON.stringify({ error: { code: 'unsupported-pdf' } }),
              { status: 422 },
            ),
          ),
      );
      await expect(request()).rejects.toThrow(
        operation === 'OCR'
          ? /encryption.*interactive forms.*digital-signature structures.*active content.*external hyperlink actions.*unflattened source annotations.*no automatic conversion/i
          : /flattened PDF.*encryption.*interactive forms.*digital-signature structures.*active content/i,
      );
    },
  );

  it('cancels an oversized streamed proxy error before retaining its body', async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(8 * 1024));
        controller.enqueue(new TextEncoder().encode('private proxy output'));
      },
      cancel,
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(stream, { status: 502 })),
    );
    await expect(upload()).rejects.toThrow('server is unavailable');
    expect(cancel).toHaveBeenCalledOnce();
    expect(stream.locked).toBe(false);
  });

  it('uses only the trusted code from a small error envelope', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: {
              code: 'server-busy',
              message: '/tmp/private native output',
            },
          }),
          { status: 503 },
        ),
      ),
    );
    await expect(upload()).rejects.toThrow('server is busy');
  });

  it.each(['text/html', 'application/pdf-malformed'])(
    'cancels a rejected response media type: %s',
    async (mediaType) => {
      const cancel = vi.fn();
      const stream = new ReadableStream<Uint8Array>({ cancel });
      const responseHeaders = headers();
      responseHeaders.set('Content-Type', mediaType);
      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockResolvedValue(
            new Response(stream, { headers: responseHeaders }),
          ),
      );
      await expect(upload()).rejects.toThrow('did not return a PDF');
      expect(cancel).toHaveBeenCalledOnce();
      expect(stream.locked).toBe(false);
    },
  );

  it('accepts a parameterized PDF media type', async () => {
    const responseHeaders = headers();
    responseHeaders.set('Content-Type', 'Application/PDF; charset=binary');
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(new Response(output, { headers: responseHeaders })),
    );
    expect((await upload()).bytes).toEqual(output);
  });

  it('requires a PDF version rather than accepting only a PDF prefix', async () => {
    const invalid = output.slice();
    invalid.set(new TextEncoder().encode('%PDF-xxx'));
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(invalid, { headers: headers() })),
    );
    await expect(upload()).rejects.toThrow('invalid PDF');
  });

  it('preserves cancellation while reading an error body', async () => {
    const controller = new AbortController();
    const stream = new ReadableStream<Uint8Array>(
      {
        pull(source) {
          controller.abort();
          source.error(controller.signal.reason);
        },
      },
      { highWaterMark: 0 },
    );
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(stream, { status: 502 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(upload(controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(stream.locked).toBe(false);
  });
});
