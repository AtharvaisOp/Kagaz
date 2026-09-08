import { useEffect, useRef, useState } from 'react';
import { DragDropProvider } from '@dnd-kit/react';
import { isSortableOperation, useSortable } from '@dnd-kit/react/sortable';

import {
  ChevronDownIcon,
  ChevronUpIcon,
  CloseIcon,
  GripIcon,
  RotateIcon,
  TrashIcon,
} from '../../../components/icons';
import { ThumbnailCanvas } from './ThumbnailCanvas';
import type { AnnotationAssetRegistry } from '../../pdf-annotations/runtime/annotationAssetRegistry';
import type { PdfAnnotation } from '../../pdf-annotations/model/types';

import type { DragEndEvent } from '@dnd-kit/react';
import type { MouseEvent } from 'react';
import type { FileLoadIssue } from '../loading/types';
import type { SourceDocumentRegistry } from '../runtime/sourceDocumentRegistry';
import type {
  SourceDocumentId,
  SourceDocumentSummary,
  WorkspacePage,
  WorkspacePageId,
} from '../model/types';

interface ThumbnailRailProps {
  readonly pages: readonly WorkspacePage[];
  readonly sources: Readonly<Record<SourceDocumentId, SourceDocumentSummary>>;
  readonly registry: SourceDocumentRegistry;
  readonly selectedPageId: WorkspacePageId | null;
  readonly issues: readonly FileLoadIssue[];
  readonly mobileOpen: boolean;
  readonly onCloseMobile: () => void;
  readonly onSelectPage: (pageId: WorkspacePageId) => void;
  readonly onMovePage: (pageId: WorkspacePageId, toIndex: number) => void;
  readonly onDeletePage: (pageId: WorkspacePageId) => void;
  readonly onRotatePage: (pageId: WorkspacePageId, delta?: number) => void;
  readonly getAnnotationsForPage: (
    pageId: WorkspacePageId,
  ) => readonly PdfAnnotation[];
  readonly assetRegistry: AnnotationAssetRegistry;
}

interface ThumbnailItemProps {
  readonly page: WorkspacePage;
  readonly position: number;
  readonly totalPages: number;
  readonly selected: boolean;
  readonly source: SourceDocumentSummary | undefined;
  readonly document: ReturnType<SourceDocumentRegistry['getDocument']>;
  readonly railRoot: HTMLElement | null;
  readonly onSelect: (pageId: WorkspacePageId) => void;
  readonly onMove: (pageId: WorkspacePageId, toIndex: number) => void;
  readonly onDelete: (pageId: WorkspacePageId) => void;
  readonly onRotate: (pageId: WorkspacePageId) => void;
  readonly annotations: readonly PdfAnnotation[];
  readonly assetRegistry: AnnotationAssetRegistry;
}

function ThumbnailItem({
  page,
  position,
  totalPages,
  selected,
  source,
  document,
  railRoot,
  onSelect,
  onMove,
  onDelete,
  onRotate,
  annotations,
  assetRegistry,
}: ThumbnailItemProps) {
  const { isDragging, isDropping, isDropTarget, handleRef, ref } = useSortable({
    id: page.id,
    index: position,
    group: 'workspace-pages',
    transition: {
      duration: 180,
      easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
      idle: true,
    },
  });
  const sourcePageNumber = page.sourcePageIndex + 1;
  const sourceLabel = source?.fileName ?? 'PDF source';
  const classes = [
    'thumbnail-item',
    selected ? 'is-selected' : '',
    isDragging ? 'is-dragging' : '',
    isDropping ? 'is-dropping' : '',
    isDropTarget ? 'is-drop-target' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const stop = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
  };

  return (
    <li ref={ref} className={classes} data-thumbnail-page-id={page.id}>
      <div className="thumbnail-card">
        <button
          className="thumbnail-select"
          type="button"
          aria-current={selected ? 'page' : undefined}
          aria-label={`Page ${position + 1}, ${sourceLabel}, source page ${sourcePageNumber}`}
          onClick={() => onSelect(page.id)}
        >
          <ThumbnailCanvas
            page={page}
            document={document}
            root={railRoot}
            annotations={annotations}
            assetRegistry={assetRegistry}
          />
          <span className="thumbnail-page-number">
            {String(position + 1).padStart(2, '0')}
          </span>
          <span
            className="thumbnail-source-label"
            title={`${sourceLabel} · source page ${sourcePageNumber}`}
          >
            {sourceLabel} · p.{sourcePageNumber}
          </span>
        </button>
        <div
          className="thumbnail-actions"
          aria-label={`Actions for page ${position + 1}`}
        >
          <button
            ref={handleRef}
            className="thumbnail-action drag-handle"
            type="button"
            aria-label={`Drag page ${position + 1} to reorder`}
            title="Drag to reorder"
          >
            <GripIcon className="size-3.5" />
          </button>
          <button
            className="thumbnail-action"
            type="button"
            aria-label={`Move page ${position + 1} up`}
            disabled={position === 0}
            onClick={(event) => {
              stop(event);
              onMove(page.id, position - 1);
            }}
          >
            <ChevronUpIcon className="size-3.5" />
          </button>
          <button
            className="thumbnail-action"
            type="button"
            aria-label={`Move page ${position + 1} down`}
            disabled={position === totalPages - 1}
            onClick={(event) => {
              stop(event);
              onMove(page.id, position + 1);
            }}
          >
            <ChevronDownIcon className="size-3.5" />
          </button>
          <button
            className="thumbnail-action"
            type="button"
            aria-label={`Rotate page ${position + 1} clockwise 90 degrees`}
            onClick={(event) => {
              stop(event);
              onRotate(page.id);
            }}
          >
            <RotateIcon className="size-3.5" />
          </button>
          <button
            className="thumbnail-action thumbnail-delete"
            type="button"
            aria-label={`Delete page ${position + 1}`}
            disabled={totalPages <= 1}
            onClick={(event) => {
              stop(event);
              onDelete(page.id);
            }}
          >
            <TrashIcon className="size-3.5" />
          </button>
        </div>
      </div>
    </li>
  );
}

export function ThumbnailRail({
  pages,
  sources,
  registry,
  selectedPageId,
  issues,
  mobileOpen,
  onCloseMobile,
  onSelectPage,
  onMovePage,
  onDeletePage,
  onRotatePage,
  getAnnotationsForPage,
  assetRegistry,
}: ThumbnailRailProps) {
  const [railRoot, setRailRoot] = useState<HTMLElement | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const pendingFocusPageId = useRef<WorkspacePageId | null>(null);
  const pageOrder = pages.map((page) => page.id);

  useEffect(() => {
    if (!pendingFocusPageId.current) return;
    const pageId = pendingFocusPageId.current;
    pendingFocusPageId.current = null;
    const button = railRoot?.querySelector<HTMLButtonElement>(
      `[data-thumbnail-page-id="${CSS.escape(pageId)}"] .thumbnail-select`,
    );
    button?.focus();
  }, [pages, railRoot, selectedPageId]);

  useEffect(() => {
    if (mobileOpen) {
      railRoot?.focus();
    }
  }, [mobileOpen, railRoot]);

  const handleDelete = (pageId: WorkspacePageId) => {
    const position = pageOrder.indexOf(pageId);
    pendingFocusPageId.current = pageOrder[Math.max(0, position - 1)] ?? null;
    onDeletePage(pageId);
    setAnnouncement(`Page ${position + 1} deleted.`);
  };

  const handleMove = (pageId: WorkspacePageId, toIndex: number) => {
    onMovePage(pageId, toIndex);
    setAnnouncement(`Page moved to position ${toIndex + 1}.`);
  };

  const handleRotate = (pageId: WorkspacePageId) => {
    onRotatePage(pageId);
    const position = pageOrder.indexOf(pageId);
    setAnnouncement(`Page ${position + 1} rotated 90 degrees clockwise.`);
  };

  return (
    <>
      {mobileOpen ? (
        <button
          className="mobile-page-scrim"
          type="button"
          aria-label="Close page manager"
          onClick={onCloseMobile}
        />
      ) : null}
      <aside
        ref={setRailRoot}
        id="thumbnail-rail"
        className="thumbnail-rail"
        data-mobile-open={mobileOpen || undefined}
        aria-label="Workspace pages"
        tabIndex={mobileOpen ? -1 : undefined}
      >
        <div className="sr-only" role="status" aria-live="polite">
          {announcement}
        </div>
        <div className="thumbnail-rail-header">
          <div>
            <p className="thumbnail-eyebrow">Page manager</p>
            <h2>
              Pages <span>{pages.length}</span>
            </h2>
          </div>
          <button
            className="icon-button thumbnail-close"
            type="button"
            aria-label="Close page manager"
            onClick={onCloseMobile}
          >
            <CloseIcon className="size-4" />
          </button>
        </div>
        {issues.length > 0 ? (
          <p className="thumbnail-issues" role="status">
            {issues.length} file issue{issues.length === 1 ? '' : 's'} reported
            below.
          </p>
        ) : null}
        <DragDropProvider
          onDragEnd={(event: DragEndEvent) => {
            if (event.canceled || !isSortableOperation(event.operation)) return;
            const sourceId = event.operation.source?.id;
            const targetIndex = event.operation.target?.index;
            if (
              (typeof sourceId !== 'string' && typeof sourceId !== 'number') ||
              typeof targetIndex !== 'number'
            )
              return;
            handleMove(String(sourceId), targetIndex);
          }}
        >
          <ol className="thumbnail-list">
            {pages.map((page, position) => (
              <ThumbnailItem
                key={page.id}
                page={page}
                position={position}
                totalPages={pages.length}
                selected={page.id === selectedPageId}
                source={sources[page.sourceDocumentId]}
                document={registry.getDocument(page.sourceDocumentId)}
                railRoot={railRoot}
                onSelect={onSelectPage}
                onMove={handleMove}
                onDelete={handleDelete}
                onRotate={handleRotate}
                annotations={getAnnotationsForPage(page.id)}
                assetRegistry={assetRegistry}
              />
            ))}
          </ol>
        </DragDropProvider>
      </aside>
    </>
  );
}
