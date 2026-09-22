import { describe, expect, it } from 'vitest';

import { createAnnotationHistoryState } from '../../pdf-annotations/model/history';
import { addAnnotation } from '../../pdf-annotations/model/operations';
import {
  friendlyExportError,
  snapshotAnnotationsForPages,
} from './usePdfExport';
import { AnnotationExportError } from '../../../lib/pdf-export/annotations/flattenAnnotations';
import { FormExportError } from '../../../lib/pdf-export/forms/types';

const pageA = {
  id: 'page-a',
  sourceDocumentId: 'source',
  sourcePageIndex: 0,
  rotationDelta: 0,
} as const;
const pageB = { ...pageA, id: 'page-b', sourcePageIndex: 1 } as const;

describe('snapshotAnnotationsForPages', () => {
  it('captures only selected page IDs, preserves z-order, and collects image IDs', () => {
    const rectangle = {
      id: 'rectangle',
      workspacePageId: pageA.id,
      kind: 'rectangle' as const,
      box: {
        origin: { x: 10, y: 10 },
        width: 20,
        height: 20,
        rotation: 0 as const,
      },
      stroke: null,
      fill: { color: { r: 1, g: 0, b: 0 }, opacity: 1 },
    };
    const image = {
      id: 'image',
      workspacePageId: pageA.id,
      kind: 'image' as const,
      box: {
        origin: { x: 30, y: 30 },
        width: 20,
        height: 20,
        rotation: 0 as const,
      },
      assetId: 'asset-a',
      opacity: 1,
    };
    const unrelated = {
      ...image,
      id: 'unrelated',
      workspacePageId: pageB.id,
      assetId: 'asset-b',
    };
    let state = createAnnotationHistoryState();
    state = {
      ...state,
      present: addAnnotation(addAnnotation(state.present, rectangle), image),
    };
    state = {
      ...state,
      present: addAnnotation(state.present, unrelated),
    };

    const snapshot = snapshotAnnotationsForPages([pageA], state);
    expect(snapshot.annotationsByPage.get(pageA.id)).toEqual([
      rectangle,
      image,
    ]);
    expect(snapshot.annotationsByPage.has(pageB.id)).toBe(false);
    expect(snapshot.imageAssetIds).toEqual(['asset-a']);
    expect(snapshot.annotationsByPage.get(pageA.id)).not.toBe(
      state.present.byPage[pageA.id],
    );
  });
});

describe('friendlyExportError', () => {
  it('maps annotation failures without exposing internal identifiers', () => {
    const message = friendlyExportError(
      new AnnotationExportError(
        'missing-image-asset',
        'internal detail',
        'annotation-id',
        'asset-id',
      ),
    );
    expect(message).toBe(
      'An image annotation is no longer available for export.',
    );
    expect(message).not.toContain('asset-id');
    expect(message).not.toContain('annotation-id');
  });

  it('maps form failures to actionable source-specific messages', () => {
    expect(
      friendlyExportError(
        new FormExportError(
          'unsupported-text-font',
          'A filled form value contains characters unsupported by Standard Helvetica.',
          'form.pdf',
        ),
      ),
    ).toBe(
      'form.pdf: A filled form value contains characters unsupported by Standard Helvetica.',
    );
    expect(
      friendlyExportError(
        new FormExportError(
          'active-draft',
          'Finish or cancel the active form text edit before exporting.',
        ),
      ),
    ).toBe('Finish or cancel the active form text edit before exporting.');
  });
});
