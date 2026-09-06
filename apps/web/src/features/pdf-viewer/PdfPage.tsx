import { useEffect, useRef, useState } from 'react';

import { useNearViewport } from '../../hooks/useNearViewport';
import { normalizeRotation } from '../pdf-workspace/model/operations';

import type { WorkspacePage } from '../pdf-workspace/model/types';
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist';

interface PdfPageProps {
  readonly page: WorkspacePage;
  readonly document: PDFDocumentProxy;
  readonly workspacePosition: number;
  readonly zoom: number;
}

type PageStatus = 'waiting' | 'loading' | 'ready' | 'error';

export function PdfPage({
  page,
  document,
  workspacePosition,
  zoom,
}: PdfPageProps) {
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
    let loadedPage: PDFPageProxy | null = null;
    let renderTask: RenderTask | null = null;
    const canvas = canvasRef.current;

    if (!canvas) {
      return;
    }

    setStatus('loading');

    void document
      .getPage(page.sourcePageIndex + 1)
      .then((nextPage) => {
        if (!active) {
          return;
        }

        loadedPage = nextPage;
        const totalRotation = normalizeRotation(
          nextPage.rotate + page.rotationDelta,
        );
        const baseViewport = nextPage.getViewport({
          scale: 1,
          rotation: totalRotation,
        });
        const viewport = nextPage.getViewport({
          scale: zoom / 100,
          rotation: totalRotation,
        });
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

        renderTask = nextPage.render({
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
      loadedPage?.cleanup();
      canvas.width = 0;
      canvas.height = 0;
    };
  }, [document, isNearViewport, page, zoom]);

  const workspacePageNumber = workspacePosition + 1;

  return (
    <article
      ref={elementRef}
      className="pdf-page-shell"
      data-workspace-page-id={page.id}
      aria-label={`Page ${workspacePageNumber}`}
      style={{
        width: displayDimensions.width,
        minHeight: displayDimensions.height,
      }}
    >
      <div className="page-index" aria-hidden="true">
        {String(workspacePageNumber).padStart(2, '0')}
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
          aria-label={`Loading page ${workspacePageNumber}`}
        >
          <span className="loading-line" />
          <span className="loading-line short" />
          <span className="loading-line" />
        </div>
      ) : null}
      {status === 'error' ? (
        <div className="page-error" role="alert">
          Page {workspacePageNumber} could not be rendered.
        </div>
      ) : null}
    </article>
  );
}
