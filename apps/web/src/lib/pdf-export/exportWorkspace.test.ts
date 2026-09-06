import { describe, expect, it, vi } from 'vitest';

import { parsePageRange } from '../../features/pdf-workspace/model/rangeParser';
import { exportWorkspace } from './exportWorkspace';
import type { ExportSource } from './types';

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

describe('exportWorkspace', () => {
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
      sources: new Map([
        ['a', source('a', a)],
        ['b', source('b', b)],
      ]),
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

  it('loads each source once and supports duplicate logical page occurrences', async () => {
    const file = await makePdf('same.pdf', [{ width: 201, height: 202 }]);
    const spy = vi.spyOn(file, 'arrayBuffer');
    const result = await exportWorkspace({
      pages: [page('first', 'same', 0), page('second', 'same', 0)],
      sources: new Map([['same', source('same', file)]]),
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
      sources: new Map([['rotated', source('rotated', file)]]),
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
      sources: new Map([['source', source('source', file)]]),
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
        sources: new Map(),
      }),
    ).rejects.toMatchObject({ code: 'missing-source' });
  });

  it('honors cancellation before doing export work', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      exportWorkspace(
        { pages: [page('p', 'source', 0)], sources: new Map() },
        { signal: controller.signal },
      ),
    ).rejects.toMatchObject({ code: 'aborted' });
  });
});
