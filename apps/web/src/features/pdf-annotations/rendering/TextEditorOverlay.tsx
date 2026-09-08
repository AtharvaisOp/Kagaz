import { useEffect, useRef } from 'react';

import { projectPdfBoxToOrientedFrame } from '../geometry/orientedFrame';
import type { TextEditSession } from '../model/textEditSession';
import type { AnnotationViewport } from './annotationProjection';
import { projectTextBoxInset, projectTextFontSize } from './textProjection';

interface TextEditorOverlayProps {
  readonly session: TextEditSession;
  readonly viewport: AnnotationViewport;
  readonly onChange: (sessionId: string, text: string) => void;
  readonly onCommit: (sessionId: string) => void;
  readonly onCancel: (sessionId: string) => void;
}

export function TextEditorOverlay({
  session,
  viewport,
  onChange,
  onCommit,
  onCancel,
}: TextEditorOverlayProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const frame = projectPdfBoxToOrientedFrame(session.box, viewport);

  useEffect(() => {
    textareaRef.current?.focus({ preventScroll: true });
    textareaRef.current?.select();
  }, [session.sessionId]);

  return (
    <textarea
      ref={textareaRef}
      className="annotation-text-editor"
      aria-label={
        session.mode === 'create'
          ? 'New annotation text'
          : 'Edit annotation text'
      }
      value={session.text}
      onChange={(event) => onChange(session.sessionId, event.target.value)}
      onBlur={() => onCommit(session.sessionId)}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Escape') {
          event.preventDefault();
          onCancel(session.sessionId);
        } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
          event.preventDefault();
          onCommit(session.sessionId);
        }
      }}
      style={{
        left: frame.x,
        top: frame.y,
        width: frame.width,
        height: frame.height,
        transform: `rotate(${frame.angle}deg)`,
        transformOrigin: 'top left',
        color: `rgba(${Math.round(session.color.r * 255)}, ${Math.round(
          session.color.g * 255,
        )}, ${Math.round(session.color.b * 255)}, ${session.opacity})`,
        fontSize: projectTextFontSize(session.fontSizeUserUnits, viewport),
        lineHeight: session.lineHeight,
        textAlign: session.align,
        padding: projectTextBoxInset(viewport),
      }}
    />
  );
}
