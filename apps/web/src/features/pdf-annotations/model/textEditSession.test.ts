import { describe, expect, it } from 'vitest';

import { createAnnotationHistoryState } from './history';
import { annotationReducer } from './reducer';
import {
  canRetainTextEditSession,
  createTextEditBoundary,
  textAnnotationFromSession,
  type TextEditSession,
} from './textEditSession';

const session: TextEditSession = {
  sessionId: 'session-1',
  mode: 'create',
  workspacePageId: 'page-1',
  annotationId: 'text-1',
  box: { origin: { x: 10, y: 100 }, width: 200, height: 80, rotation: 0 },
  text: 'Hello\nKagaz',
  fontSizeUserUnits: 14,
  lineHeight: 1.2,
  align: 'center',
  color: { r: 0, g: 0, b: 0 },
  opacity: 0.8,
  original: null,
};

describe('text edit session boundary', () => {
  it('turns arbitrary typing into one durable creation commit', () => {
    let state = createAnnotationHistoryState();
    const boundary = createTextEditBoundary();
    boundary.begin(session.sessionId);
    const typed = { ...session, text: 'Many keystrokes, one commit' };
    const annotation = textAnnotationFromSession(typed);
    expect(annotation).not.toBeNull();
    if (annotation && boundary.complete(session.sessionId)) {
      state = annotationReducer(state, { type: 'ADD_ANNOTATION', annotation });
    }
    expect(state.past).toHaveLength(1);
    expect(state.present.byPage['page-1']?.[0]).toMatchObject({
      text: typed.text,
    });
  });

  it('makes Ctrl+Enter followed by blur idempotent', () => {
    const boundary = createTextEditBoundary();
    boundary.begin(session.sessionId);
    expect(boundary.complete(session.sessionId)).toBe(true);
    expect(boundary.complete(session.sessionId)).toBe(false);
  });

  it('commits a complete existing-text edit as one undo unit', () => {
    const original = textAnnotationFromSession(session);
    expect(original).not.toBeNull();
    if (!original) return;
    let state = annotationReducer(createAnnotationHistoryState(), {
      type: 'ADD_ANNOTATION',
      annotation: original,
    });
    const afterCreation = state.past.length;
    const boundary = createTextEditBoundary();
    const editing: TextEditSession = {
      ...session,
      sessionId: 'session-edit',
      mode: 'edit',
      original,
      text: 'Several typing frames, one final value',
    };
    boundary.begin(editing.sessionId);
    const edited = textAnnotationFromSession(editing);
    if (edited && boundary.complete(editing.sessionId)) {
      state = annotationReducer(state, {
        type: 'REPLACE_ANNOTATION',
        annotation: edited,
      });
    }

    expect(state.past).toHaveLength(afterCreation + 1);
    state = annotationReducer(state, { type: 'UNDO' });
    expect(state.present.byPage['page-1']?.[0]).toEqual(original);
  });

  it('creates nothing for whitespace and restores existing text on cancel', () => {
    expect(textAnnotationFromSession({ ...session, text: '  \n ' })).toBeNull();
    const boundary = createTextEditBoundary();
    boundary.begin(session.sessionId);
    boundary.cancel();
    expect(boundary.complete(session.sessionId)).toBe(false);
  });

  it('survives viewport-only rerenders but cancels on page or annotation disappearance', () => {
    const existing = textAnnotationFromSession(session);
    expect(existing).not.toBeNull();
    if (!existing) return;
    const editing = { ...session, mode: 'edit' as const, original: existing };
    expect(canRetainTextEditSession(editing, ['page-1'], [existing])).toBe(
      true,
    );
    expect(canRetainTextEditSession(editing, [], [existing])).toBe(false);
    expect(canRetainTextEditSession(editing, ['page-1'], [])).toBe(false);
    expect(canRetainTextEditSession(session, ['page-1'], [])).toBe(true);
  });
});
