import type {
  AnnotationAssetId,
  AnnotationDocument,
  AnnotationHistoryState,
} from '../model/types';

function collectDocumentAssets(
  document: AnnotationDocument,
  result: Set<AnnotationAssetId>,
): void {
  for (const annotations of Object.values(document.byPage)) {
    for (const annotation of annotations ?? []) {
      if (annotation.kind === 'image') result.add(annotation.assetId);
    }
  }
}

export function collectReachableAnnotationAssetIds(
  state: AnnotationHistoryState,
  pendingAssetId: AnnotationAssetId | null = null,
): ReadonlySet<AnnotationAssetId> {
  const result = new Set<AnnotationAssetId>();
  collectDocumentAssets(state.baseline, result);
  for (const document of state.past) collectDocumentAssets(document, result);
  collectDocumentAssets(state.present, result);
  for (const document of state.future) collectDocumentAssets(document, result);
  if (pendingAssetId) result.add(pendingAssetId);
  return result;
}
