import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type {
  PDFDocumentLoadingTask,
  PDFPageProxy,
  RenderTask,
} from 'pdfjs-dist';
import type { RedactionRegion } from '../../../features/pdf-redactions/model/types';
import { PdfExportError } from '../types';
import {
  REDACTION_DPI,
  REDACTION_MAX_PIXELS,
  redactionPixelBounds,
  redactionRasterDimensions,
} from './rasterPolicy';

function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted)
    throw new PdfExportError('aborted', 'PDF export was cancelled.');
}

export interface SanitizedPageRaster {
  readonly png: Uint8Array;
  readonly viewBox: readonly [number, number, number, number];
  readonly pixelWidth: number;
  readonly pixelHeight: number;
}

/** Only the overwritten, opaque bitmap crosses this boundary into final output. */
export async function rasterizeAppearance(
  appearance: Uint8Array,
  pageId: string,
  regions: readonly RedactionRegion[],
  signal?: AbortSignal,
): Promise<SanitizedPageRaster> {
  let loadingTask: PDFDocumentLoadingTask | null = null;
  let renderTask: RenderTask | null = null;
  let pdfPage: PDFPageProxy | null = null;
  let canvas: HTMLCanvasElement | null = null;
  const abort = () => {
    renderTask?.cancel();
    if (loadingTask) void loadingTask.destroy().catch(() => undefined);
  };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    checkAbort(signal);
    const pdfjs = await import('pdfjs-dist');
    checkAbort(signal);
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
    loadingTask = pdfjs.getDocument({
      data: appearance,
      stopAtErrors: true,
      // PDF.js 6.3 throws (rather than omitting) oversized inline images when
      // stopAtErrors is enabled; XObject/mask aggregates are checked separately.
      maxImageSize: REDACTION_MAX_PIXELS,
      canvasMaxAreaInBytes: REDACTION_MAX_PIXELS * 4,
    });
    const document = await loadingTask.promise;
    checkAbort(signal);
    if (document.numPages !== 1)
      throw new Error('Expected one appearance page.');
    pdfPage = await document.getPage(1);
    checkAbort(signal);
    // Rotation remains PDF metadata. Geometry stays in raw PDF user space.
    const viewport = pdfPage.getViewport({
      scale: REDACTION_DPI / 72,
      rotation: 0,
    });
    const dimensions = redactionRasterDimensions(viewport);
    const bounds = regions.map((region) =>
      redactionPixelBounds(region, pageId, viewport),
    );
    canvas = globalThis.document.createElement('canvas');
    canvas.width = dimensions.width;
    canvas.height = dimensions.height;
    const context = canvas.getContext('2d', {
      alpha: false,
      willReadFrequently: true,
    });
    if (!context) throw new Error('Canvas2D unavailable.');
    renderTask = pdfPage.render({
      canvas,
      canvasContext: context,
      viewport,
      background: '#ffffff',
      annotationMode: pdfjs.AnnotationMode.ENABLE,
    });
    await renderTask.promise;
    checkAbort(signal);
    // One bounded pixel buffer. Union overlapping intervals so repeated proposals
    // cannot multiply full-page pixel work or create a full bitmap per proposal.
    const pixels = context.getImageData(
      0,
      0,
      dimensions.width,
      dimensions.height,
    );
    const words = new Uint32Array(
      pixels.data.buffer,
      pixels.data.byteOffset,
      pixels.data.byteLength / 4,
    );
    const opaqueBlack = new Uint32Array(
      Uint8Array.from([0, 0, 0, 255]).buffer,
    )[0]!;
    for (let y = 0; y < dimensions.height; y += 1) {
      const ranges = bounds
        .filter((bound) => y >= bound.y && y < bound.y + bound.height)
        .map((bound) => [bound.x, bound.x + bound.width] as const)
        .sort((first, second) => first[0] - second[0]);
      let left = -1;
      let right = -1;
      const fill = () => {
        if (left >= 0)
          words.fill(
            opaqueBlack,
            y * dimensions.width + left,
            y * dimensions.width + right,
          );
      };
      for (const range of ranges) {
        if (range[0] > right) {
          fill();
          left = range[0];
          right = range[1];
        } else right = Math.max(right, range[1]);
      }
      fill();
      if (y % 128 === 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        checkAbort(signal);
      }
    }
    // Direct sample replacement ignores graphics blend/clip/compositing state.
    context.putImageData(pixels, 0, 0);
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas!.toBlob(
        (value) =>
          value ? resolve(value) : reject(new Error('PNG encoding failed.')),
        'image/png',
      );
    });
    checkAbort(signal);
    const png = new Uint8Array(await blob.arrayBuffer());
    checkAbort(signal);
    return {
      png,
      viewBox: viewport.viewBox as [number, number, number, number],
      pixelWidth: dimensions.width,
      pixelHeight: dimensions.height,
    };
  } catch (error) {
    checkAbort(signal);
    if (error instanceof PdfExportError) throw error;
    throw new PdfExportError(
      'redaction-render-failed',
      'Kagaz could not safely finalize this redacted page. No PDF was downloaded; your proposals remain editable.',
    );
  } finally {
    signal?.removeEventListener('abort', abort);
    renderTask?.cancel();
    pdfPage?.cleanup();
    if (loadingTask) await loadingTask.destroy().catch(() => undefined);
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
    }
  }
}
