import { describe, expect, it, vi } from 'vitest';

import { createAnnotationAssetRegistry } from './annotationAssetRegistry';
import {
  readJpegExifOrientation,
  UNSUPPORTED_JPEG_ORIENTATION_MESSAGE,
} from './jpegExifOrientation';

function jpegWithOrientation(
  orientation: number,
  endian: 'little' | 'big' = 'little',
): Uint8Array {
  const little = endian === 'little';
  const tiff = new Uint8Array(26);
  const view = new DataView(tiff.buffer);
  view.setUint16(0, little ? 0x4949 : 0x4d4d, false);
  view.setUint16(2, 42, little);
  view.setUint32(4, 8, little);
  view.setUint16(8, 1, little);
  view.setUint16(10, 0x0112, little);
  view.setUint16(12, 3, little);
  view.setUint32(14, 1, little);
  view.setUint16(18, orientation, little);
  view.setUint32(22, 0, little);

  const payload = new Uint8Array(6 + tiff.length);
  payload.set([0x45, 0x78, 0x69, 0x66, 0, 0]);
  payload.set(tiff, 6);
  const segmentLength = payload.length + 2;
  return new Uint8Array([
    0xff,
    0xd8,
    0xff,
    0xe1,
    segmentLength >> 8,
    segmentLength & 0xff,
    ...payload,
    0xff,
    0xd9,
  ]);
}

function registryFixture() {
  const revoked: string[] = [];
  const createObjectUrl = vi.fn(() => 'blob:jpeg');
  const registry = createAnnotationAssetRegistry({
    createId: () => 'asset-jpeg',
    createObjectUrl,
    revokeObjectUrl: (url) => revoked.push(url),
    decode: () =>
      Promise.resolve({
        width: 40,
        height: 20,
        image: {} as CanvasImageSource,
      }),
  });
  return { registry, revoked, createObjectUrl };
}

describe('JPEG EXIF orientation parsing', () => {
  it('accepts JPEGs without EXIF and orientation 1 in both endian forms', () => {
    expect(
      readJpegExifOrientation(new Uint8Array([0xff, 0xd8, 0xff, 0xd9])),
    ).toBeNull();
    expect(readJpegExifOrientation(jpegWithOrientation(1, 'little'))).toBe(1);
    expect(readJpegExifOrientation(jpegWithOrientation(1, 'big'))).toBe(1);
  });

  it.each([2, 3, 6, 8])('reads unsupported orientation %s', (orientation) => {
    expect(readJpegExifOrientation(jpegWithOrientation(orientation))).toBe(
      orientation,
    );
  });

  it('handles truncated and malformed metadata without out-of-bounds reads', () => {
    expect(() =>
      readJpegExifOrientation(
        new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0, 40, 0x45]),
      ),
    ).not.toThrow();
    expect(
      readJpegExifOrientation(
        new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0, 40, 0x45]),
      ),
    ).toBeNull();
  });
});

describe('JPEG EXIF orientation registration policy', () => {
  it.each([
    ['without EXIF', new Uint8Array([0xff, 0xd8, 0xff, 0xd9])],
    ['with little-endian orientation 1', jpegWithOrientation(1, 'little')],
    ['with big-endian orientation 1', jpegWithOrientation(1, 'big')],
  ])('accepts a JPEG %s', async (_description, bytes) => {
    const { registry, createObjectUrl } = registryFixture();
    const asset = await registry.register(
      new Blob([bytes.buffer as ArrayBuffer], { type: 'image/jpeg' }),
    );
    expect(asset.mimeType).toBe('image/jpeg');
    expect(registry.size).toBe(1);
    expect(createObjectUrl).toHaveBeenCalledOnce();
  });

  it('rejects big-endian non-default orientation before asset creation', async () => {
    const { registry, createObjectUrl } = registryFixture();
    const bytes = jpegWithOrientation(6, 'big');
    await expect(
      registry.register(
        new Blob([bytes.buffer as ArrayBuffer], { type: 'image/jpeg' }),
      ),
    ).rejects.toThrow(UNSUPPORTED_JPEG_ORIENTATION_MESSAGE);
    expect(registry.size).toBe(0);
    expect(createObjectUrl).not.toHaveBeenCalled();
  });

  it.each([2, 3, 4, 5, 6, 7, 8])(
    'rejects orientation %s before creating a runtime asset',
    async (orientation) => {
      const { registry, revoked, createObjectUrl } = registryFixture();
      const bytes = jpegWithOrientation(orientation);
      await expect(
        registry.register(
          new Blob([bytes.buffer as ArrayBuffer], {
            type: 'image/jpeg',
          }),
        ),
      ).rejects.toThrow(UNSUPPORTED_JPEG_ORIENTATION_MESSAGE);
      expect(registry.size).toBe(0);
      expect(createObjectUrl).not.toHaveBeenCalled();
      expect(revoked).toEqual([]);
    },
  );

  it('accepts ordinary PNGs without attempting JPEG metadata parsing', async () => {
    const { registry } = registryFixture();
    const asset = await registry.register(
      new Blob(['png'], { type: 'image/png' }),
    );
    expect(asset.mimeType).toBe('image/png');
    expect(registry.size).toBe(1);
  });
});
