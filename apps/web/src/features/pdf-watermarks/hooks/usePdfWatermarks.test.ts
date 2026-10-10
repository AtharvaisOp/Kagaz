import { describe, expect, it, vi } from 'vitest';
import { createAnnotationAssetRegistry } from '../../pdf-annotations/runtime/annotationAssetRegistry';
import { EditorHistoryTimeline } from '../../editor-history/model/timeline';
import {
  createWatermarkHistory,
  watermarkReducer,
  removedWatermarkTransactionIds,
  type WatermarkAction,
} from '../model/reducer';
import { createDefaultWatermark } from '../model/watermark';
import { collectWatermarkAssetIds } from './usePdfWatermarks';
import type { WatermarkConfig } from '../model/types';

const image = (id: string): WatermarkConfig => ({
  ...createDefaultWatermark('mark'),
  kind: 'image',
  assetId: id,
});

describe('watermark unified chronology and reachable runtime assets', () => {
  it('prunes capped watermark history while keeping an older form transaction without invisible Undo steps', () => {
    let state = createWatermarkHistory();
    const timeline = new EditorHistoryTimeline();
    const formUndo = vi.fn(() => true);
    const apply = (action: WatermarkAction) => {
      const next = watermarkReducer(state, action);
      const changed = next !== state;
      state = next;
      return changed;
    };
    timeline.bind({
      form: {
        canUndo: true,
        canRedo: true,
        undo: formUndo,
        redo: () => true,
        discardFuture: vi.fn(),
      },
      watermark: {
        get canUndo() {
          return state.past.length > 0;
        },
        get canRedo() {
          return state.future.length > 0;
        },
        undo: () => apply({ type: 'UNDO' }),
        redo: () => apply({ type: 'REDO' }),
        discardFuture: () => {
          apply({ type: 'DISCARD_FUTURE' });
        },
      },
    });
    for (let index = 0; index < 105; index++) {
      const before = state;
      const transactionId = `edit-${index}`;
      apply({
        type: 'APPLY',
        config: { ...createDefaultWatermark('mark'), rotation: index },
        transactionId,
      });
      const removed = removedWatermarkTransactionIds(before, state);
      if (removed.length) timeline.pruneDomain('watermark', removed);
      timeline.record('watermark', [transactionId]);
      if (index === 2) timeline.record('form', ['field']);
    }
    for (let index = 0; index < 100; index++)
      expect(timeline.undo()).toBe(true);
    expect(state.present?.rotation).toBe(4);
    expect(timeline.undo()).toBe(true);
    expect(formUndo).toHaveBeenCalledOnce();
    expect(timeline.canUndo).toBe(false);
    expect(timeline.undo()).toBe(false);
  });
  it('coordinates watermark transactions between annotation/form/redaction, including exact deleted-target prune', () => {
    const timeline = new EditorHistoryTimeline();
    let state = createWatermarkHistory();
    const apply = (action: WatermarkAction) => {
      const next = watermarkReducer(state, action);
      const changed = next !== state;
      state = next;
      return changed;
    };
    const formUndo = vi.fn(() => true),
      annotationUndo = vi.fn(() => true),
      redactionUndo = vi.fn(() => true);
    const participant = (undo: () => boolean) => ({
      canUndo: true,
      canRedo: true,
      undo,
      redo: () => true,
      discardFuture: vi.fn(),
    });
    timeline.bind({
      form: participant(formUndo),
      annotation: participant(annotationUndo),
      redaction: participant(redactionUndo),
      watermark: {
        get canUndo() {
          return state.past.length > 0;
        },
        get canRedo() {
          return state.future.length > 0;
        },
        undo: () => apply({ type: 'UNDO' }),
        redo: () => apply({ type: 'REDO' }),
        discardFuture: () => {
          apply({ type: 'DISCARD_FUTURE' });
        },
      },
    });
    const config = createDefaultWatermark('mark');
    apply({
      type: 'APPLY',
      config: { ...config, target: { kind: 'pages', pageIds: ['deleted'] } },
      transactionId: 'one',
    });
    timeline.record('watermark', ['one']);
    timeline.record('form', ['field']);
    apply({
      type: 'APPLY',
      config: {
        ...config,
        target: { kind: 'pages', pageIds: ['deleted', 'remaining'] },
      },
      transactionId: 'two',
    });
    timeline.record('watermark', ['two']);
    timeline.record('annotation', ['remaining']);
    timeline.record('redaction', ['remaining']);
    const before = state;
    apply({ type: 'PRUNE', pageIds: ['remaining'] });
    const retained = new Set(
      [...state.past, ...state.future].map((entry) => entry.transactionId),
    );
    timeline.pruneDomain(
      'watermark',
      [...before.past, ...before.future]
        .map((entry) => entry.transactionId)
        .filter((id) => !retained.has(id)),
    );
    timeline.undo();
    expect(redactionUndo).toHaveBeenCalledOnce();
    timeline.undo();
    expect(annotationUndo).toHaveBeenCalledOnce();
    timeline.undo();
    expect(state.present).toBeNull();
    timeline.undo();
    expect(formUndo).toHaveBeenCalledOnce();
    expect(timeline.canUndo).toBe(false);
    timeline.redo();
    timeline.redo();
    expect(state.present?.target).toEqual({
      kind: 'pages',
      pageIds: ['remaining'],
    });
  });
  it('keeps past/future/draft image resources and releases an abandoned redo branch exactly once', async () => {
    const revoke = vi.fn();
    let sequence = 0;
    const registry = createAnnotationAssetRegistry({
      createId: () => `asset-${++sequence}`,
      createObjectUrl: () => `blob:${sequence}`,
      revokeObjectUrl: revoke,
      decode: () =>
        Promise.resolve({
          width: 10,
          height: 20,
          image: {} as CanvasImageSource,
        }),
    });
    const first = await registry.register(
      new Blob(['one'], { type: 'image/png' }),
    );
    const second = await registry.register(
      new Blob(['two'], { type: 'image/png' }),
    );
    const draft = await registry.register(
      new Blob(['draft'], { type: 'image/png' }),
    );
    let state = createWatermarkHistory();
    state = watermarkReducer(state, {
      type: 'APPLY',
      config: image(first.assetId),
      transactionId: 'one',
    });
    state = watermarkReducer(state, {
      type: 'APPLY',
      config: image(second.assetId),
      transactionId: 'two',
    });
    state = watermarkReducer(state, { type: 'UNDO' });
    registry.reconcile(collectWatermarkAssetIds(state, image(draft.assetId)));
    expect(registry.size).toBe(3);
    expect(revoke).not.toHaveBeenCalled();
    state = watermarkReducer(state, { type: 'DISCARD_FUTURE' });
    registry.reconcile(collectWatermarkAssetIds(state, null));
    expect(registry.get(first.assetId)).not.toBeNull();
    expect(registry.get(second.assetId)).toBeNull();
    expect(registry.get(draft.assetId)).toBeNull();
    expect(revoke).toHaveBeenCalledTimes(2);
    state = watermarkReducer(state, { type: 'RESET' });
    registry.reconcile(collectWatermarkAssetIds(state, null));
    registry.destroyAll();
    expect(registry.size).toBe(0);
    expect(revoke).toHaveBeenCalledTimes(3);
  });
  it('invalidates pending image decode and closes/revokes late work on reset or unmount', async () => {
    let finish!: (value: {
      width: number;
      height: number;
      image: CanvasImageSource;
    }) => void;
    const revoke = vi.fn(),
      close = vi.fn();
    const registry = createAnnotationAssetRegistry({
      createId: () => 'pending',
      createObjectUrl: () => 'blob:pending',
      revokeObjectUrl: revoke,
      decode: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    });
    const registration = registry.register(
      new Blob(['png'], { type: 'image/png' }),
    );
    const rejected = expect(registration).rejects.toMatchObject({
      name: 'AbortError',
    });
    registry.destroyAll();
    finish({
      width: 10,
      height: 10,
      image: { close } as unknown as CanvasImageSource,
    });
    await rejected;
    expect(registry.size).toBe(0);
    expect(revoke).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });
});
