import { PdfPage } from './PdfPage';
import { ViewerToolbar } from './ViewerToolbar';

import type { PDFDocumentProxy } from 'pdfjs-dist';

interface PdfViewerProps {
  document: PDFDocumentProxy;
  fileError: string | null;
  fileName: string;
  zoom: number;
  minZoom: number;
  maxZoom: number;
  onClose: () => void;
  onFileError: (message: string | null) => void;
  onReplace: (file: File) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
}

export function PdfViewer({
  document,
  fileError,
  fileName,
  zoom,
  minZoom,
  maxZoom,
  onClose,
  onFileError,
  onReplace,
  onZoomIn,
  onZoomOut,
}: PdfViewerProps) {
  const pages = Array.from(
    { length: document.numPages },
    (_, index) => index + 1,
  );

  return (
    <section className="viewer" aria-label={`Viewing ${fileName}`}>
      <ViewerToolbar
        fileName={fileName}
        pageCount={document.numPages}
        zoom={zoom}
        minZoom={minZoom}
        maxZoom={maxZoom}
        onClose={onClose}
        onFileError={onFileError}
        onReplace={onReplace}
        onZoomIn={onZoomIn}
        onZoomOut={onZoomOut}
      />
      <div className="page-stack">
        {pages.map((pageNumber) => (
          <PdfPage
            key={`${document.fingerprints[0] ?? fileName}-${pageNumber}`}
            document={document}
            pageNumber={pageNumber}
            zoom={zoom}
          />
        ))}
      </div>
      {fileError ? (
        <div className="viewer-alert" role="alert">
          {fileError}
        </div>
      ) : null}
    </section>
  );
}
