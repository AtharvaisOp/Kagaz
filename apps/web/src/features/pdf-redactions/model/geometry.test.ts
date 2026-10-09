import { degrees, PDFDocument, PDFName, PDFNumber } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import {
  boxWithinPage,
  clientToRedactionPoint,
  moveRedactionBox,
  projectRedactionBox,
  redactionBoxFromPoints,
  viewportPageBounds,
} from './geometry';

type PromiseWithTry = typeof Promise & {
  try?: <T>(callback: () => T | PromiseLike<T>) => Promise<T>;
};
const promiseWithTry = Promise as PromiseWithTry;
if (!promiseWithTry.try)
  promiseWithTry.try = (callback) => Promise.resolve().then(callback);
const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');

describe('canonical redaction geometry', () => {
  it.each([0, 90, 180, 270] as const)(
    'preserves raw geometry with intrinsic 90 plus workspace rotation %s at every zoom/DPR/CSS scale',
    async (delta) => {
      const source = await PDFDocument.create();
      const sourcePage = source.addPage([600, 800]);
      sourcePage.setMediaBox(10, 20, 600, 800);
      sourcePage.setCropBox(30, 50, 540, 720);
      sourcePage.setRotation(degrees(90));
      sourcePage.node.set(PDFName.of('UserUnit'), PDFNumber.of(2));
      const loadingTask = getDocument({ data: await source.save() });
      const document = await loadingTask.promise;
      const page = await document.getPage(1);
      try {
        const box = { x: 100, y: 200, width: 180, height: 35 };
        for (const zoom of [0.5, 1, 1.5, 2]) {
          const viewport = page.getViewport({
            scale: zoom,
            rotation: (90 + delta) % 360,
          });
          const projected = projectRedactionBox(box, viewport);
          for (const cssScale of [0.5, 1, 2]) {
            const css = {
              left: 83,
              top: -200,
              width: viewport.width * cssScale,
              height: viewport.height * cssScale,
            };
            const start = clientToRedactionPoint(
              {
                x: css.left + projected.x * cssScale,
                y: css.top + projected.y * cssScale,
              },
              css,
              viewport,
            );
            const end = clientToRedactionPoint(
              {
                x: css.left + (projected.x + projected.width) * cssScale,
                y: css.top + (projected.y + projected.height) * cssScale,
              },
              css,
              viewport,
            );
            const roundTrip = redactionBoxFromPoints(start, end);
            for (const key of ['x', 'y', 'width', 'height'] as const)
              expect(roundTrip[key]).toBeCloseTo(box[key], 7);
          }
          expect(viewportPageBounds(viewport)).toEqual({
            x: 30,
            y: 50,
            width: 540,
            height: 720,
          });
        }
      } finally {
        page.cleanup();
        await loadingTask.destroy();
      }
    },
  );

  it('permits exact page edges, tiny positive regions and clamps movement', () => {
    const bounds = { x: -10, y: 30, width: 600, height: 800 };
    expect(boxWithinPage(bounds, bounds)).toBe(true);
    expect(
      boxWithinPage(
        { x: 589.99, y: 829.99, width: 0.01, height: 0.01 },
        bounds,
      ),
    ).toBe(true);
    expect(boxWithinPage({ x: -11, y: 30, width: 1, height: 1 }, bounds)).toBe(
      false,
    );
    expect(boxWithinPage({ x: 0, y: 40, width: 0, height: 1 }, bounds)).toBe(
      false,
    );
    const box = { x: 0, y: 40, width: 20, height: 20 };
    expect(moveRedactionBox(box, -500, 5000, bounds)).toEqual({
      ...box,
      x: -10,
      y: 810,
    });
  });
});
