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
}

export function ExtractPagesDialog({
  pageCount,
  open,
  onClose,
  onExtract,
}: ExtractPagesDialogProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [expression, setExpression] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const closeButton = closeButtonRef.current;
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus());
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('keydown', handleKeyDown);
      closeButton?.focus();
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
            ref={closeButtonRef}
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
