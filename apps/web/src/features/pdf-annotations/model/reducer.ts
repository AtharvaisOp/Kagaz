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
  const past = state.past.map((document) =>
    pruneDocumentPages(document, removed),
  );
  const future = state.future.map((document) =>
    pruneDocumentPages(document, removed),
  );

  return {
    past,
    present,
    future,
    baseline,
    dirty: !documentsHaveSameContent(present, baseline),
  };
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
