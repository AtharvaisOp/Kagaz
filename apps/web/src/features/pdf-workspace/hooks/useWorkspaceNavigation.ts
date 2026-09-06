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

  useEffect(() => {
    selectedPageIdRef.current = selectedPageId;
  }, [selectedPageId]);

  const registerPage = useCallback(
    (pageId: WorkspacePageId, element: HTMLElement | null) => {
      if (element) {
        pageElementsRef.current.set(pageId, element);
      } else {
        pageElementsRef.current.delete(pageId);
        visibilityRef.current.delete(pageId);
      }
    },
    [],
  );

  const scrollToPage = useCallback(
    (pageId: WorkspacePageId) => {
      onSelectPage(pageId);
      pageElementsRef.current.get(pageId)?.scrollIntoView({
        behavior: prefersReducedMotion() ? 'auto' : 'smooth',
        block: 'start',
      });
    },
    [onSelectPage],
  );

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
