import { useCallback, useSyncExternalStore } from 'react';

import type { AnnotationAssetRegistry } from './annotationAssetRegistry';
import type { AnnotationAssetId } from '../model/types';

export function useAnnotationAsset(
  registry: AnnotationAssetRegistry,
  assetId: AnnotationAssetId,
) {
  return useSyncExternalStore(
    useCallback(
      (listener) => registry.subscribe(assetId, listener),
      [assetId, registry],
    ),
    useCallback(() => registry.get(assetId), [assetId, registry]),
    () => null,
  );
}
