import type { RefObject } from 'react';
export function AppHeader({
  onOpenConvert,
  convertTrigger,
}: {
  readonly onOpenConvert: () => void;
  readonly convertTrigger: RefObject<HTMLButtonElement | null>;
}) {
  return (
    <header className="app-header">
      <a className="brand" href="/" aria-label="Kagaz home">
        <span className="brand-mark" aria-hidden="true">
          K
        </span>
        <span>Kagaz</span>
      </a>
      <div className="header-actions">
        <button
          ref={convertTrigger}
          type="button"
          className="toolbar-button"
          onClick={onOpenConvert}
        >
          Convert to PDF
        </button>
        <div className="privacy-status">
          <span className="privacy-dot" aria-hidden="true" />
          Private by default
        </div>
      </div>
    </header>
  );
}
