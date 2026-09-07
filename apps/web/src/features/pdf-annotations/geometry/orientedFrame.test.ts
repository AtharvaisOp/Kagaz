import { describe, expect, it } from 'vitest';
import { degrees, PDFDocument } from 'pdf-lib';

import {
  projectPdfBoxToOrientedFrame,
  viewportOrientedFrameToPdfBox,
} from './orientedFrame';
import type { CoordinateViewport } from './coordinateTransforms';

type PromiseWithTry = typeof Promise & {
  try?: <T>(callback: () => T | PromiseLike<T>) => Promise<T>;
};
const promiseWithTry = Promise as PromiseWithTry;
promiseWithTry.try ??= <T>(callback: () => T | PromiseLike<T>) =>
  Promise.resolve().then(callback);
const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');

describe('oriented viewport frames', () => {
  it('projects exact text-editor frames at every cardinal page rotation', async () => {
    const source = await PDFDocument.create();
    source.addPage([600, 800]);
    const loadingTask = getDocument({ data: await source.save() });
    const pdf = await loadingTask.promise;
    const page = await pdf.getPage(1);
    const box = {
      origin: { x: 100, y: 200 },
      width: 120,
      height: 50,
      rotation: 0 as const,
    };
    const expected = {
      0: { x: 100, y: 550, angle: 0 },
      90: { x: 250, y: 100, angle: 90 },
      180: { x: 500, y: 250, angle: 180 },
      270: { x: 550, y: 500, angle: -90 },
    } as const;
    try {
      for (const rotation of [0, 90, 180, 270] as const) {
        const frame = projectPdfBoxToOrientedFrame(
          box,
          page.getViewport({ scale: 1, rotation }),
        );
        expect(frame.x).toBeCloseTo(expected[rotation].x, 6);
        expect(frame.y).toBeCloseTo(expected[rotation].y, 6);
        expect(frame.width).toBeCloseTo(box.width, 6);
        expect(frame.height).toBeCloseTo(box.height, 6);
        expect(frame.angle).toBeCloseTo(expected[rotation].angle, 6);
      }
      expect(box).toEqual({
        origin: { x: 100, y: 200 },
        width: 120,
        height: 50,
        rotation: 0,
      });
    } finally {
      page.cleanup();
      await loadingTask.destroy();
    }
  });

  it('uses the combined intrinsic 90 and workspace 90 rotation once', async () => {
    const source = await PDFDocument.create();
    const sourcePage = source.addPage([600, 800]);
    sourcePage.setRotation(degrees(90));
    const loadingTask = getDocument({ data: await source.save() });
    const pdf = await loadingTask.promise;
    const page = await pdf.getPage(1);
    try {
      expect(page.rotate).toBe(90);
      const frame = projectPdfBoxToOrientedFrame(
        {
          origin: { x: 100, y: 200 },
          width: 120,
          height: 50,
          rotation: 0,
        },
        page.getViewport({ scale: 1, rotation: 180 }),
      );
      expect(frame).toMatchObject({ x: 500, y: 250, width: 120, height: 50 });
      expect(frame.angle).toBeCloseTo(180, 6);
    } finally {
      page.cleanup();
      await loadingTask.destroy();
    }
  });

  it('round-trips text/image boxes at all page and annotation rotations', async () => {
    const source = await PDFDocument.create();
    source.addPage([600, 800]);
    const loadingTask = getDocument({ data: await source.save() });
    const pdf = await loadingTask.promise;
    const page = await pdf.getPage(1);
    try {
      for (const pageRotation of [0, 90, 180, 270] as const) {
        const viewport = page.getViewport({
          scale: 1.35,
          rotation: pageRotation,
        }) as CoordinateViewport;
        for (const boxRotation of [0, 90, 180, 270] as const) {
          const box = {
            origin: { x: 260, y: 360 },
            width: 120,
            height: 54,
            rotation: boxRotation,
          };
          const frame = projectPdfBoxToOrientedFrame(box, viewport);
          const restored = viewportOrientedFrameToPdfBox(frame, viewport);
          expect(restored?.rotation).toBe(boxRotation);
          expect(restored?.origin.x).toBeCloseTo(box.origin.x, 6);
          expect(restored?.origin.y).toBeCloseTo(box.origin.y, 6);
          expect(restored?.width).toBeCloseTo(box.width, 6);
          expect(restored?.height).toBeCloseTo(box.height, 6);
        }
      }
    } finally {
      page.cleanup();
      await loadingTask.destroy();
    }
  });
});
