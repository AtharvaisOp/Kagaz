import { useEffect, useRef, useState } from 'react';

import { CloseIcon, FileIcon } from '../../components/icons';
import {
  parsePageRange,
  type PageRangeError,
} from '../pdf-workspace/model/rangeParser';

const RANGE_ERROR_MESSAGES: Record<PageRangeError, string> = {
  empty: 'Enter at least one page number.',
  'invalid-token': 'Use page numbers and ranges such as 1-3, 5.',
  'invalid-page': 'Page numbers must be positive whole numbers.',
  'out-of-bounds': 'One or more pages are outside the current workspace.',
  'descending-range':
    'Ranges must go from the smaller page to the larger page.',
  'invalid-page-count': 'There are no pages available to extract.',
};

interface ExtractPagesDialogProps {
  readonly pageCount: number;
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onExtract: (indexes: readonly number[]) => void;
  readonly getExportBlockReason?: (indexes: readonly number[]) => string | null;
}

export function ExtractPagesDialog({
  pageCount,
  open,
  onClose,
  onExtract,
  getExportBlockReason,
}: ExtractPagesDialogProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const [expression, setExpression] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus());
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key !== 'Tab') return;

      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), [href], select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      } else if (!dialog.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose, open]);

  if (!open) return null;

  const parsed = parsePageRange(expression, pageCount);
  const selectedCount = parsed.ok ? parsed.indexes.length : 0;

  return (
    <div
      className="extract-dialog-scrim"
      role="presentation"
      onMouseDown={onClose}
    >
      <section
        ref={dialogRef}
        className="extract-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="extract-dialog-title"
        aria-describedby="extract-dialog-hint"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="extract-dialog-heading">
          <div>
            <p className="status-kicker">Workspace export</p>
            <h2 id="extract-dialog-title">Extract pages</h2>
          </div>
          <button
            className="icon-button"
            type="button"
            aria-label="Close extract pages"
            onClick={onClose}
          >
            <CloseIcon className="size-4" />
          </button>
        </div>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const result = parsePageRange(expression, pageCount);
            if (!result.ok) {
              setError(RANGE_ERROR_MESSAGES[result.error]);
              return;
            }
            const blockReason = getExportBlockReason?.(result.indexes);
            if (blockReason) {
              setError(blockReason);
              return;
            }
            onExtract(result.indexes);
            onClose();
          }}
        >
          <label htmlFor="extract-page-range">Pages to extract</label>
          <input
            ref={inputRef}
            id="extract-page-range"
            value={expression}
            onChange={(event) => {
              setExpression(event.target.value);
              setError(null);
            }}
            placeholder="e.g. 1-3, 5"
            aria-invalid={error ? 'true' : 'false'}
            aria-describedby="extract-dialog-hint extract-dialog-error"
          />
          <p id="extract-dialog-hint" className="extract-dialog-hint">
            Current workspace order · {pageCount}{' '}
            {pageCount === 1 ? 'page' : 'pages'}
          </p>
          {error ? (
            <p
              id="extract-dialog-error"
              className="extract-dialog-error"
              role="alert"
            >
              {error}
            </p>
          ) : parsed.ok && expression.trim() ? (
            <p className="extract-dialog-count" role="status">
              {selectedCount} {selectedCount === 1 ? 'page' : 'pages'} selected
            </p>
          ) : null}
          <div className="extract-dialog-actions">
            <button className="text-button" type="button" onClick={onClose}>
              Cancel
            </button>
            <button className="primary-button" type="submit">
              <FileIcon className="size-4" />
              Create PDF
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
