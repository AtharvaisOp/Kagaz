import { describe, expect, it, vi } from 'vitest';

import { adoptResolvedPdfPage } from './pdfPageLifecycle';

describe('shared PDF page ownership for main and thumbnail rendering', () => {
  it('cleans a page resolved after the render lifecycle became inactive', () => {
    const cleanup = vi.fn();
    const page = { cleanup };
    let renderCalled = false;

    const ownedPage = adoptResolvedPdfPage(page, false);
    if (ownedPage) {
      renderCalled = true;
    }

    expect(ownedPage).toBeNull();
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(renderCalled).toBe(false);
  });

  it('adopts an active page without cleaning it prematurely', () => {
    const cleanup = vi.fn();
    const page = { cleanup };

    expect(adoptResolvedPdfPage(page, true)).toBe(page);
    expect(cleanup).not.toHaveBeenCalled();
  });
});
