import { targetWatermarkPageIds } from '../pdf-watermarks/model/watermark';

import type { WatermarkConfig } from '../pdf-watermarks/model/types';
import type {
  WorkspacePage,
  WorkspacePageId,
} from '../pdf-workspace/model/types';
import type { AssistantWorkspaceSnapshot } from './types';

/**
 * Captures only editor metadata needed to plan a bounded command. Source names,
 * PDF bytes, extracted text, annotation content, and image assets are excluded.
 */
export function createAssistantWorkspaceSnapshot(
  pages: readonly WorkspacePage[],
  selectedPageId: WorkspacePageId | null,
  watermark: WatermarkConfig | null,
): AssistantWorkspaceSnapshot {
  const pageSnapshots = pages.map((page, index) => ({
    id: page.id,
    pageNumber: index + 1,
    rotationDegrees: page.rotationDelta,
  }));
  const watermarkTargetCount = watermark
    ? targetWatermarkPageIds(watermark.target, pages).length
    : 0;

  return {
    pages: pageSnapshots,
    selectedPageId,
    watermark: {
      present: watermark !== null,
      kind: watermark?.kind ?? null,
      targetPageCount: watermarkTargetCount,
    },
    revision: JSON.stringify({
      pages: pages.map((page) => [
        page.id,
        page.sourceDocumentId,
        page.sourcePageIndex,
        page.rotationDelta,
      ]),
      watermark,
    }),
  };
}

export function findSnapshotPage(
  snapshot: AssistantWorkspaceSnapshot,
  pageId: WorkspacePageId,
): AssistantWorkspaceSnapshot['pages'][number] | undefined {
  return snapshot.pages.find((page) => page.id === pageId);
}
