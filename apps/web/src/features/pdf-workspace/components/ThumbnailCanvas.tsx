import { useEffect, useMemo, useRef, useState } from 'react';

import { normalizeRotation } from '../model/operations';
import { adoptResolvedPdfPage } from '../runtime/pdfPageLifecycle';
import {
  drawThumbnailAnnotations,
  projectThumbnailAnnotations,
} from './thumbnailAnnotations';
import type { AnnotationAssetRegistry } from '../../pdf-annotations/runtime/annotationAssetRegistry';
import type { PdfAnnotation } from '../../pdf-annotations/model/types';

import type { WorkspacePage } from '../model/types';
import type {
  PDFDocumentProxy,
  PDFPageProxy,
  PageViewport,
  RenderTask,
} from 'pdfjs-dist';

const THUMBNAIL_WIDTH = 112;

interface ThumbnailCanvasProps {
  readonly page: WorkspacePage;
  readonly document: PDFDocumentProxy | null;
  readonly root: HTMLElement | null;
  readonly annotations: readonly PdfAnnotation[];
  readonly assetRegistry: AnnotationAssetRegistry;
}

function isCancelled(error: unknown): boolean {
  return error instanceof Error && error.name === 'RenderingCancelledException';
}

export function ThumbnailCanvas({
  page,
  document,
  root,
  annotations,
  assetRegistry,
}: ThumbnailCanvasProps) {
  const shellRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const annotationCanvasRef = useRef<HTMLCanvasElement>(null);
  const [isNearRail, setIsNearRail] = useState(false);
  const [status, setStatus] = useState<
    'waiting' | 'loading' | 'ready' | 'error'
  >('waiting');
  const [viewport, setViewport] = useState<PageViewport | null>(null);
  const [surfaceSize, setSurfaceSize] = useState<{
    readonly width: number;
    readonly height: number;
  } | null>(null);
  const [pixelRatio, setPixelRatio] = useState(1);
  const [assetVersion, setAssetVersion] = useState(0);
  const imageAssetIds = useMemo(
    () =>
      Array.from(
        new Set(
          annotations.flatMap((annotation) =>
            annotation.kind === 'image' ? [annotation.assetId] : [],
          ),
        ),
      ),
    [annotations],
  );

  useEffect(() => {
    if (imageAssetIds.length === 0) return;
    const unsubscribers = imageAssetIds.map((assetId) =>
      assetRegistry.subscribe(assetId, () =>
        setAssetVersion((current) => current + 1),
      ),
    );
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, [assetRegistry, imageAssetIds]);

  useEffect(() => {
    const element = shellRef.current;
    if (!element || !root || typeof IntersectionObserver === 'undefined') {
      setIsNearRail(Boolean(!root));
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => setIsNearRail(entry?.isIntersecting ?? false),
      { root, rootMargin: '180px 0px', threshold: 0 },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [root]);

  useEffect(() => {
    if (!isNearRail || !document) return;

    let active = true;
    let loadedPage: PDFPageProxy | null = null;
    let renderTask: RenderTask | null = null;
    const canvas = canvasRef.current;
    const annotationCanvas = annotationCanvasRef.current;
    if (!canvas || !annotationCanvas) return;

    setStatus('loading');
    setViewport(null);
    setSurfaceSize(null);
    void document
      .getPage(page.sourcePageIndex + 1)
      .then((pdfPage) => {
        const ownedPage = adoptResolvedPdfPage(pdfPage, active);
        if (!ownedPage) return;
        loadedPage = ownedPage;
        const rotation = normalizeRotation(
          ownedPage.rotate + page.rotationDelta,
        );
        const baseViewport = ownedPage.getViewport({ scale: 1, rotation });
        const scale =
          baseViewport.width > 0 ? THUMBNAIL_WIDTH / baseViewport.width : 1;
        const viewport = ownedPage.getViewport({ scale, rotation });
        const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.75);
        const context = canvas.getContext('2d', { alpha: false });
        if (!context) throw new Error('Thumbnail rendering is unavailable.');

        canvas.width = Math.floor(viewport.width * pixelRatio);
        canvas.height = Math.floor(viewport.height * pixelRatio);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        annotationCanvas.width = Math.floor(viewport.width * pixelRatio);
        annotationCanvas.height = Math.floor(viewport.height * pixelRatio);
        annotationCanvas.style.width = `${viewport.width}px`;
        annotationCanvas.style.height = `${viewport.height}px`;
        setPixelRatio(pixelRatio);
        setSurfaceSize({ width: viewport.width, height: viewport.height });
        setViewport(viewport);
        renderTask = ownedPage.render({
          canvas,
          canvasContext: context,
          transform:
            pixelRatio === 1 ? undefined : [pixelRatio, 0, 0, pixelRatio, 0, 0],
          viewport,
        });
        return renderTask.promise;
      })
      .then(() => {
        if (active) setStatus('ready');
      })
      .catch((error: unknown) => {
        if (active && !isCancelled(error)) setStatus('error');
      });

    return () => {
      active = false;
      renderTask?.cancel();
      loadedPage?.cleanup();
      canvas.width = 0;
      canvas.height = 0;
      if (annotationCanvas) {
        annotationCanvas.width = 0;
        annotationCanvas.height = 0;
      }
      setStatus('waiting');
      setViewport(null);
      setSurfaceSize(null);
      setPixelRatio(1);
    };
  }, [document, isNearRail, page.rotationDelta, page.sourcePageIndex]);

  useEffect(() => {
    const canvas = annotationCanvasRef.current;
    if (!canvas || !viewport || status !== 'ready') return;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    drawThumbnailAnnotations(
      context,
      projectThumbnailAnnotations(annotations, viewport, {
        get: (assetId) => assetRegistry.get(assetId),
      }),
      pixelRatio,
    );
  }, [annotations, assetRegistry, assetVersion, pixelRatio, status, viewport]);

  return (
    <div ref={shellRef} className="thumbnail-canvas-shell" data-status={status}>
      <div
        className="thumbnail-render-surface"
        style={
          surfaceSize
            ? { width: surfaceSize.width, height: surfaceSize.height }
            : undefined
        }
      >
        <canvas
          ref={canvasRef}
          className="thumbnail-canvas"
          width={0}
          height={0}
        />
        <canvas
          ref={annotationCanvasRef}
          className="thumbnail-annotation-canvas"
          aria-hidden="true"
          width={0}
          height={0}
        />
      </div>
      {status !== 'ready' ? (
        <span className="thumbnail-placeholder" aria-hidden="true" />
      ) : null}
    </div>
  );
}
