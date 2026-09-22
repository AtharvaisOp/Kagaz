import { useState } from 'react';

import { AppHeader } from './components/AppHeader';
import { FilePicker } from './components/FilePicker';
import { LoadingState } from './components/LoadingState';
import { PdfViewer } from './features/pdf-viewer/PdfViewer';
import { usePdfAnnotations } from './features/pdf-annotations/hooks/usePdfAnnotations';
import { usePdfWorkspace } from './features/pdf-workspace/hooks/usePdfWorkspace';
import { usePdfExport } from './features/pdf-workspace/hooks/usePdfExport';
import { usePdfForms } from './features/pdf-forms/hooks/usePdfForms';
import { useEditorHistory } from './features/editor-history/useEditorHistory';

import type { FileLoadIssue } from './features/pdf-workspace/loading/types';

const MIN_ZOOM = 50;
const MAX_ZOOM = 200;
const ZOOM_STEP = 10;

export function App() {
  const [zoom, setZoom] = useState(100);
  const {
    workspace,
    registry,
    loading,
    issues,
    openInitialFiles,
    addFiles,
    startOver,
    selectPage,
    movePage,
    deletePage,
    rotatePage,
  } = usePdfWorkspace();
  const editorHistory = useEditorHistory();
  const annotationController = usePdfAnnotations(
    workspace.pages,
    editorHistory.annotation,
  );
  const formController = usePdfForms(workspace, registry, editorHistory.form);
  editorHistory.bind({
    annotation: annotationController.historyParticipant,
    form: formController.historyParticipant,
  });
  const pdfExport = usePdfExport(
    workspace,
    registry,
    annotationController.state,
    annotationController.assetRegistry,
    formController.getExportBlockReason,
    formController.snapshotForExport,
  );

  const handleInitialSelection = (
    files: readonly File[],
    selectionIssues: readonly FileLoadIssue[],
  ) => {
    setZoom(100);
    openInitialFiles(files, selectionIssues);
  };

  const handleAddSelection = (
    files: readonly File[],
    selectionIssues: readonly FileLoadIssue[],
  ) => {
    addFiles(files, selectionIssues);
  };

  const handleStartOver = () => {
    if (
      startOver(
        annotationController.hasUnsavedWork || formController.hasUnsavedWork,
        () => {
          pdfExport.cancel();
          annotationController.resetAnnotations();
          formController.resetForms();
          editorHistory.reset();
        },
      )
    ) {
      setZoom(100);
    }
  };

  const handleDeletePage = (pageId: string) => {
    deletePage(pageId);
  };

  return (
    <main className="app-shell">
      <AppHeader />
      {workspace.sessionStatus === 'empty' && loading.status === 'idle' ? (
        <section className="upload-layout">
          <div className="ambient-grid" aria-hidden="true" />
          <div className="intro-copy">
            <p className="eyebrow">A clearer way through PDFs</p>
            <h1>Your documents. Your browser. Nothing in between.</h1>
            <p>
              Kagaz opens PDFs locally, keeping the first step of your workflow
              private and immediate.
            </p>
          </div>
          <FilePicker onSelect={handleInitialSelection} issues={issues} />
        </section>
      ) : null}
      {workspace.sessionStatus === 'empty' && loading.status === 'loading' ? (
        <LoadingState progress={loading} onStartOver={handleStartOver} />
      ) : null}
      {workspace.sessionStatus === 'active' ? (
        <PdfViewer
          pages={workspace.pages}
          sources={workspace.sources}
          sourceOrder={workspace.sourceOrder}
          registry={registry}
          issues={issues}
          loading={loading}
          zoom={zoom}
          minZoom={MIN_ZOOM}
          maxZoom={MAX_ZOOM}
          onAddFiles={handleAddSelection}
          onStartOver={handleStartOver}
          selectedPageId={workspace.selectedPageId}
          onSelectPage={selectPage}
          onMovePage={movePage}
          onDeletePage={handleDeletePage}
          onRotatePage={rotatePage}
          onZoomIn={() =>
            setZoom((current) => Math.min(MAX_ZOOM, current + ZOOM_STEP))
          }
          onZoomOut={() =>
            setZoom((current) => Math.max(MIN_ZOOM, current - ZOOM_STEP))
          }
          exportState={pdfExport.state}
          onDownloadPdf={pdfExport.downloadWorkspace}
          onExtractPages={pdfExport.extractPages}
          exportBlocked={annotationController.textEditSession !== null}
          exportBlockReason={formController.getExportBlockReason(
            workspace.pages,
          )}
          annotationController={annotationController}
          formController={formController}
        />
      ) : null}
    </main>
  );
}
