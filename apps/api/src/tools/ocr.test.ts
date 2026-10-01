import { once } from 'node:events';
import type { Server } from 'node:http';
import { request as httpRequest } from 'node:http';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';
import { ToolService } from './service.js';
import type { NativeRunner } from './nativeRunner.js';
import { HeavyToolError } from './errors.js';

let root: string, server: Server | undefined, tools: ToolService | undefined;
const input = new TextEncoder().encode('%PDF-1.7 fixture data');
const output = new TextEncoder().encode(
  '%PDF-1.7 searchable derivative larger than input',
);
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'kagaz-ocr-http-'));
});
afterEach(async () => {
  await tools?.shutdown();
  server?.closeAllConnections();
  if (server)
    await new Promise<void>((resolve) => server?.close(() => resolve()));
  expect(await readdir(root)).toEqual([]);
  await rm(root, { recursive: true, force: true });
  server = undefined;
  tools = undefined;
});
const good: NativeRunner = async (request) => {
  if (request.executable === 'ocrmypdf')
    await writeFile(request.args.at(-1)!, output);
  return {
    exitCode: request.args[0] === '--is-encrypted' ? 2 : 0,
    stderr: '',
    stdout:
      request.executable === 'python3'
        ? JSON.stringify({ pages: 1, pagesOcred: 1, pagesSkipped: 0 })
        : request.args[0] === '--show-npages'
          ? '1'
          : request.args[0] === '--json'
            ? JSON.stringify({ acroform: { hasacroform: false } })
            : '',
  };
};
async function start(
  runner: NativeRunner = good,
  requestTimeoutMs?: number,
  queueLimit = 2,
) {
  tools = new ToolService({
    runner,
    tempRoot: root,
    requestTimeoutMs,
    queueLimit,
  });
  server = createApp(['http://localhost:5173'], tools).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('address');
  return `http://127.0.0.1:${address.port}/tools/ocr`;
}
function form(bytes = input, language = 'eng', filename = 'workspace.pdf') {
  const body = new FormData();
  body.append('file', new Blob([bytes.slice()]), filename);
  body.append('language', language);
  return body;
}
async function code(response: Response, status: number, expected: string) {
  expect(response.status).toBe(status);
  const text = await response.text();
  expect(text).toContain(expected);
  expect(text).not.toContain(root);
  expect(text).not.toContain('native-secret');
}
describe('OCR shared HTTP lifecycle and policy', () => {
  it('returns independently validated metadata, allows larger OCR output and fixes arguments', async () => {
    const runner = vi.fn(good);
    const url = await start(runner);
    const response = await fetch(url, {
      method: 'POST',
      body: form(input, 'eng', '../../$(native-secret).pdf'),
      headers: { Origin: 'http://localhost:5173' },
    });
    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(output);
    expect(response.headers.get('X-Kagaz-Ocr-Language')).toBe('eng');
    expect(response.headers.get('X-Kagaz-Pages-Ocred')).toBe('1');
    expect(response.headers.get('Access-Control-Expose-Headers')).toContain(
      'X-Kagaz-Pages-Ocred',
    );
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    const engine = runner.mock.calls.find(
      ([request]) => request.executable === 'ocrmypdf',
    )?.[0];
    expect(engine?.args).toContain('--skip-text');
    expect(engine?.args).not.toContain('--force-ocr');
    expect(engine?.args).not.toContain('--deskew');
    expect(engine?.args).not.toContain('--rotate-pages');
    expect(engine?.args).toContain('eng');
    expect(engine?.args).toContain('--jobs');
    expect(engine?.timeoutMs).toBe(240_000);
    expect(engine?.limits?.addressSpace).toBe(768 * 1024 * 1024);
    expect(JSON.stringify(runner.mock.calls)).not.toContain('native-secret');
  });
  it.each(['fra', 'eng+fra', '--force-ocr', 'eng; touch hacked'])(
    'rejects language %s before native execution',
    async (language) => {
      const runner = vi.fn(good),
        url = await start(runner);
      await code(
        await fetch(url, { method: 'POST', body: form(input, language) }),
        422,
        'unsupported-language',
      );
      expect(runner).not.toHaveBeenCalled();
    },
  );
  it.each([
    'duplicate-field',
    'extra-option',
    'missing-file',
    'extra-file',
    'missing-language',
  ])('rejects malformed envelope %s', async (kind) => {
    const url = await start();
    const body = kind === 'missing-file' ? new FormData() : form();
    if (kind === 'duplicate-field' || kind === 'missing-file')
      body.append('language', 'eng');
    if (kind === 'extra-option') body.append('force', 'true');
    if (kind === 'extra-file')
      body.append('file', new Blob([input]), 'other.pdf');
    if (kind === 'missing-language') body.delete('language');
    await code(
      await fetch(url, { method: 'POST', body }),
      400,
      'invalid-request',
    );
  });
  it('rejects a generated PDF above the OCR-specific byte limit before processing', async () => {
    const runner = vi.fn(good),
      url = await start(runner);
    await code(
      await fetch(url, {
        method: 'POST',
        body: form(new Uint8Array(10 * 1024 * 1024 + 1)),
      }),
      413,
      'file-too-large',
    );
    expect(runner).not.toHaveBeenCalled();
  });
  it.each(['encrypted', 'warning', 'pages', 'forms', 'raster-budget'])(
    'rejects unsafe preflight %s',
    async (kind) => {
      const url = await start(async (request) => {
        if (kind === 'encrypted' && request.args[0] === '--is-encrypted')
          return { exitCode: 0, stdout: '', stderr: '' };
        if (kind === 'warning' && request.args[0] === '--check')
          return { exitCode: 3, stdout: '', stderr: '' };
        if (kind === 'pages' && request.args[0] === '--show-npages')
          return { exitCode: 0, stdout: '21', stderr: '' };
        if (kind === 'forms' && request.args[0] === '--json')
          return {
            exitCode: 0,
            stdout: '{"acroform":{"hasacroform":true}}',
            stderr: '',
          };
        if (kind === 'raster-budget' && request.executable === 'python3')
          return { exitCode: 2, stdout: '', stderr: '' };
        return good(request);
      });
      await code(
        await fetch(url, { method: 'POST', body: form() }),
        kind === 'warning' ? 400 : 422,
        kind === 'warning' ? 'invalid-pdf' : 'unsupported-pdf',
      );
    },
  );
  it('reports no OCR needed without executing the OCR engine', async () => {
    const runner = vi.fn<NativeRunner>(async (request) =>
      request.executable === 'python3'
        ? {
            exitCode: 0,
            stdout: '{"pages":1,"pagesOcred":0,"pagesSkipped":1}',
            stderr: '',
          }
        : good(request),
    );
    const url = await start(runner);
    await code(
      await fetch(url, { method: 'POST', body: form() }),
      422,
      'no-ocr-needed',
    );
    expect(
      runner.mock.calls.some(([request]) => request.executable === 'ocrmypdf'),
    ).toBe(false);
  });
  it.each([
    'native-exit',
    'missing-output',
    'corrupt-output',
    'page-loss',
    'no-searchable-text',
    'bad-inventory',
  ])('fails closed on %s even with exit 0', async (kind) => {
    const url = await start(async (request) => {
      if (request.executable === 'ocrmypdf') {
        if (kind === 'native-exit')
          return {
            exitCode: 7,
            stdout: '',
            stderr: 'native-secret /tmp/private',
          };
        if (kind === 'missing-output')
          return { exitCode: 0, stdout: '', stderr: '' };
        if (kind === 'corrupt-output') {
          await writeFile(request.args.at(-1)!, 'broken');
          return { exitCode: 0, stdout: '', stderr: '' };
        }
      }
      if (
        kind === 'page-loss' &&
        request.args[0] === '--show-npages' &&
        request.args[1]?.endsWith('output.pdf')
      )
        return { exitCode: 0, stdout: '2', stderr: '' };
      if (
        kind === 'no-searchable-text' &&
        request.executable === 'python3' &&
        request.args.length === 3
      )
        return { exitCode: 1, stdout: '', stderr: '' };
      if (kind === 'bad-inventory' && request.executable === 'python3')
        return { exitCode: 0, stdout: '{truncated', stderr: '' };
      return good(request);
    });
    await code(
      await fetch(url, { method: 'POST', body: form() }),
      500,
      'ocr-failed',
    );
  });
  it('enforces the request deadline and settles native work before cleaning', async () => {
    const url = await start(async (request) => {
      if (request.executable !== 'ocrmypdf') return good(request);
      return new Promise((_, reject) =>
        request.signal.addEventListener(
          'abort',
          () =>
            reject(
              request.signal.reason instanceof Error
                ? request.signal.reason
                : new HeavyToolError('cancelled'),
            ),
          { once: true },
        ),
      );
    }, 100);
    await code(
      await fetch(url, { method: 'POST', body: form() }),
      504,
      'processing-timeout',
    );
  });
  it('shares admission with compression, rejects overflow, and cancels on shutdown', async () => {
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const url = await start(
      async (request) => {
        if (request.executable !== 'ocrmypdf') return good(request);
        entered();
        return new Promise((_, reject) =>
          request.signal.addEventListener(
            'abort',
            () => reject(new HeavyToolError('server-busy')),
            { once: true },
          ),
        );
      },
      undefined,
      0,
    );
    const first = fetch(url, { method: 'POST', body: form() });
    await started;
    const compress = new FormData();
    compress.append('file', new Blob([input]), 'workspace.pdf');
    compress.append('preset', 'balanced');
    await code(
      await fetch(url.replace('/ocr', '/compress'), {
        method: 'POST',
        body: compress,
      }),
      503,
      'server-busy',
    );
    await tools?.shutdown();
    await code(await first, 503, 'server-busy');
  });
  it('aborts native OCR on disconnect and clears all intermediates', async () => {
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const url = await start(async (request) => {
      if (request.executable !== 'ocrmypdf') return good(request);
      await writeFile(
        join(request.cwd, 'private-intermediate.txt'),
        'synthetic fixture',
      );
      entered();
      return new Promise((_, reject) =>
        request.signal.addEventListener(
          'abort',
          () => reject(new HeavyToolError('cancelled')),
          { once: true },
        ),
      );
    });
    const controller = new AbortController();
    const task = fetch(url, {
      method: 'POST',
      body: form(),
      signal: controller.signal,
    }).catch(() => null);
    await started;
    controller.abort();
    await task;
    await tools?.shutdown();
    expect(await readdir(root)).toEqual([]);
  });
  it('rejects excessive chunked input using the OCR limit', async () => {
    const url = await start();
    const status = await new Promise<number>((resolve, reject) => {
      const request = httpRequest(
        url,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'multipart/form-data; boundary=test',
            'Transfer-Encoding': 'chunked',
          },
        },
        (response) => {
          response.resume();
          response.once('end', () => resolve(response.statusCode ?? 0));
        },
      );
      request.on('error', reject);
      request.end(
        Buffer.concat([
          Buffer.from(
            '--test\r\nContent-Disposition: form-data; name="file"; filename="evil.pdf"\r\n\r\n',
          ),
          Buffer.alloc(10 * 1024 * 1024 + 1),
          Buffer.from('\r\n--test--\r\n'),
        ]),
      );
    });
    expect(status).toBe(413);
  });
  it('denies unapproved CORS before parsing the upload', async () => {
    const runner = vi.fn(good),
      url = await start(runner);
    expect(
      (
        await fetch(url, {
          method: 'POST',
          body: form(),
          headers: { Origin: 'https://hostile.example' },
        })
      ).status,
    ).toBe(403);
    expect(runner).not.toHaveBeenCalled();
  });
});
