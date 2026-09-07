import type { AnnotationSelection } from '../model/types';

export interface OpacityCommit {
  readonly target: AnnotationSelection;
  readonly opacity: number;
}

export type OpacityInteractionState =
  | { readonly status: 'idle' }
  | {
      readonly status: 'active';
      readonly target: AnnotationSelection | null;
      readonly opacity: number;
      readonly changed: boolean;
    };

export const IDLE_OPACITY_INTERACTION: OpacityInteractionState = {
  status: 'idle',
};

export function beginOpacityInteraction(
  target: AnnotationSelection | null,
  opacity: number,
): OpacityInteractionState {
  return { status: 'active', target, opacity, changed: false };
}

export function updateOpacityInteraction(
  state: OpacityInteractionState,
  fallbackTarget: AnnotationSelection | null,
  opacity: number,
): OpacityInteractionState {
  if (state.status === 'idle') {
    return { status: 'active', target: fallbackTarget, opacity, changed: true };
  }

  return { ...state, opacity, changed: true };
}

export function completeOpacityInteraction(state: OpacityInteractionState): {
  readonly state: OpacityInteractionState;
  readonly commit: OpacityCommit | null;
} {
  return {
    state: IDLE_OPACITY_INTERACTION,
    commit:
      state.status === 'active' && state.changed && state.target
        ? { target: state.target, opacity: state.opacity }
        : null,
  };
}

export function sameAnnotationSelection(
  left: AnnotationSelection | null,
  right: AnnotationSelection | null,
): boolean {
  return (
    left !== null &&
    right !== null &&
    left.workspacePageId === right.workspacePageId &&
    left.annotationId === right.annotationId
  );
}

export function isOpacityAdjustmentKey(key: string): boolean {
  return (
    key === 'ArrowLeft' ||
    key === 'ArrowRight' ||
    key === 'ArrowUp' ||
    key === 'ArrowDown' ||
    key === 'Home' ||
    key === 'End' ||
    key === 'PageUp' ||
    key === 'PageDown'
  );
}
