export function LoadingState({ fileName }: { fileName: string }) {
  return (
    <section className="status-state" aria-live="polite" aria-busy="true">
      <div className="loader" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <p className="status-kicker">Preparing document</p>
      <h2>{fileName}</h2>
      <p>Reading page structure locally in your browser.</p>
    </section>
  );
}
