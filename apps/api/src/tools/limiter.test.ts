import { describe, expect, it } from 'vitest';
import { ExecutionLimiter } from './limiter.js';
import { HeavyToolError } from './errors.js';

describe('bounded request admission', () => {
  it('holds deterministic capacity and releases queued work FIFO only once', async () => {
    const limiter = new ExecutionLimiter(1, 2);
    const signal = new AbortController().signal;
    const release = await limiter.acquire(signal);
    let entered = false;
    const queued = limiter.acquire(signal).then((done) => {
      entered = true;
      return done;
    });
    await Promise.resolve();
    expect(entered).toBe(false);
    release();
    release();
    const done = await queued;
    expect(entered).toBe(true);
    done();
    (await limiter.acquire(signal))();
  });
  it('aborts queued requests without consuming or leaking a slot', async () => {
    const limiter = new ExecutionLimiter(1, 1);
    const release = await limiter.acquire(new AbortController().signal);
    const waiting = new AbortController();
    const rejected = expect(
      limiter.acquire(waiting.signal),
    ).rejects.toMatchObject({ code: 'cancelled' });
    waiting.abort();
    await rejected;
    release();
    (await limiter.acquire(new AbortController().signal))();
  });
  it('preserves a queued deadline and admits the next waiter without starvation', async () => {
    const limiter = new ExecutionLimiter(1, 2);
    const release = await limiter.acquire(new AbortController().signal);
    const expired = new AbortController();
    const timedOut = expect(
      limiter.acquire(expired.signal),
    ).rejects.toMatchObject({ code: 'processing-timeout' });
    const next = limiter.acquire(new AbortController().signal);
    expired.abort(new HeavyToolError('processing-timeout'));
    await timedOut;
    release();
    (await next)();
    (await limiter.acquire(new AbortController().signal))();
  });
  it('rejects overload, pre-aborted acquisition, and shutdown without deadlock', async () => {
    const limiter = new ExecutionLimiter(1, 1);
    const controller = new AbortController();
    const release = await limiter.acquire(controller.signal);
    const queued = expect(
      limiter.acquire(controller.signal),
    ).rejects.toMatchObject({ code: 'server-busy' });
    await expect(limiter.acquire(controller.signal)).rejects.toMatchObject({
      code: 'server-busy',
    });
    limiter.close();
    await queued;
    release();
    await expect(limiter.acquire(controller.signal)).rejects.toMatchObject({
      code: 'server-busy',
    });
    controller.abort();
    expect(() => limiter.acquire(controller.signal)).toThrow();
  });
});
