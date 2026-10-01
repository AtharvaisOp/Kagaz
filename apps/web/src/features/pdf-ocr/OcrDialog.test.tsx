import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { OcrDialog } from './OcrDialog';
describe('OCR consent and export guard semantics', () => {
  it('does not prepare or upload on opening and explains English-only temporary processing', () => {
    const prepare = vi.fn();
    const markup = renderToStaticMarkup(
      <OcrDialog
        prepareWorkspace={prepare}
        blockReason={null}
        onClose={() => {}}
      />,
    );
    expect(markup).toContain(
      'This uploads the current PDF temporarily to the Kagaz server for OCR.',
    );
    expect(markup).toContain('not permanently stored');
    expect(markup).toContain('browser-local');
    expect(markup).toContain('English OCR');
    expect(markup).toContain('Searchable PDF');
    expect(markup).toContain('existing text are skipped');
    expect(markup).toContain('Start OCR');
    expect(markup).toContain('aria-describedby="ocr-privacy"');
    expect(prepare).not.toHaveBeenCalled();
  });
  it.each([
    'pending signature',
    'signed source',
    'unsafe form',
    'XFA',
    'password field',
    'unsupported glyph',
  ])('keeps the %s export blocker authoritative', (reason) => {
    const markup = renderToStaticMarkup(
      <OcrDialog
        prepareWorkspace={vi.fn()}
        blockReason={reason}
        onClose={() => {}}
      />,
    );
    expect(markup).toContain('role="alert"');
    expect(markup).toContain(reason);
    expect(markup).toMatch(/type="submit"[^>]*disabled/);
  });
});
