import { describe, expect, it, vi } from 'vitest';

import {
  SourceDocumentRegistry,
  type PdfLoader,
} from './sourceDocumentRegistry';

import type { PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist';
import type { LoadedPdf } from '../../../lib/pdf';

function createDocument(): PDFDocumentProxy {
  return {
    cleanup: vi.fn().mockResolvedValue(undefined),
    numPages: 2,
  } as unknown as PDFDocumentProxy;
}

function createLoadingTask(): {
  task: PDFDocumentLoadingTask;
  destroy: ReturnType<typeof vi.fn>;
} {
  const destroy = vi.fn().mockResolvedValue(undefined);
  return {
    task: { destroy } as unknown as PDFDocumentLoadingTask,
    destroy,
  };
}

function createFile(name = 'document.pdf'): File {
  return new File(['%PDF-1.7'], name, { type: 'application/pdf' });
}

describe('SourceDocumentRegistry', () => {
  it('prevents duplicate runtime ownership and resolves loaded documents', async () => {
    const registry = new SourceDocumentRegistry();
    const file = createFile();
    const document = createDocument();
    const loader: PdfLoader = vi.fn(() =>
      Promise.resolve({
        document,
        loadingTask: createLoadingTask().task,
      }),
    );

    registry.register('source-a', file);
    expect(() => registry.register('source-a', file)).toThrow('already exists');
    expect(await registry.load('source-a', loader)).toBe(document);
    expect(registry.getDocument('source-a')).toBe(document);
    expect(loader).toHaveBeenCalledOnce();
  });

  it('propagates abort to the active loader', async () => {
    const registry = new SourceDocumentRegistry();
    const file = createFile();
    let receivedSignal: AbortSignal | undefined;
    const loader: PdfLoader = vi.fn(
      (_file: File, signal: AbortSignal) =>
        new Promise<LoadedPdf>((_resolve, reject) => {
          receivedSignal = signal;
          signal.addEventListener('abort', () => {
            reject(new DOMException('cancelled', 'AbortError'));
          });
        }),
    );

    registry.register('source-a', file);
    const loading = registry.load('source-a', loader);
    registry.abortSource('source-a');

    await expect(loading).rejects.toMatchObject({ name: 'AbortError' });
    expect(receivedSignal?.aborted).toBe(true);
    await registry.destroyAll();
  });

  it('destroys loaded documents and clears the registry', async () => {
    const registry = new SourceDocumentRegistry();
    const firstTask = createLoadingTask();
    const secondTask = createLoadingTask();
    const loader: PdfLoader = vi
      .fn()
      .mockResolvedValueOnce({
        document: createDocument(),
        loadingTask: firstTask.task,
      })
      .mockResolvedValueOnce({
        document: createDocument(),
        loadingTask: secondTask.task,
      });

    registry.register('source-a', createFile('a.pdf'));
    registry.register('source-b', createFile('b.pdf'));
    await registry.load('source-a', loader);
    await registry.load('source-b', loader);
    await registry.destroyAll();

    expect(firstTask.destroy).toHaveBeenCalledOnce();
    expect(secondTask.destroy).toHaveBeenCalledOnce();
    expect(registry.size).toBe(0);
  });
});
