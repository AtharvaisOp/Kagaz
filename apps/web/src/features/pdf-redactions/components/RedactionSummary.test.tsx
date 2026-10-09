import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { PdfRedactionController } from '../hooks/usePdfRedactions';
import { RedactionSummary } from './RedactionSummary';

const pages = [
  {
    id: 'page',
    sourceDocumentId: 'source',
    sourcePageIndex: 0,
    rotationDelta: 0,
  },
] as const;

function controller(): PdfRedactionController {
  const region = {
    id: 'internal-proposal-identity',
    pageId: 'page',
    box: { x: 10, y: 20, width: 100, height: 50 },
  };
  return {
    state: { past: [], present: [region], future: [] },
    active: true,
    setActive: vi.fn(),
    selectionId: region.id,
    select: vi.fn(),
    hasUnsavedWork: true,
    error: null,
    announcement: null,
    add: vi.fn(),
    replace: vi.fn(),
    remove: vi.fn(),
    removeSelected: vi.fn(),
    getRegionsForPage: () => [region],
    registerPageBounds: vi.fn(),
    getPageBounds: () => ({ x: 0, y: 0, width: 600, height: 800 }),
    reset: vi.fn(),
    historyParticipant: {
      canUndo: true,
      canRedo: false,
      undo: () => true,
      redo: () => false,
      discardFuture: vi.fn(),
    },
  };
}

describe('accessible proposal management', () => {
  it('exposes a semantic list and labeled numeric editing and deletion without private identities', () => {
    const html = renderToStaticMarkup(
      <RedactionSummary
        controller={controller()}
        pageId="page"
        pages={pages}
        onChoosePage={vi.fn()}
        onActivate={vi.fn()}
      />,
    );
    expect(html).toContain('aria-labelledby="redaction-summary-title"');
    expect(html).toContain('<ol');
    expect(html).toContain('aria-label="Pending redaction 1"');
    expect(html).toContain('aria-label="Redaction X"');
    expect(html).toContain('aria-label="Redaction Y"');
    expect(html).toContain('aria-label="Redaction width"');
    expect(html).toContain('aria-label="Redaction height"');
    expect(html).toContain('Apply redaction geometry');
    expect(html).toContain('aria-label="Remove pending redaction 1"');
    expect(html).toContain('Export permanently removes covered information');
    expect(html).toContain('lose selectable text');
    expect(html).not.toContain('internal-proposal-identity');
  });

  it('does not expose a speculative management panel before tool use', () => {
    const active = controller();
    expect(
      renderToStaticMarkup(
        <RedactionSummary
          controller={{
            ...active,
            active: false,
            state: { past: [], present: [], future: [] },
          }}
          pageId="page"
          pages={pages}
          onChoosePage={vi.fn()}
          onActivate={vi.fn()}
        />,
      ),
    ).toBe('');
  });

  it('announces geometry failure and disables keyboard creation before bounds are available', () => {
    const active = controller();
    const html = renderToStaticMarkup(
      <RedactionSummary
        controller={{
          ...active,
          error:
            'Use finite, positive dimensions entirely inside the visible page bounds.',
          getPageBounds: () => undefined,
        }}
        pageId="page"
        pages={pages}
        onChoosePage={vi.fn()}
        onActivate={vi.fn()}
      />,
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain('role="status"');
    expect(html).toContain('disabled=""');
    expect(html).toContain('Wait for its preview before adding');
  });

  it('offers every workspace identity and shows the selected proposal page independently of visible page', () => {
    const active = controller();
    const html = renderToStaticMarkup(
      <RedactionSummary
        controller={active}
        pageId="other-page"
        pages={[{ ...pages[0], id: 'other-page' }, pages[0]]}
        onChoosePage={vi.fn()}
        onActivate={vi.fn()}
      />,
    );
    expect(html).toContain('Redactions on page');
    expect(html).toContain('aria-labelledby="redaction-page-choice-label"');
    expect(html).toContain('<option value="other-page">Page 1</option>');
    expect(html).toContain('<option value="page" selected="">Page 2</option>');
    expect(html).toContain('aria-label="Redaction X"');
  });
});
