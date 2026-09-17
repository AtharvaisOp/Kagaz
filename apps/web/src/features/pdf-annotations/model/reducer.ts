import {
  addAnnotation,
  createEmptyAnnotationDocument,
  deleteAnnotation,
  documentsHaveSameContent,
  reorderAnnotation,
  replaceAnnotation,
  updateAnnotation,
} from './operations';
import {
  commitAnnotationEdit,
  discardAnnotationFuture,
  redoAnnotationEdit,
  resetAnnotationHistory,
  undoAnnotationEdit,
} from './history';
import type {
  AnnotationDocument,
  AnnotationHistoryState,
  AnnotationId,
  AnnotationUpdate,
  PdfAnnotation,
} from './types';
import { isAnnotationDocument } from './validation';

export type AnnotationAction =
  | { readonly type: 'ADD_ANNOTATION'; readonly annotation: PdfAnnotation }
  | {
      readonly type: 'UPDATE_ANNOTATION';
      readonly pageId: string;
      readonly annotationId: AnnotationId;
      readonly update: AnnotationUpdate;
    }
  | { readonly type: 'REPLACE_ANNOTATION'; readonly annotation: PdfAnnotation }
  | {
      readonly type: 'DELETE_ANNOTATION';
      readonly pageId: string;
      readonly annotationId: AnnotationId;
    }
  | {
      readonly type: 'REORDER_ANNOTATION';
      readonly pageId: string;
      readonly annotationId: AnnotationId;
      readonly toIndex: number;
    }
  | {
      readonly type: 'PRUNE_REMOVED_PAGES';
      readonly pageIds: readonly string[];
    }
  | { readonly type: 'UNDO' }
  | { readonly type: 'REDO' }
  | { readonly type: 'DISCARD_FUTURE' }
  | {
      readonly type: 'RESET_ANNOTATIONS';
      readonly document?: AnnotationDocument;
    };

function pruneDocumentPages(
  document: AnnotationDocument,
  removedPageIds: ReadonlySet<string>,
): AnnotationDocument {
  const pageIds = Object.keys(document.byPage);
  if (!pageIds.some((pageId) => removedPageIds.has(pageId))) {
    return document;
  }

  const byPage = { ...document.byPage };
  for (const pageId of removedPageIds) {
    delete byPage[pageId];
  }
  return { byPage };
}

function pruneHistoryPages(
  state: AnnotationHistoryState,
  pageIds: readonly string[],
): AnnotationHistoryState {
  const removed = new Set(pageIds);
  if (removed.size === 0) {
    return state;
  }

  const present = pruneDocumentPages(state.present, removed);
  const baseline = pruneDocumentPages(state.baseline, removed);
  const past = normalizeAdjacentDocuments(
    state.past.map((document) => pruneDocumentPages(document, removed)),
  );
  const future = normalizeAdjacentDocuments(
    state.future.map((document) => pruneDocumentPages(document, removed)),
  );

  // The last past state and first future state are adjacent to present in the
  // undo timeline. Remove either when pruning made it content-identical so a
  // subsequent undo/redo can never become an invisible transition.
  const meaningfulPast =
    past.length > 0 && documentsHaveSameContent(past[past.length - 1]!, present)
      ? past.slice(0, -1)
      : past;
  const meaningfulFuture =
    future.length > 0 && documentsHaveSameContent(future[0]!, present)
      ? future.slice(1)
      : future;

  return {
    past: meaningfulPast,
    present,
    future: meaningfulFuture,
    baseline,
    dirty: !documentsHaveSameContent(present, baseline),
  };
}

function normalizeAdjacentDocuments(
  documents: readonly AnnotationDocument[],
): readonly AnnotationDocument[] {
  const normalized: AnnotationDocument[] = [];
  for (const document of documents) {
    const previous = normalized[normalized.length - 1];
    if (previous && documentsHaveSameContent(previous, document)) continue;
    normalized.push(document);
  }
  return normalized;
}

export function annotationReducer(
  state: AnnotationHistoryState,
  action: AnnotationAction,
): AnnotationHistoryState {
  switch (action.type) {
    case 'ADD_ANNOTATION':
      return commitAnnotationEdit(
        state,
        addAnnotation(state.present, action.annotation),
      );
    case 'UPDATE_ANNOTATION':
      return commitAnnotationEdit(
        state,
        updateAnnotation(
          state.present,
          action.pageId,
          action.annotationId,
          action.update,
        ),
      );
    case 'REPLACE_ANNOTATION':
      return commitAnnotationEdit(
        state,
        replaceAnnotation(state.present, action.annotation),
      );
    case 'DELETE_ANNOTATION':
      return commitAnnotationEdit(
        state,
        deleteAnnotation(state.present, action.pageId, action.annotationId),
      );
    case 'REORDER_ANNOTATION':
      return commitAnnotationEdit(
        state,
        reorderAnnotation(
          state.present,
          action.pageId,
          action.annotationId,
          action.toIndex,
        ),
      );
    case 'PRUNE_REMOVED_PAGES':
      return pruneHistoryPages(state, action.pageIds);
    case 'UNDO':
      return undoAnnotationEdit(state);
    case 'REDO':
      return redoAnnotationEdit(state);
    case 'DISCARD_FUTURE':
      return discardAnnotationFuture(state);
    case 'RESET_ANNOTATIONS': {
      const document = action.document ?? createEmptyAnnotationDocument();
      if (!isAnnotationDocument(document)) {
        return state;
      }
      return resetAnnotationHistory(document);
    }
    default:
      return state;
  }
}

export const annotationHistoryReducer = annotationReducer;

export { pruneDocumentPages };
