import type {
  AnnotationId,
  PdfAnnotation,
  PdfOrientedBox,
  RgbColor,
  TextAnnotation,
} from './types';

export interface TextEditSession {
  readonly sessionId: string;
  readonly mode: 'create' | 'edit';
  readonly workspacePageId: string;
  readonly annotationId: AnnotationId;
  readonly box: PdfOrientedBox;
  readonly text: string;
  readonly fontSizeUserUnits: number;
  readonly lineHeight: number;
  readonly align: 'left' | 'center' | 'right';
  readonly color: RgbColor;
  readonly opacity: number;
  readonly original: TextAnnotation | null;
}

export type TextEditSessionPatch = Partial<
  Pick<
    TextEditSession,
    | 'box'
    | 'text'
    | 'fontSizeUserUnits'
    | 'lineHeight'
    | 'align'
    | 'color'
    | 'opacity'
  >
>;

export function canRetainTextEditSession(
  session: TextEditSession,
  pageIds: readonly string[],
  pageAnnotations: readonly PdfAnnotation[],
): boolean {
  if (!pageIds.includes(session.workspacePageId)) return false;
  return (
    session.mode === 'create' ||
    pageAnnotations.some(
      (annotation) =>
        annotation.id === session.annotationId && annotation.kind === 'text',
    )
  );
}

export function textAnnotationFromSession(
  session: TextEditSession,
): TextAnnotation | null {
  if (session.text.trim().length === 0) return null;
  return {
    id: session.annotationId,
    workspacePageId: session.workspacePageId,
    kind: 'text',
    box: session.box,
    text: session.text,
    fontFamily: 'helvetica',
    fontSizeUserUnits: session.fontSizeUserUnits,
    lineHeight: session.lineHeight,
    align: session.align,
    color: session.color,
    opacity: session.opacity,
  };
}

export function createTextEditBoundary() {
  let activeSessionId: string | null = null;
  return {
    begin(sessionId: string) {
      activeSessionId = sessionId;
    },
    complete(sessionId: string): boolean {
      if (activeSessionId !== sessionId) return false;
      activeSessionId = null;
      return true;
    },
    cancel() {
      activeSessionId = null;
    },
  };
}
