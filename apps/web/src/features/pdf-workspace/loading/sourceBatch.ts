import { describePdfError } from '../../../lib/pdf';
import { createBrowserIdFactory } from '../runtime/ids';
import type {
  PdfLoader,
  SourceDocumentRegistry,
} from '../runtime/sourceDocumentRegistry';

import type {
  SourceDocumentId,
  SourceDocumentSummary,
  WorkspacePage,
} from '../model/types';
import type { FileLoadIssue, LoadingProgress } from './types';

export interface SourceBatchCallbacks {
  readonly onProgress?: (progress: LoadingProgress) => void;
  readonly onSourceRegistered?: (source: {
    readonly id: SourceDocumentId;
    readonly fileName: string;
  }) => void;
  readonly onSourceReady?: (
    sourceId: SourceDocumentId,
    pageCount: number,
  ) => void;
  readonly onSourceFailed?: (
    sourceId: SourceDocumentId,
    message: string,
  ) => void;
  readonly onPagesReady?: (pages: readonly WorkspacePage[]) => void;
}

export interface SourceBatchOptions extends SourceBatchCallbacks {
  readonly registry: SourceDocumentRegistry;
  readonly createSourceId?: () => SourceDocumentId;
  readonly createPageId?: (
    sourceId: SourceDocumentId,
    sourcePageIndex: number,
  ) => string;
  readonly loader?: PdfLoader;
  readonly describeError?: (error: unknown) => string;
  readonly signal?: AbortSignal;
  readonly isCurrent?: () => boolean;
}

export interface SourceBatchResult {
  readonly sources: readonly SourceDocumentSummary[];
  readonly sourceOrder: readonly SourceDocumentId[];
  readonly pages: readonly WorkspacePage[];
  readonly issues: readonly FileLoadIssue[];
  readonly cancelled: boolean;
}

function isCancelled(options: SourceBatchOptions): boolean {
  return options.signal?.aborted === true || options.isCurrent?.() === false;
}

function createPages(
  sourceId: SourceDocumentId,
  pageCount: number,
  createPageId: (sourceId: SourceDocumentId, sourcePageIndex: number) => string,
): WorkspacePage[] {
  return Array.from({ length: pageCount }, (_, sourcePageIndex) => ({
    id: createPageId(sourceId, sourcePageIndex),
    sourceDocumentId: sourceId,
    sourcePageIndex,
    rotationDelta: 0 as const,
  }));
}

/** Load selected files in order and retain successful results when siblings fail. */
export async function loadSourceBatch(
  files: readonly File[],
  options: SourceBatchOptions,
): Promise<SourceBatchResult> {
  const createSourceId =
    options.createSourceId ?? createBrowserIdFactory('source');
  const createPageId =
    options.createPageId ??
    ((sourceId: SourceDocumentId) =>
      `${sourceId}-page-${createBrowserIdFactory('page')()}`);
  const load = options.loader;
  const explainError = options.describeError ?? describePdfError;
  const sources: SourceDocumentSummary[] = [];
  const sourceOrder: SourceDocumentId[] = [];
  const pages: WorkspacePage[] = [];
  const issues: FileLoadIssue[] = [];

  for (const [fileIndex, file] of files.entries()) {
    if (isCancelled(options)) {
      return { sources, sourceOrder, pages, issues, cancelled: true };
    }

    options.onProgress?.({
      currentIndex: fileIndex + 1,
      total: files.length,
      fileName: file.name,
    });

    const sourceId = createSourceId();
    sourceOrder.push(sourceId);
    options.registry.register(sourceId, file);
    options.onSourceRegistered?.({ id: sourceId, fileName: file.name });

    try {
      const document = await options.registry.load(sourceId, load);
      if (isCancelled(options)) {
        await options.registry.destroySource(sourceId);
        return { sources, sourceOrder, pages, issues, cancelled: true };
      }

      const summary: SourceDocumentSummary = {
        id: sourceId,
        fileName: file.name,
        status: 'ready',
        pageCount: document.numPages,
        error: null,
      };
      const sourcePages = createPages(
        sourceId,
        document.numPages,
        createPageId,
      );
      sources.push(summary);
      pages.push(...sourcePages);
      options.onSourceReady?.(sourceId, document.numPages);
      options.onPagesReady?.(sourcePages);
    } catch (error: unknown) {
      if (isCancelled(options)) {
        await options.registry.destroySource(sourceId);
        return { sources, sourceOrder, pages, issues, cancelled: true };
      }

      const message = explainError(error);
      const summary: SourceDocumentSummary = {
        id: sourceId,
        fileName: file.name,
        status: 'error',
        pageCount: null,
        error: message,
      };
      sources.push(summary);
      issues.push({ fileName: file.name, message });
      options.onSourceFailed?.(sourceId, message);
      await options.registry.destroySource(sourceId);
    }
  }

  return { sources, sourceOrder, pages, issues, cancelled: false };
}
