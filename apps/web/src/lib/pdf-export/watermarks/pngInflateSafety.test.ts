import { afterEach, describe, expect, it, vi } from 'vitest';
import { validateWatermarkPngDeflate } from './pngInflateSafety';

// Deterministic RFC 1950 zlib + RFC 1951 stored blocks for test pixel streams.
// Production validation uses the browser's independent native implementation.
function deflateFixture(raw: Uint8Array): Uint8Array {
  const bytes = new Uint8Array(
    2 + raw.length + Math.max(1, Math.ceil(raw.length / 65535)) * 5 + 4,
  );
  bytes.set([0x78, 0x01]);
  let output = 2;
  for (let input = 0; input < raw.length || input === 0;) {
    const length = Math.min(65535, raw.length - input);
    const last = input + length === raw.length;
    bytes.set(
      [
        last ? 1 : 0,
        length & 255,
        length >>> 8,
        ~length & 255,
        (~length >>> 8) & 255,
      ],
      output,
    );
    output += 5;
    bytes.set(raw.subarray(input, input + length), output);
    output += length;
    input += length;
    if (last) break;
  }
  let a = 1;
  let b = 0;
  for (const value of raw) {
    a = (a + value) % 65521;
    b = (b + a) % 65521;
  }
  new DataView(bytes.buffer).setUint32(output, ((b << 16) | a) >>> 0);
  return bytes;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const bytes = new Uint8Array(data.length + 12);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, data.length);
  bytes.set(new TextEncoder().encode(type), 4);
  bytes.set(data, 8);
  let crc = 0xffffffff;
  for (const byte of bytes.subarray(4, bytes.length - 4)) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1)
      crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  view.setUint32(bytes.length - 4, (crc ^ 0xffffffff) >>> 0);
  return bytes;
}

function fixture(
  raw: Uint8Array,
  options: {
    width?: number;
    height?: number;
    depth?: number;
    type?: number;
    interlace?: number;
    compressed?: Uint8Array;
    split?: boolean;
  } = {},
): Uint8Array {
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, options.width ?? 1);
  view.setUint32(4, options.height ?? 1);
  header[8] = options.depth ?? 8;
  header[9] = options.type ?? 6;
  header[12] = options.interlace ?? 0;
  const compressed = options.compressed ?? deflateFixture(raw);
  const parts = options.split
    ? [
        ...Array.from({ length: compressed.length }, (_, index) =>
          pngChunk('IDAT', compressed.subarray(index, index + 1)),
        ),
      ]
    : [pngChunk('IDAT', compressed)];
  return Uint8Array.from([
    137,
    80,
    78,
    71,
    13,
    10,
    26,
    10,
    ...pngChunk('IHDR', header),
    ...parts.flatMap((part) => [...part]),
    ...pngChunk('IEND', new Uint8Array()),
  ]);
}

function outputChunks(chunks: readonly Uint8Array[]): void {
  vi.stubGlobal(
    'DecompressionStream',
    class {
      constructor() {
        let sent = false;
        return new TransformStream<BufferSource, Uint8Array>({
          transform(_input, controller) {
            if (!sent) for (const chunk of chunks) controller.enqueue(chunk);
            sent = true;
          },
        });
      }
    },
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('bounded native PNG inflate inspection', () => {
  it('validates exact decompressed scanlines, including valid filter values', async () => {
    for (const filter of [0, 1, 2, 3, 4])
      await expect(
        validateWatermarkPngDeflate(
          fixture(Uint8Array.from([filter, 1, 2, 3, 4])),
        ),
      ).resolves.toBeUndefined();
  });
  it('handles IDAT split across small chunks without joining compressed buffers', async () => {
    await expect(
      validateWatermarkPngDeflate(fixture(new Uint8Array(5), { split: true })),
    ).resolves.toBeUndefined();
  });
  it.each([
    new Uint8Array(4),
    new Uint8Array(6),
    Uint8Array.from([5, 1, 2, 3, 4]),
  ])(
    'rejects incomplete, excess or invalid-filter scanline content',
    async (raw) => {
      await expect(
        validateWatermarkPngDeflate(fixture(raw)),
      ).rejects.toMatchObject({ code: 'watermark-image-invalid' });
    },
  );
  it('rejects the independently discovered valid-CRC malformed DEFLATE fixture', async () => {
    const bytes = Uint8Array.from(
      atob(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADklEQVR4nAQAAAAAAAAAAAAAANvPr/sAAAAASUVORK5CYII=',
      ),
      (character) => character.charCodeAt(0),
    );
    await expect(validateWatermarkPngDeflate(bytes)).rejects.toMatchObject({
      code: 'watermark-image-invalid',
    });
  });
  it('rejects a corrupt zlib checksum despite a valid enclosing IDAT CRC', async () => {
    const compressed = deflateFixture(new Uint8Array(5));
    compressed[compressed.length - 1] = compressed[compressed.length - 1]! ^ 1;
    await expect(
      validateWatermarkPngDeflate(fixture(new Uint8Array(), { compressed })),
    ).rejects.toMatchObject({ code: 'watermark-image-invalid' });
  });
  it('stops expansion exceeding the declared pixel budget rather than buffering it', async () => {
    await expect(
      validateWatermarkPngDeflate(fixture(new Uint8Array(1024 * 1024))),
    ).rejects.toMatchObject({ code: 'watermark-image-invalid' });
  });
  it('validates Adam7 pass row sizes from a deterministic 9×9 RGB fixture', async () => {
    // PNG specification's seven passes for 9×9: width/rows listed explicitly.
    const passes = [
      [2, 2],
      [1, 2],
      [3, 1],
      [2, 3],
      [5, 2],
      [4, 5],
      [9, 4],
    ] as const;
    const raw = Uint8Array.from(
      passes.flatMap(([width, rows]) =>
        Array.from({ length: rows }, () => [
          0,
          ...new Uint8Array(width * 3),
        ]).flat(),
      ),
    );
    await expect(
      validateWatermarkPngDeflate(
        fixture(raw, { width: 9, height: 9, type: 2, interlace: 1 }),
      ),
    ).resolves.toBeUndefined();
    await expect(
      validateWatermarkPngDeflate(
        fixture(raw.subarray(0, -1), {
          width: 9,
          height: 9,
          type: 2,
          interlace: 1,
        }),
      ),
    ).rejects.toMatchObject({ code: 'watermark-image-invalid' });
  });
  it('supports packed gray and 16-bit RGBA scanline sizes', async () => {
    await expect(
      validateWatermarkPngDeflate(
        fixture(new Uint8Array(3), { width: 9, depth: 1, type: 0 }),
      ),
    ).resolves.toBeUndefined();
    await expect(
      validateWatermarkPngDeflate(fixture(new Uint8Array(9), { depth: 16 })),
    ).resolves.toBeUndefined();
  });
  it('handles output chunks ending after the filter, a row, and an Adam7 pass', async () => {
    outputChunks([
      Uint8Array.of(0),
      Uint8Array.of(1),
      Uint8Array.of(2, 3),
      Uint8Array.of(4),
      Uint8Array.of(0, 5, 6, 7, 8),
    ]);
    await expect(
      validateWatermarkPngDeflate(fixture(new Uint8Array(10), { height: 2 })),
    ).resolves.toBeUndefined();
    vi.unstubAllGlobals();
    // 1×1 Adam7 has only its first pass; first output ends immediately after its filter.
    outputChunks([Uint8Array.of(0), new Uint8Array(4)]);
    await expect(
      validateWatermarkPngDeflate(fixture(new Uint8Array(5), { interlace: 1 })),
    ).resolves.toBeUndefined();
  });
  it('aborts while a decoder is pending, without waiting on native completion', async () => {
    vi.stubGlobal(
      'DecompressionStream',
      class {
        constructor() {
          return {
            readable: new ReadableStream(),
            writable: new WritableStream({
              write: () => new Promise<void>(() => undefined),
            }),
          };
        }
      },
    );
    const controller = new AbortController();
    const operation = validateWatermarkPngDeflate(
      fixture(new Uint8Array(5)),
      controller.signal,
    );
    controller.abort();
    await expect(operation).rejects.toMatchObject({ code: 'aborted' });
  });
  it('fails closed on native inflate timeout', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'DecompressionStream',
      class {
        constructor() {
          return {
            readable: new ReadableStream(),
            writable: new WritableStream({
              write: () => new Promise<void>(() => undefined),
            }),
          };
        }
      },
    );
    const operation = validateWatermarkPngDeflate(fixture(new Uint8Array(5)));
    const rejection = expect(operation).rejects.toMatchObject({
      code: 'watermark-image-invalid',
    });
    await vi.advanceTimersByTimeAsync(10_000);
    await rejection;
  });
  it('fails closed when native zlib validation is unavailable', async () => {
    vi.stubGlobal('DecompressionStream', undefined);
    await expect(
      validateWatermarkPngDeflate(fixture(new Uint8Array(5))),
    ).rejects.toMatchObject({ code: 'watermark-image-invalid' });
  });
});
