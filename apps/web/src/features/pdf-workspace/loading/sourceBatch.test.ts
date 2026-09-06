import { describe, expect, it, vi } from 'vitest';

import { loadSourceBatch } from './sourceBatch';
import { createEmptyWorkspaceState, workspaceReducer } from '../model/reducer';
import {
  SourceDocumentRegistry,
  type PdfLoader,
} from '../runtime/sourceDocumentRegistry';

import type { LoadedPdf } from '../../../lib/pdf';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { WorkspacePage } from '../model/types';

function createFile(name: string): File {
  return new File(['%PDF-1.7'], name, { type: 'application/pdf' });
}

function createDocument(pageCount: number): PDFDocumentProxy {
  return {
    cleanup: vi.fn().mockResolvedValue(undefined),
    numPages: pageCount,
  } as unknown as PDFDocumentProxy;
}

function createTask(): {
  task: LoadedPdf['loadingTask'];
  destroy: ReturnType<typeof vi.fn>;
} {
  const destroy = vi.fn().mockResolvedValue(undefined);
  return {
    task: { destroy } as unknown as LoadedPdf['loadingTask'],
    destroy,
  };
}

function createSourceFactory() {
  let nextId = 0;
  return () => `source-${++nextId}`;
}

function createPageFactory(sourceId: string, sourcePageIndex: number): string {
  return `${sourceId}-page-${sourcePageIndex}`;
}

function createLoader(
  documents: Readonly<Record<string, PDFDocumentProxy>>,
  order: string[] = [],
): PdfLoader {
  return vi.fn((file: File): Promise<LoadedPdf> => {
    order.push(file.name);
    const document = documents[file.name];
    if (!document) {
      return Promise.reject(new Error(`Unable to load ${file.name}`));
    }
    return Promise.resolve({ document, loadingTask: createTask().task });
  });
}

function initializeState(pages: readonly WorkspacePage[]) {
  return workspaceReducer(createEmptyWorkspaceState(), {
    type: 'INITIALIZE_WORKSPACE',
    sources: [
      {
        id: 'source-existing',
        fileName: 'existing.pdf',
        status: 'ready',
        pageCount: pages.length,
        error: null,
      },
    ],
    sourceOrder: ['source-existing'],
    pages,
  });
}

describe('loadSourceBatch', () => {
  it('loads multiple PDFs sequentially and preserves source/page order', async () => {
    const order: string[] = [];
    const result = await loadSourceBatch(
      [createFile('a.pdf'), createFile('b.pdf')],
      {
        registry: new SourceDocumentRegistry(),
        loader: createLoader(
          { 'a.pdf': createDocument(2), 'b.pdf': createDocument(1) },
          order,
        ),
        createSourceId: createSourceFactory(),
        createPageId: createPageFactory,
      },
    );

    expect(order).toEqual(['a.pdf', 'b.pdf']);
    expect(result.sourceOrder).toEqual(['source-1', 'source-2']);
    expect(result.pages.map((page) => page.id)).toEqual([
      'source-1-page-0',
      'source-1-page-1',
      'source-2-page-0',
    ]);
    expect(result.issues).toEqual([]);
    expect(result.cancelled).toBe(false);

    const state = workspaceReducer(createEmptyWorkspaceState(), {
      type: 'INITIALIZE_WORKSPACE',
      sources: result.sources,
      sourceOrder: result.sourceOrder,
      pages: result.pages,
    });
    expect(state.dirty).toBe(false);
  });

  it('keeps valid siblings when one initial source fails', async () => {
    const broken = createFile('broken.pdf');
    const result = await loadSourceBatch(
      [createFile('a.pdf'), broken, createFile('b.pdf')],
      {
        registry: new SourceDocumentRegistry(),
        loader: createLoader({
          'a.pdf': createDocument(1),
          'b.pdf': createDocument(2),
        }),
        createSourceId: createSourceFactory(),
        createPageId: createPageFactory,
      },
    );

    expect(result.pages.map((page) => page.sourceDocumentId)).toEqual([
      'source-1',
      'source-3',
      'source-3',
    ]);
    expect(result.sources.map((source) => source.status)).toEqual([
      'ready',
      'error',
      'ready',
    ]);
    expect(result.issues).toEqual([
      {
        fileName: 'broken.pdf',
        message:
          'Kagaz could not open this PDF. The file may be damaged or unsupported.',
      },
    ]);
  });

  it('returns an empty result when every source fails', async () => {
    const registry = new SourceDocumentRegistry();
    const result = await loadSourceBatch(
      [createFile('a.pdf'), createFile('b.pdf')],
      {
        registry,
        loader: vi.fn(() => Promise.reject(new Error('broken'))),
        createSourceId: createSourceFactory(),
        createPageId: createPageFactory,
      },
    );

    expect(result.pages).toEqual([]);
    expect(result.sources.every((source) => source.status === 'error')).toBe(
      true,
    );
    expect(result.issues).toHaveLength(2);
    expect(registry.size).toBe(0);
  });

  it('allows the same File to be selected twice with new identities', async () => {
    const file = createFile('same.pdf');
    const result = await loadSourceBatch([file, file], {
      registry: new SourceDocumentRegistry(),
      loader: createLoader({ 'same.pdf': createDocument(1) }),
      createSourceId: createSourceFactory(),
      createPageId: createPageFactory,
    });

    expect(result.sourceOrder).toEqual(['source-1', 'source-2']);
    expect(result.pages.map((page) => page.id)).toEqual([
      'source-1-page-0',
      'source-2-page-0',
    ]);
  });

  it('supports Add PDF callbacks while preserving existing pages and selection', async () => {
    const existingPage: WorkspacePage = {
      id: 'existing-page-0',
      sourceDocumentId: 'source-existing',
      sourcePageIndex: 0,
      rotationDelta: 0,
    };
    let state = initializeState([existingPage]);
    const registry = new SourceDocumentRegistry();
    const result = await loadSourceBatch([createFile('added.pdf')], {
      registry,
      loader: createLoader({ 'added.pdf': createDocument(2) }),
      createSourceId: () => 'source-added',
      createPageId: createPageFactory,
      onSourceRegistered: (source) => {
        state = workspaceReducer(state, {
          type: 'REGISTER_SOURCE',
          source,
        });
      },
      onSourceReady: (sourceId, pageCount) => {
        state = workspaceReducer(state, {
          type: 'SOURCE_READY',
          sourceId,
          pageCount,
        });
      },
      onPagesReady: (pages) => {
        state = workspaceReducer(state, {
          type: 'APPEND_SOURCE_PAGES',
          pages,
        });
      },
    });

    expect(result.cancelled).toBe(false);
    expect(state.pages.map((page) => page.id)).toEqual([
      'existing-page-0',
      'source-added-page-0',
      'source-added-page-1',
    ]);
    expect(state.selectedPageId).toBe('existing-page-0');
    expect(state.dirty).toBe(true);
    expect(state.sources['source-added']).toMatchObject({
      status: 'ready',
      pageCount: 2,
    });
  });

  it('reports Add PDF failure without appending pages', async () => {
    const existingPage: WorkspacePage = {
      id: 'existing-page-0',
      sourceDocumentId: 'source-existing',
      sourcePageIndex: 0,
      rotationDelta: 0,
    };
    let state = initializeState([existingPage]);
    const result = await loadSourceBatch([createFile('broken.pdf')], {
      registry: new SourceDocumentRegistry(),
      loader: vi.fn(() => Promise.reject(new Error('corrupt PDF'))),
      createSourceId: () => 'source-broken',
      createPageId: createPageFactory,
      onSourceRegistered: (source) => {
        state = workspaceReducer(state, {
          type: 'REGISTER_SOURCE',
          source,
        });
      },
      onSourceFailed: (sourceId, message) => {
        state = workspaceReducer(state, {
          type: 'SOURCE_FAILED',
          sourceId,
          error: message,
        });
      },
    });

    expect(state.pages).toEqual([existingPage]);
    expect(state.dirty).toBe(false);
    expect(state.sources['source-broken']).toMatchObject({
      status: 'error',
      error:
        'Kagaz could not open this PDF. The file may be damaged or unsupported.',
    });
    expect(result.pages).toEqual([]);
  });

  it('ignores a resolved source from a stale session and destroys it', async () => {
    const registry = new SourceDocumentRegistry();
    const document = createDocument(1);
    const staleTask = createTask();
    let generation = 1;
    let release: ((value: LoadedPdf) => void) | undefined;
    let resolveStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      resolveStarted = resolve;
    });
    const loader: PdfLoader = vi.fn(
      () =>
        new Promise<LoadedPdf>((resolve) => {
          resolveStarted?.();
          release = resolve;
        }),
    );
    const loading = loadSourceBatch([createFile('stale.pdf')], {
      registry,
      loader,
      createSourceId: () => 'source-stale',
      createPageId: createPageFactory,
      isCurrent: () => generation === 1,
    });

    await started;
    generation = 2;
    release?.({ document, loadingTask: staleTask.task });
    const result = await loading;

    expect(result.cancelled).toBe(true);
    expect(result.pages).toEqual([]);
    expect(staleTask.destroy).toHaveBeenCalledOnce();
    expect(registry.size).toBe(0);
  });
});
