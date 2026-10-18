export interface CleanablePdfPage {
  cleanup: () => void;
}

export interface PdfPageProvider<Page extends CleanablePdfPage> {
  getPage: (pageNumber: number) => Promise<Page>;
}

export interface PdfPageLease<Page extends CleanablePdfPage> {
  readonly page: Promise<Page>;
  /** Release this consumer; cleanup waits until every consumer has released. */
  release: (requestCleanup?: boolean) => void;
}

interface PageUseState {
  consumers: number;
  cleanupRequested: boolean;
  settled: boolean;
  page: CleanablePdfPage | null;
  promise: Promise<CleanablePdfPage> | null;
}

const documentPageUses = new WeakMap<object, Map<number, PageUseState>>();
const documentIdleWaiters = new WeakMap<object, Set<() => void>>();
const retiringDocuments = new WeakSet<object>();

function isDocumentIdle(document: object): boolean {
  const pages = documentPageUses.get(document);
  return (
    !pages ||
    [...pages.values()].every((state) => state.consumers === 0 && state.settled)
  );
}

function notifyDocumentIdle(document: object): void {
  if (!isDocumentIdle(document)) return;
  const waiters = documentIdleWaiters.get(document);
  if (!waiters) return;
  for (const resolve of waiters) resolve();
  waiters.clear();
}

function getPageUseState(
  document: object,
  pageNumber: number,
): { readonly state: PageUseState; readonly pages: Map<number, PageUseState> } {
  let pages = documentPageUses.get(document);
  if (!pages) {
    pages = new Map<number, PageUseState>();
    documentPageUses.set(document, pages);
  }

  let state = pages.get(pageNumber);
  if (!state) {
    state = {
      consumers: 0,
      cleanupRequested: false,
      settled: false,
      page: null,
      promise: null,
    };
    pages.set(pageNumber, state);
  }

  return { state, pages };
}

function cleanWhenIdle(
  state: PageUseState,
  pages: Map<number, PageUseState>,
  pageNumber: number,
): void {
  if (state.consumers !== 0 || !state.settled) return;

  if (state.cleanupRequested && state.page) {
    try {
      state.page.cleanup();
    } catch {
      // Page cleanup is best effort; document destruction remains the owner
      // of the final PDF.js resource release.
    } finally {
      state.page = null;
      state.cleanupRequested = false;
    }
  }

  if (!state.page && pages.get(pageNumber) === state) {
    pages.delete(pageNumber);
  }
}

/** Wait until active page renders/extractions have released this PDF proxy. */
export function waitForPdfDocumentIdle(document: object): Promise<void> {
  if (isDocumentIdle(document)) return Promise.resolve();
  return new Promise((resolve) => {
    let waiters = documentIdleWaiters.get(document);
    if (!waiters) {
      waiters = new Set();
      documentIdleWaiters.set(document, waiters);
    }
    waiters.add(resolve);
    notifyDocumentIdle(document);
  });
}

/** Prevent new page work while the registry is retiring a PDF proxy. */
export function retirePdfDocument(document: object): void {
  retiringDocuments.add(document);
  notifyDocumentIdle(document);
}

/**
 * Reserves use of a shared PDF.js page before requesting it from the document.
 * This lets viewer rendering and local text extraction share the existing
 * document proxy without one consumer cleaning the page while another is
 * parsing text or drawing a canvas.
 */
export function acquirePdfPage<Page extends CleanablePdfPage>(
  document: PdfPageProvider<Page> & object,
  pageNumber: number,
): PdfPageLease<Page> {
  const { state, pages } = getPageUseState(document, pageNumber);
  state.consumers += 1;
  let released = false;

  const release = (requestCleanup = false) => {
    if (released) return;
    released = true;
    state.cleanupRequested ||= requestCleanup;
    state.consumers -= 1;
    cleanWhenIdle(state, pages, pageNumber);
    notifyDocumentIdle(document);
  };

  if (!state.promise) {
    state.promise = Promise.resolve()
      .then(() => {
        if (retiringDocuments.has(document)) {
          throw new Error('This PDF document is being released.');
        }
        return document.getPage(pageNumber);
      })
      .then(
        (resolvedPage) => {
          state.page = resolvedPage;
          state.settled = true;
          cleanWhenIdle(state, pages, pageNumber);
          notifyDocumentIdle(document);
          return resolvedPage;
        },
        (error: unknown) => {
          state.settled = true;
          cleanWhenIdle(state, pages, pageNumber);
          notifyDocumentIdle(document);
          throw error;
        },
      );
  }

  const page = state.promise as Promise<Page>;
  return {
    page: page.catch((error: unknown) => {
      release(true);
      throw error;
    }),
    release,
  };
}

/**
 * Compatibility helper for callers which have already resolved a page. New
 * long-running consumers should reserve with acquirePdfPage before getPage.
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
