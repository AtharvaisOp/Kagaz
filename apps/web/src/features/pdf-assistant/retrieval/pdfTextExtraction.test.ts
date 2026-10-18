import { describe, expect, it, vi } from 'vitest';

import type { WorkspacePage } from '../../pdf-workspace/model/types';
import type { SourceDocumentRegistry } from '../../pdf-workspace/runtime/sourceDocumentRegistry';
import { createPdfPageTextExtractor } from './pdfTextExtraction';

function sourceRegistry(document: object): SourceDocumentRegistry {
  return {
    getDocument: vi.fn(() => document),
  } as unknown as SourceDocumentRegistry;
}

const workspacePage: WorkspacePage = {
  id: 'workspace-page-1',
  sourceDocumentId: 'source-document-1',
  sourcePageIndex: 0,
  rotationDelta: 0,
};

describe('PDF.js local text extraction', () => {
  it('ignores malformed text items, preserves line boundaries, and releases its shared page lease', async () => {
    const cleanup = vi.fn();
    const streamTextContent = vi.fn(
      () =>
        new ReadableStream<unknown>({
          start(controller) {
            controller.enqueue({
              items: [
                {
                  str: 'Résumé',
                  hasEOL: false,
                  transform: [1, 0, 0, 1, 40, 720],
                  height: 12,
                },
                null,
                { str: 42 },
                {
                  str: 'Ελληνικά',
                  hasEOL: true,
                  transform: [1, 0, 0, 1, 40, 700],
                  height: 12,
                },
              ],
            });
            controller.enqueue({ items: 'malformed' });
            controller.close();
          },
        }),
    );
    const document = {
      getPage: vi.fn(() => Promise.resolve({ cleanup, streamTextContent })),
    };
    const extract = createPdfPageTextExtractor(sourceRegistry(document));

    await expect(
      extract(workspacePage, 1_000, new AbortController().signal),
    ).resolves.toMatchObject({
      text: 'Résumé\nΕλληνικά',
      truncated: false,
    });
    expect(document.getPage).toHaveBeenCalledWith(1);
    expect(streamTextContent).toHaveBeenCalledWith({
      includeMarkedContent: false,
      disableNormalization: true,
    });
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('cancels a pending PDF.js text stream and releases page resources', async () => {
    const cleanup = vi.fn();
    const cancel = vi.fn();
    let onPull: (() => void) | null = null;
    const pullStarted = new Promise<void>((resolve) => {
      onPull = resolve;
    });
    const document = {
      getPage: vi.fn(() =>
        Promise.resolve({
          cleanup,
          streamTextContent: () =>
            new ReadableStream<unknown>({
              pull() {
                onPull?.();
                return new Promise<void>(() => undefined);
              },
              cancel,
            }),
        }),
      ),
    };
    const extract = createPdfPageTextExtractor(sourceRegistry(document));
    const controller = new AbortController();
    const reading = extract(workspacePage, 1_000, controller.signal);
    await pullStarted;
    controller.abort();

    await expect(reading).rejects.toMatchObject({ name: 'AbortError' });
    expect(cancel).toHaveBeenCalled();
    expect(cleanup).toHaveBeenCalledTimes(1);
  });
});
