import type { WorkspacePageId } from '../../pdf-workspace/model/types';

import {
  isAnnotationDocument,
  isPdfAnnotation,
  validateAnnotation,
  validateAnnotationDocument,
} from './validation';

import type {
  AnnotationDocument,
  AnnotationId,
  AnnotationUpdate,
  PdfAnnotation,
} from './types';

export function createEmptyAnnotationDocument(): AnnotationDocument {
  return { byPage: {} };
}

export function getPageAnnotations(
  document: AnnotationDocument,
  pageId: WorkspacePageId,
): readonly PdfAnnotation[] {
  return document.byPage[pageId] ?? [];
}

function withPageAnnotations(
  document: AnnotationDocument,
  pageId: WorkspacePageId,
  annotations: readonly PdfAnnotation[],
): AnnotationDocument {
  const byPage = { ...document.byPage };
  if (annotations.length === 0) {
    delete byPage[pageId];
  } else {
    byPage[pageId] = annotations;
  }
  return { byPage };
}

function hasAnnotationId(
  document: AnnotationDocument,
  id: AnnotationId,
): boolean {
  return Object.values(document.byPage).some((annotations) =>
    annotations?.some((annotation) => annotation.id === id),
  );
}

export function addAnnotation(
  document: AnnotationDocument,
  annotation: PdfAnnotation,
): AnnotationDocument {
  validateAnnotationDocument(document);
  validateAnnotation(annotation);

  if (
    hasAnnotationId(document, annotation.id) ||
    annotation.workspacePageId.length === 0
  ) {
    return document;
  }

  const annotations = getPageAnnotations(document, annotation.workspacePageId);
  return withPageAnnotations(document, annotation.workspacePageId, [
    ...annotations,
    annotation,
  ]);
}

function applyUpdate(
  current: PdfAnnotation,
  update: AnnotationUpdate,
): PdfAnnotation {
  const candidate: unknown =
    typeof update === 'function' ? update(current) : { ...current, ...update };

  if (!isPdfAnnotation(candidate)) {
    return current;
  }

  const next = candidate;
  if (
    next.id !== current.id ||
    next.workspacePageId !== current.workspacePageId ||
    next.kind !== current.kind
  ) {
    return current;
  }

  return next;
}

export function updateAnnotation(
  document: AnnotationDocument,
  pageId: WorkspacePageId,
  annotationId: AnnotationId,
  update: AnnotationUpdate,
): AnnotationDocument {
  validateAnnotationDocument(document);
  const annotations = getPageAnnotations(document, pageId);
  const index = annotations.findIndex(
    (annotation) => annotation.id === annotationId,
  );
  const current = annotations[index];
  if (!current) {
    return document;
  }

  const next = applyUpdate(current, update);
  if (next === current || !isPdfAnnotation(next)) {
    return document;
  }

  const nextAnnotations = [...annotations];
  nextAnnotations[index] = next;
  return withPageAnnotations(document, pageId, nextAnnotations);
}

export function deleteAnnotation(
  document: AnnotationDocument,
  pageId: WorkspacePageId,
  annotationId: AnnotationId,
): AnnotationDocument {
  validateAnnotationDocument(document);
  const annotations = getPageAnnotations(document, pageId);
  const index = annotations.findIndex(
    (annotation) => annotation.id === annotationId,
  );
  if (index < 0) {
    return document;
  }

  return withPageAnnotations(document, pageId, [
    ...annotations.slice(0, index),
    ...annotations.slice(index + 1),
  ]);
}

export function reorderAnnotation(
  document: AnnotationDocument,
  pageId: WorkspacePageId,
  annotationId: AnnotationId,
  toIndex: number,
): AnnotationDocument {
  validateAnnotationDocument(document);
  const annotations = getPageAnnotations(document, pageId);
  const fromIndex = annotations.findIndex(
    (annotation) => annotation.id === annotationId,
  );

  if (
    fromIndex < 0 ||
    !Number.isInteger(toIndex) ||
    toIndex < 0 ||
    toIndex >= annotations.length ||
    fromIndex === toIndex
  ) {
    return document;
  }

  const nextAnnotations = [...annotations];
  const [annotation] = nextAnnotations.splice(fromIndex, 1);
  if (!annotation) {
    return document;
  }
  nextAnnotations.splice(toIndex, 0, annotation);
  return withPageAnnotations(document, pageId, nextAnnotations);
}

export const moveAnnotation = reorderAnnotation;

export function replaceAnnotation(
  document: AnnotationDocument,
  annotation: PdfAnnotation,
): AnnotationDocument {
  validateAnnotationDocument(document);
  validateAnnotation(annotation);
  const existing = getPageAnnotations(
    document,
    annotation.workspacePageId,
  ).find((candidate) => candidate.id === annotation.id);
  if (!existing) {
    return document;
  }

  return updateAnnotation(
    document,
    annotation.workspacePageId,
    annotation.id,
    () => annotation,
  );
}

export function documentsHaveSameContent(
  left: AnnotationDocument,
  right: AnnotationDocument,
): boolean {
  if (!isAnnotationDocument(left) || !isAnnotationDocument(right)) {
    return false;
  }

  const leftPages = Object.keys(left.byPage);
  const rightPages = Object.keys(right.byPage);
  if (leftPages.length !== rightPages.length) {
    return false;
  }

  return leftPages.every((pageId) => {
    const leftAnnotations = left.byPage[pageId] ?? [];
    const rightAnnotations = right.byPage[pageId];
    return (
      rightAnnotations !== undefined &&
      leftAnnotations.length === rightAnnotations.length &&
      leftAnnotations.every((annotation, index) =>
        valuesHaveSameContent(annotation, rightAnnotations[index]),
      )
    );
  });
}

function valuesHaveSameContent(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) {
    return true;
  }

  if (Array.isArray(left) && Array.isArray(right)) {
    return (
      left.length === right.length &&
      left.every((value, index) => valuesHaveSameContent(value, right[index]))
    );
  }

  if (
    typeof left !== 'object' ||
    left === null ||
    typeof right !== 'object' ||
    right === null
  ) {
    return false;
  }

  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord);
  const rightKeys = Object.keys(rightRecord);
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key) =>
        Object.prototype.hasOwnProperty.call(rightRecord, key) &&
        valuesHaveSameContent(leftRecord[key], rightRecord[key]),
    )
  );
}
