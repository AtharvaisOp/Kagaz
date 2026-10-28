import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import type { PageViewport, PDFDocumentProxy, TextLayer } from 'pdfjs-dist';
import type { TextItem } from 'pdfjs-dist/types/src/display/api';
import { acquirePdfPage } from '../pdf-workspace/runtime/pdfPageLifecycle';
import type { AnnotationStyleDefaults } from '../pdf-annotations/model/editorTypes';
import type { PdfAnnotation } from '../pdf-annotations/model/types';
import type {
  NativeTextSelectionProof,
  NativeTextVisualRun,
} from '../../lib/pdf-native-text/types';
import { selectedTextRects, selectionRectToPdfBox } from './textSelection';

interface PdfTextLayerProps {
  readonly document: PDFDocumentProxy;
  readonly pageIndex: number;
  readonly pageId: string;
  readonly viewport: PageViewport;
  readonly enabled: boolean;
  readonly highlighting: boolean;
  readonly nativeTextEditing?: boolean;
  readonly styleDefaults: AnnotationStyleDefaults;
  readonly createId: () => string;
  readonly onHighlight: (annotations: readonly PdfAnnotation[]) => void;
  readonly onNativeTextEdit?: (
    selection: NativeTextSelectionProof | null,
  ) => Promise<boolean>;
}

const MAX_NATIVE_TEXT_PROOF_RUNS = 1_000;

interface NativeTextProofMap {
  readonly runs: readonly NativeTextVisualRun[];
  readonly runIndexByTextDiv: WeakMap<HTMLElement, number>;
}

function emptyNativeTextProofMap(): NativeTextProofMap {
  return { runs: [], runIndexByTextDiv: new WeakMap() };
}

function isPdfJsTextItem(item: unknown): item is TextItem {
  return (
    typeof item === 'object' &&
    item !== null &&
    'str' in item &&
    typeof item.str === 'string' &&
    'transform' in item &&
    Array.isArray(item.transform)
  );
}

function asNativeTextVisualRun(item: TextItem): NativeTextVisualRun | null {
  if (
    item.transform.length !== 6 ||
    !item.transform.every(
      (value) => typeof value === 'number' && Number.isFinite(value),
    )
  )
    return null;
  return Object.freeze({
    text: item.str,
    transform: Object.freeze([
      item.transform[0] ?? 0,
      item.transform[1] ?? 0,
      item.transform[2] ?? 0,
      item.transform[3] ?? 0,
      item.transform[4] ?? 0,
      item.transform[5] ?? 0,
    ]) as NativeTextVisualRun['transform'],
  });
}

/**
 * Native editing is intentionally stricter than highlighting: accept one
 * complete TextItem only. A partial or cross-span browser selection cannot be
 * allowed to resolve by matching its text string to another raw Tj operand.
 */
function selectedNativeTextProof(
  container: HTMLElement,
  selection: Selection,
  map: NativeTextProofMap,
): NativeTextSelectionProof | null {
  if (selection.isCollapsed || selection.rangeCount !== 1) return null;
  const range = selection.getRangeAt(0);
  const textNode = range.startContainer;
  if (
    textNode.nodeType !== Node.TEXT_NODE ||
    range.endContainer !== textNode ||
    range.startOffset !== 0 ||
    range.endOffset !== textNode.textContent?.length
  )
    return null;
  const textDiv = textNode.parentElement;
  if (
    !textDiv ||
    !container.contains(textDiv) ||
    !textDiv.matches('span[role="presentation"]') ||
    textDiv.childNodes.length !== 1
  )
    return null;
  const selectedRunIndex = map.runIndexByTextDiv.get(textDiv);
  if (selectedRunIndex === undefined) return null;
  const selectedRun = map.runs[selectedRunIndex];
  if (
    !selectedRun ||
    !selectedRun.text ||
    selectedRun.text !== textNode.textContent ||
    selection.toString() !== selectedRun.text
  )
    return null;
  return Object.freeze({ selectedRunIndex, runs: map.runs });
}

export function PdfTextLayer({
  document: pdf,
  pageIndex,
  pageId,
  viewport,
  enabled,
  highlighting,
  nativeTextEditing = false,
  styleDefaults,
  createId,
  onHighlight,
  onNativeTextEdit,
}: PdfTextLayerProps) {
  const layerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>(
    'loading',
  );
  const [hasSelection, setHasSelection] = useState(false);
  const [notice, setNotice] = useState('');
  const [startingNativeTextEdit, setStartingNativeTextEdit] = useState(false);
  const nativeTextProofMapRef = useRef<NativeTextProofMap>(
    emptyNativeTextProofMap(),
  );
  useEffect(() => {
    const container = layerRef.current;
    if (!container) return;
    let active = true;
    let layer: TextLayer | null = null;
    nativeTextProofMapRef.current = emptyNativeTextProofMap();
    const lease = acquirePdfPage(pdf, pageIndex + 1);
    const work = (async () => {
      const [page, { TextLayer }] = await Promise.all([
        lease.page,
        import('pdfjs-dist'),
      ]);
      if (!active) return;
      const textContent = await page.getTextContent({
        includeMarkedContent: true,
        disableNormalization: true,
      });
      if (!active) return;
      layer = new TextLayer({
        container,
        viewport,
        textContentSource: textContent,
      });
      await layer.render();
      if (!active) return;
      const textItems = textContent.items.filter(isPdfJsTextItem);
      const textDivs = layer.textDivs;
      if (textItems.length === textDivs.length) {
        const runs: NativeTextVisualRun[] = [];
        const runIndexByTextDiv = new WeakMap<HTMLElement, number>();
        for (const [index, item] of textItems.entries()) {
          if (!item.str) continue;
          const textDiv = textDivs[index];
          const run = asNativeTextVisualRun(item);
          if (!textDiv || !run) {
            runs.length = 0;
            break;
          }
          runIndexByTextDiv.set(textDiv, runs.length);
          runs.push(run);
        }
        if (runs.length > 0 && runs.length <= MAX_NATIVE_TEXT_PROOF_RUNS) {
          nativeTextProofMapRef.current = {
            runs: Object.freeze(runs),
            runIndexByTextDiv,
          };
        }
      }
      setStatus('ready');
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
      nativeTextProofMapRef.current = emptyNativeTextProofMap();
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

  const beginNativeTextEdit = useCallback(async () => {
    const selection = window.getSelection();
    if (
      !enabled ||
      !nativeTextEditing ||
      !onNativeTextEdit ||
      !selection ||
      startingNativeTextEdit
    )
      return;
    setStartingNativeTextEdit(true);
    setNotice('Verifying selected source text…');
    try {
      const container = layerRef.current;
      const started = await onNativeTextEdit(
        container
          ? selectedNativeTextProof(
              container,
              selection,
              nativeTextProofMapRef.current,
            )
          : null,
      );
      if (started) {
        selection?.removeAllRanges();
        setNotice('Verified source text is ready to edit.');
      } else {
        setNotice('This selection cannot be safely edited as source text.');
      }
    } finally {
      setStartingNativeTextEdit(false);
    }
  }, [enabled, nativeTextEditing, onNativeTextEdit, startingNativeTextEdit]);

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
          disabled={startingNativeTextEdit}
          onPointerDown={(event) => event.preventDefault()}
          onClick={
            nativeTextEditing
              ? () => void beginNativeTextEdit()
              : applyHighlight
          }
        >
          {nativeTextEditing
            ? startingNativeTextEdit
              ? 'Checking source text…'
              : 'Edit selected source text'
            : 'Highlight selected text'}
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
