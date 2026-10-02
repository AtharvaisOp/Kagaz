import { createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import type { Request, Response } from 'express';
import { compressPdf, type CompressionEngineOptions } from './compress.js';
import { HeavyToolError } from './errors.js';
import { ExecutionLimiter } from './limiter.js';
import { receiveUpload } from './upload.js';
import { createTempWorkspace } from './workspace.js';
import { ocrPdf, OCR_POLICY, type OcrEngineOptions } from './ocr.js';
import { watchWorkspaceBudget } from './workspaceBudget.js';
import {
  convertToPdf,
  CONVERSION_POLICY,
  type ConversionEngineOptions,
} from './convert.js';

export const COMPRESSION_HEADERS = [
  'X-Kagaz-Original-Bytes',
  'X-Kagaz-Compressed-Bytes',
  'X-Kagaz-Saved-Bytes',
  'X-Kagaz-Saved-Percent',
  'X-Kagaz-Preset',
  'X-Kagaz-Outcome',
];
export const OCR_HEADERS = [
  'X-Kagaz-Original-Bytes',
  'X-Kagaz-Output-Bytes',
  'X-Kagaz-Pages',
  'X-Kagaz-Ocr-Language',
  'X-Kagaz-Pages-Ocred',
  'X-Kagaz-Pages-Skipped',
];
export const CONVERSION_HEADERS = [
  'X-Kagaz-Original-Bytes',
  'X-Kagaz-Output-Bytes',
  'X-Kagaz-Pages',
  'X-Kagaz-Input-Format',
];

export interface ToolServiceOptions
  extends CompressionEngineOptions, OcrEngineOptions, ConversionEngineOptions {
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
      Math.min(options.concurrency ?? 1, 1),
      options.queueLimit ?? 2,
    );
  }

  handle(
    request: Request,
    response: Response,
    operation: 'compress' | 'ocr' | 'convert-to-pdf' = 'compress',
  ): Promise<void> {
    const task = this.process(request, response, operation);
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

  private async process(
    request: Request,
    response: Response,
    operation: 'compress' | 'ocr' | 'convert-to-pdf',
  ): Promise<void> {
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
      this.options.requestTimeoutMs ??
        (operation === 'convert-to-pdf'
          ? CONVERSION_POLICY.requestTimeoutMs
          : operation === 'ocr'
            ? OCR_POLICY.requestTimeoutMs
            : 120_000),
    );
    let release: (() => void) | undefined;
    let workspace: Awaited<ReturnType<typeof createTempWorkspace>> | undefined;
    let stopBudget: (() => Promise<void>) | undefined;
    try {
      if (this.closed) throw new HeavyToolError('server-busy');
      release = await this.limiter.acquire(controller.signal);
      workspace = await createTempWorkspace(this.options.tempRoot);
      if (operation === 'ocr')
        stopBudget = watchWorkspaceBudget(workspace.directory, controller);
      if (operation === 'convert-to-pdf')
        stopBudget = watchWorkspaceBudget(workspace.directory, controller, {
          bytes: CONVERSION_POLICY.workspaceBytes,
          error: 'conversion-failed',
        });
      const selection = await receiveUpload(
        request,
        workspace.input,
        controller.signal,
        operation,
      );
      let result: { path: string };
      if (operation === 'convert-to-pdf') {
        if (selection.operation !== 'convert-to-pdf')
          throw new HeavyToolError('invalid-request');
        const converted = await convertToPdf(
          workspace.input,
          selection.declaredFormat,
          controller.signal,
          this.options,
        );
        result = converted;
        response.set({
          'Content-Disposition': 'attachment; filename="kagaz-converted.pdf"',
          'Content-Length': String(converted.metadata.outputBytes),
          'X-Kagaz-Original-Bytes': String(converted.metadata.originalBytes),
          'X-Kagaz-Output-Bytes': String(converted.metadata.outputBytes),
          'X-Kagaz-Pages': String(converted.metadata.pages),
          'X-Kagaz-Input-Format': converted.metadata.inputFormat,
        });
      } else if (operation === 'ocr') {
        if (selection.operation !== 'ocr')
          throw new HeavyToolError('invalid-request');
        const ocr = await ocrPdf(
          workspace.input,
          workspace.output,
          controller.signal,
          this.options,
        );
        result = ocr;
        response.set({
          'Content-Disposition': 'attachment; filename="kagaz-searchable.pdf"',
          'Content-Length': String(ocr.metadata.outputBytes),
          'X-Kagaz-Original-Bytes': String(ocr.metadata.originalBytes),
          'X-Kagaz-Output-Bytes': String(ocr.metadata.outputBytes),
          'X-Kagaz-Pages': String(ocr.metadata.pages),
          'X-Kagaz-Ocr-Language': ocr.metadata.language,
          'X-Kagaz-Pages-Ocred': String(ocr.metadata.pagesOcred),
          'X-Kagaz-Pages-Skipped': String(ocr.metadata.pagesSkipped),
        });
      } else {
        if (selection.operation !== 'compress')
          throw new HeavyToolError('invalid-request');
        const compressed = await compressPdf(
          workspace.input,
          workspace.output,
          selection.preset,
          controller.signal,
          this.options,
        );
        result = compressed;
        response.set({
          'Content-Disposition': 'attachment; filename="kagaz-compressed.pdf"',
          'Content-Length': String(compressed.metadata.compressedBytes),
          'X-Kagaz-Original-Bytes': String(compressed.metadata.originalBytes),
          'X-Kagaz-Compressed-Bytes': String(
            compressed.metadata.compressedBytes,
          ),
          'X-Kagaz-Saved-Bytes': String(compressed.metadata.savedBytes),
          'X-Kagaz-Saved-Percent': String(compressed.metadata.savedPercent),
          'X-Kagaz-Preset': compressed.metadata.preset,
          'X-Kagaz-Outcome': compressed.metadata.outcome,
        });
      }
      response.type('application/pdf');
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
        response.removeHeader('Content-Length');
        response.removeHeader('Content-Disposition');
        response.set('Connection', 'close');
        if (safe.code === 'server-busy') response.set('Retry-After', '5');
        response
          .status(safe.status)
          .type('application/json')
          .json(safe.response);
        request.resume();
      }
    } finally {
      clearTimeout(deadline);
      request.removeListener('aborted', abort);
      response.removeListener('close', abort);
      try {
        await stopBudget?.();
        await workspace?.cleanup();
      } finally {
        release?.();
        this.controllers.delete(controller);
      }
    }
  }
}
