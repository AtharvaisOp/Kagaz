import { describe, expect, it } from 'vitest';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { PDFDocument, PDFName, PDFNumber } from 'pdf-lib';
import { selectionRectToPdfBox } from './textSelection';
import { pdfOrientedBoxToViewportQuad } from '../pdf-annotations/geometry/coordinateTransforms';
import { annotationReducer } from '../pdf-annotations/model/reducer';
import { createAnnotationHistoryState } from '../pdf-annotations/model/history';
import type { HighlightAnnotation } from '../pdf-annotations/model/types';

async function makePage(userUnit = 2) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([600, 800]);
  page.setMediaBox(-10, 20, 600, 800);
  page.node.set(PDFName.of('UserUnit'), PDFNumber.of(userUnit));
  const task = getDocument({ data: await pdf.save() });
  const document = await task.promise;
  return { page: await document.getPage(1), destroy: () => task.destroy() };
}

describe('native text selection geometry and history', () => {
  for (const rotation of [0, 90, 180, 270]) {
    it(`round trips CSS selection at rotation ${rotation}, zoom, user unit and cropped origin`, async () => {
      const fixture = await makePage();
      const viewport = fixture.page.getViewport({ scale: 1.5, rotation });
      const surface = {
        left: 80,
        top: -270,
        width: viewport.width / 2,
        height: viewport.height / 2,
      };
      const rect = { left: 120, top: -210, width: 100, height: 12 };
      const box = selectionRectToPdfBox(rect, surface, viewport)!;
      const quad = pdfOrientedBoxToViewportQuad(box, viewport);
      expect(Math.min(...quad.map((point) => point.x))).toBeCloseTo(80);
      expect(Math.min(...quad.map((point) => point.y))).toBeCloseTo(120);
      expect(Math.max(...quad.map((point) => point.x))).toBeCloseTo(280);
      expect(Math.max(...quad.map((point) => point.y))).toBeCloseTo(144);
      await fixture.destroy();
    });
  }
  it('clips at page bounds and ignores collapsed or outside fragments', async () => {
    const fixture = await makePage(1);
    const viewport = fixture.page.getViewport({ scale: 1, rotation: 0 });
    const surface = { left: 0, top: 0, width: 600, height: 800 };
    expect(
      selectionRectToPdfBox(
        { left: -10, top: 0, width: 20, height: 10 },
        surface,
        viewport,
      )?.width,
    ).toBe(10);
    expect(
      selectionRectToPdfBox(
        { left: 601, top: 0, width: 20, height: 10 },
        surface,
        viewport,
      ),
    ).toBeNull();
    expect(
      selectionRectToPdfBox(
        { left: 1, top: 1, width: 0, height: 10 },
        surface,
        viewport,
      ),
    ).toBeNull();
    await fixture.destroy();
  });
  it('undoes and redoes a multiline highlight in a single transaction', () => {
    const annotations: HighlightAnnotation[] = [1, 2, 3].map((index) => ({
      id: `line-${index}`,
      workspacePageId: 'duplicate-page-id',
      kind: 'highlight',
      box: {
        origin: { x: 40, y: 600 - index * 20 },
        width: 120,
        height: 14,
        rotation: 0,
      },
      fill: { color: { r: 1, g: 0.8, b: 0.1 }, opacity: 0.35 },
    }));
    const initial = createAnnotationHistoryState();
    const added = annotationReducer(initial, {
      type: 'ADD_ANNOTATIONS',
      annotations,
    });
    expect(added.past).toHaveLength(1);
    expect(added.present.byPage['duplicate-page-id']).toHaveLength(3);
    const undone = annotationReducer(added, { type: 'UNDO' });
    expect(undone.present).toEqual(initial.present);
    expect(annotationReducer(undone, { type: 'REDO' }).present).toEqual(
      added.present,
    );
  });
});
