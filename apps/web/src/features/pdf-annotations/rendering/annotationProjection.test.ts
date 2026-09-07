import { describe, expect, it } from 'vitest';

import { degrees, PDFDocument } from 'pdf-lib';

import {
  pdfPointToViewportPoint,
  type CoordinateViewport,
} from '../geometry/coordinateTransforms';
import { projectAnnotation, translateAnnotation } from './annotationProjection';

type PromiseWithTry = typeof Promise & {
  try?: <T>(callback: () => T | PromiseLike<T>) => Promise<T>;
};

const promiseWithTry = Promise as PromiseWithTry;
if (!promiseWithTry.try) {
  promiseWithTry.try = <T>(callback: () => T | PromiseLike<T>) =>
    Promise.resolve().then(callback);
}

const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');

async function createPage(rotation?: 0 | 90 | 180 | 270) {
  const document = await PDFDocument.create();
  const page = document.addPage([600, 800]);
  if (rotation) {
    page.setRotation(degrees(rotation));
  }
  const bytes = await document.save();
  const loadingTask = getDocument({ data: bytes });
  const pdf = await loadingTask.promise;
  const pdfPage = await pdf.getPage(1);

  return {
    getViewport(scale: number, totalRotation: 0 | 90 | 180 | 270) {
      return pdfPage.getViewport({
        scale,
        rotation: totalRotation,
      }) as CoordinateViewport;
    },
    async destroy() {
      pdfPage.cleanup();
      await loadingTask.destroy();
    },
  };
}

describe('annotation projection', () => {
  it('projects boxes through every display rotation', async () => {
    const fixture = await createPage();

    try {
      for (const rotation of [0, 90, 180, 270] as const) {
        const viewport = fixture.getViewport(1, rotation);
        const annotation = {
          id: `rectangle-${rotation}`,
          workspacePageId: 'page-1',
          kind: 'rectangle' as const,
          box: {
            origin: { x: 100, y: 200 },
            width: 120,
            height: 60,
            rotation: 0 as const,
          },
          stroke: null,
          fill: null,
        };
        const projection = projectAnnotation(annotation, viewport);

        expect(projection.kind).toBe('box');
        if (projection.kind !== 'box') {
          continue;
        }
        expect(projection.bounds.width).toBeCloseTo(
          rotation === 90 || rotation === 270 ? 60 : 120,
          6,
        );
        expect(projection.bounds.height).toBeCloseTo(
          rotation === 90 || rotation === 270 ? 120 : 60,
          6,
        );
      }
    } finally {
      await fixture.destroy();
    }
  });

  it('preserves canonical point geometry for intrinsic rotation plus page delta', async () => {
    const fixture = await createPage(90);

    try {
      const viewport = fixture.getViewport(1, 180);
      const annotation = {
        id: 'line-1',
        workspacePageId: 'page-1',
        kind: 'line' as const,
        start: { x: 500, y: 200 },
        end: { x: 550, y: 200 },
        stroke: {
          color: { r: 0, g: 0, b: 0 },
          widthUserUnits: 2,
          opacity: 1,
        },
      };
      const projection = projectAnnotation(annotation, viewport);
      expect(projection.kind).toBe('line');
      if (projection.kind !== 'line') {
        return;
      }
      expect(projection.points[0]).toEqual(
        pdfPointToViewportPoint(annotation.start, viewport),
      );
      expect(projection.points[1]).toEqual(
        pdfPointToViewportPoint(annotation.end, viewport),
      );
    } finally {
      await fixture.destroy();
    }
  });

  it('translates annotations immutably in canonical PDF coordinates', () => {
    const annotation = {
      id: 'freehand-1',
      workspacePageId: 'page-1',
      kind: 'freehand' as const,
      points: [
        { x: 10, y: 20 },
        { x: 15, y: 25 },
      ] as const,
      stroke: {
        color: { r: 1, g: 0, b: 0 },
        widthUserUnits: 3,
        opacity: 0.8,
      },
    };

    const translated = translateAnnotation(annotation, { x: 7, y: -4 });
    expect(translated).not.toBe(annotation);
    expect(translated).toMatchObject({
      points: [
        { x: 17, y: 16 },
        { x: 22, y: 21 },
      ],
    });
    expect(annotation.points[0]).toEqual({ x: 10, y: 20 });
  });
});
