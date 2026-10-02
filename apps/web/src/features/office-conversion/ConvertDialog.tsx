import { useState } from 'react';
import type { ConversionMetadata } from '@kagaz/shared-types';
import { DownloadIcon } from '../../components/icons';
import { PdfToolDialog } from '../pdf-heavy-tools/PdfToolDialog';
import { useDerivative } from '../pdf-heavy-tools/usePdfDerivative';
import { supportedOfficeFormat, uploadConversion } from './conversionClient';

export function ConvertDialog({ onClose }: { readonly onClose: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const format = file ? supportedOfficeFormat(file.name) : null;
  const invalid =
    file && (!format || file.size === 0 || file.size > 10 * 1024 * 1024);
  const conversion = useDerivative<File, ConversionMetadata>(
    async (selected, signal, onProcessing) => {
      const response = await uploadConversion(selected, signal, onProcessing);
      return { ...response, fileName: 'kagaz-converted.pdf' };
    },
  );
  const state = conversion.state;
  const busy = state.status === 'preparing' || state.status === 'processing';
  const close = () => {
    conversion.cancel();
    onClose();
  };
  return (
    <PdfToolDialog id="convert" title="Convert to PDF" onClose={close}>
      <div id="convert-privacy" className="compression-privacy">
        <p>
          This uploads the selected document temporarily to the Kagaz server for
          conversion.
        </p>
        <p>
          Your file is kept only for this request and is not permanently stored.
          PDF editing and ordinary export remain browser-local.
        </p>
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (file && !invalid) void conversion.start(file);
        }}
      >
        <div className="conversion-file">
          <label htmlFor="convert-file">Office document</label>
          <input
            id="convert-file"
            type="file"
            accept=".docx,.pptx,.xlsx"
            disabled={busy || state.status === 'success'}
            aria-describedby="convert-file-hint"
            onChange={(event) => {
              conversion.reset();
              setFile(event.target.files?.[0] ?? null);
            }}
          />
          <p id="convert-file-hint" className="compression-copy">
            DOCX, PPTX or XLSX · up to 10 MiB. Macros, external links and
            embedded packages are unsupported.
          </p>
          {file ? (
            <p className="conversion-selected" role="status">
              <strong>{file.name}</strong>
              <span>
                {format
                  ? `Filename extension: ${format.toUpperCase()} (supported)`
                  : 'Unsupported format'}{' '}
                · {(file.size / 1024).toFixed(1)} KiB
              </span>
              {format ? (
                <span>
                  The actual Office package type and safety are checked on the
                  server only after you choose Convert.
                </span>
              ) : null}
            </p>
          ) : null}
          {invalid ? (
            <p className="extract-dialog-error" role="alert">
              Choose a non-empty DOCX, PPTX or XLSX file up to 10 MiB.
            </p>
          ) : null}
        </div>
        <div aria-live="polite" aria-atomic="true" aria-busy={busy}>
          {busy ? (
            <p className="compression-progress" role="status">
              <span className="export-status-dot" aria-hidden="true" />
              {state.status === 'preparing'
                ? 'Preparing the selected document…'
                : 'Uploading, checking and converting on the server…'}
            </p>
          ) : null}
          {state.status === 'cancelled' ? (
            <p className="compression-copy">
              Conversion cancelled. Your workspace is intact.
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
                PDF ready · {state.metadata.inputFormat.toUpperCase()} ·{' '}
                {state.metadata.pages}{' '}
                {state.metadata.pages === 1 ? 'page' : 'pages'}
              </p>
              <p>
                {(state.metadata.originalBytes / 1024).toFixed(1)} KiB input ·{' '}
                {(state.metadata.outputBytes / 1024).toFixed(1)} KiB output
              </p>
            </div>
          ) : null}
        </div>
        <p className="compression-copy">
          The result is a derivative PDF download. Your PDF workspace stays
          unchanged. Fonts and page layout may differ from Microsoft Office;
          spreadsheets use their saved print settings.
        </p>
        <div className="extract-dialog-actions">
          <button
            type="button"
            className="text-button"
            onClick={busy ? conversion.cancel : close}
          >
            {busy ? 'Cancel conversion' : 'Close'}
          </button>
          {state.status === 'success' ? (
            <button
              type="button"
              className="primary-button"
              onClick={conversion.download}
            >
              <DownloadIcon className="size-4" />
              Download PDF
            </button>
          ) : (
            <button
              type="submit"
              className="primary-button"
              disabled={busy || !file || Boolean(invalid)}
            >
              {busy
                ? 'Working…'
                : state.status === 'error' || state.status === 'cancelled'
                  ? 'Retry conversion'
                  : 'Convert'}
            </button>
          )}
        </div>
      </form>
    </PdfToolDialog>
  );
}
