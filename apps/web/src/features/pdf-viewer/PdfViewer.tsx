import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

import { FileIssueList } from '../../components/FileIssueList';
import type { PdfAnnotationController } from '../pdf-annotations/hooks/usePdfAnnotations';
import { MemoizedPdfPage } from './PdfPage';
import { ViewerToolbar } from './ViewerToolbar';
import { AnnotationToolbar } from '../pdf-annotations/components/AnnotationToolbar';
import { AnnotationSummary } from '../pdf-annotations/components/AnnotationSummaryPanel';
import { ExtractPagesDialog } from './ExtractPagesDialog';
import { ThumbnailRail } from '../pdf-workspace/components/ThumbnailRail';
import { useWorkspaceNavigation } from '../pdf-workspace/hooks/useWorkspaceNavigation';
import { FormStatusNotice } from '../pdf-forms/components/FormStatusNotice';
import type { PdfFormsController } from '../pdf-forms/hooks/usePdfForms';
import type { PdfRedactionController } from '../pdf-redactions/hooks/usePdfRedactions';
import { RedactionSummary } from '../pdf-redactions/components/RedactionSummary';
import type { PdfWatermarkController } from '../pdf-watermarks/hooks/usePdfWatermarks';
import { WatermarkDialog } from '../pdf-watermarks/components/WatermarkDialog';
import {
  watermarkAppliesToPage,
  targetWatermarkPageIds,
} from '../pdf-watermarks/model/watermark';

import type { FileLoadIssue } from '../pdf-workspace/loading/types';
import type { WorkspaceLoadingState } from '../pdf-workspace/hooks/usePdfWorkspace';
import type {
  PdfExportState,
  PdfExportController,
} from '../pdf-workspace/hooks/usePdfExport';
import { CompressDialog } from '../pdf-compression/CompressDialog';
import { OcrDialog } from '../pdf-ocr/OcrDialog';
import type { SourceDocumentRegistry } from '../pdf-workspace/runtime/sourceDocumentRegistry';
import type {
  SourceDocumentId,
  SourceDocumentSummary,
  WorkspacePage,
  WorkspacePageId,
} from '../pdf-workspace/model/types';

interface PdfViewerProps {
  readonly pages: readonly WorkspacePage[];
  readonly sources: Readonly<Record<SourceDocumentId, SourceDocumentSummary>>;
  readonly sourceOrder: readonly SourceDocumentId[];
  readonly registry: SourceDocumentRegistry;
  readonly issues: readonly FileLoadIssue[];
  readonly loading: WorkspaceLoadingState;
  readonly zoom: number;
  readonly minZoom: number;
  readonly maxZoom: number;
  readonly onAddFiles: (
    files: readonly File[],
    issues: readonly FileLoadIssue[],
  ) => void;
  readonly onStartOver: () => void;
  readonly selectedPageId: WorkspacePageId | null;
  readonly onSelectPage: (pageId: WorkspacePageId) => void;
  readonly onMovePage: (pageId: WorkspacePageId, toIndex: number) => void;
  readonly onDeletePage: (pageId: WorkspacePageId) => void;
  readonly onRotatePage: (pageId: WorkspacePageId, delta?: number) => void;
  readonly onZoomIn: () => void;
  readonly onZoomOut: () => void;
  readonly exportState: PdfExportState;
  readonly onDownloadPdf: () => void;
  readonly onExtractPages: (pages: readonly WorkspacePage[]) => void;
  readonly exportBlocked: boolean;
  readonly exportBlockReason: string | null;
  readonly annotationController: PdfAnnotationController;
  readonly formController: PdfFormsController;
  readonly redactionController: PdfRedactionController;
  readonly watermarkController: PdfWatermarkController;
  readonly prepareWorkspace: PdfExportController['prepareWorkspace'];
}

function getSourceLabel(
  sources: Readonly<Record<SourceDocumentId, SourceDocumentSummary>>,
  sourceOrder: readonly SourceDocumentId[],
): string {
  const fileNames = sourceOrder
    .map((sourceId) => sources[sourceId])
    .filter(
      (source): source is SourceDocumentSummary => source?.status === 'ready',
    )
    .map((source) => source.fileName)
    .filter((fileName): fileName is string => Boolean(fileName));

  if (fileNames.length === 1) {
    return fileNames[0] ?? 'PDF workspace';
  }

  return `${fileNames.length || 1} PDFs`;
}

export function PdfViewer({
  pages,
  sources,
  sourceOrder,
  registry,
  issues,
  loading,
  zoom,
  minZoom,
  maxZoom,
  onAddFiles,
  onStartOver,
  selectedPageId,
  onSelectPage,
  onMovePage,
  onDeletePage,
  onRotatePage,
  onZoomIn,
  onZoomOut,
  exportState,
  onDownloadPdf,
  onExtractPages,
  exportBlocked,
  exportBlockReason,
  annotationController,
  formController,
  redactionController,
  watermarkController,
  prepareWorkspace,
}: PdfViewerProps) {
  const {
    active: redactionActive,
    setActive: setRedactionActive,
    select: selectRedaction,
  } = redactionController;
  useEffect(() => {
    if (annotationController.activeTool !== 'select' && redactionActive) {
      setRedactionActive(false);
      selectRedaction(null);
    }
  }, [
    annotationController.activeTool,
    redactionActive,
    selectRedaction,
    setRedactionActive,
  ]);
  const [mobilePageManagerOpen, setMobilePageManagerOpen] = useState(false);
  const watermarkTriggerRef = useRef<HTMLButtonElement>(null);
  const watermarkOpenerRef = useRef<HTMLElement | null>(null);
  const { cancel: cancelWatermark } = watermarkController;
  const [watermarkCurrentPageId, setWatermarkCurrentPageId] = useState<
    string | null
  >(null);
  const openWatermark = () => {
    watermarkOpenerRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setWatermarkCurrentPageId(selectedPageId);
    watermarkController.open();
  };
  const closeWatermark = useCallback(() => {
    cancelWatermark();
    window.requestAnimationFrame(() => {
      const opener = watermarkOpenerRef.current;
      (opener?.isConnected ? opener : watermarkTriggerRef.current)?.focus({
        preventScroll: true,
      });
    });
  }, [cancelWatermark]);
  const removeWatermark = () => {
    watermarkController.remove();
    window.requestAnimationFrame(() =>
      watermarkTriggerRef.current?.focus({ preventScroll: true }),
    );
  };
  const [extractOpen, setExtractOpen] = useState(false);
  const [compressOpen, setCompressOpen] = useState(false);
  const [ocrOpen, setOcrOpen] = useState(false);
  const ocrTriggerRef = useRef<HTMLButtonElement>(null);
  const closeOcr = useCallback(() => {
    setOcrOpen(false);
    window.requestAnimationFrame(() => ocrTriggerRef.current?.focus());
  }, []);
  const compressTriggerRef = useRef<HTMLButtonElement>(null);
  const closeCompress = useCallback(() => {
    setCompressOpen(false);
    window.requestAnimationFrame(() => compressTriggerRef.current?.focus());
  }, []);
  const [extractSession, setExtractSession] = useState(0);
  const extractTriggerRef = useRef<HTMLButtonElement>(null);
  const pagesTriggerRef = useRef<HTMLButtonElement>(null);
  const scrollBeforePageManagerRef = useRef(0);
  const openPageManager = () => {
    scrollBeforePageManagerRef.current = window.scrollY;
    setMobilePageManagerOpen(true);
  };

  const closePageManager = useCallback(() => {
    setMobilePageManagerOpen(false);
    if (mobilePageManagerOpen)
      window.requestAnimationFrame(() =>
        pagesTriggerRef.current?.focus({ preventScroll: true }),
      );
  }, [mobilePageManagerOpen]);

  useLayoutEffect(() => {
    if (!mobilePageManagerOpen) return;
    const scrollY = scrollBeforePageManagerRef.current;
    window.scrollTo({ top: scrollY, behavior: 'auto' });
    const frame = window.requestAnimationFrame(() => {
      window.scrollTo({ top: scrollY, behavior: 'auto' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [mobilePageManagerOpen]);

  const navigation = useWorkspaceNavigation({
    pages,
    selectedPageId,
    onSelectPage,
  });
  const sourceLabel = getSourceLabel(sources, sourceOrder);
  const readySourceCount = sourceOrder.filter(
    (sourceId) => sources[sourceId]?.status === 'ready',
  ).length;
  const openExtract = () => {
    setMobilePageManagerOpen(false);
    setExtractSession((current) => current + 1);
    setExtractOpen(true);
  };
  const closeExtract = useCallback(() => {
    setExtractOpen(false);
    window.requestAnimationFrame(() => extractTriggerRef.current?.focus());
  }, []);

  return (
    <section className="viewer" aria-label={`Viewing ${sourceLabel}`}>
      <ViewerToolbar
        sourceLabel={sourceLabel}
        sourceCount={readySourceCount}
        pageCount={pages.length}
        loading={loading}
        zoom={zoom}
        minZoom={minZoom}
        maxZoom={maxZoom}
        onAddFiles={onAddFiles}
        onStartOver={onStartOver}
        onOpenPages={openPageManager}
        mobilePageManagerOpen={mobilePageManagerOpen}
        onZoomIn={onZoomIn}
        onZoomOut={onZoomOut}
        exportState={exportState}
        onDownloadPdf={onDownloadPdf}
        exportBlocked={exportBlocked}
        exportBlockReason={exportBlockReason}
        onOpenExtract={openExtract}
        extractTriggerRef={extractTriggerRef}
        pagesTriggerRef={pagesTriggerRef}
        compressTriggerRef={compressTriggerRef}
        onOpenCompress={() => setCompressOpen(true)}
        ocrTriggerRef={ocrTriggerRef}
        onOpenOcr={() => setOcrOpen(true)}
      />
      {ocrOpen ? (
        <OcrDialog
          prepareWorkspace={prepareWorkspace}
          blockReason={
            exportBlocked
              ? 'Finish or cancel the active text edit before OCR.'
              : exportBlockReason
          }
          onClose={closeOcr}
        />
      ) : null}
      {compressOpen ? (
        <CompressDialog
          prepareWorkspace={prepareWorkspace}
          blockReason={
            exportBlocked
              ? 'Finish or cancel the active text edit before compressing.'
              : exportBlockReason
          }
          onClose={closeCompress}
        />
      ) : null}
      <AnnotationToolbar
        controller={annotationController}
        redactionController={redactionController}
        watermarkTriggerRef={watermarkTriggerRef}
        watermarkPresent={Boolean(watermarkController.state.present)}
        onOpenWatermark={openWatermark}
      />
      {watermarkController.draft ? (
        <WatermarkDialog
          controller={watermarkController}
          pages={pages}
          currentPageId={watermarkCurrentPageId}
          registry={registry}
          onClose={closeWatermark}
        />
      ) : null}
      {watermarkController.state.present ? (
        <div className="watermark-summary">
          <span>
            {watermarkController.state.present.kind === 'text'
              ? 'Text'
              : 'Image'}{' '}
            watermark ·{' '}
            {
              targetWatermarkPageIds(
                watermarkController.state.present.target,
                pages,
              ).length
            }{' '}
            pages
            {watermarkController.state.present.target.kind === 'all'
              ? ' · added pages included'
              : ''}
          </span>
          <button
            className="annotation-summary-action"
            type="button"
            onClick={openWatermark}
          >
            Edit watermark
          </button>
          <button
            className="annotation-summary-action annotation-summary-delete"
            type="button"
            onClick={removeWatermark}
          >
            Remove watermark
          </button>
        </div>
      ) : null}
      <span className="sr-only" role="status">
        {watermarkController.announcement}
      </span>
      <AnnotationSummary
        controller={annotationController}
        pageId={selectedPageId}
        onActivate={() => {
          redactionController.setActive(false);
          redactionController.select(null);
        }}
      />
      <RedactionSummary
        controller={redactionController}
        pageId={selectedPageId}
        pages={pages}
        onChoosePage={navigation.scrollToPage}
        onActivate={() => {
          if (annotationController.textEditSession)
            annotationController.cancelTextEdit(
              annotationController.textEditSession.sessionId,
            );
          annotationController.setActiveTool('select');
          annotationController.clearSelection();
          redactionController.setActive(true);
        }}
      />
      <ExtractPagesDialog
        key={extractSession}
        pageCount={pages.length}
        open={extractOpen}
        onClose={closeExtract}
        onExtract={(indexes) => {
          onExtractPages(
            indexes
              .map((index) => pages[index])
              .filter((page): page is WorkspacePage => Boolean(page)),
          );
        }}
        getExportBlockReason={(indexes) =>
          (() => {
            const selectedPages = indexes
              .map((index) => pages[index])
              .filter((page): page is WorkspacePage => Boolean(page));
            return (
              formController.getExportBlockReason(selectedPages) ??
              annotationController.getExportBlockReason(selectedPages)
            );
          })()
        }
      />
      <div className="form-status-notices" aria-label="Form status">
        {sourceOrder.map((sourceId) => {
          const definition = formController.sources.get(sourceId);
          const source = sources[sourceId];
          if (!definition || !source) return null;
          return (
            <FormStatusNotice
              key={sourceId}
              sourceName={source.fileName}
              definition={definition}
            />
          );
        })}
      </div>
      <div className="workspace-layout">
        <ThumbnailRail
          formController={formController}
          pages={pages}
          sources={sources}
          registry={registry}
          selectedPageId={selectedPageId}
          issues={issues}
          mobileOpen={mobilePageManagerOpen}
          onCloseMobile={closePageManager}
          onSelectPage={(pageId) => {
            navigation.scrollToPage(pageId);
            closePageManager();
          }}
          onMovePage={onMovePage}
          onDeletePage={onDeletePage}
          onRotatePage={onRotatePage}
          getAnnotationsForPage={annotationController.getAnnotationsForPage}
          assetRegistry={annotationController.assetRegistry}
        />
        <div className="viewer-column">
          <div className="page-stack">
            {pages.map((page, workspacePosition) => {
              const document = registry.getDocument(page.sourceDocumentId);

              if (!document) {
                return (
                  <article
                    key={page.id}
                    className="pdf-page-shell page-unavailable"
                    data-workspace-page-id={page.id}
                    ref={(element) => navigation.registerPage(page.id, element)}
                    aria-label={`Page ${workspacePosition + 1}`}
                  >
                    <div className="page-error" role="alert">
                      This source is no longer available.
                    </div>
                  </article>
                );
              }

              return (
                <MemoizedPdfPage
                  key={page.id}
                  page={page}
                  redactionActive={redactionController.active}
                  redactionRegions={redactionController.getRegionsForPage(
                    page.id,
                  )}
                  selectedRedactionId={redactionController.selectionId}
                  onAddRedaction={redactionController.add}
                  onReplaceRedaction={redactionController.replace}
                  onSelectRedaction={redactionController.select}
                  onRegisterRedactionBounds={
                    redactionController.registerPageBounds
                  }
                  document={document}
                  workspacePosition={workspacePosition}
                  zoom={zoom}
                  watermark={
                    watermarkAppliesToPage(watermarkController.preview, page.id)
                      ? watermarkController.preview
                      : null
                  }
                  watermarkAssetRegistry={watermarkController.assetRegistry}
                  annotations={annotationController.getAnnotationsForPage(
                    page.id,
                  )}
                  selectedAnnotationId={
                    annotationController.selection?.workspacePageId === page.id
                      ? annotationController.selection.annotationId
                      : null
                  }
                  onSelectAnnotation={annotationController.selectAnnotation}
                  onCommitAnnotation={annotationController.commitAnnotation}
                  onCreateAnnotation={annotationController.addAnnotation}
                  activeTool={annotationController.activeTool}
                  styleDefaults={annotationController.styleDefaults}
                  createAnnotationId={annotationController.createAnnotationId}
                  assetRegistry={annotationController.assetRegistry}
                  pendingImage={annotationController.pendingImage}
                  pendingSignature={annotationController.pendingSignature}
                  textEditSession={
                    annotationController.textEditSession?.workspacePageId ===
                    page.id
                      ? annotationController.textEditSession
                      : null
                  }
                  onBeginTextCreation={annotationController.beginTextCreation}
                  onEditText={annotationController.editTextAnnotation}
                  onUpdateText={annotationController.updateTextEditSession}
                  onCommitText={annotationController.commitTextEdit}
                  onCancelText={annotationController.cancelTextEdit}
                  onPlaceImage={annotationController.placePendingImage}
                  onPlaceSignature={annotationController.placePendingSignature}
                  onPlaceSignatureField={
                    annotationController.openSignatureCreatorForField
                  }
                  formWidgets={formController.getWidgetsForWorkspacePage(page)}
                  formFields={formController
                    .getWidgetsForWorkspacePage(page)
                    .map((widget) => formController.getField(widget.fieldId))
                    .filter((field): field is NonNullable<typeof field> =>
                      Boolean(field),
                    )}
                  formController={formController}
                  registerPage={navigation.registerPage}
                />
              );
            })}
          </div>
          {loading.status === 'loading' ? (
            <div className="viewer-loading" aria-live="polite">
              Loading {loading.currentIndex} of {loading.total} PDFs
              {loading.fileName ? ` · ${loading.fileName}` : ''}
            </div>
          ) : null}
          <FileIssueList issues={issues} />
        </div>
      </div>
    </section>
  );
}
