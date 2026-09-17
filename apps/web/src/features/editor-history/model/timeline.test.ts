import { describe, expect, it } from 'vitest';

import { EditorHistoryTimeline } from './timeline';
import type { EditorHistoryParticipant } from '../types';

function participant(): EditorHistoryParticipant & { edits: string[] } {
  const edits: string[] = [];
  return {
    edits,
    canUndo: true,
    canRedo: true,
    undo: () => {
      edits.push('undo');
      return true;
    },
    redo: () => {
      edits.push('redo');
      return true;
    },
    discardFuture: () => undefined,
  };
}

describe('editor history timeline', () => {
  it('undoes and redoes alternating annotation and form transactions chronologically', () => {
    const timeline = new EditorHistoryTimeline();
    const annotation = participant();
    const form = participant();
    timeline.bind({ annotation, form });
    timeline.record('annotation');
    timeline.record('form');
    timeline.record('annotation');
    timeline.undo();
    timeline.undo();
    timeline.undo();
    expect(annotation.edits).toEqual(['undo', 'undo']);
    expect(form.edits).toEqual(['undo']);
    timeline.redo();
    timeline.redo();
    timeline.redo();
    expect(annotation.edits).toEqual(['undo', 'undo', 'redo', 'redo']);
    expect(form.edits).toEqual(['undo', 'redo']);
  });

  it('discards every domain future after a new branch and removes pruned domains', () => {
    const timeline = new EditorHistoryTimeline();
    const annotation = participant();
    const form = participant();
    timeline.bind({ annotation, form });
    timeline.record('annotation');
    timeline.record('form');
    timeline.undo();
    timeline.record('annotation');
    expect(timeline.canRedo).toBe(false);
    timeline.pruneDomain('form');
    expect(timeline.canUndo).toBe(true);
    timeline.undo();
    expect(annotation.edits).toEqual(['undo']);
  });
});
