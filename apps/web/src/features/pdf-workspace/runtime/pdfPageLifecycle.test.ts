import { describe, expect, it, vi } from 'vitest';

import {
  acquirePdfPage,
  adoptResolvedPdfPage,
  retirePdfDocument,
  waitForPdfDocumentIdle,
} from './pdfPageLifecycle';

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

  it('defers cleanup until all render and extraction leases have released', async () => {
    const cleanup = vi.fn();
    const page = { cleanup };
    const document = { getPage: vi.fn(() => Promise.resolve(page)) };
    const render = acquirePdfPage(document, 1);
    const extraction = acquirePdfPage(document, 1);
    const [renderPage, extractionPage] = await Promise.all([
      render.page,
      extraction.page,
    ]);

    expect(renderPage).toBe(page);
    expect(extractionPage).toBe(page);
    expect(document.getPage).toHaveBeenCalledOnce();
    render.release(true);
    expect(cleanup).not.toHaveBeenCalled();
    extraction.release(true);
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('keeps an early cleanup request reserved until an in-flight page is resolved', async () => {
    const cleanup = vi.fn();
    const page = { cleanup };
    const document = { getPage: vi.fn(() => Promise.resolve(page)) };
    const lease = acquirePdfPage(document, 2);
    lease.release(true);

    await expect(lease.page).resolves.toBe(page);
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('waits for active page consumers before retiring a document and blocks new page work', async () => {
    const cleanup = vi.fn();
    const getPage = vi.fn(() => Promise.resolve({ cleanup }));
    const document = { getPage };
    const lease = acquirePdfPage(document, 1);
    await lease.page;
    retirePdfDocument(document);

    let settled = false;
    const idle = waitForPdfDocumentIdle(document).then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    const rejectedLease = acquirePdfPage(document, 2);
    await expect(rejectedLease.page).rejects.toThrow('being released');
    expect(getPage).toHaveBeenCalledTimes(1);
    lease.release(true);
    await idle;
    expect(settled).toBe(true);
    expect(cleanup).toHaveBeenCalledTimes(1);
  });
});
