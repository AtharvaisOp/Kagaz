/// <reference types="node" />
import { readFile } from 'node:fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';

const valid = Uint8Array.from(
  await readFile(
    new URL('../../assets/fonts/NotoSans-Regular.ttf', import.meta.url),
  ),
);

function expectValidBytes(actual: Uint8Array | undefined): void {
  expect(actual?.byteLength).toBe(valid.byteLength);
  expect(Buffer.from(actual ?? []).equals(Buffer.from(valid))).toBe(true);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function freshModule() {
  vi.resetModules();
  return import('./fontAssets');
}

describe('bounded bundled font lifecycle', () => {
  it('loads the one local asset once and returns separate immutable export copies', async () => {
    const fetchMock = vi.fn((_url: string, _options: RequestInit) =>
      Promise.resolve(new Response(valid)),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { snapshotFontAssets, NOTO_SANS_ASSET } = await freshModule();
    const [first, second] = await Promise.all([
      snapshotFontAssets(['noto-sans']),
      snapshotFontAssets(['helvetica', 'noto-sans', 'noto-sans']),
    ]);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[0]).toBe(NOTO_SANS_ASSET.url);
    expect(fetchMock.mock.calls[0]?.[1].credentials).toBe('omit');
    expect(fetchMock.mock.calls[0]?.[1].signal).toBeInstanceOf(AbortSignal);
    expect(first.get('noto-sans')).not.toBe(second.get('noto-sans'));
    first.get('noto-sans')?.fill(0);
    expectValidBytes(second.get('noto-sans'));
    expectValidBytes(
      (await snapshotFontAssets(['noto-sans'])).get('noto-sans'),
    );
  });

  it('does not load document font bytes for Helvetica', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { snapshotFontAssets } = await freshModule();
    expect((await snapshotFontAssets(['helvetica'])).size).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects an oversized decoded stream and cancels the reader before accepting bytes', async () => {
    const canceled = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(valid);
        controller.enqueue(new Uint8Array([0]));
      },
      cancel: canceled,
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(body))),
    );
    const { snapshotFontAssets } = await freshModule();
    await expect(snapshotFontAssets(['noto-sans'])).rejects.toMatchObject({
      code: 'invalid-font',
    });
    expect(canceled).toHaveBeenCalledOnce();
  });

  it.each([
    ['short stream', () => new Response(valid.slice(0, -1))],
    [
      'unexpected digest',
      () => {
        const wrong = valid.slice();
        wrong[wrong.length - 1] = (wrong[wrong.length - 1] ?? 0) ^ 1;
        return new Response(wrong);
      },
    ],
    [
      'oversized Content-Length',
      () =>
        new Response(valid, {
          headers: { 'Content-Length': String(valid.length + 1) },
        }),
    ],
    [
      'invalid Content-Length',
      () => new Response(valid, { headers: { 'Content-Length': 'Infinity' } }),
    ],
    ['HTTP failure', () => new Response('', { status: 503 })],
  ] as const)(
    'rejects %s and permits a later independent retry',
    async (_label, response) => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(response())
        .mockResolvedValueOnce(new Response(valid));
      vi.stubGlobal('fetch', fetchMock);
      const { snapshotFontAssets } = await freshModule();
      await expect(snapshotFontAssets(['noto-sans'])).rejects.toMatchObject({
        name: 'FontTextError',
      });
      expectValidBytes(
        (await snapshotFontAssets(['noto-sans'])).get('noto-sans'),
      );
      expect(fetchMock).toHaveBeenCalledTimes(2);
    },
  );

  it('cancels a caller promptly while preserving another caller of the same fixed resource', async () => {
    let release: (response: Response) => void = () => undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            release = resolve;
          }),
      ),
    );
    const { snapshotFontAssets } = await freshModule();
    const controller = new AbortController();
    const canceled = snapshotFontAssets(['noto-sans'], controller.signal);
    const retained = snapshotFontAssets(['noto-sans']);
    const rejection = expect(canceled).rejects.toMatchObject({
      name: 'AbortError',
    });
    controller.abort();
    await rejection;
    release(new Response(valid));
    expectValidBytes((await retained).get('noto-sans'));
  });

  it('bounds font-loading time independently from an unresponsive transport', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>(() => undefined)),
    );
    const { snapshotFontAssets } = await freshModule();
    const rejection = expect(
      snapshotFontAssets(['noto-sans']),
    ).rejects.toMatchObject({ code: 'font-load-failed' });
    await vi.advanceTimersByTimeAsync(15_000);
    await rejection;
  });

  it('retains one loaded FontFace without object URLs or persistent font data', async () => {
    const add = vi.fn();
    const load = vi.fn().mockResolvedValue(undefined);
    class TestFontFace {
      load = load;
      constructor(
        readonly family: string,
        readonly source: ArrayBuffer,
      ) {}
    }
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(valid))),
    );
    vi.stubGlobal('FontFace', TestFontFace);
    vi.stubGlobal('document', { fonts: { add } });
    const { ensureBrowserDocumentFont } = await freshModule();
    await Promise.all([
      ensureBrowserDocumentFont('noto-sans'),
      ensureBrowserDocumentFont('noto-sans'),
    ]);
    expect(load).toHaveBeenCalledOnce();
    expect(add).toHaveBeenCalledOnce();
    expect(add.mock.calls[0]?.[0]).toMatchObject({ family: 'Kagaz Noto Sans' });
  });
});
