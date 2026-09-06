import type { PageRotation, WorkspacePage, WorkspacePageId } from './types';

const ROTATION_STEP = 90;

function isValidRotationDegrees(value: number): boolean {
  return Number.isInteger(value) && value % ROTATION_STEP === 0;
}

/** Normalize a multiple of 90 degrees into Kagaz's four-value rotation type. */
export function normalizeRotation(degrees: number): PageRotation {
  if (!Number.isFinite(degrees) || !isValidRotationDegrees(degrees)) {
    throw new RangeError('Rotation must be a finite multiple of 90 degrees.');
  }

  return (((degrees % 360) + 360) % 360) as PageRotation;
}

/** Move a page by index. Invalid positions and no-op moves return the input array. */
export function movePage(
  pages: readonly WorkspacePage[],
  fromIndex: number,
  toIndex: number,
): readonly WorkspacePage[] {
  if (
    !Number.isInteger(fromIndex) ||
    !Number.isInteger(toIndex) ||
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= pages.length ||
    toIndex >= pages.length ||
    fromIndex === toIndex
  ) {
    return pages;
  }

  const nextPages = [...pages];
  const [page] = nextPages.splice(fromIndex, 1);

  if (!page) {
    return pages;
  }

  nextPages.splice(toIndex, 0, page);
  return nextPages;
}

/** Delete a page while protecting the final page in an active workspace. */
export function deletePage(
  pages: readonly WorkspacePage[],
  pageId: WorkspacePageId,
): readonly WorkspacePage[] {
  if (pages.length <= 1) {
    return pages;
  }

  const pageIndex = pages.findIndex((page) => page.id === pageId);
  if (pageIndex < 0) {
    return pages;
  }

  return [...pages.slice(0, pageIndex), ...pages.slice(pageIndex + 1)];
}

/** Apply user rotation metadata to one page without touching PDF source data. */
export function rotatePage(
  pages: readonly WorkspacePage[],
  pageId: WorkspacePageId,
  delta = ROTATION_STEP,
): readonly WorkspacePage[] {
  if (!isValidRotationDegrees(delta)) {
    return pages;
  }

  const pageIndex = pages.findIndex((page) => page.id === pageId);
  if (pageIndex < 0) {
    return pages;
  }

  const page = pages[pageIndex];
  if (!page) {
    return pages;
  }

  const nextPages = [...pages];
  nextPages[pageIndex] = {
    ...page,
    rotationDelta: normalizeRotation(page.rotationDelta + delta),
  };
  return nextPages;
}
