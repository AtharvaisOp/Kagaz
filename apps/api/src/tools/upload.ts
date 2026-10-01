import busboy from 'busboy';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import type { Request } from 'express';
import type { CompressionPreset } from '@kagaz/shared-types';
import { checkAbort, HeavyToolError } from './errors.js';

export const MAX_INPUT_BYTES = 20 * 1024 * 1024;
export const MAX_OCR_INPUT_BYTES = 10 * 1024 * 1024;
export function isPreset(value: string): value is CompressionPreset {
  return (
    value === 'high-quality' || value === 'balanced' || value === 'maximum'
  );
}

/** Streams one bounded part to disk. All writes settle before cleanup can begin. */
export async function receivePdf(
  request: Request,
  path: string,
  signal: AbortSignal,
  operation: 'compress' | 'ocr' = 'compress',
): Promise<CompressionPreset | 'eng'> {
  checkAbort(signal);
  const maximum = operation === 'ocr' ? MAX_OCR_INPUT_BYTES : MAX_INPUT_BYTES;
  const MAX_BODY_BYTES = maximum + 64 * 1024;
  if (Number(request.headers['content-length']) > MAX_BODY_BYTES)
    throw new HeavyToolError('file-too-large');
  let parser: ReturnType<typeof busboy>;
  try {
    parser = busboy({
      headers: request.headers,
      limits: {
        files: 1,
        fields: 1,
        // Busboy emits partsLimit upon reaching the count, including the last part.
        parts: 3,
        fileSize: maximum + 1,
        fieldSize: 32,
        fieldNameSize: 32,
        headerPairs: 32,
      },
    });
  } catch {
    throw new HeavyToolError('invalid-request');
  }
  let bytes = 0,
    fileCount = 0;
  let preset: CompressionPreset | 'eng' | undefined;
  let failure: unknown;
  const writes: Promise<void>[] = [];
  const counter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.length;
      callback(
        bytes > MAX_BODY_BYTES ? new HeavyToolError('file-too-large') : null,
        chunk,
      );
    },
  });
  const fail = (error: unknown) => {
    failure ??= error;
    // Busboy mutates its current file after emitting limit/field events.
    // Defer destruction to avoid reentering its parser mid-callback.
    queueMicrotask(() => parser.destroy());
  };
  const abort = () =>
    fail(
      signal.reason instanceof HeavyToolError
        ? signal.reason
        : new HeavyToolError('cancelled'),
    );
  signal.addEventListener('abort', abort, { once: true });
  const uploadDeadline = setTimeout(
    () => fail(new HeavyToolError('processing-timeout')),
    30_000,
  );
  parser.on('file', (name, file) => {
    fileCount += 1;
    if (name !== 'file') {
      file.resume();
      fail(new HeavyToolError('invalid-request'));
      return;
    }
    file.on('limit', () => fail(new HeavyToolError('file-too-large')));
    // info.filename, MIME and extension deliberately have no authority here.
    writes.push(
      pipeline(file, createWriteStream(path, { flags: 'wx', mode: 0o600 }), {
        signal,
      }).catch((error: unknown) => {
        fail(error);
      }),
    );
  });
  parser.on('field', (name, value, info) => {
    if (
      name !== (operation === 'ocr' ? 'language' : 'preset') ||
      preset ||
      info.valueTruncated ||
      info.nameTruncated
    ) {
      fail(new HeavyToolError('invalid-request'));
      return;
    }
    if (operation === 'ocr') {
      if (value !== 'eng') fail(new HeavyToolError('unsupported-language'));
      else preset = value;
    } else if (isPreset(value)) preset = value;
    else fail(new HeavyToolError('invalid-request'));
  });
  parser.on('filesLimit', () => fail(new HeavyToolError('invalid-request')));
  parser.on('fieldsLimit', () => fail(new HeavyToolError('invalid-request')));
  parser.on('partsLimit', () => fail(new HeavyToolError('invalid-request')));
  parser.on('error', () => {
    failure ??= new HeavyToolError('invalid-request');
  });
  counter.on('error', fail);
  const requestError = () => fail(new HeavyToolError('cancelled'));
  request.on('error', requestError);
  try {
    await new Promise<void>((resolve) => {
      parser.once('close', resolve);
      request.pipe(counter).pipe(parser);
      if (signal.aborted) abort();
    });
  } finally {
    clearTimeout(uploadDeadline);
    signal.removeEventListener('abort', abort);
    request.removeListener('error', requestError);
    request.unpipe(counter);
    counter.unpipe(parser);
    counter.destroy();
    parser.destroy();
    await Promise.all(writes);
  }
  checkAbort(signal);
  if (failure)
    throw failure instanceof HeavyToolError
      ? failure
      : new HeavyToolError('invalid-request');
  if (fileCount !== 1 || !preset) throw new HeavyToolError('invalid-request');
  return preset;
}
