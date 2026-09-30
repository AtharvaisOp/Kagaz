import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import type { Server } from 'node:http';
import { PDFDocument } from 'pdf-lib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';
import { ToolService } from './service.js';
import { HeavyToolError } from './errors.js';
import type { NativeRequest, NativeRunner } from './nativeRunner.js';

let root: string, input: Uint8Array, output: Uint8Array;
let server: Server | undefined, tools: ToolService | undefined;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'kagaz-service-test-'));
  const doc = await PDFDocument.create();
  doc.addPage().drawText('Current workspace');
  output = await doc.save();
  doc.setSubject('padding'.repeat(2000));
  input = await doc.save({ useObjectStreams: false });
});
afterEach(async () => {
  await tools?.shutdown();
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server?.close(() => resolve()));
  }
  expect(await readdir(root)).toEqual([]);
  await rm(root, { recursive: true, force: true });
  server = undefined;
  tools = undefined;
});
const successRunner: NativeRunner = async (request) => {
  if (request.executable === 'gs') {
    const path = request.args
      .find((arg) => arg.startsWith('-sOutputFile='))
      ?.slice(13);
    if (!path) throw new Error('Missing output path');
    await writeFile(path, output);
    return { exitCode: 0, stdout: '', stderr: '' };
  }
  return {
    exitCode: request.args[0] === '--is-encrypted' ? 2 : 0,
    stdout:
      request.args[0] === '--show-npages'
        ? '1\n'
        : request.args[0] === '--json'
          ? JSON.stringify({ acroform: { hasacroform: false } })
          : '',
    stderr: '',
  };
};
async function start(
  runner: NativeRunner = successRunner,
  options: { requestTimeoutMs?: number; queueLimit?: number } = {},
) {
  tools = new ToolService({ tempRoot: root, runner, ...options });
  server = createApp(['http://localhost:5173'], tools).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Missing address');
  return `http://127.0.0.1:${address.port}`;
}
function form(
  bytes: Uint8Array = input,
  preset = 'balanced',
  filename = 'workspace.pdf',
) {
  const body = new FormData();
  body.append(
    'file',
    new Blob([bytes.slice()], { type: 'application/pdf' }),
    filename,
  );
  body.append('preset', preset);
  return body;
}
async function post(url: string, body = form(), signal?: AbortSignal) {
  return fetch(`${url}/tools/compress`, { method: 'POST', body, signal });
}
async function errorCode(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  const body: unknown = await response.json();
  expect(body).toMatchObject({ error: { code } });
  expect(JSON.stringify(body)).not.toContain(root);
  expect(JSON.stringify(body)).not.toContain('native-secret');
}
describe('compression HTTP boundary', () => {
  it('rejects interactive source forms at the API boundary', async () => {
    const url = await start(async (request) =>
      request.args[0] === '--json'
        ? {
            exitCode: 0,
            stdout: JSON.stringify({ acroform: { hasacroform: true } }),
            stderr: '',
          }
        : successRunner(request),
    );
    await errorCode(await post(url), 422, 'unsupported-pdf');
  });
  it('rejects unreadable structural inventory instead of treating it as plain', async () => {
    const url = await start(async (request) =>
      request.args[0] === '--json'
        ? { exitCode: 0, stdout: '{truncated', stderr: '' }
        : successRunner(request),
    );
    await errorCode(await post(url), 400, 'invalid-pdf');
  });
  it('times out incomplete uploads and deletes their partial file', async () => {
    const url = await start(successRunner, { requestTimeoutMs: 100 });
    const received = await new Promise<number>((resolve, reject) => {
      const req = httpRequest(
        `${url}/tools/compress`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'multipart/form-data; boundary=test' },
        },
        (res) => {
          res.resume();
          res.once('end', () => resolve(res.statusCode ?? 0));
        },
      );
      req.on('error', reject);
      req.write(
        '--test\r\nContent-Disposition: form-data; name="file"; filename="f.pdf"\r\n\r\n%PDF-1.7',
      );
    });
    expect(received).toBe(504);
  });
  it.each(['high-quality', 'balanced', 'maximum'])(
    'returns validated PDF and metadata for %s',
    async (preset) => {
      const runner = vi.fn(successRunner);
      const url = await start(runner);
      const response = await post(url, form(input, preset));
      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toContain('application/pdf');
      expect(response.headers.get('Cache-Control')).toBe('no-store');
      const bytes = new Uint8Array(await response.arrayBuffer());
      expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
      expect(response.headers.get('X-Kagaz-Preset')).toBe(preset);
      expect(Number(response.headers.get('X-Kagaz-Saved-Bytes'))).toBe(
        input.length - bytes.length,
      );
      const gs = runner.mock.calls.find(
        ([request]) => request.executable === 'gs',
      )?.[0];
      const setting =
        preset === 'high-quality'
          ? '/printer'
          : preset === 'balanced'
            ? '/ebook'
            : '/screen';
      expect(gs?.args).toContain(`-dPDFSETTINGS=${setting}`);
      expect(gs?.args).toContain('-dSAFER');
      expect(gs?.args).toContain('-dAutoRotatePages=/None');
    },
  );
  it('returns identical exported bytes when the derivative is larger', async () => {
    const url = await start(async (request) => {
      if (request.executable === 'gs') {
        const path = request.args
          .find((arg) => arg.startsWith('-sOutputFile='))
          ?.slice(13);
        if (!path) throw new Error();
        await writeFile(path, input);
        return { exitCode: 0, stdout: '', stderr: '' };
      }
      return successRunner(request);
    });
    const response = await post(url);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(input);
    expect(response.headers.get('X-Kagaz-Outcome')).toBe('unchanged');
    expect(response.headers.get('X-Kagaz-Saved-Percent')).toBe('0');
  });
  it.each([
    new Uint8Array(),
    new TextEncoder().encode('not a PDF'),
    new TextEncoder().encode('%PDF-1.7\ngarbage'),
  ])('rejects empty, wrong-content and malformed PDFs', async (bytes) => {
    const url = await start(async (request) =>
      request.executable === 'qpdf' && request.args[0] === '--check'
        ? { exitCode: 2, stdout: '', stderr: 'native-secret' }
        : successRunner(request),
    );
    await errorCode(await post(url, form(bytes)), 400, 'invalid-pdf');
  });
  it.each(['unknown', '-dNOSAFER', 'balanced; touch /tmp/escaped'])(
    'rejects invalid presets %s',
    async (preset) => {
      await errorCode(
        await post(await start(), form(input, preset)),
        400,
        'invalid-request',
      );
    },
  );
  it('rejects no file, extra file, unknown and repeated fields', async () => {
    const url = await start();
    const missing = new FormData();
    missing.append('preset', 'balanced');
    await errorCode(await post(url, missing), 400, 'invalid-request');
    const extra = form();
    extra.append('file', new Blob([input.slice()]), 'extra.pdf');
    await errorCode(await post(url, extra), 400, 'invalid-request');
    const repeated = form();
    repeated.append('preset', 'maximum');
    await errorCode(await post(url, repeated), 400, 'invalid-request');
    const unknown = form();
    unknown.append('path', '/tmp/escaped');
    await errorCode(await post(url, unknown), 400, 'invalid-request');
  });
  it('rejects oversized uploads before native execution', async () => {
    const runner = vi.fn(successRunner);
    const url = await start(runner);
    await errorCode(
      await post(url, form(new Uint8Array(20 * 1024 * 1024 + 1))),
      413,
      'file-too-large',
    );
    expect(runner).not.toHaveBeenCalled();
  });
  it('rejects oversized chunked multipart data, not only Content-Length', async () => {
    const url = await start();
    const body = Buffer.concat([
      Buffer.from(
        '--test\r\nContent-Disposition: form-data; name="file"; filename="f.pdf"\r\n\r\n',
      ),
      Buffer.alloc(20 * 1024 * 1024 + 1),
      Buffer.from('\r\n--test--\r\n'),
    ]);
    const response = await new Promise<{ status: number; body: string }>(
      (resolve, reject) => {
        const req = httpRequest(
          `${url}/tools/compress`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'multipart/form-data; boundary=test',
              'Transfer-Encoding': 'chunked',
            },
          },
          (res) => {
            const chunks: Buffer[] = [];
            res.on('data', (chunk: Buffer) => chunks.push(chunk));
            res.on('end', () =>
              resolve({
                status: res.statusCode ?? 0,
                body: Buffer.concat(chunks).toString(),
              }),
            );
          },
        );
        req.on('error', reject);
        req.end(body);
      },
    );
    expect(response.status).toBe(413);
    expect(response.body).toContain('file-too-large');
  });
  it('ignores hostile filename and MIME and only passes generated paths', async () => {
    const runner = vi.fn(successRunner);
    const url = await start(runner);
    const body = new FormData();
    body.append(
      'file',
      new Blob([input.slice()], { type: 'text/plain' }),
      '../../$(echo native-secret).ps',
    );
    body.append('preset', 'balanced');
    expect((await post(url, body)).status).toBe(200);
    expect(JSON.stringify(runner.mock.calls)).not.toContain('native-secret');
  });
  it.each(['encrypted', 'warning', 'too-many-pages'])(
    'rejects unsupported input: %s',
    async (mode) => {
      const url = await start(async (request) => {
        if (mode === 'encrypted' && request.args[0] === '--is-encrypted')
          return { exitCode: 0, stdout: '', stderr: '' };
        if (mode === 'warning' && request.args[0] === '--check')
          return { exitCode: 3, stdout: '', stderr: '' };
        if (mode === 'too-many-pages' && request.args[0] === '--show-npages')
          return { exitCode: 0, stdout: '301', stderr: '' };
        return successRunner(request);
      });
      await errorCode(
        await post(url),
        mode === 'warning' ? 400 : 422,
        mode === 'warning' ? 'invalid-pdf' : 'unsupported-pdf',
      );
    },
  );
  it.each(['exit', 'missing', 'corrupt', 'page-loss'])(
    'never returns failed or partial output: %s',
    async (mode) => {
      const url = await start(async (request) => {
        if (request.executable === 'gs') {
          if (mode === 'exit')
            return {
              exitCode: 1,
              stdout: '',
              stderr: 'native-secret /tmp/path',
            };
          if (mode === 'missing')
            return { exitCode: 0, stdout: '', stderr: '' };
          if (mode === 'corrupt') {
            const path = request.args
              .find((arg) => arg.startsWith('-sOutputFile='))
              ?.slice(13);
            if (!path) throw new Error();
            await writeFile(path, 'partial');
            return { exitCode: 0, stdout: '', stderr: '' };
          }
        }
        if (
          mode === 'page-loss' &&
          request.args[0] === '--show-npages' &&
          request.args[1]?.endsWith('output.pdf')
        )
          return { exitCode: 0, stdout: '2', stderr: '' };
        return successRunner(request);
      });
      await errorCode(await post(url), 500, 'processing-failed');
    },
  );
  it('returns friendly timeout and cleans up after native cancellation', async () => {
    const url = await start(async (request) => {
      if (request.executable === 'gs')
        throw new HeavyToolError('processing-timeout');
      return successRunner(request);
    });
    await errorCode(await post(url), 504, 'processing-timeout');
  });
  it('rejects disallowed CORS origins before upload and exposes metadata to allowed ones', async () => {
    const runner = vi.fn(successRunner),
      url = await start(runner);
    const denied = await fetch(`${url}/tools/compress`, {
      method: 'POST',
      body: form(),
      headers: { Origin: 'https://hostile.example' },
    });
    expect(denied.status).toBe(403);
    expect(runner).not.toHaveBeenCalled();
    const allowed = await fetch(`${url}/tools/compress`, {
      method: 'POST',
      body: form(),
      headers: { Origin: 'http://localhost:5173' },
    });
    expect(allowed.headers.get('Access-Control-Allow-Origin')).toBe(
      'http://localhost:5173',
    );
    expect(allowed.headers.get('Access-Control-Expose-Headers')).toContain(
      'X-Kagaz-Saved-Bytes',
    );
  });
  it('aborts in-flight native work on disconnect and cleans before releasing capacity', async () => {
    let started!: () => void;
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    const url = await start(async (request) => {
      if (request.executable !== 'gs') return successRunner(request);
      started();
      return new Promise((_, reject) =>
        request.signal.addEventListener(
          'abort',
          () => reject(new HeavyToolError('cancelled')),
          { once: true },
        ),
      );
    });
    const controller = new AbortController();
    const task = post(url, form(), controller.signal).catch(() => null);
    await entered;
    controller.abort();
    await task;
    await tools?.shutdown();
    expect(await readdir(root)).toEqual([]);
  });
  it('caps admission and aborts queued and active work during shutdown', async () => {
    let started!: () => void;
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    const url = await start(
      async (request: NativeRequest) => {
        if (request.executable !== 'gs') return successRunner(request);
        started();
        return new Promise((_, reject) =>
          request.signal.addEventListener(
            'abort',
            () => reject(new HeavyToolError('server-busy')),
            { once: true },
          ),
        );
      },
      { queueLimit: 0 },
    );
    const first = post(url);
    await entered;
    const busy = await post(url);
    await errorCode(busy, 503, 'server-busy');
    expect(busy.headers.get('Retry-After')).toBe('5');
    await tools?.shutdown();
    await errorCode(await first, 503, 'server-busy');
  });
  it('aborted incomplete uploads leave no streams or temporary files', async () => {
    const url = await start();
    await new Promise<void>((resolve) => {
      const req = httpRequest(`${url}/tools/compress`, {
        method: 'POST',
        headers: { 'Content-Type': 'multipart/form-data; boundary=test' },
      });
      req.on('error', () => resolve());
      req.write(
        '--test\r\nContent-Disposition: form-data; name="file"; filename="f.pdf"\r\n\r\n%PDF-1.7',
      );
      setTimeout(() => {
        req.destroy();
        resolve();
      }, 50);
    });
    await tools?.shutdown();
    expect(await readdir(root)).toEqual([]);
  });
  it('handles malformed multipart boundaries without hanging', async () => {
    const url = await start();
    const response = await fetch(`${url}/tools/compress`, {
      method: 'POST',
      body: '--test\r\npartial',
      headers: { 'Content-Type': 'multipart/form-data; boundary=test' },
    });
    await errorCode(response, 400, 'invalid-request');
  });
});
