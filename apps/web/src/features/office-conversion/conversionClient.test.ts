import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  readConversionMetadata,
  supportedOfficeFormat,
  uploadConversion,
} from './conversionClient';

const input = new File(['synthetic Office package bytes'], 'report.DOCX', {
  type: 'application/octet-stream',
});
const output = new TextEncoder().encode('%PDF-1.7 converted fixture');

function headers() {
  return new Headers({
    'Content-Type': 'application/pdf',
    'X-Kagaz-Input-Format': 'docx',
    'X-Kagaz-Original-Bytes': String(input.size),
    'X-Kagaz-Output-Bytes': String(output.length),
    'X-Kagaz-Pages': '2',
  });
}

afterEach(() => vi.unstubAllGlobals());

describe('explicit Office conversion transport', () => {
  it.each([
    ['report.docx', 'docx'],
    ['presentation.PPTX', 'pptx'],
    ['budget.xlsx', 'xlsx'],
    ['old.doc', null],
    ['macro.docm', null],
    ['no-extension', null],
  ] as const)(
    'recognizes only supported filename extensions: %s',
    (name, expected) => {
      expect(supportedOfficeFormat(name)).toBe(expected);
    },
  );

  it('checks output byte counts, format, and page bounds', () => {
    expect(
      readConversionMetadata(headers(), input.size, output.length),
    ).toEqual({
      inputFormat: 'docx',
      originalBytes: input.size,
      outputBytes: output.length,
      pages: 2,
    });
    for (const change of [
      (value: Headers) => value.set('X-Kagaz-Input-Format', 'xls'),
      (value: Headers) => value.set('X-Kagaz-Original-Bytes', '0'),
      (value: Headers) => value.set('X-Kagaz-Output-Bytes', '999999999'),
      (value: Headers) => value.set('X-Kagaz-Pages', '0'),
      (value: Headers) => value.set('X-Kagaz-Pages', '51'),
    ]) {
      const value = headers();
      change(value);
      expect(() =>
        readConversionMetadata(value, input.size, output.length),
      ).toThrow('incomplete');
    }
  });

  it('uploads only when called and sends a normalized supported extension', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(output, { headers: headers() }));
    vi.stubGlobal('fetch', fetchMock);
    const processing = vi.fn();
    const result = await uploadConversion(
      input,
      new AbortController().signal,
      processing,
      'https://api.example/',
    );
    expect(processing).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, options] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.example/tools/convert-to-pdf');
    expect(options?.credentials).toBe('omit');
    expect(options?.cache).toBe('no-store');
    const body = options?.body;
    expect(body).toBeInstanceOf(FormData);
    if (!(body instanceof FormData))
      throw new Error('Expected multipart form data');
    expect([...body.keys()]).toEqual(['file']);
    const uploaded = body.get('file');
    if (!(uploaded instanceof File)) throw new Error('Expected a file part');
    expect(uploaded.name).toBe('selected-document.docx');
    expect(uploaded.name).not.toContain('report');
    expect(result.bytes).toEqual(output);
    expect(result.metadata.inputFormat).toBe('docx');
  });

  it('rejects unsupported extensions before any network request', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const legacy = new File(['legacy'], 'report.doc', {
      type: 'application/msword',
    });
    await expect(
      uploadConversion(legacy, new AbortController().signal, () => {}),
    ).rejects.toThrow('unsupported');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('uses safe errors for server, network, and cancellation outcomes', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: {
              code: 'unsafe-document',
              message: '/tmp/secret/native stderr',
            },
          }),
          { status: 422 },
        ),
      ),
    );
    await expect(
      uploadConversion(input, new AbortController().signal, () => {}),
    ).rejects.toThrow('external links');

    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('network internals')),
    );
    await expect(
      uploadConversion(input, new AbortController().signal, () => {}),
    ).rejects.toThrow('connection');

    const controller = new AbortController();
    controller.abort();
    await expect(
      uploadConversion(input, controller.signal, () => {}),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});
