export type EditorHistoryDomain = 'annotation' | 'form';

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
  readonly record: () => void;
  readonly prune: () => void;
  readonly undo: () => void;
  readonly redo: () => void;
}
