export function AppHeader() {
  return (
    <header className="app-header">
      <a className="brand" href="/" aria-label="Kagaz home">
        <span className="brand-mark" aria-hidden="true">
          K
        </span>
        <span>Kagaz</span>
      </a>
      <div className="privacy-status">
        <span className="privacy-dot" aria-hidden="true" />
        Private by default
      </div>
    </header>
  );
}
