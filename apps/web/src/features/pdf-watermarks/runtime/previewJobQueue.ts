interface PreviewJob {
  readonly signal: AbortSignal;
  readonly run: () => Promise<void>;
  readonly resolve: () => void;
  readonly reject: (error: unknown) => void;
  readonly cancelQueued: () => void;
}

/** Serializes expensive preview decoding; a job owns its slot through async cleanup. */
export class WatermarkPreviewJobQueue {
  private active = false;
  private readonly pending: PreviewJob[] = [];

  run(signal: AbortSignal, operation: () => Promise<void>): Promise<void> {
    if (signal.aborted) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const job: PreviewJob = {
        signal,
        run: operation,
        resolve,
        reject,
        cancelQueued: () => {
          const index = this.pending.indexOf(job);
          if (index < 0) return;
          this.pending.splice(index, 1);
          signal.removeEventListener('abort', job.cancelQueued);
          resolve();
        },
      };
      this.pending.push(job);
      signal.addEventListener('abort', job.cancelQueued, { once: true });
      this.startNext();
    });
  }

  private startNext(): void {
    if (this.active) return;
    const job = this.pending.shift();
    if (!job) return;
    job.signal.removeEventListener('abort', job.cancelQueued);
    if (job.signal.aborted) {
      job.resolve();
      this.startNext();
      return;
    }
    this.active = true;
    void this.execute(job);
  }

  private async execute(job: PreviewJob): Promise<void> {
    try {
      await job.run();
      job.resolve();
    } catch (error) {
      job.reject(error);
    } finally {
      this.active = false;
      this.startNext();
    }
  }
}

// Shared by dialog and all nearby page previews: one decode/render worker at a time.
export const watermarkPreviewJobs = new WatermarkPreviewJobQueue();
