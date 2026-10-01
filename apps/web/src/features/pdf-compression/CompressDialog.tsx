import { useState } from 'react';
import type { CompressionPreset } from '@kagaz/shared-types';
import type { PdfExportController } from '../pdf-workspace/hooks/usePdfExport';
import { DownloadIcon } from '../../components/icons';
import { usePdfCompression } from './usePdfCompression';
import { PdfToolDialog } from '../pdf-heavy-tools/PdfToolDialog';

const PRESETS: readonly {
  value: CompressionPreset;
  label: string;
  detail: string;
}[] = [
  {
    value: 'high-quality',
    label: 'High quality',
    detail: 'Sharper images · suitable for print',
  },
  {
    value: 'balanced',
    label: 'Balanced',
    detail: 'A smaller file with clear images',
  },
  {
    value: 'maximum',
    label: 'Maximum compression',
    detail: 'Stronger downsampling · lower image quality',
  },
];
function formatBytes(bytes: number): string {
  return bytes < 1024
    ? `${bytes} B`
    : bytes < 1024 * 1024
      ? `${(bytes / 1024).toFixed(1)} KiB`
      : `${(bytes / 1024 / 1024).toFixed(2)} MiB`;
}

export function CompressDialog({
  prepareWorkspace,
  blockReason,
  onClose,
}: {
  readonly prepareWorkspace: PdfExportController['prepareWorkspace'];
  readonly blockReason: string | null;
  readonly onClose: () => void;
}) {
  const [preset, setPreset] = useState<CompressionPreset>('balanced');
  const compression = usePdfCompression(prepareWorkspace);
  const busy =
    compression.state.status === 'preparing' ||
    compression.state.status === 'processing';
  const close = () => {
    compression.cancel();
    onClose();
  };
  const state = compression.state;
  return (
    <PdfToolDialog id="compress" title="Compress PDF" onClose={close}>
      <div id="compress-privacy" className="compression-privacy">
        <p>
          Compression temporarily uploads the current PDF to the Kagaz server
          for processing.
        </p>
        <p>
          It is not permanently stored. Temporary files are deleted after
          processing. Ordinary editing and export remain browser-local.
        </p>
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!blockReason) void compression.start(preset);
        }}
      >
        <fieldset
          className="compression-presets"
          disabled={busy || state.status === 'success'}
        >
          <legend>Compression level</legend>
          {PRESETS.map((option) => (
            <label className="compression-preset" key={option.value}>
              <input
                type="radio"
                name="compression-preset"
                value={option.value}
                checked={preset === option.value}
                onChange={() => setPreset(option.value)}
              />
              <span>
                <strong>{option.label}</strong>
                <span>{option.detail}</span>
              </span>
            </label>
          ))}
        </fieldset>
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
                : 'Uploading and compressing on the server…'}
            </p>
          ) : null}
          {state.status === 'cancelled' ? (
            <p className="compression-copy">
              Compression cancelled. Your workspace is intact.
            </p>
          ) : null}
          {state.status === 'error' ? (
            <p className="extract-dialog-error" role="alert">
              {state.message}
            </p>
          ) : null}
          {state.status === 'success' ? (
            <div className="compression-result">
              <dl>
                <div>
                  <dt>Before</dt>
                  <dd>{formatBytes(state.metadata.originalBytes)}</dd>
                </div>
                <div>
                  <dt>After</dt>
                  <dd>{formatBytes(state.metadata.compressedBytes)}</dd>
                </div>
              </dl>
              <p>
                {state.metadata.outcome === 'unchanged'
                  ? 'Already compact. Your exported PDF is returned without increasing its size.'
                  : `Saved ${formatBytes(state.metadata.savedBytes)} (${state.metadata.savedPercent.toFixed(1)}%)`}
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
            onClick={busy ? compression.cancel : close}
          >
            {busy ? 'Cancel compression' : 'Close'}
          </button>
          {state.status === 'success' ? (
            <button
              type="button"
              className="primary-button"
              onClick={compression.download}
            >
              <DownloadIcon className="size-4" />
              Download compressed PDF
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
                  ? 'Retry compression'
                  : 'Compress'}
            </button>
          )}
        </div>
      </form>
    </PdfToolDialog>
  );
}
