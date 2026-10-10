import { afterEach, describe, expect, it, vi } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import {
  prepareWatermarkImageFile,
  prepareWatermarkImageSource,
} from './nativeImage';
import { assertWatermarkImageBytes } from './imageSafety';
import { createWatermarkExportContext } from './renderWatermark';
import { createDefaultWatermark } from '../../../features/pdf-watermarks/model/watermark';

const png = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  ),
  (character) => character.charCodeAt(0),
);
// Valid CRCs/header, malformed DEFLATE: never send it to synchronous UPNG.
const malformedIdat = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADklEQVR4nAQAAAAAAAAAAAAAANvPr/sAAAAASUVORK5CYII=',
  ),
  (character) => character.charCodeAt(0),
);
const jpeg = Uint8Array.from([
  255, 216, 255, 192, 0, 11, 8, 0, 1, 0, 1, 1, 1, 17, 0, 255, 217,
]);
const source = (
  bytes = png,
  mimeType: 'image/png' | 'image/jpeg' = 'image/png',
) => ({ assetId: 'image', bytes, mimeType });

function nativeRuntime(
  options: {
    error?: boolean;
    pending?: boolean;
    width?: number;
    encoded?: Blob | null;
  } = {},
) {
  const decoded: FakeImage[] = [];
  class FakeImage {
    decoding = '';
    naturalWidth = options.width ?? 1;
    naturalHeight = 1;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    value = '';
    constructor() {
      decoded.push(this);
    }
    set src(value: string) {
      this.value = value;
      if (value && !options.pending)
        queueMicrotask(() =>
          options.error ? this.onerror?.() : this.onload?.(),
        );
    }
    get src() {
      return this.value;
    }
  }
  const drawImage = vi.fn();
  const canvas = {
    width: 0,
    height: 0,
    getContext: vi.fn(() => ({ drawImage })),
    toBlob: vi.fn((callback: (blob: Blob | null) => void) =>
      callback(
        options.encoded === undefined
          ? new Blob([png], { type: 'image/png' })
          : options.encoded,
      ),
    ),
  };
  vi.stubGlobal('Image', FakeImage);
  vi.stubGlobal('document', { createElement: vi.fn(() => canvas) });
  const createObjectUrl = vi
    .spyOn(URL, 'createObjectURL')
    .mockReturnValue('blob:watermark-test');
  const revokeObjectUrl = vi
    .spyOn(URL, 'revokeObjectURL')
    .mockImplementation(() => undefined);
  return { canvas, decoded, drawImage, createObjectUrl, revokeObjectUrl };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('watermark native image trust boundary', () => {
  it('re-encodes PNG from decoded pixels, and releases the URL and canvas', async () => {
    const runtime = nativeRuntime();
    const prepared = await prepareWatermarkImageSource(source());
    expect(prepared.bytes).toEqual(png);
    expect(prepared.bytes).not.toBe(png);
    expect(runtime.drawImage).toHaveBeenCalledOnce();
    expect(runtime.canvas.toBlob).toHaveBeenCalledWith(
      expect.any(Function),
      'image/png',
    );
    expect(runtime.canvas.width).toBe(0);
    expect(runtime.canvas.height).toBe(0);
    expect(runtime.decoded[0]?.src).toBe('');
    expect(runtime.revokeObjectUrl).toHaveBeenCalledExactlyOnceWith(
      'blob:watermark-test',
    );
  });
  it('rejects the valid-CRC malformed-IDAT fixture before synchronous pdf-lib embed', async () => {
    expect(assertWatermarkImageBytes(malformedIdat, 'image/png')).toEqual({
      width: 1,
      height: 1,
    });
    nativeRuntime({ error: true });
    const document = await PDFDocument.create();
    const embed = vi.spyOn(document, 'embedPng');
    await expect(
      createWatermarkExportContext(
        document,
        { ...createDefaultWatermark('w'), kind: 'image', assetId: 'image' },
        new Map([['image', source(malformedIdat)]]),
      ),
    ).rejects.toMatchObject({ code: 'watermark-image-invalid' });
    expect(embed).not.toHaveBeenCalled();
  });
  it('rejects header-valid JPEG data when native decoding fails', async () => {
    nativeRuntime({ error: true });
    await expect(
      prepareWatermarkImageSource(source(jpeg, 'image/jpeg')),
    ).rejects.toMatchObject({ code: 'watermark-image-invalid' });
  });
  it('validates real JPEG dimensions without encoding another raster', async () => {
    const runtime = nativeRuntime();
    const prepared = await prepareWatermarkImageSource(
      source(jpeg, 'image/jpeg'),
    );
    expect(prepared.bytes).toEqual(jpeg);
    expect(runtime.canvas.toBlob).not.toHaveBeenCalled();
  });
  it('rejects native dimensions differing from the bounded header', async () => {
    const runtime = nativeRuntime({ width: 2 });
    await expect(prepareWatermarkImageSource(source())).rejects.toMatchObject({
      code: 'watermark-image-invalid',
    });
    expect(runtime.canvas.toBlob).not.toHaveBeenCalled();
  });
  it.each([
    null,
    new Blob([], { type: 'image/png' }),
    new Blob([new Uint8Array(10 * 1024 * 1024 + 1)], { type: 'image/png' }),
  ])(
    'fails closed on missing, empty or oversized canonical PNG output',
    async (encoded) => {
      nativeRuntime({ encoded });
      await expect(prepareWatermarkImageSource(source())).rejects.toMatchObject(
        { code: 'watermark-image-invalid' },
      );
    },
  );
  it('aborts pending native decoding and revokes its URL', async () => {
    const runtime = nativeRuntime({ pending: true });
    const controller = new AbortController();
    const operation = prepareWatermarkImageSource(
      source(jpeg, 'image/jpeg'),
      controller.signal,
    );
    controller.abort();
    await expect(operation).rejects.toMatchObject({ code: 'aborted' });
    expect(runtime.revokeObjectUrl).toHaveBeenCalledOnce();
    expect(runtime.decoded[0]?.src).toBe('');
  });
  it('times out an unavailable native decoder and releases its resources', async () => {
    vi.useFakeTimers();
    const runtime = nativeRuntime({ pending: true });
    const operation = prepareWatermarkImageSource(source(jpeg, 'image/jpeg'));
    const result = expect(operation).rejects.toMatchObject({
      code: 'watermark-image-invalid',
    });
    await vi.advanceTimersByTimeAsync(10_000);
    await result;
    expect(runtime.revokeObjectUrl).toHaveBeenCalledOnce();
  });
  it('reuses private canonical bytes once per asset even if a public result is mutated', async () => {
    const runtime = nativeRuntime();
    const first = await prepareWatermarkImageSource(source());
    const publicBytes = first.bytes;
    expect(publicBytes).toBeInstanceOf(Uint8Array);
    if (publicBytes instanceof Uint8Array) publicBytes.fill(0);
    const second = await prepareWatermarkImageSource(first);
    expect(second.bytes).toEqual(png);
    expect(runtime.createObjectUrl).toHaveBeenCalledOnce();
  });
  it('captures mutable input bytes before native decode begins', async () => {
    const runtime = nativeRuntime({ pending: true });
    const original = jpeg.slice();
    const operation = prepareWatermarkImageSource(
      source(original, 'image/jpeg'),
    );
    original.fill(0);
    const blob = runtime.createObjectUrl.mock.calls[0]?.[0];
    expect(blob).toBeInstanceOf(Blob);
    if (blob instanceof Blob)
      expect(new Uint8Array(await blob.arrayBuffer())).toEqual(jpeg);
    runtime.decoded[0]?.onload?.();
    await expect(operation).resolves.toMatchObject({ mimeType: 'image/jpeg' });
  });
  it('provides a canonical selection Blob for registry ownership', async () => {
    nativeRuntime();
    const prepared = await prepareWatermarkImageFile(
      new Blob([png], { type: 'image/png' }),
    );
    expect(prepared.width).toBe(1);
    expect(prepared.height).toBe(1);
    expect(new Uint8Array(await prepared.blob.arrayBuffer())).toEqual(png);
  });
  it('fails closed when browser decoding APIs are unavailable', async () => {
    vi.stubGlobal('Image', undefined);
    await expect(prepareWatermarkImageSource(source())).rejects.toMatchObject({
      code: 'watermark-image-invalid',
    });
  });
});
