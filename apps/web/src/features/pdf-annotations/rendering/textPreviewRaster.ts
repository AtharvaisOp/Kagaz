import type {
  PDFDocumentLoadingTask,
  PDFPageProxy,
  RenderTask,
} from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { TextAnnotation } from '../model/types';

/** Isolated text-box PDF: no donor document or source resources enter a preview. */
export async function renderTextPreviewRaster(
  annotation: TextAnnotation,
  width: number,
  height: number,
  signal: AbortSignal,
): Promise<HTMLCanvasElement> {
  const canvas = document.createElement('canvas');
  let loading: PDFDocumentLoadingTask | null = null;
  let page: PDFPageProxy | null = null;
  let task: RenderTask | null = null;
  let complete = false;
  const checkAbort = () => {
    if (signal.aborted)
      throw new DOMException('Text preview cancelled.', 'AbortError');
  };
  const cancel = () => task?.cancel();
  signal.addEventListener('abort', cancel, { once: true });
  try {
    checkAbort();
    if (
      ![width, height, annotation.box.width, annotation.box.height].every(
        (value) => Number.isFinite(value) && value > 0,
      )
    )
      throw new Error('This text box has invalid preview dimensions.');
    const [{ PDFDocument }, flattening, runtime] = await Promise.all([
      import('pdf-lib'),
      import('../../../lib/pdf-export/annotations/flattenAnnotations'),
      import('pdfjs-dist'),
    ]);
    checkAbort();
    const pdf = await PDFDocument.create();
    const pdfPage = pdf.addPage([annotation.box.width, annotation.box.height]);
    await flattening.flattenAnnotationsOntoCopiedPage(
      pdfPage,
      [
        {
          ...annotation,
          box: { ...annotation.box, origin: { x: 0, y: 0 }, rotation: 0 },
        },
      ],
      pdf,
    );
    checkAbort();
    const bytes = await pdf.save();
    checkAbort();
    runtime.GlobalWorkerOptions.workerSrc = workerUrl;
    loading = runtime.getDocument({
      data: bytes,
      stopAtErrors: true,
      maxImageSize: 16_000_000,
    });
    const previewDocument = await loading.promise;
    checkAbort();
    page = await previewDocument.getPage(1);
    checkAbort();
    const base = page.getViewport({ scale: 1 });
    const requested =
      Math.min(width / base.width, height / base.height) *
      Math.min(window.devicePixelRatio || 1, 2);
    const scale = Math.min(
      requested,
      4096 / base.width,
      4096 / base.height,
      Math.sqrt(4_000_000 / (base.width * base.height)),
    );
    const viewport = page.getViewport({ scale });
    canvas.width = Math.max(1, Math.floor(viewport.width));
    canvas.height = Math.max(1, Math.floor(viewport.height));
    const context = canvas.getContext('2d', { alpha: true });
    if (!context)
      throw new Error('Canvas rendering is unavailable in this browser.');
    task = page.render({
      canvas,
      canvasContext: context,
      viewport,
      background: 'rgba(0,0,0,0)',
    });
    await task.promise;
    checkAbort();
    complete = true;
    return canvas;
  } finally {
    signal.removeEventListener('abort', cancel);
    if (!complete) {
      canvas.width = 0;
      canvas.height = 0;
    }
    page?.cleanup();
    await loading?.destroy();
  }
}
