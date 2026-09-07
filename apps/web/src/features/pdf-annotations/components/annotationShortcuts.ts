const PROTECTED_SHORTCUT_CONTEXT =
  'input, textarea, select, button, a[href], [contenteditable]:not([contenteditable="false"]), dialog, [role="dialog"]';

interface ClosestEventTarget extends EventTarget {
  closest(selectors: string): Element | null;
}

export interface AnnotationShortcutEvent {
  readonly key: string;
  readonly target: EventTarget | null;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
}

function hasClosest(target: EventTarget | null): target is ClosestEventTarget {
  return (
    target !== null &&
    typeof (target as Partial<ClosestEventTarget>).closest === 'function'
  );
}

export function isProtectedAnnotationShortcutContext(
  target: EventTarget | null,
): boolean {
  return hasClosest(target)
    ? target.closest(PROTECTED_SHORTCUT_CONTEXT) !== null
    : false;
}

export function shouldHandleAnnotationShortcut(
  event: AnnotationShortcutEvent,
): boolean {
  if (isProtectedAnnotationShortcutContext(event.target) || event.altKey) {
    return false;
  }

  const key = event.key.toLowerCase();
  const modifier = event.metaKey || event.ctrlKey;
  if (modifier) {
    return key === 'z' || (event.ctrlKey && key === 'y');
  }

  return (
    key === 'delete' ||
    key === 'backspace' ||
    key === 'escape' ||
    key === 'v' ||
    key === 'h' ||
    key === 'p' ||
    key === 'r' ||
    key === 'e' ||
    key === 'l'
  );
}
