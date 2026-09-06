import { useEffect, useRef, useState } from 'react';

import { useNearViewport } from '../../hooks/useNearViewport';

import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist';

interface PdfPageProps {
  document: PDFDocumentProxy;
  pageNumber: number;
  zoom: number;
}

type PageStatus = 'waiting' | 'loading' | 'ready' | 'error';

export function PdfPage({ document, pageNumber, zoom }: PdfPageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { elementRef, isNearViewport } = useNearViewport();
  const [status, setStatus] = useState<PageStatus>('waiting');
  const [baseDimensions, setBaseDimensions] = useState({
    width: 612,
    height: 792,
  });
  const displayDimensions = {
    width: baseDimensions.width * (zoom / 100),
    height: baseDimensions.height * (zoom / 100),
  };

  useEffect(() => {
    if (!isNearViewport) {
      return;
    }

    let active = true;
    let page: PDFPageProxy | null = null;
    let renderTask: RenderTask | null = null;
    const canvas = canvasRef.current;

    if (!canvas) {
      return;
    }

    setStatus('loading');

    void document
      .getPage(pageNumber)
      .then((loadedPage) => {
        if (!active) {
          return;
        }

        page = loadedPage;
        const baseViewport = loadedPage.getViewport({ scale: 1 });
        const viewport = loadedPage.getViewport({ scale: zoom / 100 });
        const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
        const context = canvas.getContext('2d', { alpha: false });

        if (!context) {
          throw new Error('Canvas rendering is unavailable in this browser.');
        }

        setBaseDimensions({
          width: baseViewport.width,
          height: baseViewport.height,
        });
        canvas.width = Math.floor(viewport.width * pixelRatio);
        canvas.height = Math.floor(viewport.height * pixelRatio);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;

        renderTask = loadedPage.render({
          canvas,
          canvasContext: context,
          transform:
            pixelRatio === 1 ? undefined : [pixelRatio, 0, 0, pixelRatio, 0, 0],
          viewport,
        });

        return renderTask.promise;
      })
      .then(() => {
        if (active) {
          setStatus('ready');
        }
      })
      .catch((error: unknown) => {
        if (
          active &&
          !(
            error instanceof Error &&
            error.name === 'RenderingCancelledException'
          )
        ) {
          setStatus('error');
        }
      });

    return () => {
      active = false;
      renderTask?.cancel();
      page?.cleanup();
      canvas.width = 0;
      canvas.height = 0;
    };
  }, [document, isNearViewport, pageNumber, zoom]);

  return (
    <article
      ref={elementRef}
      className="pdf-page-shell"
      aria-label={`Page ${pageNumber}`}
      style={{
        width: displayDimensions.width,
        minHeight: displayDimensions.height,
      }}
    >
      <div className="page-index" aria-hidden="true">
        {String(pageNumber).padStart(2, '0')}
      </div>
      <canvas
        ref={canvasRef}
        className="pdf-canvas"
        width={0}
        height={0}
        data-ready={isNearViewport && status === 'ready' ? true : undefined}
      />
      {!isNearViewport || status === 'loading' || status === 'waiting' ? (
        <div
          className="page-placeholder"
          aria-label={`Loading page ${pageNumber}`}
        >
          <span className="loading-line" />
          <span className="loading-line short" />
          <span className="loading-line" />
        </div>
      ) : null}
      {status === 'error' ? (
        <div className="page-error" role="alert">
          Page {pageNumber} could not be rendered.
        </div>
      ) : null}
    </article>
  );
}
