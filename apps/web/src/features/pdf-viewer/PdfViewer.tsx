import { useCallback, useLayoutEffect, useRef, useState } from 'react';

import { FileIssueList } from '../../components/FileIssueList';
import type { PdfAnnotationController } from '../pdf-annotations/hooks/usePdfAnnotations';
import { MemoizedPdfPage } from './PdfPage';
import { ViewerToolbar } from './ViewerToolbar';
import { AnnotationToolbar } from '../pdf-annotations/components/AnnotationToolbar';
import { AnnotationSummary } from '../pdf-annotations/components/AnnotationSummaryPanel';
import { ExtractPagesDialog } from './ExtractPagesDialog';
import { ThumbnailRail } from '../pdf-workspace/components/ThumbnailRail';
import { useWorkspaceNavigation } from '../pdf-workspace/hooks/useWorkspaceNavigation';

import type { FileLoadIssue } from '../pdf-workspace/loading/types';
import type { WorkspaceLoadingState } from '../pdf-workspace/hooks/usePdfWorkspace';
import type { PdfExportState } from '../pdf-workspace/hooks/usePdfExport';
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
  readonly annotationController: PdfAnnotationController;
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
  annotationController,
}: PdfViewerProps) {
  const [mobilePageManagerOpen, setMobilePageManagerOpen] = useState(false);
  const [extractOpen, setExtractOpen] = useState(false);
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
    window.requestAnimationFrame(() => pagesTriggerRef.current?.focus());
  }, []);

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
        onOpenExtract={openExtract}
        extractTriggerRef={extractTriggerRef}
        pagesTriggerRef={pagesTriggerRef}
      />
      <AnnotationToolbar controller={annotationController} />
      <AnnotationSummary
        controller={annotationController}
        pageId={selectedPageId}
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
      />
      <div className="workspace-layout">
        <ThumbnailRail
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
                  document={document}
                  workspacePosition={workspacePosition}
                  zoom={zoom}
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
