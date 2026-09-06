import type { WorkspacePageId } from './model/types';

export interface PageVisibility {
  readonly pageId: WorkspacePageId;
  readonly ratio: number;
  readonly isIntersecting: boolean;
}

/** Select the most visible page, preferring current workspace order on ties. */
export function chooseMostVisiblePage(
  pageOrder: readonly WorkspacePageId[],
  visibility: ReadonlyMap<WorkspacePageId, PageVisibility>,
): WorkspacePageId | null {
  let bestPageId: WorkspacePageId | null = null;
  let bestRatio = 0;

  pageOrder.forEach((pageId, index) => {
    const entry = visibility.get(pageId);
    if (!entry?.isIntersecting || entry.ratio <= 0) {
      return;
    }

    if (entry.ratio > bestRatio) {
      bestRatio = entry.ratio;
      bestPageId = pageId;
      return;
    }

    if (entry.ratio === bestRatio && bestPageId === null) {
      bestPageId = pageOrder[index] ?? null;
    }
  });

  return bestPageId;
}
