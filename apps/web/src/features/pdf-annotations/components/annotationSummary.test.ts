import { describe, expect, it } from 'vitest';

import {
  adjacentAnnotationIdAfterDelete,
  annotationsForCurrentPage,
  annotationSummaryLabel,
  canResizeAnnotation,
  canResizeAnnotationByKeyboard,
  MIN_ANNOTATION_BOX_SIZE_USER_UNITS,
  moveAnnotationByKeyboard,
  resizeAnnotationByKeyboard,
} from './annotationSummary';
import type { PdfAnnotation } from '../model/types';
import { createAnnotationHistoryState } from '../model/history';
import { annotationReducer } from '../model/reducer';

const box = {
  origin: { x: 10, y: 20 },
  width: 100,
  height: 50,
  rotation: 0 as const,
};
const rectangle: PdfAnnotation = {
  id: 'rectangle-id',
  workspacePageId: 'page-1',
  kind: 'rectangle',
  box,
  stroke: {
    color: { r: 0, g: 0, b: 0 },
    widthUserUnits: 2,
    opacity: 1,
  },
  fill: null,
};

describe('annotation summary labels', () => {
  it('uses readable labels without exposing internal ids', () => {
    expect(
      annotationSummaryLabel({
        id: 'secret-id',
        workspacePageId: 'page-1',
        kind: 'text',
        box: {
          origin: { x: 0, y: 0 },
          width: 10,
          height: 10,
          rotation: 0,
        },
        text: '  Hello   world  ',
        fontFamily: 'helvetica',
        fontSizeUserUnits: 12,
        lineHeight: 1.2,
        align: 'left',
        color: { r: 0, g: 0, b: 0 },
        opacity: 1,
      }),
    ).toBe('Hello world');
    expect(
      annotationSummaryLabel(
        {
          id: 'secret-image',
          workspacePageId: 'page-1',
          kind: 'image',
          box: {
            origin: { x: 0, y: 0 },
            width: 10,
            height: 10,
            rotation: 0,
          },
          assetId: 'asset-1',
          opacity: 1,
        },
        null,
      ),
    ).toBe('Image');
  });
});

describe('semantic annotation operations', () => {
  it('filters the semantic list to the current page in z-order', () => {
    const second = { ...rectangle, id: 'second' };
    const otherPage = {
      ...rectangle,
      id: 'other-page',
      workspacePageId: 'page-2',
    };
    expect(
      annotationsForCurrentPage([rectangle, otherPage, second], 'page-1').map(
        (annotation) => annotation.id,
      ),
    ).toEqual(['rectangle-id', 'second']);
  });

  it('moves box, line, and freehand geometry in canonical PDF units', () => {
    expect(moveAnnotationByKeyboard(rectangle, 'left')).toMatchObject({
      box: { origin: { x: 5, y: 20 } },
    });
    expect(moveAnnotationByKeyboard(rectangle, 'up')).toMatchObject({
      box: { origin: { x: 10, y: 25 } },
    });

    const line: PdfAnnotation = {
      id: 'line-id',
      workspacePageId: 'page-1',
      kind: 'line',
      start: { x: 1, y: 2 },
      end: { x: 3, y: 4 },
      stroke: rectangle.stroke ?? {
        color: { r: 0, g: 0, b: 0 },
        widthUserUnits: 2,
        opacity: 1,
      },
    };
    expect(moveAnnotationByKeyboard(line, 'right')).toMatchObject({
      start: { x: 6, y: 2 },
      end: { x: 8, y: 4 },
    });

    const freehand: PdfAnnotation = {
      ...line,
      id: 'freehand-id',
      kind: 'freehand',
      points: [line.start, line.end],
    };
    expect(moveAnnotationByKeyboard(freehand, 'down')).toMatchObject({
      points: [
        { x: 1, y: -3 },
        { x: 3, y: -1 },
      ],
    });
  });

  it('resizes boxes without flips and leaves line/freehand resize disabled', () => {
    const atMinimum = {
      ...rectangle,
      box: {
        ...rectangle.box,
        width: MIN_ANNOTATION_BOX_SIZE_USER_UNITS,
      },
    };
    expect(resizeAnnotationByKeyboard(atMinimum, 'decrease-width')).toBe(
      atMinimum,
    );
    expect(canResizeAnnotationByKeyboard(atMinimum, 'decrease-width')).toBe(
      false,
    );
    expect(
      resizeAnnotationByKeyboard(rectangle, 'increase-height'),
    ).toMatchObject({ box: { width: 100, height: 55 } });

    const line: PdfAnnotation = {
      id: 'line-id',
      workspacePageId: 'page-1',
      kind: 'line',
      start: { x: 0, y: 0 },
      end: { x: 10, y: 10 },
      stroke: rectangle.stroke!,
    };
    expect(canResizeAnnotation(line)).toBe(false);
    expect(resizeAnnotationByKeyboard(line, 'increase-width')).toBe(line);
  });

  it('preserves image aspect ratio for every accessible size action', () => {
    const image: PdfAnnotation = {
      id: 'image-id',
      workspacePageId: 'page-1',
      kind: 'image',
      box: { ...box, width: 120, height: 60 },
      assetId: 'asset-id',
      opacity: 1,
    };
    for (const action of [
      'increase-width',
      'decrease-width',
      'increase-height',
      'decrease-height',
    ] as const) {
      const resized = resizeAnnotationByKeyboard(image, action);
      expect(resized.kind).toBe('image');
      if (resized.kind === 'image') {
        expect(resized.box.width / resized.box.height).toBe(2);
        expect(resized.box.width).toBeGreaterThanOrEqual(
          MIN_ANNOTATION_BOX_SIZE_USER_UNITS,
        );
        expect(resized.box.height).toBeGreaterThanOrEqual(
          MIN_ANNOTATION_BOX_SIZE_USER_UNITS,
        );
      }
    }
  });

  it('chooses predictable focus after deletion', () => {
    const annotations = [
      rectangle,
      { ...rectangle, id: 'second' },
      { ...rectangle, id: 'third' },
    ];
    expect(adjacentAnnotationIdAfterDelete(annotations, 1)).toBe('third');
    expect(adjacentAnnotationIdAfterDelete(annotations, 2)).toBe('second');
    expect(adjacentAnnotationIdAfterDelete([rectangle], 0)).toBeNull();
  });

  it('records each move, resize, layer, and delete action as one history edit', () => {
    const second = { ...rectangle, id: 'second' };
    let history = annotationReducer(createAnnotationHistoryState(), {
      type: 'ADD_ANNOTATION',
      annotation: rectangle,
    });
    history = annotationReducer(history, {
      type: 'ADD_ANNOTATION',
      annotation: second,
    });

    for (const next of [
      moveAnnotationByKeyboard(rectangle, 'right'),
      resizeAnnotationByKeyboard(rectangle, 'increase-width'),
    ]) {
      const before = history.past.length;
      history = annotationReducer(history, {
        type: 'REPLACE_ANNOTATION',
        annotation: next,
      });
      expect(history.past).toHaveLength(before + 1);
    }

    const beforeLayer = history.past.length;
    history = annotationReducer(history, {
      type: 'REORDER_ANNOTATION',
      pageId: 'page-1',
      annotationId: rectangle.id,
      toIndex: 1,
    });
    expect(history.past).toHaveLength(beforeLayer + 1);

    const beforeDelete = history.past.length;
    history = annotationReducer(history, {
      type: 'DELETE_ANNOTATION',
      pageId: 'page-1',
      annotationId: rectangle.id,
    });
    expect(history.past).toHaveLength(beforeDelete + 1);
  });
});
