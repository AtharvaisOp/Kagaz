import { describe, expect, it } from 'vitest';

import { degrees, PDFDocument, PDFName, PDFNumber } from 'pdf-lib';

import {
  clientPointToViewportPoint,
  pdfOrientedBoxToCorners,
  pdfOrientedBoxToViewportQuad,
  pdfPointToViewportPoint,
  pdfUserLengthToViewportPixels,
  viewportPixelsToPdfUserLength,
  viewportPointToPdfPoint,
  viewportRectToPdfOrientedBox,
} from './coordinateTransforms';

import type { CoordinateViewport } from './coordinateTransforms';

type PromiseWithTry = typeof Promise & {
  try?: <T>(callback: () => T | PromiseLike<T>) => Promise<T>;
};

const promiseWithTry = Promise as PromiseWithTry;
if (!promiseWithTry.try) {
  promiseWithTry.try = <T>(callback: () => T | PromiseLike<T>) =>
    Promise.resolve().then(callback);
}

const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');

async function createPdfPage(options: {
  readonly media: readonly [number, number, number, number];
  readonly crop: readonly [number, number, number, number];
  readonly userUnit: number;
  readonly rotation?: 0 | 90 | 180 | 270;
}): Promise<{
  getViewport: (
    scale: number,
    rotation: 0 | 90 | 180 | 270,
  ) => CoordinateViewport;
  destroy: () => Promise<void>;
}> {
  const document = await PDFDocument.create();
  const page = document.addPage([600, 800]);
  page.setMediaBox(
    options.media[0],
    options.media[1],
    options.media[2] - options.media[0],
    options.media[3] - options.media[1],
  );
  page.setCropBox(
    options.crop[0],
    options.crop[1],
    options.crop[2] - options.crop[0],
    options.crop[3] - options.crop[1],
  );
  page.node.set(PDFName.of('UserUnit'), PDFNumber.of(options.userUnit));
  if (options.rotation) {
    page.setRotation(degrees(options.rotation));
  }

  const bytes = await document.save();
  const loadingTask = getDocument({ data: bytes });
  const pdf = await loadingTask.promise;
  const pdfPage = await pdf.getPage(1);
  return {
    getViewport: (scale, rotation) => pdfPage.getViewport({ scale, rotation }),
    destroy: async () => {
      pdfPage.cleanup();
      await loadingTask.destroy();
    },
  };
}

describe('PDF coordinate transforms', () => {
  it('round-trips points through actual PDF.js viewports at every rotation and zoom', async () => {
    const fixture = await createPdfPage({
      media: [10, 20, 610, 820],
      crop: [-20, 50, 180, 950],
      userUnit: 2,
    });

    try {
      expect(fixture.getViewport(1, 0).viewBox).toEqual([10, 50, 180, 820]);
      expect(fixture.getViewport(1, 0).userUnit).toBe(2);
      for (const rotation of [0, 90, 180, 270] as const) {
        for (const scale of [0.5, 1, 2]) {
          const viewport = fixture.getViewport(scale, rotation);
          const pdfPoint = { x: 110, y: 220 };
          const viewportPoint = pdfPointToViewportPoint(pdfPoint, viewport);
          const roundTrip = viewportPointToPdfPoint(viewportPoint, viewport);
          expect(roundTrip.x).toBeCloseTo(pdfPoint.x, 6);
          expect(roundTrip.y).toBeCloseTo(pdfPoint.y, 6);
        }
      }
    } finally {
      await fixture.destroy();
    }
  });

  it('uses overlay bounds rather than backing-canvas dimensions for pointers', async () => {
    const fixture = await createPdfPage({
      media: [0, 0, 600, 800],
      crop: [0, 0, 600, 800],
      userUnit: 1,
    });

    try {
      const point = clientPointToViewportPoint(
        { x: 150, y: 250 },
        { left: 50, top: 50, width: 200, height: 400 },
        fixture.getViewport(1, 0),
      );
      const viewport = fixture.getViewport(1, 0);
      expect(point.x).toBeCloseTo(viewport.width / 2, 6);
      expect(point.y).toBeCloseTo(viewport.height / 2, 6);
    } finally {
      await fixture.destroy();
    }
  });

  it('includes UserUnit in scalar conversion without changing canonical coordinates', async () => {
    const fixture = await createPdfPage({
      media: [0, 0, 600, 800],
      crop: [0, 0, 600, 800],
      userUnit: 2,
    });

    try {
      const viewport = fixture.getViewport(1, 0);
      const pixels = pdfUserLengthToViewportPixels(10, viewport);
      expect(viewportPixelsToPdfUserLength(pixels, viewport)).toBeCloseTo(
        10,
        8,
      );
      expect(pixels).toBeCloseTo(20, 8);
    } finally {
      await fixture.destroy();
    }
  });

  it('round-trips oriented boxes through viewport projections', async () => {
    const fixture = await createPdfPage({
      media: [0, 0, 600, 800],
      crop: [0, 0, 600, 800],
      userUnit: 1,
    });

    try {
      for (const rotation of [0, 90, 180, 270] as const) {
        const box = {
          origin: { x: 200, y: 300 },
          width: 100,
          height: 50,
          rotation,
        } as const;
        const quad = pdfOrientedBoxToViewportQuad(
          box,
          fixture.getViewport(1, rotation),
        );
        const rect = {
          x: Math.min(...quad.map((point) => point.x)),
          y: Math.min(...quad.map((point) => point.y)),
          width:
            Math.max(...quad.map((point) => point.x)) -
            Math.min(...quad.map((point) => point.x)),
          height:
            Math.max(...quad.map((point) => point.y)) -
            Math.min(...quad.map((point) => point.y)),
        };
        const reconstructed = viewportRectToPdfOrientedBox(
          rect,
          fixture.getViewport(1, rotation),
        );
        const originalCorners = pdfOrientedBoxToCorners(box);
        const reconstructedCorners = pdfOrientedBoxToCorners(reconstructed);
        expect(reconstructed.rotation).toBe(box.rotation);
        expect(reconstructed.width).toBeCloseTo(box.width, 6);
        expect(reconstructed.height).toBeCloseTo(box.height, 6);
        expect(reconstructed.origin.x).toBeCloseTo(box.origin.x, 6);
        expect(reconstructed.origin.y).toBeCloseTo(box.origin.y, 6);
        expect(reconstructedCorners).toEqual(originalCorners);
      }
    } finally {
      await fixture.destroy();
    }
  });

  it('keeps canonical geometry stable for intrinsic 90 plus delta 90', async () => {
    const fixture = await createPdfPage({
      media: [0, 0, 600, 800],
      crop: [0, 0, 600, 800],
      userUnit: 1,
      rotation: 90,
    });

    try {
      const viewport = fixture.getViewport(1, 180);
      const canonical = { x: 500, y: 200 };
      const display = pdfPointToViewportPoint(canonical, viewport);
      expect(display.x).toBeCloseTo(100, 6);
      expect(display.y).toBeCloseTo(200, 6);
      expect(viewportPointToPdfPoint(display, viewport)).toEqual(canonical);
    } finally {
      await fixture.destroy();
    }
  });

  it('handles landscape and nonstandard page dimensions', async () => {
    const fixture = await createPdfPage({
      media: [-40, 10, 1110, 410],
      crop: [-20, 20, 1000, 380],
      userUnit: 1,
    });

    try {
      const viewport = fixture.getViewport(2, 270);
      const canonical = { x: 400, y: 200 };
      expect(
        viewportPointToPdfPoint(
          pdfPointToViewportPoint(canonical, viewport),
          viewport,
        ),
      ).toEqual(canonical);
    } finally {
      await fixture.destroy();
    }
  });
});
