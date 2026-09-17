import { describe, expect, it } from 'vitest';

import { createFormHistoryState } from './history';
import { formReducer } from './reducer';

describe('form history reducer', () => {
  it('initializes sources without overwriting earlier edits', () => {
    let state = createFormHistoryState();
    state = formReducer(state, {
      type: 'INITIALIZE_SOURCE',
      initialValues: { 'source-a:name': 'Ada' },
    });
    state = formReducer(state, {
      type: 'COMMIT_FIELD_VALUE',
      fieldId: 'source-a:name',
      value: 'Grace',
    });
    state = formReducer(state, {
      type: 'INITIALIZE_SOURCE',
      initialValues: { 'source-b:name': 'Katherine' },
    });

    expect(state.present.byField).toEqual({
      'source-a:name': 'Grace',
      'source-b:name': 'Katherine',
    });
    expect(state.baseline.byField).toEqual({
      'source-a:name': 'Ada',
      'source-b:name': 'Katherine',
    });
    expect(state.dirty).toBe(true);
  });

  it('supports semantic undo/redo and invalidates the future branch', () => {
    let state = formReducer(createFormHistoryState(), {
      type: 'INITIALIZE_SOURCE',
      initialValues: { name: 'Ada', check: false, choice: null },
    });
    state = formReducer(state, {
      type: 'COMMIT_FIELD_VALUE',
      fieldId: 'name',
      value: 'Grace',
    });
    state = formReducer(state, {
      type: 'COMMIT_FIELD_VALUE',
      fieldId: 'check',
      value: true,
    });
    expect(state.past).toHaveLength(2);
    state = formReducer(state, { type: 'UNDO' });
    expect(state.present.byField.check).toBe(false);
    state = formReducer(state, { type: 'REDO' });
    expect(state.present.byField.check).toBe(true);
    state = formReducer(state, { type: 'UNDO' });
    state = formReducer(state, {
      type: 'COMMIT_FIELD_VALUE',
      fieldId: 'choice',
      value: 'a',
    });
    expect(state.future).toHaveLength(0);
  });

  it('keeps arrays deterministic and prunes invisible fields and history', () => {
    let state = formReducer(createFormHistoryState(), {
      type: 'INITIALIZE_SOURCE',
      initialValues: { list: ['a'], other: 'x' },
    });
    state = formReducer(state, {
      type: 'COMMIT_FIELD_VALUE',
      fieldId: 'list',
      value: ['a', 'b'],
    });
    state = formReducer(state, { type: 'PRUNE_FIELDS', fieldIds: ['other'] });
    expect(state.present.byField).toEqual({ other: 'x' });
    expect(state.baseline.byField).toEqual({ other: 'x' });
    expect(state.past).toHaveLength(0);
    expect(state.future).toHaveLength(0);
    expect(state.dirty).toBe(false);
  });

  it('bounds form history at one hundred committed transactions', () => {
    let state = formReducer(createFormHistoryState(), {
      type: 'INITIALIZE_SOURCE',
      initialValues: { value: '' },
    });
    for (let index = 0; index < 120; index += 1) {
      state = formReducer(state, {
        type: 'COMMIT_FIELD_VALUE',
        fieldId: 'value',
        value: String(index),
      });
    }
    expect(state.past).toHaveLength(100);
  });
});
