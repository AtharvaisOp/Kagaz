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
  for (const assetId of assetIds) {
    if (snapshot.has(assetId)) continue;
    const asset = registry.get(assetId);
    if (!asset) continue;
    let bytes: ArrayBuffer;
    try {
      bytes = await asset.blob.arrayBuffer();
    } catch {
      throw new AnnotationExportError(
        'image-read-failed',
        'Kagaz could not read the image annotation asset for export.',
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
