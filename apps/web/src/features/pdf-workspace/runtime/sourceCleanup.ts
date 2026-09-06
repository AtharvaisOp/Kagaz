import type { SourceDocumentId } from '../model/types';

export interface SourceRuntimeCleanup {
  destroySource(sourceId: SourceDocumentId): Promise<void>;
}

/**
 * Destroys only sources that disappeared from a committed active workspace.
 * Loading sources are retained until the reducer removes their metadata.
 */
export function destroyRemovedSources(
  registry: SourceRuntimeCleanup,
  previousSourceIds: readonly SourceDocumentId[],
  currentSourceIds: readonly SourceDocumentId[],
): void {
  const currentIds = new Set(currentSourceIds);

  for (const sourceId of previousSourceIds) {
    if (!currentIds.has(sourceId)) {
      void registry.destroySource(sourceId);
    }
  }
}
