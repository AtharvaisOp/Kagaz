import { describe, expect, it, vi } from 'vitest';

import { parsePageRange } from '../../features/pdf-workspace/model/rangeParser';
import { exportWorkspace } from './exportWorkspace';
import type { ExportSource } from './types';
import type { PdfAnnotation } from '../../features/pdf-annotations/model/types';
import type { FormExportSnapshot } from './forms/types';

const pdfLib = await import('pdf-lib');

async function makePdf(
  fileName: string,
  pages: readonly { width: number; height: number; rotation?: number }[],
): Promise<File> {
  const document = await pdfLib.PDFDocument.create();
  for (const pageSpec of pages) {
    const page = document.addPage([pageSpec.width, pageSpec.height]);
    if (pageSpec.rotation) page.setRotation(pdfLib.degrees(pageSpec.rotation));
  }
  const saved = await document.save();
  const buffer = new ArrayBuffer(saved.byteLength);
  new Uint8Array(buffer).set(saved);
  return new File([buffer], fileName, { type: 'application/pdf' });
}

function page(
  id: string,
  sourceDocumentId: string,
  sourcePageIndex: number,
  rotationDelta: 0 | 90 | 180 | 270 = 0,
) {
  return { id, sourceDocumentId, sourcePageIndex, rotationDelta } as const;
}

function source(id: string, file: File): ExportSource {
  return { id, file, fileName: file.name };
}

function plainForms(
  ...sourceDocumentIds: readonly string[]
): FormExportSnapshot {
  return {
    sources: [...new Set(sourceDocumentIds)].map((sourceDocumentId) => ({
      sourceDocumentId,
      capability: 'plain',
      fields: [],
    })),
    hasChangedTextDraft: false,
  };
}

describe('exportWorkspace', () => {
  it('flattens page-local vector, text, and image snapshots in request order', async () => {
    const sourceFile = await makePdf('annotated.pdf', [
      { width: 200, height: 200 },
    ]);
    const annotations: readonly PdfAnnotation[] = [
      {
        id: 'rectangle',
        workspacePageId: 'annotated-page',
        kind: 'rectangle',
        box: { origin: { x: 10, y: 10 }, width: 40, height: 30, rotation: 0 },
        stroke: null,
        fill: { color: { r: 1, g: 0, b: 0 }, opacity: 0.5 },
      },
      {
        id: 'text',
        workspacePageId: 'annotated-page',
        kind: 'text',
        box: { origin: { x: 20, y: 100 }, width: 100, height: 40, rotation: 0 },
        text: 'Exported',
        fontFamily: 'helvetica',
        fontSizeUserUnits: 12,
        lineHeight: 1.2,
        align: 'left',
        color: { r: 0, g: 0, b: 0 },
        opacity: 1,
      },
      {
        id: 'image',
        workspacePageId: 'annotated-page',
        kind: 'image',
        box: { origin: { x: 120, y: 20 }, width: 40, height: 40, rotation: 0 },
        assetId: 'asset-a',
        opacity: 1,
      },
    ];
    const pngBytes = Uint8Array.from(
      atob(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      ),
      (character) => character.charCodeAt(0),
    );

    const result = await exportWorkspace({
      pages: [page('annotated-page', 'source', 0)],
      forms: plainForms('source'),
      sources: new Map([['source', source('source', sourceFile)]]),
      annotationsByPage: new Map([['annotated-page', annotations]]),
      imageAssets: new Map([
        [
          'asset-a',
          { assetId: 'asset-a', mimeType: 'image/png', bytes: pngBytes },
        ],
      ]),
    });

    const output = await pdfLib.PDFDocument.load(result);
    expect(output.getPageCount()).toBe(1);
    expect(result.byteLength).toBeGreaterThan(sourceFile.size);
  });

  it('preserves specific annotation failures through the workspace boundary', async () => {
    const sourceFile = await makePdf('missing-image.pdf', [
      { width: 100, height: 100 },
    ]);
    await expect(
      exportWorkspace({
        pages: [page('page', 'source', 0)],
        forms: plainForms('source'),
        sources: new Map([['source', source('source', sourceFile)]]),
        annotationsByPage: new Map([
          [
            'page',
            [
              {
                id: 'image',
                workspacePageId: 'page',
                kind: 'image',
                box: {
                  origin: { x: 10, y: 10 },
                  width: 20,
                  height: 20,
                  rotation: 0,
                },
                assetId: 'missing',
                opacity: 1,
              },
            ],
          ],
        ]),
        imageAssets: new Map(),
      }),
    ).rejects.toMatchObject({ code: 'missing-image-asset' });
  });

  it('draws canonical annotations before applying intrinsic plus workspace rotation once', async () => {
    const sourceFile = await makePdf('rotated-annotated.pdf', [
      { width: 120, height: 80, rotation: 90 },
    ]);
    const result = await exportWorkspace({
      pages: [page('rotated-page', 'source', 0, 90)],
      forms: plainForms('source'),
      sources: new Map([['source', source('source', sourceFile)]]),
      annotationsByPage: new Map([
        [
          'rotated-page',
          [
            {
              id: 'line',
              workspacePageId: 'rotated-page',
              kind: 'line',
              start: { x: 10, y: 10 },
              end: { x: 80, y: 40 },
              stroke: {
                color: { r: 0, g: 0, b: 0 },
                widthUserUnits: 2,
                opacity: 1,
              },
            },
          ],
        ],
      ]),
      imageAssets: new Map(),
    });
    const output = await pdfLib.PDFDocument.load(result);
    expect(output.getPage(0)?.getRotation().angle).toBe(180);
  });

  it('exports multiple sources in exact logical order and omits deleted pages', async () => {
    const a = await makePdf('a.pdf', [
      { width: 201, height: 202 },
      { width: 203, height: 204 },
    ]);
    const b = await makePdf('b.pdf', [
      { width: 301, height: 302 },
      { width: 303, height: 304 },
    ]);
    const result = await exportWorkspace({
      pages: [page('b1', 'b', 0), page('a2', 'a', 1), page('b2', 'b', 1)],
      forms: plainForms('a', 'b'),
      sources: new Map([
        ['a', source('a', a)],
        ['b', source('b', b)],
      ]),
      annotationsByPage: new Map(),
      imageAssets: new Map(),
    });
    const output = await pdfLib.PDFDocument.load(result);
    expect(
      output.getPages().map((item) => [item.getWidth(), item.getHeight()]),
    ).toEqual([
      [301, 302],
      [203, 204],
      [303, 304],
    ]);
  });

  it('keeps annotations attached across a multi-PDF reordered merge', async () => {
    const a = await makePdf('annotated-a.pdf', [{ width: 110, height: 120 }]);
    const b = await makePdf('annotated-b.pdf', [{ width: 210, height: 220 }]);
    const line = (workspacePageId: string, id: string): PdfAnnotation => ({
      id,
      workspacePageId,
      kind: 'line',
      start: { x: 10, y: 10 },
      end: { x: 80, y: 60 },
      stroke: {
        color: { r: 0, g: 0, b: 0 },
        widthUserUnits: 2,
        opacity: 1,
      },
    });
    const result = await exportWorkspace({
      pages: [page('b-page', 'b', 0), page('a-page', 'a', 0)],
      forms: plainForms('a', 'b'),
      sources: new Map([
        ['a', source('a', a)],
        ['b', source('b', b)],
      ]),
      annotationsByPage: new Map([
        ['a-page', [line('a-page', 'a-line')]],
        ['b-page', [line('b-page', 'b-line')]],
      ]),
      imageAssets: new Map(),
    });
    const output = await pdfLib.PDFDocument.load(result);
    expect(output.getPages().map((item) => item.getWidth())).toEqual([
      210, 110,
    ]);
  });

  it('loads each source once and supports duplicate logical page occurrences', async () => {
    const file = await makePdf('same.pdf', [{ width: 201, height: 202 }]);
    const spy = vi.spyOn(file, 'arrayBuffer');
    const result = await exportWorkspace({
      pages: [page('first', 'same', 0), page('second', 'same', 0)],
      forms: plainForms('same'),
      sources: new Map([['same', source('same', file)]]),
      annotationsByPage: new Map(),
      imageAssets: new Map(),
    });
    const output = await pdfLib.PDFDocument.load(result);
    expect(spy).toHaveBeenCalledOnce();
    expect(output.getPageCount()).toBe(2);
  });

  it('composes intrinsic and user rotations with normalization', async () => {
    const file = await makePdf('rotated.pdf', [
      { width: 201, height: 202, rotation: 90 },
      { width: 203, height: 204, rotation: 270 },
    ]);
    const result = await exportWorkspace({
      pages: [page('one', 'rotated', 0, 90), page('two', 'rotated', 1, 90)],
      forms: plainForms('rotated'),
      sources: new Map([['rotated', source('rotated', file)]]),
      annotationsByPage: new Map(),
      imageAssets: new Map(),
    });
    const output = await pdfLib.PDFDocument.load(result);
    expect(output.getPages().map((item) => item.getRotation().angle)).toEqual([
      180, 0,
    ]);
  });

  it('reuses the range parser for ordered extraction snapshots', async () => {
    const file = await makePdf('extract.pdf', [
      { width: 201, height: 202 },
      { width: 202, height: 203 },
      { width: 203, height: 204 },
      { width: 204, height: 205 },
      { width: 205, height: 206 },
    ]);
    const pages = [0, 1, 2, 3, 4].map((index) =>
      page(`p${index}`, 'source', index),
    );
    const parsed = parsePageRange('3, 1-2', pages.length);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const selectedPages = parsed.indexes
      .map((index) => pages[index])
      .filter((item): item is (typeof pages)[number] => Boolean(item));
    const result = await exportWorkspace({
      pages: selectedPages,
      forms: plainForms('source'),
      sources: new Map([['source', source('source', file)]]),
      annotationsByPage: new Map(),
      imageAssets: new Map(),
    });
    const output = await pdfLib.PDFDocument.load(result);
    expect(output.getPages().map((item) => item.getWidth())).toEqual([
      203, 201, 202,
    ]);
  });

  it('fails safely when a required source is missing', async () => {
    await expect(
      exportWorkspace({
        pages: [page('missing', 'gone', 0)],
        forms: plainForms('gone'),
        sources: new Map(),
        annotationsByPage: new Map(),
        imageAssets: new Map(),
      }),
    ).rejects.toMatchObject({ code: 'missing-source' });
  });

  it('honors cancellation before doing export work', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      exportWorkspace(
        {
          pages: [page('p', 'source', 0)],
          forms: plainForms('source'),
          sources: new Map(),
          annotationsByPage: new Map(),
          imageAssets: new Map(),
        },
        { signal: controller.signal },
      ),
    ).rejects.toMatchObject({ code: 'aborted' });
  });

  it('honors cancellation after source loading before a stale download can be produced', async () => {
    const file = await makePdf('cancelled.pdf', [{ width: 100, height: 100 }]);
    const controller = new AbortController();
    await expect(
      exportWorkspace(
        {
          pages: [page('p', 'source', 0)],
          forms: plainForms('source'),
          sources: new Map([['source', source('source', file)]]),
          annotationsByPage: new Map(),
          imageAssets: new Map(),
        },
        {
          signal: controller.signal,
          onProgress: (progress) => {
            if (progress.phase === 'building') controller.abort();
          },
        },
      ),
    ).rejects.toMatchObject({ code: 'aborted' });
  });
});
