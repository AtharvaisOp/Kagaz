import type { OcrMetadata } from '@kagaz/shared-types';
import type { PdfExportController } from '../pdf-workspace/hooks/usePdfExport';
import { DownloadIcon } from '../../components/icons';
import { usePdfDerivative } from '../pdf-heavy-tools/usePdfDerivative';
import { PdfToolDialog } from '../pdf-heavy-tools/PdfToolDialog';
import { uploadOcr } from './ocrClient';

export function OcrDialog({
  prepareWorkspace,
  blockReason,
  onClose,
}: {
  readonly prepareWorkspace: PdfExportController['prepareWorkspace'];
  readonly blockReason: string | null;
  readonly onClose: () => void;
}) {
  const ocr = usePdfDerivative<'eng', OcrMetadata>(
    prepareWorkspace,
    uploadOcr,
    'searchable',
  );
  const state = ocr.state,
    busy = state.status === 'preparing' || state.status === 'processing';
  const close = () => {
    ocr.cancel();
    onClose();
  };
  return (
    <PdfToolDialog id="ocr" title="OCR PDF" onClose={close}>
      <div id="ocr-privacy" className="compression-privacy">
        <p>
          This uploads the current PDF temporarily to the Kagaz server for OCR.
        </p>
        <p>
          Your file is not permanently stored. Ordinary editing and export
          remain browser-local.
        </p>
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!blockReason) void ocr.start('eng');
        }}
      >
        <fieldset
          className="compression-presets"
          disabled={busy || state.status === 'success'}
        >
          <legend>Searchable PDF</legend>
          <label className="compression-preset">
            <input
              type="radio"
              name="ocr-language"
              value="eng"
              checked
              readOnly
            />
            <span>
              <strong>English OCR</strong>
              <span>
                Searchable text is added to scanned pages. Pages with existing
                text are skipped.
              </span>
            </span>
          </label>
        </fieldset>
        <p className="compression-copy">
          Up to 10 MiB and 20 pages. Recognition can be imperfect. Review the
          result before relying on its text.
        </p>
        {blockReason ? (
          <p className="extract-dialog-error" role="alert">
            {blockReason}
          </p>
        ) : null}
        <div aria-live="polite" aria-atomic="true" aria-busy={busy}>
          {busy ? (
            <p className="compression-progress" role="status">
              <span className="export-status-dot" aria-hidden="true" />
              {state.status === 'preparing'
                ? 'Preparing the current PDF in your browser…'
                : 'Uploading and processing English OCR on the server…'}
            </p>
          ) : null}
          {state.status === 'cancelled' ? (
            <p className="compression-copy">
              OCR cancelled. Your workspace is intact.
            </p>
          ) : null}
          {state.status === 'error' ? (
            <p className="extract-dialog-error" role="alert">
              {state.message}
            </p>
          ) : null}
          {state.status === 'success' ? (
            <div className="compression-result">
              <p>
                Searchable PDF ready. English OCR added text to{' '}
                {state.metadata.pagesOcred}{' '}
                {state.metadata.pagesOcred === 1 ? 'page' : 'pages'};{' '}
                {state.metadata.pagesSkipped} skipped.
              </p>
              <p>
                {(state.metadata.originalBytes / 1024).toFixed(1)} KiB input ·{' '}
                {(state.metadata.outputBytes / 1024).toFixed(1)} KiB output
              </p>
            </div>
          ) : null}
        </div>
        <p className="compression-copy">
          Creates a separate download. Your workspace stays unchanged.
        </p>
        <div className="extract-dialog-actions">
          <button
            type="button"
            className="text-button"
            onClick={busy ? ocr.cancel : close}
          >
            {busy ? 'Cancel OCR' : 'Close'}
          </button>
          {state.status === 'success' ? (
            <button
              type="button"
              className="primary-button"
              onClick={ocr.download}
            >
              <DownloadIcon className="size-4" />
              Download searchable PDF
            </button>
          ) : (
            <button
              type="submit"
              className="primary-button"
              disabled={busy || Boolean(blockReason)}
            >
              {busy
                ? 'Working…'
                : state.status === 'error' || state.status === 'cancelled'
                  ? 'Retry OCR'
                  : 'Start OCR'}
            </button>
          )}
        </div>
      </form>
    </PdfToolDialog>
  );
}
