import { describe, expect, it, vi } from 'vitest';

import { downloadPdf, type DownloadAdapter } from './downloadPdf';

describe('downloadPdf', () => {
  it('creates an application/pdf blob and cleans up asynchronously', () => {
    vi.useFakeTimers();
    const anchor = { href: '', download: '', rel: '' } as HTMLAnchorElement;
    const blob = new Blob(['pdf'], { type: 'application/pdf' });
    const adapter: DownloadAdapter = {
      createBlob: vi.fn(() => blob),
      createObjectUrl: vi.fn(() => 'blob:test'),
      revokeObjectUrl: vi.fn(),
      createAnchor: vi.fn(() => anchor),
      appendAnchor: vi.fn(),
      removeAnchor: vi.fn(),
      clickAnchor: vi.fn(),
      schedule: (callback) => setTimeout(callback, 10),
    };

    downloadPdf(new Uint8Array([1, 2, 3]), 'export.pdf', adapter);
    expect(adapter.createBlob).toHaveBeenCalledWith([expect.any(Uint8Array)], {
      type: 'application/pdf',
    });
    expect(anchor.download).toBe('export.pdf');
    expect(adapter.appendAnchor).toHaveBeenCalledWith(anchor);
    expect(adapter.clickAnchor).toHaveBeenCalledWith(anchor);
    expect(adapter.removeAnchor).toHaveBeenCalledWith(anchor);
    expect(adapter.revokeObjectUrl).not.toHaveBeenCalled();
    vi.advanceTimersByTime(10);
    expect(adapter.revokeObjectUrl).toHaveBeenCalledWith('blob:test');
    vi.useRealTimers();
  });
});
