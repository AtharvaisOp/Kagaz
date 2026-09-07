import { describe, expect, it } from 'vitest';

import { applyAnnotationStyleDefaults } from '../model/annotationStyle';
import { DEFAULT_ANNOTATION_STYLE } from '../model/editorTypes';
import { createAnnotationHistoryState } from '../model/history';
import { annotationReducer } from '../model/reducer';
import type { AnnotationSelection, PdfAnnotation } from '../model/types';
import {
  beginOpacityInteraction,
  completeOpacityInteraction,
  IDLE_OPACITY_INTERACTION,
  isOpacityAdjustmentKey,
  sameAnnotationSelection,
  updateOpacityInteraction,
  type OpacityInteractionState,
} from './annotationStyleInteraction';

const selectionA: AnnotationSelection = {
  workspacePageId: 'page-1',
  annotationId: 'rectangle-1',
};
const selectionB: AnnotationSelection = {
  workspacePageId: 'page-1',
  annotationId: 'rectangle-2',
};
const rectangle: PdfAnnotation = {
  id: selectionA.annotationId,
  workspacePageId: selectionA.workspacePageId,
  kind: 'rectangle',
  box: { origin: { x: 10, y: 10 }, width: 80, height: 60, rotation: 0 },
  stroke: {
    color: DEFAULT_ANNOTATION_STYLE.strokeColor,
    widthUserUnits: DEFAULT_ANNOTATION_STYLE.strokeWidth,
    opacity: DEFAULT_ANNOTATION_STYLE.opacity,
  },
  fill: null,
};

function finish(state: OpacityInteractionState) {
  return completeOpacityInteraction(state);
}

describe('opacity interaction boundary', () => {
  it('turns many continuous inputs into one durable annotation edit', () => {
    let history = annotationReducer(createAnnotationHistoryState(), {
      type: 'ADD_ANNOTATION',
      annotation: rectangle,
    });
    const historyAfterCreation = history.past.length;
    let interaction = beginOpacityInteraction(selectionA, 0.35);
    for (const opacity of [0.4, 0.5, 0.65, 0.8]) {
      interaction = updateOpacityInteraction(interaction, selectionA, opacity);
    }

    const result = finish(interaction);
    expect(result.commit).toEqual({ target: selectionA, opacity: 0.8 });
    if (result.commit) {
      history = annotationReducer(history, {
        type: 'UPDATE_ANNOTATION',
        pageId: result.commit.target.workspacePageId,
        annotationId: result.commit.target.annotationId,
        update: (annotation) =>
          applyAnnotationStyleDefaults(annotation, {
            ...DEFAULT_ANNOTATION_STYLE,
            opacity: result.commit?.opacity ?? 0.35,
          }),
      });
    }

    expect(history.past).toHaveLength(historyAfterCreation + 1);
    history = annotationReducer(history, { type: 'UNDO' });
    expect(history.present.byPage['page-1']?.[0]).toEqual(rectangle);
  });

  it('produces no edit without a selection or without a value change', () => {
    let interaction = beginOpacityInteraction(null, 0.35);
    interaction = updateOpacityInteraction(interaction, null, 0.8);
    expect(finish(interaction).commit).toBeNull();
    expect(finish(beginOpacityInteraction(selectionA, 0.35)).commit).toBeNull();
  });

  it('makes duplicate completion signals idempotent', () => {
    const active = updateOpacityInteraction(
      beginOpacityInteraction(selectionA, 0.35),
      selectionA,
      0.8,
    );
    const first = finish(active);
    const second = finish(first.state);

    expect(first.commit).toEqual({ target: selectionA, opacity: 0.8 });
    expect(second.commit).toBeNull();
  });

  it('recognizes native range keyboard adjustments without capturing letters', () => {
    for (const key of [
      'ArrowLeft',
      'ArrowRight',
      'ArrowUp',
      'ArrowDown',
      'Home',
      'End',
      'PageUp',
      'PageDown',
    ]) {
      expect(isOpacityAdjustmentKey(key)).toBe(true);
    }
    expect(isOpacityAdjustmentKey('r')).toBe(false);
  });

  it('does not retarget a captured edit after selection change or removal', () => {
    const active = updateOpacityInteraction(
      beginOpacityInteraction(selectionA, 0.35),
      selectionA,
      0.8,
    );
    const result = finish(active);

    expect(
      sameAnnotationSelection(result.commit?.target ?? null, selectionB),
    ).toBe(false);
    expect(sameAnnotationSelection(result.commit?.target ?? null, null)).toBe(
      false,
    );
  });
});

describe('discrete style controls', () => {
  it('keeps color and width changes as one history edit each', () => {
    let history = annotationReducer(createAnnotationHistoryState(), {
      type: 'ADD_ANNOTATION',
      annotation: rectangle,
    });
    const afterCreation = history.past.length;
    const edits = [
      {
        ...DEFAULT_ANNOTATION_STYLE,
        strokeColor: { r: 1, g: 0, b: 0 },
        fillColor: { r: 1, g: 0, b: 0 },
      },
      { ...DEFAULT_ANNOTATION_STYLE, strokeWidth: 8 },
    ];

    for (const styles of edits) {
      history = annotationReducer(history, {
        type: 'UPDATE_ANNOTATION',
        pageId: selectionA.workspacePageId,
        annotationId: selectionA.annotationId,
        update: (annotation) =>
          applyAnnotationStyleDefaults(annotation, styles),
      });
    }

    expect(history.past).toHaveLength(afterCreation + 2);
  });

  it('keeps the idle state reusable for isolated accessibility input', () => {
    const interaction = updateOpacityInteraction(
      IDLE_OPACITY_INTERACTION,
      selectionA,
      0.55,
    );
    expect(finish(interaction).commit?.opacity).toBe(0.55);
  });
});
