import { checkAbort, HeavyToolError } from './errors.js';

interface Waiter {
  readonly signal: AbortSignal;
  readonly resolve: (release: () => void) => void;
  readonly reject: (error: unknown) => void;
  readonly abort: () => void;
}

/** Admission covers upload, validation, processing, download and cleanup. */
export class ExecutionLimiter {
  private active = 0;
  private readonly queue: Waiter[] = [];
  private closed = false;

  constructor(
    private readonly maximum = 1,
    private readonly queueLimit = 2,
  ) {
    if (
      !Number.isInteger(maximum) ||
      maximum < 1 ||
      !Number.isInteger(queueLimit) ||
      queueLimit < 0
    ) {
      throw new Error('Invalid execution capacity.');
    }
  }

  acquire(signal: AbortSignal): Promise<() => void> {
    checkAbort(signal);
    if (this.closed) return Promise.reject(new HeavyToolError('server-busy'));
    if (this.active < this.maximum) {
      this.active += 1;
      return Promise.resolve(this.releaseOnce());
    }
    if (this.queue.length >= this.queueLimit)
      return Promise.reject(new HeavyToolError('server-busy'));
    return new Promise((resolve, reject) => {
      const waiter: Waiter = {
        signal,
        resolve,
        reject,
        abort: () => {
          const index = this.queue.indexOf(waiter);
          if (index >= 0) this.queue.splice(index, 1);
          signal.removeEventListener('abort', waiter.abort);
          reject(
            signal.reason instanceof HeavyToolError
              ? signal.reason
              : new HeavyToolError('cancelled'),
          );
        },
      };
      this.queue.push(waiter);
      signal.addEventListener('abort', waiter.abort, { once: true });
    });
  }

  close(): void {
    this.closed = true;
    for (const waiter of this.queue.splice(0)) {
      waiter.signal.removeEventListener('abort', waiter.abort);
      waiter.reject(new HeavyToolError('server-busy'));
    }
  }

  private releaseOnce(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active -= 1;
      const waiter = this.queue.shift();
      if (waiter) {
        waiter.signal.removeEventListener('abort', waiter.abort);
        this.active += 1;
        waiter.resolve(this.releaseOnce());
      }
    };
  }
}
