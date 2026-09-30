import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { CompressDialog } from './CompressDialog';

describe('compression dialog semantics', () => {
  it('requires explicit action, explains server privacy, and defaults to balanced', () => {
    const prepare = vi.fn();
    const markup = renderToStaticMarkup(
      <CompressDialog
        prepareWorkspace={prepare}
        blockReason={null}
        onClose={() => {}}
      />,
    );
    expect(markup).toContain(
      'Compression temporarily uploads the current PDF to the Kagaz server for processing.',
    );
    expect(markup).toContain('not permanently stored');
    expect(markup).toContain(
      'Ordinary editing and export remain browser-local.',
    );
    expect(markup).toContain('High quality');
    expect(markup).toContain('Balanced');
    expect(markup).toContain('Maximum compression');
    expect(markup).toMatch(/type="radio"[^>]*checked=""[^>]*value="balanced"/);
    expect(markup).toContain('<dialog');
    expect(markup).toContain('<legend>Compression level');
    expect(prepare).not.toHaveBeenCalled();
  });
  it('keeps the export block visible and disables compression', () => {
    const markup = renderToStaticMarkup(
      <CompressDialog
        prepareWorkspace={vi.fn()}
        blockReason="Place or cancel the pending visual signature."
        onClose={() => {}}
      />,
    );
    expect(markup).toContain('role="alert"');
    expect(markup).toContain('pending visual signature');
    expect(markup).toMatch(/type="submit"[^>]*disabled/);
  });
});
