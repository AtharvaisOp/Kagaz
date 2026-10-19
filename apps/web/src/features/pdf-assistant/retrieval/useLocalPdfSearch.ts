import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import type { WorkspacePage } from '../../pdf-workspace/model/types';
import type { SourceDocumentRegistry } from '../../pdf-workspace/runtime/sourceDocumentRegistry';
import type { RedactionRegion } from '../../pdf-redactions/model/types';
import type { PdfFormsController } from '../../pdf-forms/hooks/usePdfForms';
import {
  LocalPdfRetrievalIndex,
  RETRIEVAL_LIMITS,
  parseRetrievalQuery,
  sourcePageKey,
  type RetrievalIndexProgress,
  type RetrievalIndexSummary,
  type RetrievalResult,
} from './index';
import { createPdfPageTextExtractor } from './pdfTextExtraction';
import { collectCommittedFormPassages } from './formPassages';

export type LocalSearchStatus = 'idle' | 'indexing' | 'searching' | 'cancelled';

export interface LocalPdfSearchState {
  readonly status: LocalSearchStatus;
  readonly progress: RetrievalIndexProgress;
  readonly summary: RetrievalIndexSummary | null;
  readonly results: readonly RetrievalResult[];
  readonly totalMatches: number;
  readonly limited: boolean;
  readonly message: string | null;
  readonly messageKind: 'status' | 'error' | 'cancelled' | null;
}

interface UseLocalPdfSearchOptions {
  readonly pages: readonly WorkspacePage[];
  readonly redactions: readonly RedactionRegion[];
  readonly registry: SourceDocumentRegistry;
  readonly forms: PdfFormsController;
}

const EMPTY_PROGRESS: RetrievalIndexProgress = {
  completedPages: 0,
  totalPages: 0,
  characters: 0,
};

const INITIAL_STATE: LocalPdfSearchState = {
  status: 'idle',
  progress: EMPTY_PROGRESS,
  summary: null,
  results: [],
  totalMatches: 0,
  limited: false,
  message: null,
  messageKind: null,
};

function pageStructure(pages: readonly WorkspacePage[]): string {
  return JSON.stringify(
    pages.map((page) => [page.id, page.sourceDocumentId, page.sourcePageIndex]),
  );
}

function sameWorkspaceMembership(
  previous: readonly WorkspacePage[],
  current: readonly WorkspacePage[],
): boolean {
  if (previous.length !== current.length) return false;
  const previousById = new Map(
    previous.map((page) => [page.id, sourcePageKey(page)]),
  );
  return current.every(
    (page) => previousById.get(page.id) === sourcePageKey(page),
  );
}

function queryErrorMessage(reason: string): string {
  switch (reason) {
    case 'empty':
      return 'Enter a phrase, name, or a few specific words to search.';
    case 'too-long':
      return `Keep the search under ${RETRIEVAL_LIMITS.maxQueryCharacters} characters.`;
    case 'phrase-too-long':
      return `Quoted phrases are limited to ${RETRIEVAL_LIMITS.maxExactPhraseCharacters} characters.`;
    case 'invalid-page-filter':
      return 'Choose one valid workspace page number in your search.';
    case 'no-search-terms':
      return 'Add a specific name, number, or subject. General request words are ignored.';
    default:
      return 'Kagaz could not interpret that local search.';
  }
}

function summaryMessage(summary: RetrievalIndexSummary): string | null {
  const notices: string[] = [];
  if (summary.unindexedPages > 0) {
    notices.push(
      `${summary.unindexedPages} page ${summary.unindexedPages === 1 ? 'was' : 'pages were'} left unindexed because of the session limits.`,
    );
  }
  if (summary.truncatedSourcePages > 0) {
    notices.push(
      `${summary.truncatedSourcePages} long ${summary.truncatedSourcePages === 1 ? 'page was' : 'pages were'} indexed only up to the per-page text limit.`,
    );
  }
  if (summary.failedSourcePages > 0) {
    notices.push(
      `${summary.failedSourcePages} page ${summary.failedSourcePages === 1 ? 'could' : 'pages could'} not be read.`,
    );
  }
  if (summary.chunkLimitReached) {
    notices.push(
      'The passage limit was reached. Search results may omit later passages; make the query more specific.',
    );
  }
  if (summary.omittedFormPassages > 0) {
    notices.push(
      `${summary.omittedFormPassages} committed form ${summary.omittedFormPassages === 1 ? 'value was' : 'values were'} omitted because the local index limits were reached.`,
    );
  }
  if (summary.excludedPages > 0) {
    notices.push(
      `${summary.excludedPages} page ${summary.excludedPages === 1 ? 'was' : 'pages were'} excluded because of pending redactions.`,
    );
  }
  if (summary.emptySourcePages > 0 && summary.searchableSourcePages === 0) {
    notices.push(
      'No selectable text was found. This may be a scanned or image-only PDF; OCR is not run.',
    );
  } else if (summary.emptySourcePages > 0) {
    notices.push(
      `${summary.emptySourcePages} page ${summary.emptySourcePages === 1 ? 'had' : 'pages had'} no selectable text; scanned content is not searched and OCR is not run.`,
    );
  }
  return notices.length > 0 ? notices.join(' ') : null;
}

export function useLocalPdfSearch({
  pages,
  redactions,
  registry,
  forms,
}: UseLocalPdfSearchOptions) {
  const [index] = useState(() => new LocalPdfRetrievalIndex());
  const pageTextExtractor = useMemo(
    () => createPdfPageTextExtractor(registry),
    [registry],
  );
  const pageMap = useMemo(
    () =>
      new Map(
        pages.map((page, index) => [page.id, { page, pageNumber: index + 1 }]),
      ),
    [pages],
  );
  const redactedPageIds = useMemo(
    () => new Set(redactions.map((region) => region.pageId)),
    [redactions],
  );
  const blockedSourcePages = useMemo(
    () =>
      new Set(
        pages.filter((page) => redactedPageIds.has(page.id)).map(sourcePageKey),
      ),
    [pages, redactedPageIds],
  );
  const pendingRedactionPageNumbers = useMemo(
    () =>
      pages.flatMap((page, index) =>
        blockedSourcePages.has(sourcePageKey(page)) ? [index + 1] : [],
      ),
    [blockedSourcePages, pages],
  );
  const committedFormPassages = useMemo(
    () => collectCommittedFormPassages(pages, forms, blockedSourcePages),
    [blockedSourcePages, forms, pages],
  );
  const formSignature = useMemo(
    () => JSON.stringify(committedFormPassages),
    [committedFormPassages],
  );
  const [state, setState] = useState(INITIAL_STATE);
  const activeRun = useRef<{
    readonly id: number;
    readonly controller: AbortController;
  } | null>(null);
  const nextRunId = useRef(0);
  const pagesRef = useRef(pages);
  const blockedRef = useRef(blockedSourcePages);
  const previousPagesRef = useRef<readonly WorkspacePage[] | null>(null);
  const previousBlockedRef = useRef<ReadonlySet<string>>(new Set());
  const previousFormSnapshotRef = useRef<{
    readonly structureSignature: string;
    readonly blockedSignature: string;
    readonly formSignature: string;
  } | null>(null);
  const structureSignature = useMemo(() => pageStructure(pages), [pages]);

  const stopActiveRun = useCallback(() => {
    nextRunId.current += 1;
    activeRun.current?.controller.abort();
    activeRun.current = null;
  }, []);

  useLayoutEffect(() => {
    pagesRef.current = pages;
    blockedRef.current = blockedSourcePages;
    index.syncWorkspace(pages, blockedSourcePages);

    const previousPages = previousPagesRef.current;
    if (previousPages && pageStructure(previousPages) !== structureSignature) {
      stopActiveRun();
      if (!sameWorkspaceMembership(previousPages, pages)) {
        setState((current) => ({
          ...current,
          status: 'idle',
          results: [],
          totalMatches: 0,
          limited: false,
          message:
            'The workspace pages changed. Search again to refresh the results.',
          messageKind: 'status',
        }));
      } else {
        setState((current) => ({
          ...current,
          status: 'idle',
          message: current.results.length
            ? 'Page order changed. Page references now use the current workspace order.'
            : current.message,
          messageKind: current.results.length ? 'status' : current.messageKind,
        }));
      }
    }
    previousPagesRef.current = pages;

    const newlyBlocked = [...blockedSourcePages].filter(
      (key) => !previousBlockedRef.current.has(key),
    );
    if (newlyBlocked.length > 0) {
      stopActiveRun();
      const newlyBlockedSet = new Set(newlyBlocked);
      setState((current) => {
        const results = current.results.filter(
          (result) => !newlyBlockedSet.has(result.sourcePageKey),
        );
        return {
          ...current,
          status: 'idle',
          results,
          totalMatches: results.length,
          limited: false,
          message:
            'Results from pages with pending redactions were removed. Those source pages are excluded from retrieval.',
          messageKind: 'status',
        };
      });
    }
    previousBlockedRef.current = blockedSourcePages;
  }, [blockedSourcePages, index, pages, stopActiveRun, structureSignature]);

  useLayoutEffect(() => {
    index.setCommittedFormPassages(committedFormPassages);
    const blockedSignature = JSON.stringify([...blockedSourcePages].sort());
    const previous = previousFormSnapshotRef.current;
    if (
      previous &&
      previous.structureSignature === structureSignature &&
      previous.blockedSignature === blockedSignature &&
      previous.formSignature !== formSignature
    ) {
      stopActiveRun();
      setState((current) => {
        if (current.results.length === 0 && current.summary === null) {
          return current;
        }
        return {
          ...current,
          status: 'idle',
          results: [],
          totalMatches: 0,
          limited: false,
          message:
            'Committed form values changed. Search again to refresh the results.',
          messageKind: 'status',
        };
      });
    }
    previousFormSnapshotRef.current = {
      structureSignature,
      blockedSignature,
      formSignature,
    };
  }, [
    blockedSourcePages,
    committedFormPassages,
    formSignature,
    index,
    stopActiveRun,
    structureSignature,
  ]);

  useEffect(
    () => () => {
      stopActiveRun();
      index.clear();
    },
    [index, stopActiveRun],
  );

  const search = useCallback(
    async (input: string) => {
      stopActiveRun();
      const id = nextRunId.current;
      const controller = new AbortController();
      activeRun.current = { id, controller };
      const currentPages = pagesRef.current;
      const currentBlocked = blockedRef.current;
      const parsed = parseRetrievalQuery(input);
      if (!parsed.ok) {
        activeRun.current = null;
        setState((current) => ({
          ...current,
          status: 'idle',
          results: [],
          totalMatches: 0,
          limited: false,
          message: queryErrorMessage(parsed.reason),
          messageKind: 'error',
        }));
        return;
      }
      if (
        parsed.query.pageNumber !== null &&
        parsed.query.pageNumber > currentPages.length
      ) {
        activeRun.current = null;
        setState((current) => ({
          ...current,
          status: 'idle',
          results: [],
          totalMatches: 0,
          limited: false,
          message: 'That page number is outside the current workspace.',
          messageKind: 'error',
        }));
        return;
      }
      if (currentPages.length === 0) {
        activeRun.current = null;
        setState((current) => ({
          ...current,
          status: 'idle',
          results: [],
          totalMatches: 0,
          limited: false,
          message: 'Open a PDF before searching its text.',
          messageKind: 'error',
        }));
        return;
      }

      setState({
        ...INITIAL_STATE,
        status: 'indexing',
        progress: {
          completedPages: 0,
          totalPages: currentPages.filter(
            (page) => !currentBlocked.has(sourcePageKey(page)),
          ).length,
          characters: index.getStats().characters,
        },
      });

      try {
        const summary = await index.ensureIndexed(
          currentPages,
          currentBlocked,
          pageTextExtractor,
          controller.signal,
          (progress) => {
            if (activeRun.current?.id !== id) return;
            setState((current) => ({
              ...current,
              status: 'indexing',
              progress,
            }));
          },
        );
        if (activeRun.current?.id !== id || controller.signal.aborted) return;

        setState((current) => ({
          ...current,
          status: 'searching',
          summary,
        }));
        await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
        if (activeRun.current?.id !== id || controller.signal.aborted) return;

        const latestPages = pagesRef.current;
        const latestBlocked = blockedRef.current;
        const response = index.search(input, latestPages, latestBlocked);
        if (!response.ok) {
          setState((current) => ({
            ...current,
            status: 'idle',
            message: queryErrorMessage(response.reason),
            messageKind: 'error',
            results: [],
            totalMatches: 0,
            limited: false,
          }));
          return;
        }

        const availableResults = response.response.results.filter((result) =>
          pageMap.has(result.pageId),
        );
        const partialMessage = summaryMessage(summary);
        setState({
          status: 'idle',
          progress: EMPTY_PROGRESS,
          summary,
          results: availableResults,
          totalMatches: response.response.totalMatches,
          limited: response.response.limited,
          message:
            response.response.totalMatches > 0
              ? `Found ${response.response.totalMatches} matching ${response.response.totalMatches === 1 ? 'passage' : 'passages'} in local PDF text.${partialMessage ? ` ${partialMessage}` : ''}`
              : summary.searchableSourcePages === 0 &&
                  summary.failedSourcePages > 0 &&
                  summary.indexedFormPassages === 0
                ? `No pages could be indexed. ${partialMessage ?? 'Check that the source PDFs are still available.'}`
                : `No matching passage was found.${partialMessage ? ` ${partialMessage}` : ' Try fewer terms or another spelling.'}`,
          messageKind: response.response.totalMatches > 0 ? 'status' : 'status',
        });
        activeRun.current = null;
      } catch (error) {
        if (activeRun.current?.id !== id) return;
        activeRun.current = null;
        if (
          controller.signal.aborted ||
          (error instanceof Error && error.name === 'AbortError')
        ) {
          setState((current) => ({
            ...current,
            status: 'cancelled',
            progress: EMPTY_PROGRESS,
            message: 'Search cancelled. No document changes were made.',
            messageKind: 'cancelled',
          }));
          return;
        }
        setState((current) => ({
          ...current,
          status: 'idle',
          progress: EMPTY_PROGRESS,
          message:
            'Kagaz could not read one or more pages. Search again or check whether the PDF is supported.',
          messageKind: 'error',
        }));
      }
    },
    [index, pageMap, pageTextExtractor, stopActiveRun],
  );

  const cancel = useCallback(() => {
    stopActiveRun();
    setState((current) => ({
      ...current,
      status: 'cancelled',
      progress: EMPTY_PROGRESS,
      message: 'Search cancelled. No document changes were made.',
      messageKind: 'cancelled',
    }));
  }, [stopActiveRun]);

  const clear = useCallback(() => {
    stopActiveRun();
    index.clear();
    setState(INITIAL_STATE);
  }, [index, stopActiveRun]);

  const visibleResults = state.results.flatMap((result) => {
    const resolved = pageMap.get(result.pageId);
    if (!resolved || blockedSourcePages.has(result.sourcePageKey)) return [];
    return [{ ...result, pageNumber: resolved.pageNumber }];
  });

  return {
    state,
    search,
    cancel,
    clear,
    visibleResults,
    pendingRedactionPageNumbers,
    blockedSourcePages,
    // A review belongs to one precise local retrieval/workspace snapshot.
    // This includes form text only in memory; it is never sent as metadata.
    contextRevision: JSON.stringify([
      structureSignature,
      formSignature,
      [...blockedSourcePages].sort(),
      state.summary?.generation ?? 0,
      state.results.map((result) => [result.id, result.excerpt]),
    ]),
  };
}
