import { describe, expect, it } from 'vitest';

import {
  commitAnnotationEdit,
  createAnnotationHistoryState,
  redoAnnotationEdit,
  undoAnnotationEdit,
} from './history';
import { annotationReducer } from './reducer';
import { addAnnotation } from './operations';
import type { AnnotationDocument, PdfAnnotation } from './types';

const pageA = 'page-a';
const pageB = 'page-b';

function text(id: string, pageId: string, value: string): PdfAnnotation {
  return {
    id,
    workspacePageId: pageId,
    kind: 'text',
    box: { origin: { x: 10, y: 10 }, width: 80, height: 20, rotation: 0 },
    text: value,
    fontFamily: 'helvetica',
    fontSizeUserUnits: 12,
    lineHeight: 1.2,
    align: 'left',
    color: { r: 0, g: 0, b: 0 },
    opacity: 1,
  };
}

function documentWith(...annotations: PdfAnnotation[]): AnnotationDocument {
  return annotations.reduce(addAnnotation, { byPage: {} });
}

describe('history pruning normalization', () => {
  it('collapses duplicate past/future states while preserving meaningful A edits', () => {
    let state = createAnnotationHistoryState();
    const a1 = text('a1', pageA, 'one');
    const a2 = text('a2', pageA, 'two');
    const b1 = text('b1', pageB, 'b-one');
    const b2 = text('b2', pageB, 'b-two');
    state = commitAnnotationEdit(state, documentWith(a1));
    state = commitAnnotationEdit(state, documentWith(a1, a2));
    state = commitAnnotationEdit(state, documentWith(a1, a2, b1));
    state = commitAnnotationEdit(state, documentWith(a1, a2, b1, b2));
    state = undoAnnotationEdit(state);
    state = undoAnnotationEdit(state);
    state = annotationReducer(state, {
      type: 'PRUNE_REMOVED_PAGES',
      pageIds: [pageB],
    });

    expect(state.present).toEqual(documentWith(a1, a2));
    expect(state.past.map((doc) => doc.byPage[pageA]?.length ?? 0)).toEqual([
      0, 1,
    ]);
    expect(state.future).toHaveLength(0);

    state = undoAnnotationEdit(state);
    expect(state.present).toEqual(documentWith(a1));
    state = undoAnnotationEdit(state);
    expect(state.present).toEqual(documentWith());
    state = redoAnnotationEdit(state);
    expect(state.present).toEqual(documentWith(a1));
    state = redoAnnotationEdit(state);
    expect(state.present).toEqual(documentWith(a1, a2));
  });

  it('keeps dirty comparison against the pruned baseline', () => {
    const baseline = documentWith(text('b', pageB, 'baseline'));
    let state = createAnnotationHistoryState(baseline);
    state = commitAnnotationEdit(
      state,
      documentWith(text('b', pageB, 'changed')),
    );
    state = annotationReducer(state, {
      type: 'PRUNE_REMOVED_PAGES',
      pageIds: [pageB],
    });
    expect(state.present).toEqual({ byPage: {} });
    expect(state.baseline).toEqual({ byPage: {} });
    expect(state.dirty).toBe(false);
    expect(state.past).toHaveLength(0);
  });
});
