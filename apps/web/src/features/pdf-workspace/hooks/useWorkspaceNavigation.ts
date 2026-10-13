import { useCallback, useEffect, useRef } from 'react';

import { chooseMostVisiblePage, type PageVisibility } from '../navigation';

import type { WorkspacePage, WorkspacePageId } from '../model/types';

interface WorkspaceNavigationOptions {
  readonly pages: readonly WorkspacePage[];
  readonly selectedPageId: WorkspacePageId | null;
  readonly onSelectPage: (pageId: WorkspacePageId) => void;
}

export interface WorkspaceNavigation {
  readonly registerPage: (
    pageId: WorkspacePageId,
    element: HTMLElement | null,
  ) => void;
  readonly scrollToPage: (pageId: WorkspacePageId) => void;
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

export function useWorkspaceNavigation({
  pages,
  selectedPageId,
  onSelectPage,
}: WorkspaceNavigationOptions): WorkspaceNavigation {
  const pageElementsRef = useRef(new Map<WorkspacePageId, HTMLElement>());
  const selectedPageIdRef = useRef(selectedPageId);
  const visibilityRef = useRef(new Map<WorkspacePageId, PageVisibility>());
  const explicitSelectionRef = useRef<WorkspacePageId | null>(null);

  useEffect(() => {
    selectedPageIdRef.current = selectedPageId;
  }, [selectedPageId]);

  useEffect(() => {
    if (
      explicitSelectionRef.current &&
      !pages.some((page) => page.id === explicitSelectionRef.current)
    )
      explicitSelectionRef.current = null;
  }, [pages]);

  const registerPage = useCallback(
    (pageId: WorkspacePageId, element: HTMLElement | null) => {
      if (element) {
        pageElementsRef.current.set(pageId, element);
      } else {
        pageElementsRef.current.delete(pageId);
        visibilityRef.current.delete(pageId);
        // Callback refs briefly detach during rerenders; only clear if it stays absent.
        if (explicitSelectionRef.current === pageId)
          queueMicrotask(() => {
            if (!pageElementsRef.current.has(pageId))
              explicitSelectionRef.current = null;
          });
      }
    },
    [],
  );

  const scrollToPage = useCallback(
    (pageId: WorkspacePageId) => {
      explicitSelectionRef.current = pageId;
      selectedPageIdRef.current = pageId;
      onSelectPage(pageId);
      pageElementsRef.current.get(pageId)?.scrollIntoView({
        behavior: prefersReducedMotion() ? 'auto' : 'smooth',
        block: 'start',
      });
    },
    [onSelectPage],
  );

  useEffect(() => {
    const resumeScrollSelection = (event: Event) => {
      if (
        event.target instanceof Element &&
        event.target.closest('.thumbnail-rail, dialog')
      )
        return;
      explicitSelectionRef.current = null;
    };
    const resumeOnScrollKey = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      if (
        event.target instanceof Element &&
        event.target.closest(
          'button, input, textarea, select, a, dialog, [role="button"], [role="slider"], [contenteditable="true"]',
        )
      )
        return;
      if (
        [
          'ArrowUp',
          'ArrowDown',
          'PageUp',
          'PageDown',
          'Home',
          'End',
          ' ',
        ].includes(event.key)
      )
        resumeScrollSelection(event);
    };
    window.addEventListener('wheel', resumeScrollSelection, { passive: true });
    window.addEventListener('touchstart', resumeScrollSelection, {
      passive: true,
    });
    window.addEventListener('keydown', resumeOnScrollKey);
    return () => {
      window.removeEventListener('wheel', resumeScrollSelection);
      window.removeEventListener('touchstart', resumeScrollSelection);
      window.removeEventListener('keydown', resumeOnScrollKey);
    };
  }, []);

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') {
      return;
    }

    const pageOrder = pages.map((page) => page.id);
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const pageId = (entry.target as HTMLElement).dataset.workspacePageId;
          if (!pageId) {
            continue;
          }

          visibilityRef.current.set(pageId, {
            pageId,
            ratio: entry.intersectionRatio,
            isIntersecting: entry.isIntersecting,
          });
        }

        const currentPageId = chooseMostVisiblePage(
          pageOrder,
          visibilityRef.current,
        );
        // Toolbar focus and smooth thumbnail jumps can scroll the viewport without
        // changing the page the user explicitly selected.
        if (explicitSelectionRef.current) return;
        if (currentPageId && currentPageId !== selectedPageIdRef.current) {
          onSelectPage(currentPageId);
        }
      },
      {
        rootMargin: '-12% 0px -56% 0px',
        threshold: [0, 0.25, 0.5, 0.75, 1],
      },
    );

    for (const page of pages) {
      const element = pageElementsRef.current.get(page.id);
      if (element) {
        observer.observe(element);
      }
    }

    return () => observer.disconnect();
  }, [onSelectPage, pages]);

  return { registerPage, scrollToPage };
}
