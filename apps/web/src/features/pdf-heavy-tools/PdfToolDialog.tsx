import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { CloseIcon } from '../../components/icons';

export function PdfToolDialog({
  id,
  title,
  onClose,
  children,
}: {
  readonly id: string;
  readonly title: string;
  readonly onClose: () => void;
  readonly children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      const element = dialog.current;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key === 'Tab') {
        const controls = element?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), [href], [tabindex="0"]',
        );
        const first = controls?.[0],
          last = controls?.[controls.length - 1];
        if (
          first &&
          last &&
          (event.shiftKey
            ? document.activeElement === first
            : document.activeElement === last)
        ) {
          event.preventDefault();
          (event.shiftKey ? last : first).focus();
        } else if (
          first &&
          !(event.target instanceof Node && element?.contains(event.target))
        ) {
          event.preventDefault();
          first.focus();
        }
      }
      if (!(event.target instanceof Node) || !element?.contains(event.target))
        event.stopPropagation();
    };
    document.addEventListener('keydown', key, true);
    return () => document.removeEventListener('keydown', key, true);
  }, [onClose]);
  return (
    <dialog
      ref={dialog}
      className="extract-dialog compress-dialog"
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-privacy`}
      onKeyDown={(event) => event.stopPropagation()}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className="extract-dialog-heading">
        <h2 id={`${id}-title`}>{title}</h2>
        <button
          type="button"
          className="icon-button"
          aria-label={`Close ${title}`}
          onClick={onClose}
        >
          <CloseIcon className="size-4" />
        </button>
      </div>
      {children}
    </dialog>
  );
}
