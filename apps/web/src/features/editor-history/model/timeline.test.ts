import { describe, expect, it, vi } from 'vitest';

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
  it('coordinates redactions between form and annotation edits and abandons redo in all three domains', () => {
    const timeline = new EditorHistoryTimeline();
    const annotation = { ...participant(), discardFuture: vi.fn() };
    const form = { ...participant(), discardFuture: vi.fn() };
    const redaction = { ...participant(), discardFuture: vi.fn() };
    timeline.bind({ annotation, form, redaction });
    timeline.record('form', ['field-a']);
    timeline.record('redaction', ['page-a']);
    timeline.record('annotation', ['page-b']);
    timeline.undo();
    timeline.undo();
    timeline.undo();
    expect(annotation.edits).toEqual(['undo']);
    expect(redaction.edits).toEqual(['undo']);
    expect(form.edits).toEqual(['undo']);
    timeline.redo();
    timeline.redo();
    expect(redaction.edits).toEqual(['undo', 'redo']);
    timeline.record('redaction', ['page-a']);
    expect(timeline.canRedo).toBe(false);
    expect(annotation.discardFuture).toHaveBeenCalledOnce();
    expect(form.discardFuture).toHaveBeenCalledOnce();
    expect(redaction.discardFuture).toHaveBeenCalledOnce();
  });

  it('removes only deleted-page redaction transactions while preserving other domains', () => {
    const timeline = new EditorHistoryTimeline();
    const redaction = participant();
    const form = participant();
    timeline.bind({ form, redaction });
    timeline.record('redaction', ['deleted-page']);
    timeline.record('form', ['remaining-field']);
    timeline.record('redaction', ['remaining-page']);
    timeline.pruneDomain('redaction', ['deleted-page']);
    timeline.undo();
    timeline.undo();
    expect(redaction.edits).toEqual(['undo']);
    expect(form.edits).toEqual(['undo']);
    expect(timeline.canUndo).toBe(false);
  });
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

  it('prunes only transactions tied to removed entities', () => {
    const timeline = new EditorHistoryTimeline();
    const form = participant();
    timeline.bind({ form });
    timeline.record('form', ['field-a']);
    timeline.record('form', ['field-b']);

    timeline.pruneDomain('form', ['field-b']);

    expect(timeline.canUndo).toBe(true);
    timeline.undo();
    expect(form.edits).toEqual(['undo']);
    expect(timeline.canUndo).toBe(false);
  });
});
