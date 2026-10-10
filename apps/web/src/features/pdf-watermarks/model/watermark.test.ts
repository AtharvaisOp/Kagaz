import { describe, expect, it } from 'vitest';
import {
  createDefaultWatermark,
  snapshotWatermark,
  targetWatermarkPageIds,
  validateWatermarkModel,
  watermarkAppliesToPage,
  watermarkTargetFromRange,
} from './watermark';
import { createWatermarkHistory, watermarkReducer } from './reducer';
import type { WatermarkConfig } from './types';

const pages = ['a', 'b', 'c'].map((id, index) => ({
  id,
  sourceDocumentId: 'source',
  sourcePageIndex: index,
  rotationDelta: 0 as const,
}));
const initial = createDefaultWatermark('watermark');
const targeted = (ids: readonly string[]): WatermarkConfig => ({
  ...initial,
  target: { kind: 'pages', pageIds: ids },
});

describe('watermark configuration and targeting', () => {
  it('includes future additions for All and binds explicit targets to identities after reorder', () => {
    expect(targetWatermarkPageIds(initial.target, pages)).toEqual([
      'a',
      'b',
      'c',
    ]);
    expect(
      targetWatermarkPageIds(initial.target, [
        ...pages,
        { ...pages[0]!, id: 'new' },
      ]),
    ).toEqual(['a', 'b', 'c', 'new']);
    expect(
      targetWatermarkPageIds(targeted(['a', 'c']).target, [
        pages[2]!,
        pages[1]!,
        pages[0]!,
      ]),
    ).toEqual(['c', 'a']);
    expect(watermarkAppliesToPage(targeted(['a']), 'b')).toBe(false);
  });
  it('resolves ranges once, deduplicates repeated pages, and rejects malformed/empty/deleted scopes', () => {
    expect(watermarkTargetFromRange('1-2, 2, 3', pages)).toEqual({
      kind: 'pages',
      pageIds: ['a', 'b', 'c'],
    });
    expect(
      watermarkTargetFromRange('1', [pages[2]!, pages[0]!, pages[1]!]),
    ).toEqual({ kind: 'pages', pageIds: ['c'] });
    for (const expression of ['', '3-1', '0', '4', '1,,2', 'a'])
      expect(() => watermarkTargetFromRange(expression, pages)).toThrow();
    expect(validateWatermarkModel(targeted([]))).toContain('at least one');
    expect(validateWatermarkModel(targeted(['a', 'a']))).toContain('only once');
    expect(
      validateWatermarkModel(targeted(['deleted']), new Set(['a'])),
    ).toContain('deleted');
  });
  it.each([
    { opacity: NaN },
    { opacity: -1 },
    { opacity: 1.1 },
    { rotation: Infinity },
    { rotation: 181 },
    { scale: 0 },
    { scale: 1.1 },
    { customPosition: { x: Infinity, y: 0 } },
    { customPosition: { x: 0, y: -1 } },
  ])('rejects invalid finite bounds %j', (patch) =>
    expect(validateWatermarkModel({ ...initial, ...patch })).not.toBeNull(),
  );
  it('accepts fully transparent marks but rejects empty, multiline/control and excessive text', () => {
    expect(validateWatermarkModel({ ...initial, opacity: 0 })).toBeNull();
    for (const text of ['', ' ', 'x\ny', 'x\u0000y', 'x'.repeat(201)])
      expect(
        validateWatermarkModel({
          ...initial,
          kind: 'text',
          text,
          fontSize: 48,
          color: { r: 0, g: 0, b: 0 },
        }),
      ).not.toBeNull();
    expect(
      validateWatermarkModel({
        ...initial,
        kind: 'text',
        text: 'x'.repeat(200),
        fontSize: 144,
        color: { r: 0, g: 1, b: 0.5 },
      }),
    ).toBeNull();
    expect(
      validateWatermarkModel({ ...initial, kind: 'image', assetId: '' }),
    ).toContain('Choose');
  });
  it('deeply freezes copy geometry, color and page IDs without mutating caller state', () => {
    const source = {
      ...initial,
      kind: 'text' as const,
      text: 'MARK',
      fontSize: 20,
      color: { r: 0, g: 0, b: 0 },
      customPosition: { x: 0.2, y: 0.8 },
      target: { kind: 'pages' as const, pageIds: ['a'] },
    };
    const captured = snapshotWatermark(source);
    source.color.r = 1;
    source.customPosition.x = 1;
    source.target.pageIds.push('b');
    expect(captured.target).toEqual({ kind: 'pages', pageIds: ['a'] });
    expect(captured.customPosition.x).toBe(0.2);
    expect(captured.kind === 'text' && captured.color.r).toBe(0);
    expect(Object.isFrozen(captured)).toBe(true);
    expect(Object.isFrozen(captured.customPosition)).toBe(true);
  });
});

describe('single watermark history', () => {
  it('applies/edits/removes/undoes/redoes and ignores identical edits without invisible entries', () => {
    let state = createWatermarkHistory();
    state = watermarkReducer(state, {
      type: 'APPLY',
      config: initial,
      transactionId: 'one',
    });
    expect(
      watermarkReducer(state, {
        type: 'APPLY',
        config: { ...initial },
        transactionId: 'noop',
      }),
    ).toBe(state);
    state = watermarkReducer(state, {
      type: 'APPLY',
      config: { ...initial, opacity: 0.8 },
      transactionId: 'two',
    });
    state = watermarkReducer(state, { type: 'REMOVE', transactionId: 'three' });
    state = watermarkReducer(state, { type: 'UNDO' });
    expect(state.present?.opacity).toBe(0.8);
    state = watermarkReducer(state, { type: 'UNDO' });
    expect(state.present?.opacity).toBe(0.3);
    state = watermarkReducer(state, { type: 'UNDO' });
    expect(state.present).toBeNull();
    state = watermarkReducer(state, { type: 'REDO' });
    expect(state.present?.opacity).toBe(0.3);
    state = watermarkReducer(state, { type: 'REDO' });
    expect(state.present?.opacity).toBe(0.8);
    state = watermarkReducer(state, { type: 'REDO' });
    expect(state.present).toBeNull();
  });
  it('prunes only deleted targets and collapses exactly their now-empty transaction IDs', () => {
    let state = createWatermarkHistory();
    state = watermarkReducer(state, {
      type: 'APPLY',
      config: targeted(['a']),
      transactionId: 'a-only',
    });
    state = watermarkReducer(state, {
      type: 'APPLY',
      config: targeted(['a', 'b']),
      transactionId: 'add-b',
    });
    state = watermarkReducer(state, { type: 'PRUNE', pageIds: ['b', 'c'] });
    expect(state.present?.target).toEqual({ kind: 'pages', pageIds: ['b'] });
    expect(state.past.map((entry) => entry.transactionId)).toEqual(['add-b']);
    state = watermarkReducer(state, { type: 'UNDO' });
    expect(state.present).toBeNull();
    state = watermarkReducer(state, { type: 'REDO' });
    expect(state.present?.target).toEqual({ kind: 'pages', pageIds: ['b'] });
  });
  it('prunes collapsed future transitions without reviving deleted pages or obsolete resets', () => {
    let state = createWatermarkHistory();
    state = watermarkReducer(state, {
      type: 'APPLY',
      config: targeted(['a']),
      transactionId: 'a',
    });
    state = watermarkReducer(state, {
      type: 'APPLY',
      config: targeted(['a', 'b']),
      transactionId: 'b',
    });
    state = watermarkReducer(state, { type: 'UNDO' });
    state = watermarkReducer(state, { type: 'PRUNE', pageIds: ['a'] });
    expect(state.future).toEqual([]);
    state = watermarkReducer(state, { type: 'RESET' });
    expect(watermarkReducer(state, { type: 'UNDO' }).present).toBeNull();
    expect(watermarkReducer(state, { type: 'REDO' }).present).toBeNull();
  });
  it('keeps All edits through additions/deletion, clears on no pages, and bounds history', () => {
    let state = createWatermarkHistory();
    for (let index = 0; index < 105; index++)
      state = watermarkReducer(state, {
        type: 'APPLY',
        config: { ...initial, rotation: index },
        transactionId: `edit-${index}`,
      });
    expect(state.past).toHaveLength(100);
    state = watermarkReducer(state, { type: 'PRUNE', pageIds: ['remaining'] });
    expect(state.present?.target).toEqual({ kind: 'all' });
    state = watermarkReducer(state, { type: 'PRUNE', pageIds: [] });
    expect(state.present).toBeNull();
    expect(state.past).toEqual([]);
  });
});
