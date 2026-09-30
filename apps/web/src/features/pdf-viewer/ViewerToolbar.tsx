import { FilePicker } from '../../components/FilePicker';
import {
  CloseIcon,
  DownloadIcon,
  FileIcon,
  MinusIcon,
  PagesIcon,
  PlusIcon,
} from '../../components/icons';

import type { FileLoadIssue } from '../pdf-workspace/loading/types';
import type { WorkspaceLoadingState } from '../pdf-workspace/hooks/usePdfWorkspace';
import type { PdfExportState } from '../pdf-workspace/hooks/usePdfExport';
import type { RefObject } from 'react';

interface ViewerToolbarProps {
  readonly sourceLabel: string;
  readonly sourceCount: number;
  readonly pageCount: number;
  readonly loading: WorkspaceLoadingState;
  readonly zoom: number;
  readonly minZoom: number;
  readonly maxZoom: number;
  readonly onAddFiles: (
    files: readonly File[],
    issues: readonly FileLoadIssue[],
  ) => void;
  readonly onStartOver: () => void;
  readonly onOpenPages: () => void;
  readonly mobilePageManagerOpen: boolean;
  readonly onZoomIn: () => void;
  readonly onZoomOut: () => void;
  readonly exportState: PdfExportState;
  readonly onDownloadPdf: () => void;
  readonly exportBlocked: boolean;
  readonly exportBlockReason: string | null;
  readonly onOpenExtract: () => void;
  readonly extractTriggerRef: RefObject<HTMLButtonElement | null>;
  readonly pagesTriggerRef: RefObject<HTMLButtonElement | null>;
}

export function ViewerToolbar({
  sourceLabel,
  sourceCount,
  pageCount,
  loading,
  zoom,
  minZoom,
  maxZoom,
  onAddFiles,
  onStartOver,
  onOpenPages,
  mobilePageManagerOpen,
  onZoomIn,
  onZoomOut,
  exportState,
  onDownloadPdf,
  exportBlocked,
  exportBlockReason,
  onOpenExtract,
  extractTriggerRef,
  pagesTriggerRef,
}: ViewerToolbarProps) {
  const exporting = exportState.status === 'exporting';
  const exportStatus = exportState.progress
    ? exportState.progress.phase === 'loading'
      ? `Loading ${exportState.progress.current} of ${exportState.progress.total} source PDFs · ${exportState.progress.fileName}`
      : exportState.progress.phase === 'building'
        ? `Building page ${exportState.progress.current} of ${exportState.progress.total}`
        : exportState.progress.phase === 'saving'
          ? 'Saving PDF…'
          : 'Preparing PDF…'
    : null;
  const downloadBlocked = Boolean(exportBlockReason);

  return (
    <div
      className="viewer-toolbar"
      role="toolbar"
      aria-label="PDF controls"
      aria-busy={exporting}
    >
      <div className="document-meta">
        <span className="document-name" title={sourceLabel}>
          {sourceLabel}
        </span>
        <span className="document-pages">
          {sourceCount} {sourceCount === 1 ? 'PDF' : 'PDFs'} · {pageCount}{' '}
          {pageCount === 1 ? 'page' : 'pages'}
        </span>
      </div>
      <div className="toolbar-actions">
        <div className="zoom-control" aria-label="Zoom controls">
          <button
            type="button"
            aria-label="Zoom out"
            disabled={zoom <= minZoom}
            onClick={onZoomOut}
          >
            <MinusIcon className="size-4" />
          </button>
          <output aria-live="polite" aria-label="Current zoom">
            {zoom}%
          </output>
          <button
            type="button"
            aria-label="Zoom in"
            disabled={zoom >= maxZoom}
            onClick={onZoomIn}
          >
            <PlusIcon className="size-4" />
          </button>
        </div>
        <FilePicker
          compact
          disabled={loading.status === 'loading'}
          onSelect={onAddFiles}
        />
        <button
          ref={extractTriggerRef}
          className="toolbar-button extract-button"
          type="button"
          disabled={exporting || exportBlocked}
          onClick={onOpenExtract}
        >
          <FileIcon className="size-4" />
          Extract pages
        </button>
        <button
          className="toolbar-button download-button"
          type="button"
          disabled={
            exporting || exportBlocked || downloadBlocked || pageCount === 0
          }
          aria-describedby={
            exportBlockReason ? 'export-block-reason' : undefined
          }
          title={exportBlockReason ?? undefined}
          aria-label={exporting ? 'Creating PDF' : 'Download PDF'}
          onClick={onDownloadPdf}
        >
          <DownloadIcon className="size-4" />
          {exporting ? 'Creating…' : 'Download PDF'}
        </button>
        <button
          ref={pagesTriggerRef}
          className="toolbar-button pages-toggle-button"
          type="button"
          aria-controls="thumbnail-rail"
          aria-expanded={mobilePageManagerOpen}
          onClick={onOpenPages}
        >
          <PagesIcon className="size-4" />
          Pages
        </button>
        <button
          className="toolbar-button start-over-button"
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={onStartOver}
        >
          <CloseIcon className="size-4" />
          Start over
        </button>
      </div>
      {exportStatus ? (
        <div className="export-status" role="status" aria-live="polite">
          <span className="export-status-dot" aria-hidden="true" />
          {exportStatus}
        </div>
      ) : null}
      {exportBlockReason ? (
        <div
          id="export-block-reason"
          className="export-safety-notice"
          role="status"
          aria-live="polite"
        >
          Download blocked: {exportBlockReason}
        </div>
      ) : null}
      {exportState.status === 'error' && exportState.error ? (
        <div className="export-error" role="alert">
          {exportState.error}
        </div>
      ) : null}
    </div>
  );
}
