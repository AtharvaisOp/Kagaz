import { CloseIcon, MinusIcon, PlusIcon } from '../../components/icons';
import { FilePicker } from '../../components/FilePicker';

interface ViewerToolbarProps {
  fileName: string;
  pageCount: number;
  zoom: number;
  minZoom: number;
  maxZoom: number;
  onClose: () => void;
  onFileError: (message: string | null) => void;
  onReplace: (file: File) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
}

export function ViewerToolbar({
  fileName,
  pageCount,
  zoom,
  minZoom,
  maxZoom,
  onClose,
  onFileError,
  onReplace,
  onZoomIn,
  onZoomOut,
}: ViewerToolbarProps) {
  return (
    <div className="viewer-toolbar" role="toolbar" aria-label="PDF controls">
      <div className="document-meta">
        <span className="document-name" title={fileName}>
          {fileName}
        </span>
        <span className="document-pages">
          {pageCount} {pageCount === 1 ? 'page' : 'pages'}
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
        <FilePicker compact onError={onFileError} onSelect={onReplace} />
        <button
          className="icon-button"
          type="button"
          aria-label="Close PDF"
          onClick={onClose}
        >
          <CloseIcon className="size-4" />
        </button>
      </div>
    </div>
  );
}
