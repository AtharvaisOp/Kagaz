import type { WorkspaceLoadingState } from '../features/pdf-workspace/hooks/usePdfWorkspace';

export function LoadingState({
  progress,
  onStartOver,
}: {
  readonly progress: WorkspaceLoadingState;
  readonly onStartOver: () => void;
}) {
  const percent = progress.total
    ? Math.round((progress.currentIndex / progress.total) * 100)
    : 0;

  return (
    <section className="status-state" aria-live="polite" aria-busy="true">
      <div className="loader" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <p className="status-kicker">Opening PDFs locally</p>
      <h2>{progress.fileName ?? 'Preparing your workspace'}</h2>
      <p>
        Loading {progress.currentIndex} of {progress.total} PDFs. Your files
        stay in this browser.
      </p>
      <progress
        className="loading-progress"
        value={percent}
        max={100}
        aria-label={`Loading PDF ${progress.currentIndex} of ${progress.total}`}
      />
      <div className="loading-actions">
        <button className="text-button" type="button" onClick={onStartOver}>
          Start over
        </button>
      </div>
    </section>
  );
}
