export type EditorHistoryDomain = 'annotation' | 'form' | 'redaction';

export type EditorHistoryEntityId = string;

export interface EditorHistoryParticipant {
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly undo: () => boolean;
  readonly redo: () => boolean;
  readonly discardFuture: () => void;
}

export interface EditorHistoryBridge {
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly record: (
    affectedEntityIds?: readonly EditorHistoryEntityId[],
  ) => void;
  readonly prune: (removedEntityIds?: readonly EditorHistoryEntityId[]) => void;
  readonly undo: () => void;
  readonly redo: () => void;
}
