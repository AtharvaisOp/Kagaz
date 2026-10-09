import { isRedactionBox } from './geometry';
import type { RedactionHistoryState, RedactionRegion } from './types';

export type RedactionAction =
  | { readonly type: 'ADD'; readonly region: RedactionRegion }
  | { readonly type: 'REPLACE'; readonly region: RedactionRegion }
  | { readonly type: 'REMOVE'; readonly id: string }
  | { readonly type: 'PRUNE'; readonly pageIds: readonly string[] }
  | { readonly type: 'UNDO' | 'REDO' | 'DISCARD_FUTURE' | 'RESET' };

export function createRedactionHistory(): RedactionHistoryState {
  return { past: [], present: [], future: [] };
}

function equal(
  first: readonly RedactionRegion[],
  second: readonly RedactionRegion[],
): boolean {
  return (
    first.length === second.length &&
    first.every((region, index) => {
      const other = second[index];
      return (
        other?.id === region.id &&
        other.pageId === region.pageId &&
        other.box.x === region.box.x &&
        other.box.y === region.box.y &&
        other.box.width === region.box.width &&
        other.box.height === region.box.height
      );
    })
  );
}

function commit(
  state: RedactionHistoryState,
  present: readonly RedactionRegion[],
): RedactionHistoryState {
  if (equal(present, state.present)) return state;
  return {
    past: [...state.past, state.present].slice(-100),
    present,
    future: [],
  };
}

function validRegion(region: RedactionRegion): boolean {
  return Boolean(region.id && region.pageId) && isRedactionBox(region.box);
}

export function redactionReducer(
  state: RedactionHistoryState,
  action: RedactionAction,
): RedactionHistoryState {
  switch (action.type) {
    case 'ADD':
      return !validRegion(action.region) ||
        state.present.some((region) => region.id === action.region.id)
        ? state
        : commit(state, [...state.present, action.region]);
    case 'REPLACE':
      return !validRegion(action.region) ||
        !state.present.some(
          (region) =>
            region.id === action.region.id &&
            region.pageId === action.region.pageId,
        )
        ? state
        : commit(
            state,
            state.present.map((region) =>
              region.id === action.region.id ? action.region : region,
            ),
          );
    case 'REMOVE':
      return commit(
        state,
        state.present.filter((region) => region.id !== action.id),
      );
    case 'UNDO': {
      const previous = state.past.at(-1);
      return previous
        ? {
            past: state.past.slice(0, -1),
            present: previous,
            future: [state.present, ...state.future],
          }
        : state;
    }
    case 'REDO': {
      const next = state.future[0];
      return next
        ? {
            past: [...state.past, state.present],
            present: next,
            future: state.future.slice(1),
          }
        : state;
    }
    case 'RESET':
      return createRedactionHistory();
    case 'DISCARD_FUTURE':
      return state.future.length ? { ...state, future: [] } : state;
    case 'PRUNE': {
      const removed = new Set(action.pageIds);
      const prune = (regions: readonly RedactionRegion[]) =>
        regions.filter((region) => !removed.has(region.pageId));
      const normalize = (snapshots: readonly (readonly RedactionRegion[])[]) =>
        snapshots.filter(
          (regions, index) => !index || !equal(regions, snapshots[index - 1]!),
        );
      const present = prune(state.present);
      const past = normalize(state.past.map(prune));
      const future = normalize(state.future.map(prune));
      return {
        present,
        past:
          past.length && equal(past.at(-1)!, present)
            ? past.slice(0, -1)
            : past,
        future:
          future.length && equal(future[0]!, present)
            ? future.slice(1)
            : future,
      };
    }
  }
}
