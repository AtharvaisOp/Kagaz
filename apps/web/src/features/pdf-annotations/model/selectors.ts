import type { WorkspacePageId } from '../../pdf-workspace/model/types';

import { getPageAnnotations } from './operations';

import type {
  AnnotationDocument,
  AnnotationId,
  AnnotationSelection,
  PdfAnnotation,
} from './types';

export function selectPageAnnotations(
  document: AnnotationDocument,
  pageId: WorkspacePageId,
): readonly PdfAnnotation[] {
  return getPageAnnotations(document, pageId);
}

export function selectAnnotation(
  document: AnnotationDocument,
  selection: AnnotationSelection | null,
): PdfAnnotation | null {
  if (!selection) {
    return null;
  }

  return (
    getPageAnnotations(document, selection.workspacePageId).find(
      (annotation) => annotation.id === selection.annotationId,
    ) ?? null
  );
}

export function hasAnnotation(
  document: AnnotationDocument,
  pageId: WorkspacePageId,
  annotationId: AnnotationId,
): boolean {
  return getPageAnnotations(document, pageId).some(
    (annotation) => annotation.id === annotationId,
  );
}
