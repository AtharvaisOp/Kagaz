import type { TextEditSession } from './textEditSession';

/** Meaningful transient annotation work that Start Over must protect. */
export function hasUnsavedAnnotationWork(
  annotationDirty: boolean,
  textEditSession: Pick<TextEditSession, 'text'> | null,
  pendingImage: boolean,
  pendingSignature = false,
): boolean {
  return (
    annotationDirty ||
    pendingImage ||
    pendingSignature ||
    (textEditSession?.text.trim().length ?? 0) > 0
  );
}
