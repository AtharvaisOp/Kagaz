export interface CleanablePdfPage {
  cleanup: () => void;
}

/**
 * Assigns ownership of a resolved PDF.js page to an active render effect.
 * Stale continuations clean their page immediately and never hand it to the
 * caller for rendering.
 */
export function adoptResolvedPdfPage<T extends CleanablePdfPage>(
  page: T,
  active: boolean,
): T | null {
  if (!active) {
    page.cleanup();
    return null;
  }

  return page;
}
