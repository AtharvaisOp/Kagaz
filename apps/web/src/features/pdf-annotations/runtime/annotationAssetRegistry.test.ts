import { describe, expect, it, vi } from 'vitest';

import {
  createAnnotationHistoryState,
  MAX_ANNOTATION_HISTORY,
} from '../model/history';
import { annotationReducer } from '../model/reducer';
import type { ImageAnnotation, PdfAnnotation } from '../model/types';
import { collectReachableAnnotationAssetIds } from './assetReachability';
import { createAnnotationAssetRegistry } from './annotationAssetRegistry';

it('cancels one pending decode immediately while preserving other reachable assets', async () => {
  let finish!: (value: {
    width: number;
    height: number;
    image: CanvasImageSource;
  }) => void;
  const revoke = vi.fn(),
    close = vi.fn();
  let next = 0;
  const registry = createAnnotationAssetRegistry({
    createId: () => `asset-${++next}`,
    createObjectUrl: () => `blob:${next}`,
    revokeObjectUrl: revoke,
    decode: () =>
      next === 1
        ? Promise.resolve({
            width: 10,
            height: 10,
            image: {} as CanvasImageSource,
          })
        : new Promise((resolve) => {
            finish = resolve;
          }),
  });
  const retained = await registry.register(
    new Blob(['first'], { type: 'image/png' }),
  );
  const abort = new AbortController();
  const pending = registry.register(
    new Blob(['pending'], { type: 'image/png' }),
    abort.signal,
  );
  const rejected = expect(pending).rejects.toMatchObject({
    name: 'AbortError',
  });
  abort.abort();
  expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:2');
  expect(registry.get(retained.assetId)).not.toBeNull();
  finish({
    width: 10,
    height: 10,
    image: { close } as unknown as CanvasImageSource,
  });
  await rejected;
  expect(close).toHaveBeenCalledOnce();
  expect(revoke).toHaveBeenCalledOnce();
  registry.destroyAll();
  expect(revoke).toHaveBeenCalledTimes(2);
});

it('rejects an already-aborted decode without creating an object URL', async () => {
  const createObjectUrl = vi.fn(),
    decode = vi.fn();
  const registry = createAnnotationAssetRegistry({
    createId: () => 'id',
    createObjectUrl,
    revokeObjectUrl: vi.fn(),
    decode,
  });
  const abort = new AbortController();
  abort.abort();
  await expect(
    registry.register(new Blob(['png'], { type: 'image/png' }), abort.signal),
  ).rejects.toMatchObject({ name: 'AbortError' });
  expect(createObjectUrl).not.toHaveBeenCalled();
  expect(decode).not.toHaveBeenCalled();
});

function registryFixture(decodeFails = false) {
  let id = 0;
  const revoked: string[] = [];
  const registry = createAnnotationAssetRegistry({
    createId: () => `asset-${++id}`,
    createObjectUrl: (_blob) => `blob:test-${id}`,
    revokeObjectUrl: (url) => revoked.push(url),
    decode: () =>
      decodeFails
        ? Promise.reject(new Error('decode failed'))
        : Promise.resolve({
            width: 640,
            height: 320,
            image: { close: vi.fn() } as unknown as CanvasImageSource,
          }),
  });
  return { registry, revoked };
}

function image(id: string, assetId: string): ImageAnnotation {
  return {
    id,
    workspacePageId: 'page-1',
    kind: 'image',
    box: { origin: { x: 10, y: 20 }, width: 200, height: 100, rotation: 0 },
    assetId,
    opacity: 1,
  };
}

describe('annotation asset registry', () => {
  it('registers PNG/JPEG independently and revokes each URL exactly once', async () => {
    const { registry, revoked } = registryFixture();
    const first = await registry.register(
      new Blob(['png'], { type: 'image/png' }),
    );
    const second = await registry.register(
      new Blob(['jpg'], { type: 'image/jpeg' }),
    );
    expect(first.assetId).not.toBe(second.assetId);
    expect(first.width / first.height).toBe(2);
    expect(registry.get(first.assetId)).toBe(first);
    expect(registry.size).toBe(2);
    expect(registry.destroy(first.assetId)).toBe(true);
    expect(registry.destroy(first.assetId)).toBe(false);
    registry.destroyAll();
    expect(revoked).toEqual(['blob:test-1', 'blob:test-2']);
  });

  it('rejects unsupported and undecodable files without leaking URLs', async () => {
    const good = registryFixture();
    await expect(
      good.registry.register(new Blob(['gif'], { type: 'image/gif' })),
    ).rejects.toThrow('PNG or JPEG');
    expect(good.revoked).toHaveLength(0);

    const bad = registryFixture(true);
    await expect(
      bad.registry.register(new Blob(['bad'], { type: 'image/png' })),
    ).rejects.toThrow('decode failed');
    expect(bad.revoked).toEqual(['blob:test-1']);
  });

  it('rejects decoded images with invalid dimensions and revokes their URL', async () => {
    const revoked: string[] = [];
    const close = vi.fn();
    const registry = createAnnotationAssetRegistry({
      createId: () => 'asset-invalid',
      createObjectUrl: () => 'blob:invalid',
      revokeObjectUrl: (url) => revoked.push(url),
      decode: () =>
        Promise.resolve({
          width: 0,
          height: 10,
          image: { close } as unknown as CanvasImageSource,
        }),
    });
    await expect(
      registry.register(new Blob(['bad-size'], { type: 'image/png' })),
    ).rejects.toThrow('invalid dimensions');
    expect(registry.size).toBe(0);
    expect(revoked).toEqual(['blob:invalid']);
    expect(close).toHaveBeenCalledOnce();
  });

  it('notifies only subscribers for the changed asset', async () => {
    const { registry } = registryFixture();
    const first = await registry.register(
      new Blob(['a'], { type: 'image/png' }),
    );
    const second = await registry.register(
      new Blob(['b'], { type: 'image/png' }),
    );
    const firstListener = vi.fn();
    const secondListener = vi.fn();
    registry.subscribe(first.assetId, firstListener);
    registry.subscribe(second.assetId, secondListener);
    registry.destroy(first.assetId);
    expect(firstListener).toHaveBeenCalledOnce();
    expect(secondListener).not.toHaveBeenCalled();
  });

  it('keeps pending assets alive and releases them once placement is cancelled', async () => {
    const { registry, revoked } = registryFixture();
    const asset = await registry.register(
      new Blob(['pending'], { type: 'image/png' }),
    );
    registry.reconcile(new Set([asset.assetId]));
    expect(registry.size).toBe(1);
    registry.reconcile(new Set());
    registry.reconcile(new Set());
    expect(registry.size).toBe(0);
    expect(revoked).toEqual(['blob:test-1']);
  });
});

describe('image asset reachability', () => {
  it('retains assets across delete/undo/redo history and pending placement', () => {
    let state = createAnnotationHistoryState();
    state = annotationReducer(state, {
      type: 'ADD_ANNOTATION',
      annotation: image('image-1', 'asset-history'),
    });
    state = annotationReducer(state, {
      type: 'DELETE_ANNOTATION',
      pageId: 'page-1',
      annotationId: 'image-1',
    });
    expect(collectReachableAnnotationAssetIds(state)).toContain(
      'asset-history',
    );
    state = annotationReducer(state, { type: 'UNDO' });
    expect(collectReachableAnnotationAssetIds(state)).toContain(
      'asset-history',
    );
    state = annotationReducer(state, { type: 'REDO' });
    expect(collectReachableAnnotationAssetIds(state, 'asset-pending')).toEqual(
      new Set(['asset-history', 'asset-pending']),
    );
  });

  it('releases a page-only asset after all history documents are pruned', () => {
    let state = annotationReducer(createAnnotationHistoryState(), {
      type: 'ADD_ANNOTATION',
      annotation: image('image-1', 'asset-page'),
    });
    state = annotationReducer(state, {
      type: 'PRUNE_REMOVED_PAGES',
      pageIds: ['page-1'],
    });
    expect(collectReachableAnnotationAssetIds(state)).toEqual(new Set());
  });

  it('releases deleted assets once the last referencing history state is trimmed', () => {
    let state = annotationReducer(createAnnotationHistoryState(), {
      type: 'ADD_ANNOTATION',
      annotation: image('image-1', 'asset-trimmed'),
    });
    state = annotationReducer(state, {
      type: 'DELETE_ANNOTATION',
      pageId: 'page-1',
      annotationId: 'image-1',
    });

    for (let index = 0; index <= MAX_ANNOTATION_HISTORY; index += 1) {
      const annotation: PdfAnnotation = {
        id: `rectangle-${index}`,
        workspacePageId: 'page-1',
        kind: 'rectangle',
        box: {
          origin: { x: index, y: index },
          width: 20,
          height: 20,
          rotation: 0,
        },
        stroke: {
          color: { r: 0, g: 0, b: 0 },
          widthUserUnits: 1,
          opacity: 1,
        },
        fill: null,
      };
      state = annotationReducer(state, {
        type: 'ADD_ANNOTATION',
        annotation,
      });
    }

    expect(state.past).toHaveLength(MAX_ANNOTATION_HISTORY);
    expect(collectReachableAnnotationAssetIds(state)).toEqual(new Set());
  });

  it('drops every asset reference when annotation history is reset', () => {
    let state = annotationReducer(createAnnotationHistoryState(), {
      type: 'ADD_ANNOTATION',
      annotation: image('image-1', 'asset-reset'),
    });
    state = annotationReducer(state, { type: 'RESET_ANNOTATIONS' });
    expect(collectReachableAnnotationAssetIds(state)).toEqual(new Set());
  });
});

it('destroyAll invalidates in-flight decoding and revokes its URL exactly once', async () => {
  let finish!: (value: {
    width: number;
    height: number;
    image: CanvasImageSource;
  }) => void;
  const close = vi.fn(),
    revoke = vi.fn();
  const registry = createAnnotationAssetRegistry({
    createId: () => 'pending',
    createObjectUrl: () => 'blob:pending',
    revokeObjectUrl: revoke,
    decode: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  });
  const loading = registry.register(new Blob(['png'], { type: 'image/png' }));
  const rejected = expect(loading).rejects.toMatchObject({
    name: 'AbortError',
  });
  registry.destroyAll();
  expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:pending');
  finish({
    width: 10,
    height: 10,
    image: { close } as unknown as CanvasImageSource,
  });
  await rejected;
  registry.destroyAll();
  expect(registry.size).toBe(0);
  expect(close).toHaveBeenCalledOnce();
  expect(revoke).toHaveBeenCalledOnce();
});
