import type { WatermarkConfig, WatermarkHistoryState } from './types';
import {
  equalWatermarks,
  pruneWatermark,
  snapshotWatermark,
  validateWatermarkModel,
} from './watermark';

export type WatermarkAction =
  | {
      readonly type: 'APPLY';
      readonly config: WatermarkConfig;
      readonly transactionId: string;
    }
  | { readonly type: 'REMOVE'; readonly transactionId: string }
  | { readonly type: 'PRUNE'; readonly pageIds: readonly string[] }
  | { readonly type: 'UNDO' | 'REDO' | 'RESET' | 'DISCARD_FUTURE' };

export function createWatermarkHistory(): WatermarkHistoryState {
  return { past: [], present: null, future: [] };
}

/** Lets the unified timeline remove only transitions collapsed by lifecycle or capacity. */
export function removedWatermarkTransactionIds(
  before: WatermarkHistoryState,
  after: WatermarkHistoryState,
): readonly string[] {
  const retained = new Set(
    [...after.past, ...after.future].map((entry) => entry.transactionId),
  );
  return [...before.past, ...before.future]
    .map((entry) => entry.transactionId)
    .filter((id) => !retained.has(id));
}

function commit(
  state: WatermarkHistoryState,
  present: WatermarkConfig | null,
  transactionId: string,
): WatermarkHistoryState {
  return equalWatermarks(state.present, present)
    ? state
    : {
        past: [...state.past, { config: state.present, transactionId }].slice(
          -100,
        ),
        present,
        future: [],
      };
}

export function watermarkReducer(
  state: WatermarkHistoryState,
  action: WatermarkAction,
): WatermarkHistoryState {
  switch (action.type) {
    case 'APPLY':
      return validateWatermarkModel(action.config)
        ? state
        : commit(state, snapshotWatermark(action.config), action.transactionId);
    case 'REMOVE':
      return commit(state, null, action.transactionId);
    case 'UNDO': {
      const entry = state.past.at(-1);
      return entry
        ? {
            past: state.past.slice(0, -1),
            present: entry.config,
            future: [
              { config: state.present, transactionId: entry.transactionId },
              ...state.future,
            ],
          }
        : state;
    }
    case 'REDO': {
      const entry = state.future[0];
      return entry
        ? {
            past: [
              ...state.past,
              { config: state.present, transactionId: entry.transactionId },
            ],
            present: entry.config,
            future: state.future.slice(1),
          }
        : state;
    }
    case 'DISCARD_FUTURE':
      return state.future.length ? { ...state, future: [] } : state;
    case 'RESET':
      return createWatermarkHistory();
    case 'PRUNE': {
      const available = new Set(action.pageIds);
      const present = pruneWatermark(state.present, available);
      const prunedPast = state.past.map((entry) => ({
        ...entry,
        config: pruneWatermark(entry.config, available),
      }));
      const prunedFuture = state.future.map((entry) => ({
        ...entry,
        config: pruneWatermark(entry.config, available),
      }));
      const past = prunedPast.filter(
        (entry, index) =>
          !equalWatermarks(
            entry.config,
            index + 1 < prunedPast.length
              ? prunedPast[index + 1]!.config
              : present,
          ),
      );
      const future = prunedFuture.filter(
        (entry, index) =>
          !equalWatermarks(
            entry.config,
            index ? prunedFuture[index - 1]!.config : present,
          ),
      );
      return { present, past, future };
    }
  }
}
