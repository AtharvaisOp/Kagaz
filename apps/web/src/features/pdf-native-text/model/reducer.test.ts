import { describe, expect, it } from 'vitest';

import type { NativeTextEdit } from '../../../lib/pdf-native-text/types';
import {
  createNativeTextEditHistory,
  nativeTextEditReducer,
  snapshotNativeTextEdits,
} from './reducer';

function edit(
  id: string,
  workspacePageId = 'page-a',
  replacementText = 'REPLACED',
): NativeTextEdit {
  return {
    id,
    workspacePageId,
    sourceDocumentId: 'source',
    sourcePageIndex: 0,
    identity: {
      sourceFileFingerprint: 'source-fingerprint',
      streamFingerprint: 'stream-fingerprint',
      runOrdinal: 0,
      originalText: 'ORIGINAL',
      fontResourceName: 'F1',
      fontBaseName: 'Helvetica',
      fontSize: 12,
      textMatrix: [1, 0, 0, 1, 40, 80],
    },
    replacementText,
    translationX: 0,
    translationY: 0,
  };
}

describe('native source-text edit history', () => {
  it('commits, undoes, and redoes an immutable source-text replacement', () => {
    let state = nativeTextEditReducer(createNativeTextEditHistory(), {
      type: 'COMMIT',
      edit: edit('first', 'page-a', 'FIRST'),
    });
    state = nativeTextEditReducer(state, {
      type: 'COMMIT',
      edit: edit('second', 'page-a', 'SECOND'),
    });
    expect(state.present.map((item) => item.replacementText)).toEqual([
      'SECOND',
    ]);

    state = nativeTextEditReducer(state, { type: 'UNDO' });
    expect(state.present.map((item) => item.replacementText)).toEqual([
      'FIRST',
    ]);
    state = nativeTextEditReducer(state, { type: 'REDO' });
    expect(state.present.map((item) => item.replacementText)).toEqual([
      'SECOND',
    ]);
    expect(Object.isFrozen(state.present[0])).toBe(true);
    expect(Object.isFrozen(state.present[0]?.identity.textMatrix)).toBe(true);
  });

  it('removes page-local edits and prunes all history for deleted pages', () => {
    let state = nativeTextEditReducer(createNativeTextEditHistory(), {
      type: 'COMMIT',
      edit: edit('a', 'page-a'),
    });
    state = nativeTextEditReducer(state, {
      type: 'COMMIT',
      edit: edit('b', 'page-b'),
    });
    state = nativeTextEditReducer(state, {
      type: 'REMOVE',
      id: 'b',
    });
    state = nativeTextEditReducer(state, {
      type: 'PRUNE',
      pageIds: ['page-a'],
    });

    expect(state.present).toEqual([]);
    expect(
      [...state.past, ...state.future]
        .flat()
        .some((item) => item.workspacePageId === 'page-a'),
    ).toBe(false);
  });

  it('snapshots only current workspace pages without exposing mutable edits', () => {
    let state = nativeTextEditReducer(createNativeTextEditHistory(), {
      type: 'COMMIT',
      edit: edit('a', 'page-a'),
    });
    state = nativeTextEditReducer(state, {
      type: 'COMMIT',
      edit: edit('b', 'page-b'),
    });

    const snapshot = snapshotNativeTextEdits(state, new Set(['page-b']));

    expect(snapshot).toHaveLength(1);
    expect(snapshot[0]?.workspacePageId).toBe('page-b');
    expect(snapshot).not.toBe(state.present);
    expect(Object.isFrozen(snapshot)).toBe(true);
  });
});
