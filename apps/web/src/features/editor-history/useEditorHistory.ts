import { useCallback, useMemo, useReducer, useRef } from 'react';

import { EditorHistoryTimeline } from './model/timeline';
import type {
  EditorHistoryBridge,
  EditorHistoryDomain,
  EditorHistoryParticipant,
} from './types';

export interface EditorHistoryController {
  readonly annotation: EditorHistoryBridge;
  readonly form: EditorHistoryBridge;
  readonly bind: (
    participants: Partial<
      Record<EditorHistoryDomain, EditorHistoryParticipant>
    >,
  ) => void;
  readonly pruneDomain: (domain: EditorHistoryDomain) => void;
  readonly reset: () => void;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly undo: () => void;
  readonly redo: () => void;
}

/** Coordinates chronological transactions while leaving each domain's snapshots intact. */
export function useEditorHistory(): EditorHistoryController {
  const [, rerender] = useReducer((value: number) => value + 1, 0);
  const timelineRef = useRef(new EditorHistoryTimeline());
  const signal = useCallback(() => rerender(), []);
  const bind = useCallback(
    (
      participants: Partial<
        Record<EditorHistoryDomain, EditorHistoryParticipant>
      >,
    ) => {
      timelineRef.current.bind(participants);
    },
    [],
  );
  const record = useCallback(
    (domain: EditorHistoryDomain) => {
      timelineRef.current.record(domain);
      signal();
    },
    [signal],
  );
  const undo = useCallback(() => {
    timelineRef.current.undo();
    signal();
  }, [signal]);
  const redo = useCallback(() => {
    timelineRef.current.redo();
    signal();
  }, [signal]);
  const pruneDomain = useCallback(
    (domain: EditorHistoryDomain) => {
      timelineRef.current.pruneDomain(domain);
      signal();
    },
    [signal],
  );
  const reset = useCallback(() => {
    timelineRef.current.reset();
    signal();
  }, [signal]);
  const createBridge = useCallback(
    (domain: EditorHistoryDomain): EditorHistoryBridge => ({
      get canUndo() {
        return timelineRef.current.canUndo;
      },
      get canRedo() {
        return timelineRef.current.canRedo;
      },
      record: () => record(domain),
      prune: () => pruneDomain(domain),
      undo,
      redo,
    }),
    [pruneDomain, record, redo, undo],
  );

  return useMemo(
    () => ({
      annotation: createBridge('annotation'),
      form: createBridge('form'),
      bind,
      pruneDomain,
      reset,
      get canUndo() {
        return timelineRef.current.canUndo;
      },
      get canRedo() {
        return timelineRef.current.canRedo;
      },
      undo,
      redo,
    }),
    [bind, createBridge, pruneDomain, redo, reset, undo],
  );
}
