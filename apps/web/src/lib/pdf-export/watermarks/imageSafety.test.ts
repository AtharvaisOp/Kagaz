import { describe, expect, it } from 'vitest';
import {
  assertWatermarkImageBytes,
  watermarkImageFilePreflight,
  WATERMARK_MAX_IMAGE_BYTES,
} from './imageSafety';

const png = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  ),
  (value) => value.charCodeAt(0),
);
const jpeg = Uint8Array.from([
  0xff, 0xd8, 0xff, 0xc0, 0, 11, 8, 0, 10, 0, 20, 1, 1, 0x11, 0, 0xff, 0xd9,
]);

function chunk(type: string, data: Uint8Array): Uint8Array {
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

function insertChunk(type: string, data: Uint8Array): Uint8Array {
  return Uint8Array.from([
    ...png.subarray(0, 33),
    ...chunk(type, data),
    ...png.subarray(33),
  ]);
}

function exifSegment(orientation: number): Uint8Array {
  const tiff = new Uint8Array(26);
  const view = new DataView(tiff.buffer);
  view.setUint16(0, 0x4949);
  view.setUint16(2, 42, true);
  view.setUint32(4, 8, true);
  view.setUint16(8, 1, true);
  view.setUint16(10, 0x112, true);
  view.setUint16(12, 3, true);
  view.setUint32(14, 1, true);
  view.setUint16(18, orientation, true);
  return Uint8Array.from([255, 225, 0, 34, 69, 120, 105, 102, 0, 0, ...tiff]);
}

describe('watermark image predecode budgets', () => {
  it('reads PNG and JPEG dimensions from bounded format-specific headers', () => {
    expect(assertWatermarkImageBytes(png, 'image/png')).toEqual({
      width: 1,
      height: 1,
    });
    expect(assertWatermarkImageBytes(jpeg, 'image/jpeg')).toEqual({
      width: 20,
      height: 10,
    });
  });
  it('honors Uint8Array byte offsets and ArrayBuffer inputs', () => {
    const padded = new Uint8Array(png.length + 20);
    padded.set(png, 10);
    expect(
      assertWatermarkImageBytes(
        padded.subarray(10, 10 + png.length),
        'image/png',
      ),
    ).toEqual({ width: 1, height: 1 });
    expect(assertWatermarkImageBytes(png.slice().buffer, 'image/png')).toEqual({
      width: 1,
      height: 1,
    });
  });
  it.each([
    [0, 1],
    [1, 0],
    [8193, 1],
    [1, 8193],
    [5000, 5000],
  ])('rejects PNG dimensions %i×%i before decode', (width, height) => {
    const bytes = png.slice();
    const view = new DataView(bytes.buffer);
    view.setUint32(16, width);
    view.setUint32(20, height);
    expect(() => assertWatermarkImageBytes(bytes, 'image/png')).toThrowError(
      expect.objectContaining({ code: 'watermark-image-invalid' }),
    );
  });
  it.each([new Uint8Array(), png.subarray(0, 20), jpeg])(
    'rejects wrong or incomplete PNG content despite its declared MIME',
    (bytes) => {
      expect(() => assertWatermarkImageBytes(bytes, 'image/png')).toThrow();
    },
  );
  it.each([
    new Uint8Array(),
    jpeg.subarray(0, 8),
    png,
    Uint8Array.from([255, 216, 255, 218]),
  ])('rejects incomplete or wrong JPEG content', (bytes) => {
    expect(() => assertWatermarkImageBytes(bytes, 'image/jpeg')).toThrow();
  });
  it('rejects oversized bytes before creating registry URLs or images', () => {
    expect(() =>
      assertWatermarkImageBytes(
        new Uint8Array(WATERMARK_MAX_IMAGE_BYTES + 1),
        'image/png',
      ),
    ).toThrow();
  });
  it('requires PNG/JPEG selection and bounded nonempty Blob size', async () => {
    await expect(
      watermarkImageFilePreflight(new Blob([png], { type: 'image/svg+xml' })),
    ).rejects.toMatchObject({ code: 'watermark-image-invalid' });
    await expect(
      watermarkImageFilePreflight(new Blob([], { type: 'image/png' })),
    ).rejects.toMatchObject({ code: 'watermark-image-invalid' });
    await expect(
      watermarkImageFilePreflight(new Blob([png], { type: 'image/png' })),
    ).resolves.toEqual({ width: 1, height: 1 });
  });
  it('rejects a second huge IHDR before either browser or UPNG decoding', () => {
    const header = png.slice(16, 29);
    const view = new DataView(header.buffer);
    view.setUint32(0, 100_000);
    view.setUint32(4, 100_000);
    expect(() =>
      assertWatermarkImageBytes(insertChunk('IHDR', header), 'image/png'),
    ).toThrow(/duplicate/);
  });
  it.each(['acTL', 'fcTL', 'fdAT'])(
    'rejects %s animated/frame chunks before UPNG can allocate frame pixels',
    (type) => {
      const frame = new Uint8Array(26);
      const view = new DataView(frame.buffer);
      view.setUint32(4, 100_000);
      view.setUint32(8, 100_000);
      expect(() =>
        assertWatermarkImageBytes(insertChunk(type, frame), 'image/png'),
      ).toThrow(/Animated/);
    },
  );
  it.each([
    Uint8Array.from([...png, 1]),
    png.slice(0, -12),
    Uint8Array.from([...png.subarray(0, 33), ...png.subarray(-12)]),
    insertChunk('ZZZZ', new Uint8Array()),
  ])(
    'rejects trailing/missing/unknown critical PNG representations',
    (bytes) => {
      expect(() => assertWatermarkImageBytes(bytes, 'image/png')).toThrow();
    },
  );
  it('rejects malformed checksums and invalid IHDR encoding with valid checksums', () => {
    const corrupt = png.slice();
    corrupt[40] = corrupt[40]! ^ 1;
    expect(() => assertWatermarkImageBytes(corrupt, 'image/png')).toThrow(
      /chunk/,
    );
    const header = png.slice(16, 29);
    header[8] = 3;
    const unsupported = Uint8Array.from([
      ...png.subarray(0, 8),
      ...chunk('IHDR', header),
      ...png.subarray(33),
    ]);
    expect(() => assertWatermarkImageBytes(unsupported, 'image/png')).toThrow(
      /encoding/,
    );
  });
  it('rejects duplicate JPEG frame headers instead of trusting the first dimensions', () => {
    const ambiguous = Uint8Array.from([
      ...jpeg.subarray(0, -2),
      ...jpeg.subarray(2),
    ]);
    expect(() => assertWatermarkImageBytes(ambiguous, 'image/jpeg')).toThrow(
      /encoding/,
    );
  });
  it('rejects a second JPEG frame hidden after entropy scan data before native allocation', () => {
    const scan = [255, 218, 0, 2, 1, 2, 255, 0, 3, 255, 208, 4];
    const ambiguous = Uint8Array.from([
      ...jpeg.subarray(0, -2),
      ...scan,
      ...jpeg.subarray(2),
    ]);
    expect(() => assertWatermarkImageBytes(ambiguous, 'image/jpeg')).toThrow(
      /encoding/,
    );
  });
  it('walks multiple progressive scans with stuffed bytes/restarts to the terminal JPEG marker', () => {
    const sequential = Uint8Array.from([
      ...jpeg.subarray(0, -2),
      255,
      218,
      0,
      2,
      1,
      255,
      0,
      2,
      255,
      209,
      3,
      255,
      196,
      0,
      2,
      255,
      218,
      0,
      2,
      4,
      255,
      0,
      5,
      255,
      217,
    ]);
    expect(assertWatermarkImageBytes(sequential, 'image/jpeg')).toEqual({
      width: 20,
      height: 10,
    });
    expect(() =>
      assertWatermarkImageBytes(sequential.subarray(0, -2), 'image/jpeg'),
    ).toThrow(/incomplete|terminal/);
  });
  it('rejects duplicate EXIF orientation metadata even when the first value is normal', () => {
    const ambiguous = Uint8Array.from([
      255,
      216,
      ...exifSegment(1),
      ...exifSegment(3),
      ...jpeg.subarray(2),
    ]);
    expect(() => assertWatermarkImageBytes(ambiguous, 'image/jpeg')).toThrow(
      /orientation/,
    );
  });
  it('rejects EXIF orientation metadata after scan data before native decoding', () => {
    const ambiguous = Uint8Array.from([
      ...jpeg.subarray(0, -2),
      255,
      218,
      0,
      2,
      1,
      2,
      ...exifSegment(3),
      255,
      217,
    ]);
    expect(() => assertWatermarkImageBytes(ambiguous, 'image/jpeg')).toThrow(
      /orientation/,
    );
  });
  it.each([
    ['tEXt', Uint8Array.from([65, 66, 67])],
    ['iTXt', Uint8Array.from([65, 66, 67])],
    ['iTXt', Uint8Array.from([65, 0, 0, 0, 69, 78])],
    ['iTXt', Uint8Array.from([65, 0, 0, 0, 0, 84, 69, 88, 84])],
    ['hIST', Uint8Array.from([1, 2])],
  ] as const)(
    'rejects malformed %s metadata within its chunk before UPNG can scan beyond EOF',
    (type, data) => {
      expect(() =>
        assertWatermarkImageBytes(insertChunk(type, data), 'image/png'),
      ).toThrow();
    },
  );
  it('accepts bounded ordinary PNG metadata with complete terminators', () => {
    expect(
      assertWatermarkImageBytes(
        insertChunk('tEXt', Uint8Array.from([65, 0, 66])),
        'image/png',
      ),
    ).toEqual({ width: 1, height: 1 });
    expect(
      assertWatermarkImageBytes(
        insertChunk('iTXt', Uint8Array.from([65, 0, 0, 0, 0, 0, 66])),
        'image/png',
      ),
    ).toEqual({ width: 1, height: 1 });
  });
  it('rejects non-default JPEG orientation before the registry decoder', () => {
    const tiff = new Uint8Array(26);
    const view = new DataView(tiff.buffer);
    view.setUint16(0, 0x4949);
    view.setUint16(2, 42, true);
    view.setUint32(4, 8, true);
    view.setUint16(8, 1, true);
    view.setUint16(10, 0x112, true);
    view.setUint16(12, 3, true);
    view.setUint32(14, 1, true);
    view.setUint16(18, 6, true);
    const oriented = Uint8Array.from([
      255,
      216,
      255,
      225,
      0,
      34,
      69,
      120,
      105,
      102,
      0,
      0,
      ...tiff,
      ...jpeg.subarray(2),
    ]);
    expect(() => assertWatermarkImageBytes(oriented, 'image/jpeg')).toThrow(
      /orientation/,
    );
  });
});
