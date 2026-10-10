import { useEffect, useRef, useState } from 'react';
import type {
  PDFDocumentLoadingTask,
  PDFPageProxy,
  RenderTask,
} from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import {
  AnnotationExportError,
  type AnnotationImageExportSource,
} from '../../../lib/pdf-export/annotations/exportContracts';
import type { AnnotationAssetRegistry } from '../../pdf-annotations/runtime/annotationAssetRegistry';
import type { WatermarkConfig, WatermarkPreviewGeometry } from '../model/types';
import { watermarkPreviewJobs } from '../runtime/previewJobQueue';

const MAX_PREVIEW_PIXELS = 4_000_000;
const MAX_PREVIEW_SIDE = 4096;

/** The same PDF draw path as export, bounded and rendered only for visible pages. */
export function WatermarkPreview({
  config,
  geometry,
  assetRegistry,
  width,
  height,
  className = 'watermark-page-preview',
  onError,
}: {
  readonly config: WatermarkConfig;
  readonly geometry: WatermarkPreviewGeometry;
  readonly assetRegistry: Pick<AnnotationAssetRegistry, 'get'>;
  readonly width: number;
  readonly height: number;
  readonly className?: string;
  readonly onError?: (error: string | null) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let active = true;
    let loading: PDFDocumentLoadingTask | null = null;
    let page: PDFPageProxy | null = null;
    let task: RenderTask | null = null;
    let destroyPromise: Promise<void> | null = null;
    const cancellation = new AbortController();
    const cleanup = async () => {
      const completedPage = page;
      page = null;
      try {
        completedPage?.cleanup();
      } finally {
        const completedLoading = loading;
        loading = null;
        if (completedLoading) {
          const priorDestroy = destroyPromise;
          destroyPromise = Promise.resolve()
            .then(async () => {
              await priorDestroy;
              await completedLoading.destroy();
            })
            .catch(() => undefined);
        }
        await destroyPromise;
      }
    };
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    // Capture only immutable metadata/Blob references. Queued/debounced jobs read no bytes.
    const asset =
      config.kind === 'image' ? assetRegistry.get(config.assetId) : null;
    const capturedImage = asset
      ? { assetId: asset.assetId, mimeType: asset.mimeType, blob: asset.blob }
      : null;
    setError(null);
    setReady(false);
    onError?.(null);
    canvas.width = 0;
    canvas.height = 0;
    const timer = window.setTimeout(() => {
      void watermarkPreviewJobs
        .run(cancellation.signal, async () => {
          try {
            const readAssets = async () => {
              const snapshot = new Map<string, AnnotationImageExportSource>();
              if (capturedImage) {
                let bytes: ArrayBuffer;
                try {
                  bytes = await capturedImage.blob.arrayBuffer();
                } catch {
                  throw new AnnotationExportError(
                    'image-read-failed',
                    'Kagaz could not read a visual annotation asset for export.',
                    null,
                    capturedImage.assetId,
                  );
                }
                snapshot.set(capturedImage.assetId, {
                  assetId: capturedImage.assetId,
                  mimeType: capturedImage.mimeType,
                  bytes,
                });
              }
              return snapshot;
            };
            const [{ createWatermarkPreviewPdf }, runtime, imageAssets] =
              await Promise.all([
                import('../../../lib/pdf-export/watermarks/renderWatermark'),
                import('pdfjs-dist'),
                readAssets(),
              ]);
            if (!active) return;
            const bytes = await createWatermarkPreviewPdf(
              config,
              geometry,
              imageAssets,
              cancellation.signal,
            );
            if (!active) return;
            runtime.GlobalWorkerOptions.workerSrc = workerUrl;
            loading = runtime.getDocument({
              data: bytes,
              stopAtErrors: true,
              maxImageSize: 16_000_000,
            });
            const document = await loading.promise;
            if (!active) return;
            page = await document.getPage(1);
            if (!active) return;
            const base = page.getViewport({ scale: 1 });
            if (
              ![base.width, base.height, width, height].every(
                (value) => Number.isFinite(value) && value > 0,
              )
            )
              throw new Error(
                'This page cannot display a safe watermark preview.',
              );
            const fit = Math.min(width / base.width, height / base.height);
            const requested = fit * pixelRatio;
            const scale = Math.min(
              requested,
              MAX_PREVIEW_SIDE / base.width,
              MAX_PREVIEW_SIDE / base.height,
              Math.sqrt(MAX_PREVIEW_PIXELS / (base.width * base.height)),
            );
            const viewport = page.getViewport({ scale });
            canvas.width = Math.max(1, Math.floor(viewport.width));
            canvas.height = Math.max(1, Math.floor(viewport.height));
            const context = canvas.getContext('2d', { alpha: true });
            if (!context)
              throw new Error(
                'Canvas rendering is unavailable in this browser.',
              );
            task = page.render({
              canvas,
              canvasContext: context,
              viewport,
              background: 'rgba(0,0,0,0)',
            });
            await task.promise;
            if (active) setReady(true);
          } finally {
            await cleanup();
          }
        })
        .catch((failure: unknown) => {
          if (!active) return;
          const message =
            failure instanceof Error
              ? failure.message
              : 'Kagaz could not preview this watermark.';
          setError(message);
          onError?.(message);
        });
    }, 90);
    return () => {
      active = false;
      cancellation.abort();
      window.clearTimeout(timer);
      task?.cancel();
      void cleanup().catch(() => undefined);
      canvas.width = 0;
      canvas.height = 0;
    };
  }, [assetRegistry, config, geometry, height, onError, width]);
  return (
    <div
      className={className}
      aria-hidden={className === 'watermark-page-preview' ? true : undefined}
    >
      <canvas
        ref={canvasRef}
        className="watermark-canvas"
        data-watermark-ready={ready || undefined}
      />
      {error && className !== 'watermark-page-preview' ? (
        <p className="watermark-preview-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
