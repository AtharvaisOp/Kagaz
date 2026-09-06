import { FilePicker } from './FilePicker';

interface ErrorStateProps {
  fileError: string | null;
  fileName: string;
  message: string;
  onClear: () => void;
  onFileError: (message: string | null) => void;
  onReplace: (file: File) => void;
}

export function ErrorState({
  fileError,
  fileName,
  message,
  onClear,
  onFileError,
  onReplace,
}: ErrorStateProps) {
  return (
    <section className="status-state error-state" role="alert">
      <span className="error-mark" aria-hidden="true">
        !
      </span>
      <p className="status-kicker">Document unavailable</p>
      <h2>{fileName}</h2>
      <p>{fileError ?? message}</p>
      <div className="status-actions">
        <FilePicker compact onError={onFileError} onSelect={onReplace} />
        <button className="text-button" type="button" onClick={onClear}>
          Return home
        </button>
      </div>
    </section>
  );
}
