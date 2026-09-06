import { useState } from 'react';

import { AppHeader } from './components/AppHeader';
import { ErrorState } from './components/ErrorState';
import { FilePicker } from './components/FilePicker';
import { LoadingState } from './components/LoadingState';
import { PdfViewer } from './features/pdf-viewer/PdfViewer';
import { usePdfDocument } from './hooks/usePdfDocument';

const MIN_ZOOM = 50;
const MAX_ZOOM = 200;
const ZOOM_STEP = 10;

export function App() {
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(100);
  const pdfState = usePdfDocument(file);

  const selectFile = (nextFile: File) => {
    setFile(nextFile);
    setZoom(100);
    setFileError(null);
  };

  const clearFile = () => {
    setFile(null);
    setZoom(100);
    setFileError(null);
  };

  return (
    <main className="app-shell">
      <AppHeader />
      {pdfState.status === 'idle' ? (
        <section className="upload-layout">
          <div className="ambient-grid" aria-hidden="true" />
          <div className="intro-copy">
            <p className="eyebrow">A clearer way through PDFs</p>
            <h1>Your document. Your browser. Nothing in between.</h1>
            <p>
              Kagaz opens PDFs locally, keeping the first step of your workflow
              private and immediate.
            </p>
          </div>
          <FilePicker
            error={fileError}
            onError={setFileError}
            onSelect={selectFile}
          />
        </section>
      ) : null}
      {pdfState.status === 'loading' ? (
        <LoadingState fileName={pdfState.fileName} />
      ) : null}
      {pdfState.status === 'error' ? (
        <ErrorState
          fileError={fileError}
          fileName={pdfState.fileName}
          message={pdfState.message}
          onClear={clearFile}
          onFileError={setFileError}
          onReplace={selectFile}
        />
      ) : null}
      {pdfState.status === 'ready' ? (
        <PdfViewer
          document={pdfState.document}
          fileError={fileError}
          fileName={pdfState.fileName}
          zoom={zoom}
          minZoom={MIN_ZOOM}
          maxZoom={MAX_ZOOM}
          onClose={clearFile}
          onFileError={setFileError}
          onReplace={selectFile}
          onZoomIn={() =>
            setZoom((current) => Math.min(MAX_ZOOM, current + ZOOM_STEP))
          }
          onZoomOut={() =>
            setZoom((current) => Math.max(MIN_ZOOM, current - ZOOM_STEP))
          }
        />
      ) : null}
    </main>
  );
}
