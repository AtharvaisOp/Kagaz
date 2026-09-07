import type { TextEditSession } from './textEditSession';

/** Meaningful transient annotation work that Start Over must protect. */
export function hasUnsavedAnnotationWork(
  annotationDirty: boolean,
  textEditSession: Pick<TextEditSession, 'text'> | null,
  pendingImage: boolean,
): boolean {
  return (
    annotationDirty ||
    pendingImage ||
    (textEditSession?.text.trim().length ?? 0) > 0
  );
}
