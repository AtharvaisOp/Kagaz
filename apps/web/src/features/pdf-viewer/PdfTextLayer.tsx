import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import type { PageViewport, PDFDocumentProxy, TextLayer } from 'pdfjs-dist';
import { acquirePdfPage } from '../pdf-workspace/runtime/pdfPageLifecycle';
import type { AnnotationStyleDefaults } from '../pdf-annotations/model/editorTypes';
import type { PdfAnnotation } from '../pdf-annotations/model/types';
import { selectedTextRects, selectionRectToPdfBox } from './textSelection';

interface PdfTextLayerProps {
  readonly document: PDFDocumentProxy;
  readonly pageIndex: number;
  readonly pageId: string;
  readonly viewport: PageViewport;
  readonly enabled: boolean;
  readonly highlighting: boolean;
  readonly styleDefaults: AnnotationStyleDefaults;
  readonly createId: () => string;
  readonly onHighlight: (annotations: readonly PdfAnnotation[]) => void;
}

export function PdfTextLayer({
  document: pdf,
  pageIndex,
  pageId,
  viewport,
  enabled,
  highlighting,
  styleDefaults,
  createId,
  onHighlight,
}: PdfTextLayerProps) {
  const layerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>(
    'loading',
  );
  const [hasSelection, setHasSelection] = useState(false);
  const [notice, setNotice] = useState('');
  useEffect(() => {
    const container = layerRef.current;
    if (!container) return;
    let active = true;
    let layer: TextLayer | null = null;
    const lease = acquirePdfPage(pdf, pageIndex + 1);
    const work = (async () => {
      const [page, { TextLayer }] = await Promise.all([
        lease.page,
        import('pdfjs-dist'),
      ]);
      if (!active) return;
      layer = new TextLayer({
        container,
        viewport,
        textContentSource: page.streamTextContent({
          includeMarkedContent: true,
        }),
      });
      await layer.render();
      if (active) setStatus('ready');
    })();
    void work.catch(() => {
      if (active) setStatus('error');
    });
    return () => {
      active = false;
      layer?.cancel();
      // Hold the shared page until extraction/cancellation settles, just as canvas renders do.
      void work.then(
        () => lease.release(true),
        () => lease.release(true),
      );
      container.replaceChildren();
    };
  }, [pdf, pageIndex, viewport]);

  const applyHighlight = useCallback(() => {
    const container = layerRef.current;
    const selection = window.getSelection();
    const surface = container?.parentElement;
    if (!container || !selection || !surface || !enabled) return;
    const rectangles = selectedTextRects(container, selection);
    if (rectangles.length > 1000) {
      setNotice(
        'Select a shorter passage to highlight (up to 1,000 text runs).',
      );
      return;
    }
    const bounds = surface.getBoundingClientRect();
    const annotations = rectangles.flatMap((rect) => {
      const box = selectionRectToPdfBox(
        { left: rect.x, top: rect.y, width: rect.width, height: rect.height },
        bounds,
        viewport,
      );
      return box
        ? [
            {
              id: createId(),
              workspacePageId: pageId,
              kind: 'highlight' as const,
              box,
              fill: {
                color: styleDefaults.fillColor,
                opacity: styleDefaults.opacity,
              },
            },
          ]
        : [];
    });
    if (!annotations.length) return;
    onHighlight(annotations);
    setNotice('Selected text highlighted.');
    // Keep the selection in Highlight mode until every selected page has handled pointerup.
    if (!highlighting) selection.removeAllRanges();
  }, [
    createId,
    enabled,
    highlighting,
    onHighlight,
    pageId,
    styleDefaults.fillColor,
    styleDefaults.opacity,
    viewport,
  ]);

  useEffect(() => {
    const onSelection = () => {
      const selection = window.getSelection();
      const layer = layerRef.current;
      setHasSelection(
        Boolean(
          enabled &&
          layer &&
          selection &&
          !selection.isCollapsed &&
          [...Array(selection.rangeCount).keys()].some((index) =>
            selection.getRangeAt(index).intersectsNode(layer),
          ),
        ),
      );
    };
    document.addEventListener('selectionchange', onSelection);
    return () => document.removeEventListener('selectionchange', onSelection);
  }, [enabled]);

  useEffect(() => {
    if (!highlighting || !enabled) return;
    // Native selection completes before this task, including a drag ending outside the page.
    let timer: number | undefined;
    let clearTimer: number | undefined;
    let selectingText = false;
    const onDown = (event: PointerEvent) => {
      selectingText =
        event.button === 0 &&
        event.target instanceof Element &&
        Boolean(event.target.closest('.pdf-text-layer[data-enabled="true"]'));
    };
    const onUp = () => {
      if (!selectingText) return;
      selectingText = false;
      timer = window.setTimeout(() => {
        applyHighlight();
        clearTimer = window.setTimeout(
          () => window.getSelection()?.removeAllRanges(),
          0,
        );
      }, 0);
    };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointerup', onUp);
      window.clearTimeout(timer);
      window.clearTimeout(clearTimer);
    };
  }, [applyHighlight, enabled, highlighting]);

  return (
    <>
      <div
        ref={layerRef}
        className="pdf-text-layer"
        data-enabled={enabled}
        data-status={status}
        style={
          {
            '--total-scale-factor': viewport.scale * viewport.userUnit,
            '--scale-round-x': '1px',
            '--scale-round-y': '1px',
          } as CSSProperties
        }
      />
      {enabled && hasSelection && !highlighting ? (
        <button
          className="text-selection-action"
          type="button"
          onPointerDown={(event) => event.preventDefault()}
          onClick={applyHighlight}
        >
          Highlight selected text
        </button>
      ) : null}
      {status === 'error' ? (
        <span className="text-layer-notice" role="status">
          Text selection is unavailable on this page. Manual highlighting is
          still available.
        </span>
      ) : null}
      <span className="sr-only" role="status">
        {notice}
      </span>
    </>
  );
}
