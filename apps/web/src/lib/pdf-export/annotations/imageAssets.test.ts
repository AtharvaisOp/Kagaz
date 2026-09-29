import { describe, expect, it, vi } from 'vitest';

import { snapshotAnnotationImageAssets } from './imageAssets';

describe('snapshotAnnotationImageAssets', () => {
  it('captures image and signature Blobs before an async read permits registry cleanup', async () => {
    let release!: (bytes: ArrayBuffer) => void;
    const read = new Promise<ArrayBuffer>((resolve) => {
      release = resolve;
    });
    const makeAsset = (assetId: string, blob: Blob) => ({
      assetId,
      blob,
      fileName: null,
      mimeType: 'image/png' as const,
      objectUrl: `blob:${assetId}`,
      width: 1,
      height: 1,
      image: {} as CanvasImageSource,
    });
    const assets = new Map([
      ['image', makeAsset('image', { arrayBuffer: () => read } as Blob)],
      [
        'signature',
        makeAsset('signature', new Blob([new Uint8Array([7, 8, 9])])),
      ],
    ]);
    const get = vi.fn((id: string) => assets.get(id) ?? null);
    const exporting = snapshotAnnotationImageAssets({ get }, [
      'image',
      'signature',
      'signature',
    ]);
    expect(get.mock.calls).toEqual([['image'], ['signature']]);
    assets.clear();
    release(new Uint8Array([1, 2]).buffer);
    const result = await exporting;
    expect(new Uint8Array(result.get('signature')!.bytes)).toEqual(
      new Uint8Array([7, 8, 9]),
    );
    expect(get).toHaveBeenCalledTimes(2);
  });
  it('reads only requested assets and preserves the export-safe bytes', async () => {
    const requestedRead = vi.fn().mockResolvedValue(new ArrayBuffer(2));
    const unrelatedRead = vi
      .fn()
      .mockRejectedValue(new Error('unrelated asset must not be read'));
    const requestedBlob = {
      arrayBuffer: requestedRead,
    } as unknown as Blob;
    const unrelatedBlob = {
      arrayBuffer: unrelatedRead,
    } as unknown as Blob;
    const assets = new Map([
      [
        'requested',
        {
          assetId: 'requested',
          blob: requestedBlob,
          fileName: null,
          mimeType: 'image/png' as const,
          objectUrl: 'blob:requested',
          width: 1,
          height: 1,
          image: {} as CanvasImageSource,
        },
      ],
      [
        'unrelated',
        {
          assetId: 'unrelated',
          blob: unrelatedBlob,
          fileName: null,
          mimeType: 'image/jpeg' as const,
          objectUrl: 'blob:unrelated',
          width: 1,
          height: 1,
          image: {} as CanvasImageSource,
        },
      ],
    ]);

    const snapshot = await snapshotAnnotationImageAssets(
      { get: (assetId: string) => assets.get(assetId) ?? null },
      ['requested'],
    );

    expect(snapshot.get('requested')?.assetId).toBe('requested');
    expect(requestedRead).toHaveBeenCalledOnce();
    expect(unrelatedRead).not.toHaveBeenCalled();
  });
});
