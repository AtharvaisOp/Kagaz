import { describe, expect, it } from 'vitest';

import { createAnnotationHistoryState } from './history';
import { annotationReducer } from './reducer';
import { isPdfAnnotation } from './validation';
import { collectReachableAnnotationAssetIds } from '../runtime/assetReachability';
import {
  annotationSummaryLabel,
  resizeAnnotationByKeyboard,
} from '../components/annotationSummary';
import type { PdfAnnotation } from './types';

const signature: PdfAnnotation = {
  id: 'signature-1',
  workspacePageId: 'page-1',
  kind: 'signature',
  box: {
    origin: { x: 10, y: 20 },
    width: 240,
    height: 96,
    rotation: 0,
  },
  assetId: 'asset-signature',
  method: 'draw',
  opacity: 1,
};

describe('visual signatures', () => {
  it('validates as a distinct editable annotation kind', () => {
    expect(isPdfAnnotation(signature)).toBe(true);
    expect(isPdfAnnotation({ ...signature, method: 'secure-digital' })).toBe(
      false,
    );
  });

  it('keeps signature assets reachable through annotation history', () => {
    let state = annotationReducer(createAnnotationHistoryState(), {
      type: 'ADD_ANNOTATION',
      annotation: signature,
    });
    state = annotationReducer(state, {
      type: 'DELETE_ANNOTATION',
      pageId: 'page-1',
      annotationId: signature.id,
    });
    expect(collectReachableAnnotationAssetIds(state)).toContain(
      signature.assetId,
    );
  });

  it('labels signatures by their creation method', () => {
    expect(annotationSummaryLabel(signature)).toBe('Drawn signature');
    expect(annotationSummaryLabel({ ...signature, method: 'type' })).toBe(
      'Typed signature',
    );
    expect(annotationSummaryLabel({ ...signature, method: 'upload' })).toBe(
      'Uploaded signature',
    );
  });

  it('preserves the aspect ratio for keyboard resize', () => {
    const resized = resizeAnnotationByKeyboard(signature, 'increase-width', 20);
    expect(resized.kind).toBe('signature');
    if (resized.kind === 'signature') {
      expect(resized.box.width / resized.box.height).toBeCloseTo(2.5);
    }
  });
});
