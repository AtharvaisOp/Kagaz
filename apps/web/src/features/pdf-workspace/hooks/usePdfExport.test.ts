import { describe, expect, it } from 'vitest';

import { createAnnotationHistoryState } from '../../pdf-annotations/model/history';
import { addAnnotation } from '../../pdf-annotations/model/operations';
import {
  friendlyExportError,
  snapshotAnnotationsForPages,
  snapshotRedactionsForPages,
  snapshotWatermarkForPages,
} from './usePdfExport';
import { AnnotationExportError } from '../../../lib/pdf-export/annotations/flattenAnnotations';
import { FormExportError } from '../../../lib/pdf-export/forms/types';
import { createDefaultWatermark } from '../../pdf-watermarks/model/watermark';
import { snapshotAnnotationImageAssets } from '../../../lib/pdf-export/annotations/imageAssets';
import type { AnnotationImageAsset } from '../../pdf-annotations/runtime/annotationAssetRegistry';

const pageA = {
  id: 'page-a',
  sourceDocumentId: 'source',
  sourcePageIndex: 0,
  rotationDelta: 0,
} as const;
const pageB = { ...pageA, id: 'page-b', sourcePageIndex: 1 } as const;

describe('watermark export snapshots', () => {
  it('includes only applicable Extract page identities and deeply snapshots configuration', () => {
    const config = {
      ...createDefaultWatermark('mark'),
      kind: 'text' as const,
      text: 'BEFORE',
      fontSize: 24,
      color: { r: 0, g: 0, b: 0 },
      customPosition: { x: 0.2, y: 0.5 },
      target: { kind: 'pages' as const, pageIds: [pageA.id, pageB.id] },
    };
    const captured = snapshotWatermarkForPages([pageA], config);
    config.text = 'AFTER';
    config.color.r = 1;
    config.customPosition.x = 1;
    config.target.pageIds.pop();
    expect(captured?.target).toEqual({ kind: 'pages', pageIds: [pageA.id] });
    expect(captured?.kind === 'text' && captured.text).toBe('BEFORE');
    expect(captured?.kind === 'text' && captured.color.r).toBe(0);
    expect(captured?.customPosition.x).toBe(0.2);
    expect(snapshotWatermarkForPages([pageB], config)).toBeNull();
  });
  it('captures image Blob before a paused read, independently of later registry removal', async () => {
    let finish!: (bytes: ArrayBuffer) => void;
    const blob = new Blob(['captured'], { type: 'image/png' });
    blob.arrayBuffer = () =>
      new Promise((resolve) => {
        finish = resolve;
      });
    const asset: AnnotationImageAsset = {
      assetId: 'mark-asset',
      blob,
      fileName: null,
      mimeType: 'image/png',
      objectUrl: 'blob:fixture',
      width: 10,
      height: 10,
      image: {} as CanvasImageSource,
    };
    const registry = new Map([[asset.assetId, asset]]);
    const config = {
      ...createDefaultWatermark('mark'),
      kind: 'image' as const,
      assetId: asset.assetId,
    };
    const captured = snapshotWatermarkForPages([pageA], config);
    const pending = snapshotAnnotationImageAssets(
      { get: (id) => registry.get(id) ?? null },
      captured?.kind === 'image' ? [captured.assetId] : [],
    );
    registry.clear();
    config.assetId = 'replacement';
    finish(new Uint8Array([1, 2, 3]).buffer);
    expect(new Uint8Array((await pending).get('mark-asset')!.bytes)).toEqual(
      new Uint8Array([1, 2, 3]),
    );
    expect(captured?.kind === 'image' && captured.assetId).toBe('mark-asset');
  });
});

describe('snapshotRedactionsForPages', () => {
  it('deeply snapshots selected page proposals before asynchronous asset work', () => {
    const region = {
      id: 'redaction',
      pageId: pageA.id,
      box: { x: 1, y: 2, width: 30, height: 40 },
    };
    const snapshot = snapshotRedactionsForPages(
      [pageA],
      [region, { ...region, id: 'unselected', pageId: pageB.id }],
    );
    region.box.x = 99;
    expect(snapshot.get(pageA.id)).toEqual([
      { ...region, box: { x: 1, y: 2, width: 30, height: 40 } },
    ]);
    expect(snapshot.has(pageB.id)).toBe(false);
    expect(Object.isFrozen(snapshot.get(pageA.id)?.[0]?.box)).toBe(true);
  });
});

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
    const signature = {
      id: 'signature',
      workspacePageId: pageA.id,
      kind: 'signature' as const,
      box: {
        origin: { x: 60, y: 60 },
        width: 80,
        height: 30,
        rotation: 0 as const,
      },
      assetId: 'signature-asset',
      method: 'type' as const,
      opacity: 1,
    };
    let state = createAnnotationHistoryState();
    state = {
      ...state,
      present: addAnnotation(
        addAnnotation(addAnnotation(state.present, rectangle), signature),
        image,
      ),
    };
    state = {
      ...state,
      present: addAnnotation(state.present, unrelated),
    };

    const snapshot = snapshotAnnotationsForPages([pageA], state);
    expect(snapshot.annotationsByPage.get(pageA.id)).toEqual([
      rectangle,
      signature,
      image,
    ]);
    expect(snapshot.annotationsByPage.has(pageB.id)).toBe(false);
    expect(snapshot.imageAssetIds).toEqual(['signature-asset', 'asset-a']);
    expect(snapshot.annotationsByPage.get(pageA.id)).not.toBe(
      state.present.byPage[pageA.id],
    );
  });

  it('maps missing visual-signature assets without exposing IDs', () => {
    const message = friendlyExportError(
      new AnnotationExportError(
        'missing-signature-asset',
        'internal detail',
        'signature-id',
        'asset-id',
      ),
    );
    expect(message).toBe(
      'A visual signature is no longer available for export.',
    );
    expect(message).not.toContain('asset-id');
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
