import type { PDFPageProxy } from 'pdfjs-dist';

import type { WorkspacePage } from '../../pdf-workspace/model/types';
import { acquirePdfPage } from '../../pdf-workspace/runtime/pdfPageLifecycle';
import type { SourceDocumentRegistry } from '../../pdf-workspace/runtime/sourceDocumentRegistry';
import type { PageTextExtraction, PageTextExtractor } from './index';

interface ReadableTextItem {
  readonly str: string;
  readonly hasEOL: boolean;
  readonly y: number | null;
  readonly height: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readTextItem(value: unknown): ReadableTextItem | null {
  if (!isRecord(value) || typeof value.str !== 'string') return null;

  const transform = Array.isArray(value.transform) ? value.transform : [];
  const yValue: unknown = transform[5];
  const y =
    typeof yValue === 'number' && Number.isFinite(yValue) ? yValue : null;
  const heightValue: unknown = value.height;
  const height =
    typeof heightValue === 'number' && Number.isFinite(heightValue)
      ? Math.max(0, heightValue)
      : 0;

  return {
    str: value.str,
    hasEOL: value.hasEOL === true,
    y,
    height,
  };
}

function itemsFromChunk(value: unknown): readonly unknown[] {
  if (!isRecord(value) || !Array.isArray(value.items)) return [];
  return value.items;
}

function separatorBetween(
  previous: ReadableTextItem,
  current: ReadableTextItem,
): string {
  const verticalGap =
    previous.y !== null && current.y !== null
      ? Math.abs(previous.y - current.y)
      : 0;
  const lineHeight = Math.max(previous.height, current.height, 1);
  if (verticalGap > lineHeight * 2.2) return '\n\n';
  if (previous.hasEOL || verticalGap > lineHeight * 0.45) return '\n';
  if (/\s$/u.test(previous.str) || /^\s/u.test(current.str)) return '';
  if (/^[,.;:!?%)\]}]/u.test(current.str)) return '';
  if (/[([{“‘]$/u.test(previous.str)) return '';
  return ' ';
}

function normalizeExtractedDisplayText(value: string): string {
  return value
    .replaceAll('\u0000', '')
    .replace(/[\t\f\v ]+\n/gu, '\n')
    .replace(/\n[\t\f\v ]+/gu, '\n')
    .replace(/[\t\f\v ]{2,}/gu, ' ')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
}

async function extractPageText(
  pdfPage: PDFPageProxy,
  maximumCharacters: number,
  signal: AbortSignal,
): Promise<PageTextExtraction> {
  const stream = pdfPage.streamTextContent({
    includeMarkedContent: false,
    disableNormalization: true,
  }) as ReadableStream<unknown>;
  const reader = stream.getReader();
  let previous: ReadableTextItem | null = null;
  let output = '';
  let truncated = false;
  const abortError = () => new DOMException('Search cancelled.', 'AbortError');
  let rejectOnAbort: (() => void) | null = null;
  const aborted = new Promise<never>((_, reject) => {
    rejectOnAbort = () => reject(abortError());
  });
  const onAbort = () => {
    void reader.cancel(abortError()).catch(() => undefined);
    rejectOnAbort?.();
  };
  signal.addEventListener('abort', onAbort, { once: true });

  try {
    if (signal.aborted) onAbort();
    while (true) {
      const next = await Promise.race([reader.read(), aborted]);
      if (next.done) break;
      for (const value of itemsFromChunk(next.value)) {
        const item = readTextItem(value);
        if (!item || !item.str) continue;
        if (previous) output += separatorBetween(previous, item);
        const remaining = maximumCharacters - output.length;
        if (remaining <= 0) {
          truncated = true;
          break;
        }
        output += item.str.slice(0, remaining);
        previous = item;
        if (item.str.length > remaining) {
          truncated = true;
          break;
        }
      }
      if (truncated) break;
    }
  } finally {
    signal.removeEventListener('abort', onAbort);
    if (signal.aborted || truncated) {
      await reader
        .cancel(
          signal.aborted
            ? abortError()
            : new Error('The per-page text limit was reached.'),
        )
        .catch(() => undefined);
    }
    reader.releaseLock();
  }

  if (signal.aborted) throw abortError();
  return { text: normalizeExtractedDisplayText(output), truncated };
}

export function createPdfPageTextExtractor(
  registry: SourceDocumentRegistry,
): PageTextExtractor {
  return async (
    page: WorkspacePage,
    maximumCharacters: number,
    signal: AbortSignal,
  ) => {
    if (signal.aborted)
      throw new DOMException('Search cancelled.', 'AbortError');
    const document = registry.getDocument(page.sourceDocumentId);
    if (!document) {
      throw new Error(
        'This source PDF is no longer available in the workspace.',
      );
    }

    const lease = acquirePdfPage(document, page.sourcePageIndex + 1);
    try {
      const pdfPage = await lease.page;
      if (signal.aborted)
        throw new DOMException('Search cancelled.', 'AbortError');
      return await extractPageText(pdfPage, maximumCharacters, signal);
    } finally {
      lease.release(true);
    }
  };
}
