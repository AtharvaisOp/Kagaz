import { FileIssueList } from '../../components/FileIssueList';
import { PdfPage } from './PdfPage';
import { ViewerToolbar } from './ViewerToolbar';

import type { FileLoadIssue } from '../pdf-workspace/loading/types';
import type { WorkspaceLoadingState } from '../pdf-workspace/hooks/usePdfWorkspace';
import type { SourceDocumentRegistry } from '../pdf-workspace/runtime/sourceDocumentRegistry';
import type {
  SourceDocumentId,
  SourceDocumentSummary,
  WorkspacePage,
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
  readonly onZoomIn: () => void;
  readonly onZoomOut: () => void;
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
  onZoomIn,
  onZoomOut,
}: PdfViewerProps) {
  const sourceLabel = getSourceLabel(sources, sourceOrder);
  const readySourceCount = sourceOrder.filter(
    (sourceId) => sources[sourceId]?.status === 'ready',
  ).length;

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
        onZoomIn={onZoomIn}
        onZoomOut={onZoomOut}
      />
      <div className="page-stack">
        {pages.map((page, workspacePosition) => {
          const document = registry.getDocument(page.sourceDocumentId);

          if (!document) {
            return (
              <article
                key={page.id}
                className="pdf-page-shell page-unavailable"
                data-workspace-page-id={page.id}
                aria-label={`Page ${workspacePosition + 1}`}
              >
                <div className="page-error" role="alert">
                  This source is no longer available.
                </div>
              </article>
            );
          }

          return (
            <PdfPage
              key={page.id}
              page={page}
              document={document}
              workspacePosition={workspacePosition}
              zoom={zoom}
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
    </section>
  );
}
