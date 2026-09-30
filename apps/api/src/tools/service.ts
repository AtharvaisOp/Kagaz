import { createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import type { Request, Response } from 'express';
import { compressPdf, type CompressionEngineOptions } from './compress.js';
import { HeavyToolError } from './errors.js';
import { ExecutionLimiter } from './limiter.js';
import { receivePdf } from './upload.js';
import { createTempWorkspace } from './workspace.js';

export const COMPRESSION_HEADERS = [
  'X-Kagaz-Original-Bytes',
  'X-Kagaz-Compressed-Bytes',
  'X-Kagaz-Saved-Bytes',
  'X-Kagaz-Saved-Percent',
  'X-Kagaz-Preset',
  'X-Kagaz-Outcome',
];

export interface ToolServiceOptions extends CompressionEngineOptions {
  readonly tempRoot?: string;
  readonly concurrency?: number;
  readonly queueLimit?: number;
  readonly requestTimeoutMs?: number;
}

export class ToolService {
  private readonly limiter: ExecutionLimiter;
  private readonly controllers = new Set<AbortController>();
  private readonly work = new Set<Promise<void>>();
  private closed = false;
  constructor(private readonly options: ToolServiceOptions = {}) {
    this.limiter = new ExecutionLimiter(
      options.concurrency ?? 1,
      options.queueLimit ?? 2,
    );
  }

  handle(request: Request, response: Response): Promise<void> {
    const task = this.compress(request, response);
    this.work.add(task);
    void task.finally(() => this.work.delete(task)).catch(() => {});
    return task;
  }

  async shutdown(): Promise<void> {
    this.closed = true;
    this.limiter.close();
    for (const controller of this.controllers)
      controller.abort(new HeavyToolError('server-busy'));
    await Promise.allSettled(this.work);
  }

  private async compress(request: Request, response: Response): Promise<void> {
    response.set({
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    const controller = new AbortController();
    this.controllers.add(controller);
    const abort = () => {
      if (!response.writableFinished)
        controller.abort(new HeavyToolError('cancelled'));
    };
    request.once('aborted', abort);
    response.once('close', abort);
    const deadline = setTimeout(
      () => controller.abort(new HeavyToolError('processing-timeout')),
      this.options.requestTimeoutMs ?? 120_000,
    );
    let release: (() => void) | undefined;
    let workspace: Awaited<ReturnType<typeof createTempWorkspace>> | undefined;
    try {
      if (this.closed) throw new HeavyToolError('server-busy');
      release = await this.limiter.acquire(controller.signal);
      workspace = await createTempWorkspace(this.options.tempRoot);
      const preset = await receivePdf(
        request,
        workspace.input,
        controller.signal,
      );
      const result = await compressPdf(
        workspace.input,
        workspace.output,
        preset,
        controller.signal,
        this.options,
      );
      response.type('application/pdf');
      response.set({
        'Content-Disposition': 'attachment; filename="kagaz-compressed.pdf"',
        'Content-Length': String(result.metadata.compressedBytes),
        'X-Kagaz-Original-Bytes': String(result.metadata.originalBytes),
        'X-Kagaz-Compressed-Bytes': String(result.metadata.compressedBytes),
        'X-Kagaz-Saved-Bytes': String(result.metadata.savedBytes),
        'X-Kagaz-Saved-Percent': String(result.metadata.savedPercent),
        'X-Kagaz-Preset': result.metadata.preset,
        'X-Kagaz-Outcome': result.metadata.outcome,
      });
      await pipeline(createReadStream(result.path), response, {
        signal: controller.signal,
      });
    } catch (error) {
      const safe =
        error instanceof HeavyToolError
          ? error
          : new HeavyToolError('processing-failed');
      // Never log filenames, PDF data, raw native diagnostics or exception objects.
      if (safe.code !== 'cancelled')
        console.warn('Heavy tool request failed', { code: safe.code });
      if (!response.headersSent && !response.destroyed) {
        response.set('Connection', 'close');
        if (safe.code === 'server-busy') response.set('Retry-After', '5');
        response.status(safe.status).json(safe.response);
        request.resume();
      }
    } finally {
      clearTimeout(deadline);
      request.removeListener('aborted', abort);
      response.removeListener('close', abort);
      try {
        await workspace?.cleanup();
      } finally {
        release?.();
        this.controllers.delete(controller);
      }
    }
  }
}
