import type { AnnotationAssetRegistry } from '../../../features/pdf-annotations/runtime/annotationAssetRegistry';
import {
  AnnotationExportError,
  type AnnotationImageExportSource,
} from './exportContracts';

/** Snapshots original registry bytes so export is independent of later cleanup. */
export async function snapshotAnnotationImageAssets(
  registry: Pick<AnnotationAssetRegistry, 'get'>,
  assetIds: readonly string[],
): Promise<ReadonlyMap<string, AnnotationImageExportSource>> {
  const snapshot = new Map<string, AnnotationImageExportSource>();
  // Capture every immutable Blob before the first await. Registry cleanup or
  // replacement during an earlier read must not change a later asset.
  const captured = [...new Set(assetIds)].map((assetId) => ({
    assetId,
    asset: registry.get(assetId),
  }));
  for (const { assetId, asset } of captured) {
    if (!asset) continue;
    let bytes: ArrayBuffer;
    try {
      bytes = await asset.blob.arrayBuffer();
    } catch {
      throw new AnnotationExportError(
        'image-read-failed',
        'Kagaz could not read a visual annotation asset for export.',
        null,
        assetId,
      );
    }
    snapshot.set(assetId, {
      assetId,
      mimeType: asset.mimeType,
      bytes,
    });
  }
  return snapshot;
}
