import { describe, expect, it } from 'vitest';

import {
  isProtectedAnnotationShortcutContext,
  shouldHandleAnnotationShortcut,
} from './annotationShortcuts';

function targetInside(contextSelector: string): EventTarget {
  return {
    closest: (selectors: string) =>
      selectors
        .split(',')
        .map((selector) => selector.trim())
        .includes(contextSelector)
        ? {}
        : null,
  } as unknown as EventTarget;
}

function shortcutEvent(
  key: string,
  target: EventTarget,
  overrides: Partial<{
    ctrlKey: boolean;
    metaKey: boolean;
    altKey: boolean;
    shiftKey: boolean;
  }> = {},
) {
  return {
    key,
    target,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    ...overrides,
  };
}

const viewerBackground = targetInside('.viewer-background');

describe('annotation shortcut context', () => {
  it.each([
    'input',
    'textarea',
    'select',
    'button',
    'a[href]',
    '[contenteditable]:not([contenteditable="false"])',
    'dialog',
    '[role="dialog"]',
  ])('blocks shortcuts inside %s', (selector) => {
    const target = targetInside(selector);
    expect(isProtectedAnnotationShortcutContext(target)).toBe(true);
    expect(shouldHandleAnnotationShortcut(shortcutEvent('r', target))).toBe(
      false,
    );
  });

  it('blocks destructive, Escape, and history shortcuts in protected UI', () => {
    const input = targetInside('input');
    const dialog = targetInside('[role="dialog"]');

    expect(shouldHandleAnnotationShortcut(shortcutEvent('Delete', input))).toBe(
      false,
    );
    expect(
      shouldHandleAnnotationShortcut(shortcutEvent('Escape', dialog)),
    ).toBe(false);
    expect(
      shouldHandleAnnotationShortcut(
        shortcutEvent('z', input, { ctrlKey: true }),
      ),
    ).toBe(false);
    expect(
      shouldHandleAnnotationShortcut(
        shortcutEvent('z', input, { metaKey: true, shiftKey: true }),
      ),
    ).toBe(false);
    expect(
      shouldHandleAnnotationShortcut(
        shortcutEvent('y', input, { ctrlKey: true }),
      ),
    ).toBe(false);
  });

  it('allows the complete annotation shortcut set on the viewer background', () => {
    for (const key of [
      'v',
      't',
      'h',
      'p',
      'r',
      'e',
      'l',
      'Delete',
      'Backspace',
      'Escape',
    ]) {
      expect(
        shouldHandleAnnotationShortcut(shortcutEvent(key, viewerBackground)),
      ).toBe(true);
    }
    expect(
      shouldHandleAnnotationShortcut(
        shortcutEvent('z', viewerBackground, { ctrlKey: true }),
      ),
    ).toBe(true);
    expect(
      shouldHandleAnnotationShortcut(
        shortcutEvent('z', viewerBackground, {
          metaKey: true,
          shiftKey: true,
        }),
      ),
    ).toBe(true);
    expect(
      shouldHandleAnnotationShortcut(
        shortcutEvent('y', viewerBackground, { ctrlKey: true }),
      ),
    ).toBe(true);
  });

  it('does not turn modified letters or unrelated keys into tool shortcuts', () => {
    expect(
      shouldHandleAnnotationShortcut(
        shortcutEvent('v', viewerBackground, { ctrlKey: true }),
      ),
    ).toBe(false);
    expect(
      shouldHandleAnnotationShortcut(shortcutEvent('q', viewerBackground)),
    ).toBe(false);
  });
});
