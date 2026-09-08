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
          applyAnnotationStyleDefaults(
            annotation,
            {
              ...DEFAULT_ANNOTATION_STYLE,
              opacity: result.commit?.opacity ?? 0.35,
            },
            { opacity: result.commit?.opacity ?? 0.35 },
          ),
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
  it('applies text controls independently and image opacity only', () => {
    const text: PdfAnnotation = {
      id: 'text-1',
      workspacePageId: 'page-1',
      kind: 'text',
      box: { origin: { x: 0, y: 40 }, width: 120, height: 40, rotation: 0 },
      text: 'Kagaz',
      fontFamily: 'helvetica',
      fontSizeUserUnits: 12,
      lineHeight: 1.2,
      align: 'left',
      color: { r: 0, g: 0, b: 0 },
      opacity: 1,
    };
    const image: PdfAnnotation = {
      id: 'image-1',
      workspacePageId: 'page-1',
      kind: 'image',
      box: { origin: { x: 0, y: 100 }, width: 100, height: 50, rotation: 0 },
      assetId: 'asset-1',
      opacity: 1,
    };
    const styledText = applyAnnotationStyleDefaults(
      text,
      { ...DEFAULT_ANNOTATION_STYLE, fontSize: 24, textAlign: 'right' },
      { fontSize: 24, textAlign: 'right' },
    );
    const styledImage = applyAnnotationStyleDefaults(
      image,
      { ...DEFAULT_ANNOTATION_STYLE, opacity: 0.45 },
      { opacity: 0.45, strokeWidth: 8 },
    );
    expect(styledText).toMatchObject({
      fontSizeUserUnits: 24,
      align: 'right',
      opacity: 1,
    });
    expect(styledImage).toMatchObject({ opacity: 0.45, assetId: 'asset-1' });
  });

  it('keeps color and width changes as one history edit each', () => {
    let history = annotationReducer(createAnnotationHistoryState(), {
      type: 'ADD_ANNOTATION',
      annotation: rectangle,
    });
    const afterCreation = history.past.length;
    const edits = [
      [
        {
          ...DEFAULT_ANNOTATION_STYLE,
          strokeColor: { r: 1, g: 0, b: 0 },
          fillColor: { r: 1, g: 0, b: 0 },
        },
        {
          strokeColor: { r: 1, g: 0, b: 0 },
          fillColor: { r: 1, g: 0, b: 0 },
        },
      ],
      [{ ...DEFAULT_ANNOTATION_STYLE, strokeWidth: 8 }, { strokeWidth: 8 }],
    ] as const;

    for (const [styles, patch] of edits) {
      history = annotationReducer(history, {
        type: 'UPDATE_ANNOTATION',
        pageId: selectionA.workspacePageId,
        annotationId: selectionA.annotationId,
        update: (annotation) =>
          applyAnnotationStyleDefaults(annotation, styles, patch),
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

  it('coalesces image opacity inputs into one image history edit', () => {
    const image: PdfAnnotation = {
      id: 'image-opacity',
      workspacePageId: 'page-1',
      kind: 'image',
      box: { origin: { x: 20, y: 20 }, width: 160, height: 90, rotation: 0 },
      assetId: 'asset-opacity',
      opacity: 0.35,
    };
    const imageSelection = {
      workspacePageId: image.workspacePageId,
      annotationId: image.id,
    };
    let history = annotationReducer(createAnnotationHistoryState(), {
      type: 'ADD_ANNOTATION',
      annotation: image,
    });
    let interaction = beginOpacityInteraction(imageSelection, image.opacity);
    for (const opacity of [0.45, 0.6, 0.8, 1]) {
      interaction = updateOpacityInteraction(
        interaction,
        imageSelection,
        opacity,
      );
    }
    const result = finish(interaction);
    if (result.commit) {
      history = annotationReducer(history, {
        type: 'UPDATE_ANNOTATION',
        pageId: result.commit.target.workspacePageId,
        annotationId: result.commit.target.annotationId,
        update: { opacity: result.commit.opacity },
      });
    }
    expect(history.past).toHaveLength(2);
    expect(history.present.byPage['page-1']?.[0]).toMatchObject({
      kind: 'image',
      opacity: 1,
    });
  });

  it('commits one patch-local opacity edit for a line with non-default style', () => {
    const line: PdfAnnotation = {
      id: 'wide-black-line',
      workspacePageId: 'page-1',
      kind: 'line',
      start: { x: 10, y: 10 },
      end: { x: 100, y: 100 },
      stroke: {
        color: { r: 0, g: 0, b: 0 },
        widthUserUnits: 8,
        opacity: 1,
      },
    };
    const target = {
      workspacePageId: line.workspacePageId,
      annotationId: line.id,
    };
    let history = annotationReducer(createAnnotationHistoryState(), {
      type: 'ADD_ANNOTATION',
      annotation: line,
    });
    let interaction = beginOpacityInteraction(target, 1);
    for (const opacity of [0.8, 0.6, 0.4]) {
      interaction = updateOpacityInteraction(interaction, target, opacity);
    }
    const result = finish(interaction);
    expect(result.commit).not.toBeNull();
    if (result.commit) {
      const committedOpacity = result.commit.opacity;
      history = annotationReducer(history, {
        type: 'UPDATE_ANNOTATION',
        pageId: target.workspacePageId,
        annotationId: target.annotationId,
        update: (annotation) =>
          applyAnnotationStyleDefaults(
            annotation,
            {
              ...DEFAULT_ANNOTATION_STYLE,
              strokeColor: { r: 1, g: 0, b: 0 },
              strokeWidth: 2,
              opacity: committedOpacity,
            },
            { opacity: committedOpacity },
          ),
      });
    }

    expect(history.past).toHaveLength(2);
    expect(history.present.byPage['page-1']?.[0]).toMatchObject({
      stroke: {
        color: { r: 0, g: 0, b: 0 },
        widthUserUnits: 8,
        opacity: 0.4,
      },
    });
    expect(
      annotationReducer(history, { type: 'UNDO' }).present.byPage[
        'page-1'
      ]?.[0],
    ).toEqual(line);
  });
});
