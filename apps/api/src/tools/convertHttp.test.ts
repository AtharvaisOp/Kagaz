import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import type { Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { officeFixture } from '../../../../scripts/office-fixtures.mjs';
import { createApp } from '../app.js';
import { ToolService } from './service.js';
import type { NativeRequest, NativeRunner } from './nativeRunner.js';

let root: string;
let server: Server | undefined;
let tools: ToolService | undefined;
let calls: NativeRequest[];

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'kagaz-convert-http-'));
  calls = [];
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

function successRunner(detection: 'docx' | 'xlsx' = 'docx'): NativeRunner {
  return async (request) => {
    calls.push(request);
    const script = request.args[0] ?? '';
    if (script.endsWith('inspect_office.py'))
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          format: detection,
          units: detection === 'xlsx' ? 1 : 0,
          expandedBytes: 512,
        }),
        stderr: '',
      };
    if (script.endsWith('office_sandbox.py')) {
      const outputDirectory =
        request.args[request.args.indexOf('--outdir') + 1]!;
      await writeFile(
        join(outputDirectory, 'document.pdf'),
        Buffer.from('%PDF-1.7\nsynthetic derivative'),
      );
      return { exitCode: 0, stdout: '', stderr: '' };
    }
    if (request.executable.endsWith('qpdf')) {
      return request.args[0] === '--is-encrypted'
        ? { exitCode: 2, stdout: '', stderr: '' }
        : request.args[0] === '--show-npages'
          ? { exitCode: 0, stdout: '1\n', stderr: '' }
          : { exitCode: 0, stdout: '', stderr: '' };
    }
    if (script.endsWith('inspect_converted_pdf.py'))
      return { exitCode: 0, stdout: JSON.stringify({ pages: 1 }), stderr: '' };
    throw new Error('Unexpected native command');
  };
}

async function start(runner = successRunner(), requestTimeoutMs?: number) {
  tools = new ToolService({
    tempRoot: root,
    runner,
    python: 'server-python',
    qpdf: 'server-qpdf',
    requestTimeoutMs,
  });
  server = createApp(['http://localhost:5173'], tools).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Missing address');
  return `http://127.0.0.1:${address.port}`;
}

function form(
  bytes: Uint8Array,
  filename: string,
  type = 'application/octet-stream',
) {
  const body = new FormData();
  body.append('file', new Blob([bytes.slice()], { type }), filename);
  return body;
}

async function post(url: string, body: FormData, signal?: AbortSignal) {
  return fetch(`${url}/tools/convert-to-pdf`, { method: 'POST', body, signal });
}

async function errorCode(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  expect(response.headers.get('content-type')).toMatch(/^application\/json\b/);
  expect(response.headers.get('content-type')).not.toMatch(/application\/pdf/);
  expect(await response.json()).toMatchObject({ error: { code } });
}

describe('Office conversion HTTP boundary', () => {
  it('returns a noncached PDF derivative with validated metadata', async () => {
    const url = await start();
    const bytes = await officeFixture('paragraphs.docx');
    const response = await post(
      url,
      form(bytes, 'selected-document.DOCX', 'application/x-msdownload'),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toMatch(/^application\/pdf\b/);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(response.headers.get('content-disposition')).toBe(
      'attachment; filename="kagaz-converted.pdf"',
    );
    expect(response.headers.get('x-kagaz-input-format')).toBe('docx');
    expect(response.headers.get('x-kagaz-original-bytes')).toBe(
      String(bytes.byteLength),
    );
    expect(response.headers.get('x-kagaz-output-bytes')).toBe(
      String((await response.clone().arrayBuffer()).byteLength),
    );
    expect(response.headers.get('x-kagaz-pages')).toBe('1');
    expect(new TextDecoder().decode(await response.arrayBuffer())).toContain(
      '%PDF-1.7',
    );
    expect(
      calls.some((call) => call.args[0]?.endsWith('office_sandbox.py')),
    ).toBe(true);
  });

  it('rejects an extension that does not match the server-inspected package', async () => {
    const url = await start(successRunner('xlsx'));
    await errorCode(
      await post(url, form(await officeFixture('sheet.xlsx'), 'renamed.docx')),
      422,
      'unsupported-format',
    );
    expect(
      calls.some((call) => call.args[0]?.endsWith('office_sandbox.py')),
    ).toBe(false);
  });

  it.each([
    'selected-document.doc',
    'selected-document.docm',
    'selected-document.ppt',
    'selected-document.pptm',
    'selected-document.xls',
    'selected-document.xlsm',
    'no-extension',
  ])(
    'rejects unsupported or legacy filename declarations: %s',
    async (filename) => {
      const url = await start();
      await errorCode(
        await post(url, form(await officeFixture('paragraphs.docx'), filename)),
        422,
        'unsupported-format',
      );
      expect(
        calls.some((call) => call.args[0]?.endsWith('office_sandbox.py')),
      ).toBe(false);
    },
  );

  it('uses fixed server paths when the uploaded filename attempts traversal or argument injection', async () => {
    const url = await start();
    const response = await post(
      url,
      form(
        await officeFixture('paragraphs.docx'),
        '../../--headless;touch-outside.docx',
      ),
    );
    expect(response.status).toBe(200);
    const conversion = calls.find((call) =>
      call.args[0]?.endsWith('office_sandbox.py'),
    );
    expect(conversion).toBeDefined();
    expect(
      conversion?.args.some((argument) => argument.includes('touch-outside')),
    ).toBe(false);
    expect(conversion?.args.some((argument) => argument.includes('..'))).toBe(
      false,
    );
  });

  it('rejects multipart options and unsupported packages with JSON errors', async () => {
    const url = await start((request) => {
      calls.push(request);
      return Promise.resolve({
        exitCode: 2,
        stdout: '',
        stderr: 'private native detail',
      });
    });
    const extraField = form(
      await officeFixture('paragraphs.docx'),
      'document.docx',
    );
    extraField.append('format', 'xlsx');
    await errorCode(await post(url, extraField), 400, 'invalid-request');
    await errorCode(
      await post(url, form(Buffer.from('PK\x03\x04broken'), 'document.docx')),
      422,
      'unsafe-document',
    );
    expect(calls).toHaveLength(1);
    await tools?.shutdown();
    expect(await readdir(root)).toEqual([]);
  });

  it('cancels an active conversion when the browser disconnects and cleans its request workspace', async () => {
    let started!: () => void;
    const conversionStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const runner: NativeRunner = async (request) => {
      calls.push(request);
      if (request.args[0]?.endsWith('inspect_office.py'))
        return {
          exitCode: 0,
          stdout: JSON.stringify({
            format: 'docx',
            units: 0,
            expandedBytes: 10,
          }),
          stderr: '',
        };
      if (request.args[0]?.endsWith('office_sandbox.py')) {
        started();
        return new Promise((_resolve, reject) => {
          const rejectAborted = () => {
            const reason: unknown = request.signal.reason;
            reject(
              reason instanceof Error ? reason : new Error('request aborted'),
            );
          };
          if (request.signal.aborted) rejectAborted();
          else
            request.signal.addEventListener('abort', rejectAborted, {
              once: true,
            });
        });
      }
      throw new Error('Unexpected native command');
    };
    const url = await start(runner);
    const controller = new AbortController();
    const response = post(
      url,
      form(await officeFixture('paragraphs.docx'), 'document.docx'),
      controller.signal,
    ).then(
      (value) => value,
      (error: unknown) => error,
    );
    await conversionStarted;
    controller.abort();
    expect(await response).toBeInstanceOf(Error);
    await tools?.shutdown();
    expect(await readdir(root)).toEqual([]);
  }, 15_000);
});
