import { describe, expect, it, vi } from 'vitest';
import { WatermarkPreviewJobQueue } from './previewJobQueue';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

describe('bounded watermark preview jobs', () => {
  it('serializes image reads/decodes across nearby previews and preserves waiting order', async () => {
    const queue = new WatermarkPreviewJobQueue();
    const firstDecode = deferred();
    const order: number[] = [];
    let activeDecodes = 0;
    let peakDecodes = 0;
    const decode = async (id: number) => {
      order.push(id);
      peakDecodes = Math.max(peakDecodes, ++activeDecodes);
      if (id === 1) await firstDecode.promise;
      activeDecodes--;
    };
    const jobs = [1, 2, 3].map((id) =>
      queue.run(new AbortController().signal, () => decode(id)),
    );
    expect(order).toEqual([1]);
    firstDecode.resolve();
    await Promise.all(jobs);
    expect(order).toEqual([1, 2, 3]);
    expect(peakDecodes).toBe(1);
  });

  it('removes stale queued previews without reading assets or reporting cancellation errors', async () => {
    const queue = new WatermarkPreviewJobQueue();
    const busy = deferred();
    const first = queue.run(new AbortController().signal, () => busy.promise);
    const staleController = new AbortController();
    const readStaleAsset = vi.fn(() => Promise.resolve());
    const stale = queue.run(staleController.signal, readStaleAsset);
    const surviving = vi.fn(() => Promise.resolve());
    const last = queue.run(new AbortController().signal, surviving);
    staleController.abort();
    await expect(stale).resolves.toBeUndefined();
    expect(readStaleAsset).not.toHaveBeenCalled();
    expect(surviving).not.toHaveBeenCalled();
    busy.resolve();
    await Promise.all([first, last]);
    expect(readStaleAsset).not.toHaveBeenCalled();
    expect(surviving).toHaveBeenCalledOnce();
  });

  it('holds a cancelled active preview slot until its worker cleanup finishes', async () => {
    const queue = new WatermarkPreviewJobQueue();
    const controller = new AbortController();
    const render = deferred();
    const workerDestroyed = deferred();
    let cleanupStarted = false;
    controller.signal.addEventListener('abort', render.resolve, { once: true });
    const first = queue.run(controller.signal, async () => {
      try {
        await render.promise;
      } finally {
        cleanupStarted = true;
        await workerDestroyed.promise;
      }
    });
    const next = vi.fn(() => Promise.resolve());
    const second = queue.run(new AbortController().signal, next);
    controller.abort();
    await vi.waitFor(() => expect(cleanupStarted).toBe(true));
    expect(next).not.toHaveBeenCalled();
    workerDestroyed.resolve();
    await Promise.all([first, second]);
    expect(next).toHaveBeenCalledOnce();
  });

  it('preserves a current render failure while allowing later previews to recover', async () => {
    const queue = new WatermarkPreviewJobQueue();
    const failure = new Error('invalid image stream');
    const first = queue.run(new AbortController().signal, () => {
      throw failure;
    });
    const next = vi.fn(() => Promise.resolve());
    const second = queue.run(new AbortController().signal, next);
    await expect(first).rejects.toBe(failure);
    await second;
    expect(next).toHaveBeenCalledOnce();
  });

  it('does not start an already cancelled preview', async () => {
    const queue = new WatermarkPreviewJobQueue();
    const controller = new AbortController();
    controller.abort();
    const decode = vi.fn(() => Promise.resolve());
    await expect(queue.run(controller.signal, decode)).resolves.toBeUndefined();
    expect(decode).not.toHaveBeenCalled();
  });
});
