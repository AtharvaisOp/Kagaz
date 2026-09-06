import { loadPdf } from '../../../lib/pdf';

import type { LoadedPdf } from '../../../lib/pdf';
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist';
import type { SourceDocumentId } from '../model/types';

export interface SourceDocumentRuntime {
  readonly id: SourceDocumentId;
  readonly file: File;
  document: PDFDocumentProxy | null;
  loadingTask: PDFDocumentLoadingTask | null;
  abortController: AbortController | null;
}

export type PdfLoader = (file: File, signal: AbortSignal) => Promise<LoadedPdf>;

function createAbortError(): DOMException {
  return new DOMException('PDF loading was cancelled.', 'AbortError');
}

async function destroyLoadingTask(
  loadingTask: PDFDocumentLoadingTask,
): Promise<void> {
  try {
    await loadingTask.destroy();
  } catch {
    // Cleanup is best effort. The runtime is removed even if PDF.js has
    // already completed its own destruction.
  }
}

async function cleanupDocument(document: PDFDocumentProxy): Promise<void> {
  try {
    // PDFDocumentProxy.cleanup is a method on the proxy; call it with the
    // proxy as its receiver for PDF.js implementations that rely on `this`.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const cleanup = document.cleanup as (
      keepLoadedFonts?: boolean,
    ) => Promise<void>;
    await cleanup.call(document);
  } catch {
    // Cleanup is best effort for a document whose worker is already gone.
  }
}

/** Owns all non-serializable PDF.js resources for the current workspace session. */
export class SourceDocumentRegistry {
  private readonly runtimes = new Map<
    SourceDocumentId,
    SourceDocumentRuntime
  >();

  register(id: SourceDocumentId, file: File): SourceDocumentRuntime {
    if (this.runtimes.has(id)) {
      throw new Error(`Source runtime already exists for ${id}.`);
    }

    const runtime: SourceDocumentRuntime = {
      id,
      file,
      document: null,
      loadingTask: null,
      abortController: null,
    };
    this.runtimes.set(id, runtime);
    return runtime;
  }

  get(id: SourceDocumentId): SourceDocumentRuntime | undefined {
    return this.runtimes.get(id);
  }

  getDocument(id: SourceDocumentId): PDFDocumentProxy | null {
    return this.runtimes.get(id)?.document ?? null;
  }

  get size(): number {
    return this.runtimes.size;
  }

  async load(
    id: SourceDocumentId,
    loader: PdfLoader = loadPdf,
  ): Promise<PDFDocumentProxy> {
    const runtime = this.runtimes.get(id);
    if (!runtime) {
      throw new Error(`No source runtime exists for ${id}.`);
    }

    if (runtime.document) {
      return runtime.document;
    }

    if (runtime.abortController) {
      throw new Error(`Source ${id} is already loading.`);
    }

    const abortController = new AbortController();
    runtime.abortController = abortController;

    try {
      const loaded = await loader(runtime.file, abortController.signal);
      const isCurrentRuntime = this.runtimes.get(id) === runtime;

      if (!isCurrentRuntime || abortController.signal.aborted) {
        await destroyLoadingTask(loaded.loadingTask);
        throw createAbortError();
      }

      runtime.document = loaded.document;
      // PDF.js exposes full worker/document destruction on the loading task.
      // Retain it alongside the proxy so this registry remains the sole owner
      // of the complete source lifecycle.
      runtime.loadingTask = loaded.loadingTask;
      return loaded.document;
    } finally {
      if (this.runtimes.get(id) === runtime) {
        runtime.abortController = null;
      }
    }
  }

  abortSource(id: SourceDocumentId): void {
    this.runtimes.get(id)?.abortController?.abort();
  }

  async destroySource(id: SourceDocumentId): Promise<void> {
    const runtime = this.runtimes.get(id);
    if (!runtime) {
      return;
    }

    runtime.abortController?.abort();
    this.runtimes.delete(id);

    if (runtime.loadingTask) {
      const loadingTask = runtime.loadingTask;
      runtime.loadingTask = null;
      runtime.document = null;
      await destroyLoadingTask(loadingTask);
      return;
    }

    if (runtime.document) {
      const document = runtime.document;
      runtime.document = null;
      await cleanupDocument(document);
    }
  }

  async destroyAll(): Promise<void> {
    const ids = [...this.runtimes.keys()];
    await Promise.all(ids.map((id) => this.destroySource(id)));
  }
}
