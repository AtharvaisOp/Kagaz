import { memo, useEffect, useRef, useState } from 'react';

import { useNearViewport } from '../../hooks/useNearViewport';
import { AnnotationOverlay } from '../pdf-annotations/rendering/AnnotationOverlay';
import type {
  AnnotationStyleDefaults,
  AnnotationTool,
} from '../pdf-annotations/model/editorTypes';
import type {
  AnnotationId,
  PdfAnnotation,
} from '../pdf-annotations/model/types';
import type { TextAnnotation } from '../pdf-annotations/model/types';
import type { TextEditSession } from '../pdf-annotations/model/textEditSession';
import type { AnnotationAssetRegistry } from '../pdf-annotations/runtime/annotationAssetRegistry';
import type {
  PdfAnnotationController,
  PendingImagePlacement,
  PendingSignaturePlacement,
} from '../pdf-annotations/hooks/usePdfAnnotations';
import { normalizeRotation } from '../pdf-workspace/model/operations';
import { adoptResolvedPdfPage } from '../pdf-workspace/runtime/pdfPageLifecycle';
import { FormWidgetLayer } from '../pdf-forms/rendering/FormWidgetLayer';
import type {
  FormFieldDefinition,
  FormWidgetDefinition,
} from '../pdf-forms/model/types';
import type { PdfFormsController } from '../pdf-forms/hooks/usePdfForms';

import type {
  WorkspacePage,
  WorkspacePageId,
} from '../pdf-workspace/model/types';
import type {
  PageViewport,
  PDFDocumentProxy,
  PDFPageProxy,
  RenderTask,
} from 'pdfjs-dist';

interface PdfPageProps {
  readonly page: WorkspacePage;
  readonly document: PDFDocumentProxy;
  readonly workspacePosition: number;
  readonly zoom: number;
  readonly annotations: readonly PdfAnnotation[];
  readonly selectedAnnotationId: AnnotationId | null;
  readonly onSelectAnnotation: (
    pageId: WorkspacePageId,
    annotationId: AnnotationId | null,
  ) => void;
  readonly onCommitAnnotation: (annotation: PdfAnnotation) => void;
  readonly onCreateAnnotation: (annotation: PdfAnnotation) => void;
  readonly activeTool: AnnotationTool;
  readonly styleDefaults: AnnotationStyleDefaults;
  readonly createAnnotationId: () => string;
  readonly assetRegistry: AnnotationAssetRegistry;
  readonly pendingImage: PendingImagePlacement | null;
  readonly pendingSignature: PendingSignaturePlacement | null;
  readonly textEditSession: TextEditSession | null;
  readonly onBeginTextCreation: PdfAnnotationController['beginTextCreation'];
  readonly onEditText: (annotation: TextAnnotation) => void;
  readonly onUpdateText: PdfAnnotationController['updateTextEditSession'];
  readonly onCommitText: PdfAnnotationController['commitTextEdit'];
  readonly onCancelText: PdfAnnotationController['cancelTextEdit'];
  readonly onPlaceImage: PdfAnnotationController['placePendingImage'];
  readonly onPlaceSignature: PdfAnnotationController['placePendingSignature'];
  readonly formFields: readonly FormFieldDefinition[];
  readonly formWidgets: readonly FormWidgetDefinition[];
  readonly formController: PdfFormsController;
  readonly registerPage?: (
    pageId: WorkspacePageId,
    element: HTMLDivElement | null,
  ) => void;
}

type PageStatus = 'waiting' | 'loading' | 'ready' | 'error';

interface RenderedViewportState {
  readonly viewport: PageViewport;
  readonly signature: string;
  readonly requestSignature: string;
  readonly document: PDFDocumentProxy;
}

// PDF.js 6.3.289 documents AnnotationMode.ENABLE_FORMS as value 2. Keeping
// this small runtime constant avoids statically importing the lazy PDF.js
// runtime just for an enum value.
const PDFJS_ENABLE_FORMS_ANNOTATION_MODE = 2;

export function PdfPage({
  page,
  document,
  workspacePosition,
  zoom,
  annotations,
  selectedAnnotationId,
  onSelectAnnotation,
  onCommitAnnotation,
  onCreateAnnotation,
  activeTool,
  styleDefaults,
  createAnnotationId,
  assetRegistry,
  pendingImage,
  pendingSignature,
  textEditSession,
  onBeginTextCreation,
  onEditText,
  onUpdateText,
  onCommitText,
  onCancelText,
  onPlaceImage,
  onPlaceSignature,
  formFields,
  formWidgets,
  formController,
  registerPage,
}: PdfPageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { elementRef, isNearViewport } = useNearViewport();
  const [status, setStatus] = useState<PageStatus>('waiting');
  const [renderedViewport, setRenderedViewport] =
    useState<RenderedViewportState | null>(null);
  const [baseDimensions, setBaseDimensions] = useState({
    width: 612,
    height: 792,
  });
  const displayDimensions = {
    width: baseDimensions.width * (zoom / 100),
    height: baseDimensions.height * (zoom / 100),
  };
  const viewportRequestSignature = [
    page.id,
    page.sourcePageIndex,
    page.rotationDelta,
    zoom,
  ].join(':');

  const setPageRef = (element: HTMLDivElement | null) => {
    elementRef.current = element;
    registerPage?.(page.id, element);
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
    setRenderedViewport(null);

    void document
      .getPage(page.sourcePageIndex + 1)
      .then((nextPage) => {
        const ownedPage = adoptResolvedPdfPage(nextPage, active);
        if (!ownedPage) {
          return;
        }

        loadedPage = ownedPage;
        const totalRotation = normalizeRotation(
          ownedPage.rotate + page.rotationDelta,
        );
        const baseViewport = ownedPage.getViewport({
          scale: 1,
          rotation: totalRotation,
        });
        const viewport = ownedPage.getViewport({
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

        renderTask = ownedPage.render({
          canvas,
          canvasContext: context,
          annotationMode: PDFJS_ENABLE_FORMS_ANNOTATION_MODE,
          transform:
            pixelRatio === 1 ? undefined : [pixelRatio, 0, 0, pixelRatio, 0, 0],
          viewport,
        });

        return renderTask.promise.then(() => ({ viewport }));
      })
      .then((result) => {
        if (active && result) {
          const { viewport } = result;
          setRenderedViewport({
            viewport,
            signature: [
              viewportRequestSignature,
              viewport.width,
              viewport.height,
              viewport.rotation,
            ].join(':'),
            requestSignature: viewportRequestSignature,
            document,
          });
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
          setRenderedViewport(null);
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
  }, [
    document,
    isNearViewport,
    page.id,
    page.rotationDelta,
    page.sourcePageIndex,
    viewportRequestSignature,
    zoom,
  ]);

  const workspacePageNumber = workspacePosition + 1;
  const surfaceWidth =
    renderedViewport?.viewport.width ?? displayDimensions.width;
  const surfaceHeight =
    renderedViewport?.viewport.height ?? displayDimensions.height;
  const hasRenderedViewport =
    isNearViewport &&
    renderedViewport !== null &&
    status === 'ready' &&
    renderedViewport.requestSignature === viewportRequestSignature &&
    renderedViewport.document === document;

  return (
    <article
      ref={setPageRef}
      className="pdf-page-shell"
      data-workspace-page-id={page.id}
      aria-label={`Page ${workspacePageNumber}`}
      style={{
        width: surfaceWidth + 2,
        minHeight: surfaceHeight + 2,
      }}
    >
      <div className="page-index" aria-hidden="true">
        {String(workspacePageNumber).padStart(2, '0')}
      </div>
      <div
        className="pdf-page-surface"
        style={{ width: surfaceWidth, height: surfaceHeight }}
        data-viewport-signature={renderedViewport?.signature}
      >
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
        {hasRenderedViewport && renderedViewport ? (
          formWidgets.length > 0 ? (
            <FormWidgetLayer
              viewport={renderedViewport.viewport}
              fields={formFields}
              widgets={formWidgets}
              getValue={formController.getValue}
              textEditSession={formController.textEditSession}
              onBeginTextEdit={formController.beginTextEdit}
              onUpdateTextDraft={formController.updateTextDraft}
              onCommitTextEdit={formController.commitTextEdit}
              onCancelTextEdit={formController.cancelTextEdit}
              onSetCheckbox={formController.setCheckbox}
              onSelectRadio={formController.selectRadio}
              onSelectChoice={formController.selectChoice}
              annotationTool={activeTool}
            />
          ) : null
        ) : null}
        {hasRenderedViewport && renderedViewport ? (
          <AnnotationOverlay
            key={renderedViewport.signature}
            workspacePageId={page.id}
            viewport={renderedViewport.viewport}
            viewportSignature={renderedViewport.signature}
            annotations={annotations}
            selectedAnnotationId={selectedAnnotationId}
            onSelectAnnotation={onSelectAnnotation}
            onCommitAnnotation={onCommitAnnotation}
            onCreateAnnotation={onCreateAnnotation}
            activeTool={activeTool}
            styleDefaults={styleDefaults}
            createAnnotationId={createAnnotationId}
            assetRegistry={assetRegistry}
            pendingImage={pendingImage}
            pendingSignature={pendingSignature}
            textEditSession={textEditSession}
            onBeginTextCreation={onBeginTextCreation}
            onEditText={onEditText}
            onUpdateText={(sessionId, text) =>
              onUpdateText(sessionId, { text })
            }
            onCommitText={onCommitText}
            onCancelText={onCancelText}
            onPlaceImage={onPlaceImage}
            onPlaceSignature={onPlaceSignature}
          />
        ) : null}
      </div>
    </article>
  );
}

export const MemoizedPdfPage = memo(PdfPage);
