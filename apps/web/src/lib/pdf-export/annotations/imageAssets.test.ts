import { describe, expect, it, vi } from 'vitest';

import { snapshotAnnotationImageAssets } from './imageAssets';

describe('snapshotAnnotationImageAssets', () => {
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
