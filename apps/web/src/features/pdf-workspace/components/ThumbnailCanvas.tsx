import { useEffect, useRef, useState } from 'react';

import { normalizeRotation } from '../model/operations';
import { adoptResolvedPdfPage } from '../runtime/pdfPageLifecycle';

import type { WorkspacePage } from '../model/types';
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist';

const THUMBNAIL_WIDTH = 112;

interface ThumbnailCanvasProps {
  readonly page: WorkspacePage;
  readonly document: PDFDocumentProxy | null;
  readonly root: HTMLElement | null;
}

function isCancelled(error: unknown): boolean {
  return error instanceof Error && error.name === 'RenderingCancelledException';
}

export function ThumbnailCanvas({
  page,
  document,
  root,
}: ThumbnailCanvasProps) {
  const shellRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isNearRail, setIsNearRail] = useState(false);
  const [status, setStatus] = useState<
    'waiting' | 'loading' | 'ready' | 'error'
  >('waiting');

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
    if (!canvas) return;

    setStatus('loading');
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
    };
  }, [document, isNearRail, page.rotationDelta, page.sourcePageIndex]);

  return (
    <div ref={shellRef} className="thumbnail-canvas-shell" data-status={status}>
      <canvas
        ref={canvasRef}
        className="thumbnail-canvas"
        width={0}
        height={0}
      />
      {status !== 'ready' ? (
        <span className="thumbnail-placeholder" aria-hidden="true" />
      ) : null}
    </div>
  );
}
