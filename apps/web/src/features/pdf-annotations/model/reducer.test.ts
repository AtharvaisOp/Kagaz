import { describe, expect, it } from 'vitest';

import {
  addAnnotation,
  createEmptyAnnotationDocument,
  deleteAnnotation,
  getPageAnnotations,
  reorderAnnotation,
  updateAnnotation,
} from './operations';
import {
  createAnnotationHistoryState,
  MAX_ANNOTATION_HISTORY,
} from './history';
import { annotationReducer } from './reducer';
import { isAnnotationDocument, validateAnnotation } from './validation';

import type { PdfAnnotation } from './types';

const pageA = 'page-a';
const pageB = 'page-b';

const text: PdfAnnotation = {
  id: 'text-1',
  workspacePageId: pageA,
  kind: 'text',
  box: { origin: { x: 10, y: 20 }, width: 100, height: 30, rotation: 0 },
  text: 'Hello',
  fontFamily: 'helvetica',
  fontSizeUserUnits: 12,
  lineHeight: 1.2,
  align: 'left',
  color: { r: 1, g: 1, b: 1 },
  opacity: 1,
};

const highlight: PdfAnnotation = {
  id: 'highlight-1',
  workspacePageId: pageA,
  kind: 'highlight',
  box: { origin: { x: 20, y: 40 }, width: 80, height: 12, rotation: 90 },
  fill: { color: { r: 1, g: 0.8, b: 0 }, opacity: 0.35 },
};

const freehand: PdfAnnotation = {
  id: 'freehand-1',
  workspacePageId: pageB,
  kind: 'freehand',
  points: [
    { x: 1, y: 1 },
    { x: 2, y: 2 },
  ],
  stroke: {
    color: { r: 0, g: 1, b: 1 },
    widthUserUnits: 2,
    opacity: 1,
  },
};

const rectangle: PdfAnnotation = {
  id: 'rectangle-1',
  workspacePageId: pageA,
  kind: 'rectangle',
  box: { origin: { x: 0, y: 0 }, width: 20, height: 20, rotation: 180 },
  stroke: {
    color: { r: 1, g: 0, b: 0 },
    widthUserUnits: 1,
    opacity: 1,
  },
  fill: null,
};

const ellipse: PdfAnnotation = {
  id: 'ellipse-1',
  workspacePageId: pageA,
  kind: 'ellipse',
  box: { origin: { x: 5, y: 5 }, width: 30, height: 15, rotation: 270 },
  stroke: null,
  fill: { color: { r: 0, g: 0, b: 1 }, opacity: 0.5 },
};

const line: PdfAnnotation = {
  id: 'line-1',
  workspacePageId: pageB,
  kind: 'line',
  start: { x: 1, y: 2 },
  end: { x: 30, y: 40 },
  stroke: {
    color: { r: 1, g: 1, b: 1 },
    widthUserUnits: 1,
    opacity: 0.8,
  },
};

const image: PdfAnnotation = {
  id: 'image-1',
  workspacePageId: pageB,
  kind: 'image',
  box: { origin: { x: 2, y: 3 }, width: 40, height: 50, rotation: 90 },
  assetId: 'asset-1',
  opacity: 1,
};

describe('annotation validation', () => {
  it('accepts every Phase 2 annotation kind', () => {
    for (const annotation of [
      text,
      highlight,
      freehand,
      rectangle,
      ellipse,
      line,
      image,
    ]) {
      expect(() => validateAnnotation(annotation)).not.toThrow();
    }
  });

  it('rejects invalid geometry, style, and path data', () => {
    expect(() =>
      validateAnnotation({ ...text, box: { ...text.box, width: 0 } }),
    ).toThrow(RangeError);
    expect(() =>
      validateAnnotation({
        ...text,
        color: { r: 2, g: 0, b: 0 },
      }),
    ).toThrow(RangeError);
    expect(() =>
      validateAnnotation({ ...freehand, points: [{ x: 1, y: 1 }] }),
    ).toThrow(RangeError);
    expect(() =>
      validateAnnotation({
        ...rectangle,
        box: { ...rectangle.box, rotation: 45 },
      }),
    ).toThrow(RangeError);
  });

  it('requires annotation page IDs to match the containing page map', () => {
    expect(
      isAnnotationDocument({
        byPage: { [pageA]: [{ ...text, workspacePageId: pageB }] },
      }),
    ).toBe(false);
  });
});

describe('annotation operations', () => {
  it('adds, looks up, updates, deletes, and reorders by stable ID', () => {
    let document = createEmptyAnnotationDocument();
    document = addAnnotation(document, text);
    document = addAnnotation(document, highlight);
    document = addAnnotation(document, rectangle);

    expect(getPageAnnotations(document, pageA).map((item) => item.id)).toEqual([
      text.id,
      highlight.id,
      rectangle.id,
    ]);
    expect(addAnnotation(document, text)).toBe(document);

    const updated = updateAnnotation(document, pageA, text.id, {
      text: 'Updated',
    });
    expect(getPageAnnotations(updated, pageA)[0]).toMatchObject({
      text: 'Updated',
    });

    const reordered = reorderAnnotation(updated, pageA, rectangle.id, 0);
    expect(getPageAnnotations(reordered, pageA).map((item) => item.id)).toEqual(
      [rectangle.id, text.id, highlight.id],
    );

    const deleted = deleteAnnotation(reordered, pageA, text.id);
    expect(getPageAnnotations(deleted, pageA).map((item) => item.id)).toEqual([
      rectangle.id,
      highlight.id,
    ]);
    expect(deleteAnnotation(deleted, pageA, 'missing')).toBe(deleted);
  });

  it('preserves untouched page arrays', () => {
    let document = createEmptyAnnotationDocument();
    document = addAnnotation(document, text);
    document = addAnnotation(document, freehand);
    const pageBArray = getPageAnnotations(document, pageB);
    const next = updateAnnotation(document, pageA, text.id, {
      text: 'Changed',
    });

    expect(getPageAnnotations(next, pageB)).toBe(pageBArray);
  });
});

describe('annotation history reducer', () => {
  it('supports edits, undo/redo, redo invalidation, and baseline dirty semantics', () => {
    let state = createAnnotationHistoryState();
    state = annotationReducer(state, {
      type: 'ADD_ANNOTATION',
      annotation: text,
    });
    expect(state.dirty).toBe(true);
    expect(state.past).toHaveLength(1);

    state = annotationReducer(state, { type: 'UNDO' });
    expect(state.dirty).toBe(false);
    expect(state.future).toHaveLength(1);

    state = annotationReducer(state, { type: 'REDO' });
    expect(state.dirty).toBe(true);

    state = annotationReducer(state, {
      type: 'UPDATE_ANNOTATION',
      pageId: pageA,
      annotationId: text.id,
      update: { text: 'Edited again' },
    });
    expect(state.future).toHaveLength(0);

    state = annotationReducer(state, { type: 'UNDO' });
    state = annotationReducer(state, { type: 'UNDO' });
    expect(state.dirty).toBe(false);
  });

  it('bounds committed history at 100 entries', () => {
    let state = createAnnotationHistoryState();
    for (let index = 0; index < MAX_ANNOTATION_HISTORY + 20; index += 1) {
      const annotation: PdfAnnotation = {
        ...text,
        id: `text-${index}`,
        text: String(index),
      };
      state = annotationReducer(state, { type: 'ADD_ANNOTATION', annotation });
    }
    expect(state.past).toHaveLength(MAX_ANNOTATION_HISTORY);
  });
});
