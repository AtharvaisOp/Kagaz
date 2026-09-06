import { FilePicker } from '../../components/FilePicker';
import { CloseIcon, MinusIcon, PlusIcon } from '../../components/icons';

import type { FileLoadIssue } from '../pdf-workspace/loading/types';
import type { WorkspaceLoadingState } from '../pdf-workspace/hooks/usePdfWorkspace';

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
  readonly onZoomIn: () => void;
  readonly onZoomOut: () => void;
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
  onZoomIn,
  onZoomOut,
}: ViewerToolbarProps) {
  return (
    <div className="viewer-toolbar" role="toolbar" aria-label="PDF controls">
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
          className="toolbar-button start-over-button"
          type="button"
          onClick={onStartOver}
        >
          <CloseIcon className="size-4" />
          Start over
        </button>
      </div>
    </div>
  );
}
