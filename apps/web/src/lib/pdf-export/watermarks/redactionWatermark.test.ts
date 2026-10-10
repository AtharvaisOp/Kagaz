import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PDFDocument,
  PDFDict,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFString,
} from 'pdf-lib';
import type { ExportWorkspaceRequest } from '../types';
import { exportWorkspace } from '../exportWorkspace';
import { createDefaultWatermark } from '../../../features/pdf-watermarks/model/watermark';
import type { TextWatermarkConfig } from '../../../features/pdf-watermarks/model/types';
import { rasterizeAppearance } from '../redactions/rasterizeAppearance';

// These tests inspect export graph boundaries. Real pixel sanitization and
// visible foreground watermarking are independently tested by verify-phase5b.
vi.mock('../redactions/rasterizeAppearance', () => ({
  rasterizeAppearance: vi.fn(),
}));
// This graph test has no browser decoder; native validation has separate tests.
vi.mock('./nativeImage', () => ({
  prepareWatermarkImageSource: vi.fn((source: unknown) =>
    Promise.resolve(source),
  ),
}));
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
const sanitizedPng = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  ),
  (value) => value.charCodeAt(0),
);
const watermarkPng = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAEUlEQVR4nGP4z8DQwMDwnwEADH8Cf4i6MZwAAAAASUVORK5CYII=',
  ),
  (value) => value.charCodeAt(0),
);
const config = {
  ...createDefaultWatermark('watermark'),
  text: 'NEW-WATERMARK-ALPHA',
} as TextWatermarkConfig;

async function makeRequest(): Promise<ExportWorkspaceRequest> {
  const source = await PDFDocument.create();
  source
    .addPage([300, 200])
    .drawText('SECRET-TEXT-ALPHA', { x: 30, y: 85, size: 10 });
  source
    .addPage([300, 200])
    .drawText('PUBLIC-BETA', { x: 30, y: 85, size: 10 });
  const bytes = await source.save();
  const buffer = new ArrayBuffer(bytes.length);
  new Uint8Array(buffer).set(bytes);
  const file = new File([buffer], 'secret.pdf', { type: 'application/pdf' });
  return {
    pages: [0, 1].map((index) => ({
      id: `p${index}`,
      sourceDocumentId: 'source',
      sourcePageIndex: index,
      rotationDelta: 0,
    })),
    sources: new Map([['source', { id: 'source', file, fileName: file.name }]]),
    forms: {
      sources: [
        { sourceDocumentId: 'source', capability: 'plain', fields: [] },
      ],
      hasChangedTextDraft: false,
    },
    annotationsByPage: new Map(),
    imageAssets: new Map(),
    redactionsByPage: new Map([
      [
        'p0',
        [
          {
            id: 'proposal',
            pageId: 'p0',
            box: { x: 30, y: 80, width: 150, height: 30 },
          },
        ],
      ],
    ]),
  };
}

async function texts(bytes: Uint8Array): Promise<string[]> {
  const task = pdfjs.getDocument({ data: bytes.slice() });
  try {
    const document = await task.promise;
    const result: string[] = [];
    for (let index = 1; index <= document.numPages; index += 1) {
      const page = await document.getPage(index);
      result.push(
        (await page.getTextContent()).items
          .map((item) => ('str' in item ? item.str : ''))
          .join(''),
      );
      page.cleanup();
    }
    return result;
  } finally {
    await task.destroy();
  }
}

function images(document: PDFDocument): PDFRawStream[] {
  return document.context
    .enumerateIndirectObjects()
    .map(([, object]) => object)
    .filter(
      (object): object is PDFRawStream =>
        object instanceof PDFRawStream &&
        object.dict.get(PDFName.of('Subtype'))?.toString() === '/Image',
    );
}

beforeEach(() => {
  vi.mocked(rasterizeAppearance)
    .mockReset()
    .mockResolvedValue({
      png: sanitizedPng,
      viewBox: [0, 0, 300, 200],
      pixelWidth: 600,
      pixelHeight: 400,
    });
});

describe('watermark compatibility with destructive redaction', () => {
  it('sanitizes before composing foreground text in a source-free second appearance', async () => {
    const bytes = await exportWorkspace({
      ...(await makeRequest()),
      watermark: config,
    });
    expect(rasterizeAppearance).toHaveBeenCalledTimes(2);
    const donor = vi.mocked(rasterizeAppearance).mock.calls[0]!;
    const composed = vi.mocked(rasterizeAppearance).mock.calls[1]!;
    expect(await texts(donor[0])).toEqual(['SECRET-TEXT-ALPHA']);
    expect(donor[2]).toHaveLength(1);
    expect(await texts(composed[0])).toEqual(['NEW-WATERMARK-ALPHA']);
    expect(composed[2]).toEqual([]);
    const output = await PDFDocument.load(bytes, {
      throwOnInvalidObject: true,
    });
    expect(await texts(bytes)).toEqual(['', 'PUBLIC-BETANEW-WATERMARK-ALPHA']);
    expect(
      output
        .getPage(0)
        .node.Resources()
        ?.lookupMaybe(PDFName.of('Font'), PDFDict)
        ?.keys().length ?? 0,
    ).toBe(0);
    expect(output.getPage(0).node.Annots()?.size() ?? 0).toBe(0);
    expect(images(output)).toHaveLength(1);
    expect(
      output.context
        .enumerateIndirectObjects()
        .filter(
          ([, object]) =>
            object instanceof PDFDict &&
            object.get(PDFName.of('Type'))?.toString() === '/Page',
        ),
    ).toHaveLength(2);
  });
  it('never serializes the original watermark PNG or its alpha mask in redacted-only output', async () => {
    const request = await makeRequest();
    const bytes = await exportWorkspace({
      ...request,
      pages: [request.pages[0]!],
      watermark: { ...config, kind: 'image', assetId: 'watermark-image' },
      imageAssets: new Map([
        [
          'watermark-image',
          {
            assetId: 'watermark-image',
            mimeType: 'image/png',
            bytes: watermarkPng,
          },
        ],
      ]),
    });
    expect(rasterizeAppearance).toHaveBeenCalledTimes(2);
    const sourceFree = await PDFDocument.load(
      vi.mocked(rasterizeAppearance).mock.calls[1]![0],
    );
    expect(
      await texts(vi.mocked(rasterizeAppearance).mock.calls[1]![0]),
    ).toEqual(['']);
    expect(
      images(sourceFree).some(
        (image) =>
          image.dict.lookupMaybe(PDFName.of('Width'), PDFNumber)?.asNumber() ===
          2,
      ),
    ).toBe(true);
    const output = await PDFDocument.load(bytes);
    expect(images(output)).toHaveLength(1);
    expect(
      images(output)[0]!.dict.lookup(PDFName.of('Width'), PDFNumber).asNumber(),
    ).toBe(1);
    expect(images(output)[0]!.dict.has(PDFName.of('SMask'))).toBe(false);
    expect(await texts(bytes)).toEqual(['']);
  });
  it('does not run the second raster pass for an untargeted redacted page', async () => {
    const request = await makeRequest();
    const bytes = await exportWorkspace({
      ...request,
      watermark: { ...config, target: { kind: 'pages', pageIds: ['p1'] } },
    });
    expect(rasterizeAppearance).toHaveBeenCalledTimes(1);
    expect(await texts(bytes)).toEqual(['', 'PUBLIC-BETANEW-WATERMARK-ALPHA']);
  });
  it('preserves source-free final structure through reordered redacted Extract', async () => {
    const request = await makeRequest();
    const bytes = await exportWorkspace({
      ...request,
      pages: [request.pages[1]!, request.pages[0]!],
      watermark: config,
    });
    expect(await texts(bytes)).toEqual(['PUBLIC-BETANEW-WATERMARK-ALPHA', '']);
    const extract = await exportWorkspace({
      ...request,
      pages: [request.pages[0]!],
      watermark: { ...config, target: { kind: 'pages', pageIds: ['p0'] } },
    });
    expect((await PDFDocument.load(extract)).getPageCount()).toBe(1);
    expect(await texts(extract)).toEqual(['']);
  });
  it('fails closed on second-pass failure and preserves subsequent export availability', async () => {
    const request = await makeRequest();
    vi.mocked(rasterizeAppearance)
      .mockResolvedValueOnce({
        png: sanitizedPng,
        viewBox: [0, 0, 300, 200],
        pixelWidth: 600,
        pixelHeight: 400,
      })
      .mockRejectedValueOnce(new Error('foreground render failed'));
    await expect(
      exportWorkspace({ ...request, watermark: config }),
    ).rejects.toBeDefined();
    expect(
      await texts(await exportWorkspace({ ...request, watermark: config })),
    ).toEqual(['', 'PUBLIC-BETANEW-WATERMARK-ALPHA']);
  });
  it('aborts after sanitization without composing or publishing a partial PDF', async () => {
    const request = await makeRequest();
    const controller = new AbortController();
    vi.mocked(rasterizeAppearance).mockImplementationOnce(() => {
      controller.abort();
      return Promise.resolve({
        png: sanitizedPng,
        viewBox: [0, 0, 300, 200],
        pixelWidth: 600,
        pixelHeight: 400,
      });
    });
    await expect(
      exportWorkspace(
        { ...request, watermark: config },
        { signal: controller.signal },
      ),
    ).rejects.toMatchObject({ code: 'aborted' });
    expect(rasterizeAppearance).toHaveBeenCalledTimes(1);
  });
  it('aborts after foreground reconstruction without publishing partial output', async () => {
    const request = await makeRequest();
    const controller = new AbortController();
    vi.mocked(rasterizeAppearance)
      .mockResolvedValueOnce({
        png: sanitizedPng,
        viewBox: [0, 0, 300, 200],
        pixelWidth: 600,
        pixelHeight: 400,
      })
      .mockImplementationOnce(() => {
        controller.abort();
        return Promise.resolve({
          png: sanitizedPng,
          viewBox: [0, 0, 300, 200],
          pixelWidth: 600,
          pixelHeight: 400,
        });
      });
    await expect(
      exportWorkspace(
        { ...request, watermark: config },
        { signal: controller.signal },
      ),
    ).rejects.toMatchObject({ code: 'aborted' });
  });
  it('keeps hidden/numeric original resource retention rejected with watermarking enabled', async () => {
    const request = await makeRequest();
    const source = await PDFDocument.load(
      await request.sources.get('source')!.file.arrayBuffer(),
    );
    source
      .getPage(1)
      .node.set(
        PDFName.of('Metadata'),
        source.context.obj({ Contents: PDFString.of('SECRET-TEXT-ALPHA') }),
      );
    const sourceBytes = await source.save();
    const buffer = new ArrayBuffer(sourceBytes.length);
    new Uint8Array(buffer).set(sourceBytes);
    const file = new File([buffer], 'unsafe.pdf', { type: 'application/pdf' });
    await expect(
      exportWorkspace({
        ...request,
        watermark: config,
        sources: new Map([
          ['source', { id: 'source', file, fileName: file.name }],
        ]),
      }),
    ).rejects.toMatchObject({ code: 'redaction-unsafe-retention' });
    expect(rasterizeAppearance).not.toHaveBeenCalled();
  });
});
