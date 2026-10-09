import { useLayoutEffect, useRef, useState } from 'react';

import type { WorkspacePageId } from '../../pdf-workspace/model/types';
import type { PdfAnnotationController } from '../hooks/usePdfAnnotations';
import type { AnnotationId, PdfAnnotation } from '../model/types';
import {
  adjacentAnnotationIdAfterDelete,
  annotationSummaryLabel,
  canResizeAnnotation,
  canResizeAnnotationByKeyboard,
  moveAnnotationByKeyboard,
  resizeAnnotationByKeyboard,
  type AnnotationMoveDirection,
  type AnnotationResizeAction,
} from './annotationSummary';

interface AnnotationSummaryProps {
  readonly controller: PdfAnnotationController;
  readonly pageId: WorkspacePageId | null;
  readonly onActivate?: () => void;
}

const moveDirections: readonly (readonly [AnnotationMoveDirection, string])[] =
  [
    ['left', 'Left'],
    ['right', 'Right'],
    ['up', 'Up'],
    ['down', 'Down'],
  ];

const resizeActions: readonly (readonly [AnnotationResizeAction, string])[] = [
  ['increase-width', 'Width +'],
  ['decrease-width', 'Width -'],
  ['increase-height', 'Height +'],
  ['decrease-height', 'Height -'],
];

const EMPTY_ANNOTATION_SUMMARY: readonly PdfAnnotation[] = Object.freeze([]);

type PendingFocus =
  | { readonly kind: 'annotation'; readonly annotationId: AnnotationId }
  | { readonly kind: 'heading' };

export function AnnotationSummary({
  controller,
  pageId,
  onActivate,
}: AnnotationSummaryProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const selectButtonRefs = useRef(new Map<AnnotationId, HTMLButtonElement>());
  const pendingFocusRef = useRef<PendingFocus | null>(null);
  const [expanded, setExpanded] = useState(true);
  const annotations = pageId
    ? controller.getAnnotationsForPage(pageId)
    : EMPTY_ANNOTATION_SUMMARY;

  useLayoutEffect(() => {
    const pending = pendingFocusRef.current;
    if (!pending) return;
    pendingFocusRef.current = null;
    if (pending.kind === 'heading') {
      headingRef.current?.focus();
    } else {
      selectButtonRefs.current.get(pending.annotationId)?.focus();
    }
  }, [annotations]);

  const commitMove = (
    annotation: PdfAnnotation,
    direction: AnnotationMoveDirection,
  ) =>
    controller.commitAnnotation(
      moveAnnotationByKeyboard(annotation, direction),
    );

  const commitResize = (
    annotation: PdfAnnotation,
    action: AnnotationResizeAction,
  ) =>
    controller.commitAnnotation(resizeAnnotationByKeyboard(annotation, action));

  return (
    <section
      className="annotation-summary"
      aria-labelledby="annotation-summary-title"
    >
      <div className="annotation-summary-header">
        <h2 ref={headingRef} id="annotation-summary-title" tabIndex={-1}>
          Annotations
        </h2>
        <span aria-label={`${annotations.length} annotations`}>
          {annotations.length}
        </span>
        <button
          type="button"
          className="annotation-summary-toggle"
          aria-expanded={expanded}
          aria-controls="annotation-summary-content"
          onClick={() => setExpanded((current) => !current)}
        >
          {expanded ? 'Hide' : 'Show'}
        </button>
      </div>
      <div
        id="annotation-summary-content"
        className="annotation-summary-content"
        hidden={!expanded}
      >
        {annotations.length === 0 ? (
          <p className="annotation-summary-empty">
            No annotations on this page.
          </p>
        ) : (
          <ol className="annotation-summary-list">
            {annotations.map((annotation, index) => {
              const selected =
                controller.selection?.workspacePageId === pageId &&
                controller.selection.annotationId === annotation.id;
              const fileName =
                annotation.kind === 'image'
                  ? controller.assetRegistry.get(annotation.assetId)?.fileName
                  : null;
              const label = annotationSummaryLabel(annotation, fileName);
              return (
                <li key={annotation.id} className="annotation-summary-item">
                  <button
                    ref={(node) => {
                      if (node) {
                        selectButtonRefs.current.set(annotation.id, node);
                      } else {
                        selectButtonRefs.current.delete(annotation.id);
                      }
                    }}
                    type="button"
                    className="annotation-summary-select"
                    aria-pressed={selected}
                    aria-label={`${label}, annotation ${index + 1}`}
                    onClick={() => {
                      onActivate?.();
                      if (pageId)
                        controller.selectAnnotation(pageId, annotation.id);
                    }}
                  >
                    <span
                      className="annotation-summary-index"
                      aria-hidden="true"
                    >
                      {index + 1}
                    </span>
                    <span className="annotation-summary-label">{label}</span>
                  </button>
                  {selected ? (
                    <div className="annotation-summary-actions">
                      <fieldset className="annotation-summary-action-group">
                        <legend className="sr-only">Move {label}</legend>
                        {moveDirections.map(([direction, directionLabel]) => (
                          <button
                            key={direction}
                            type="button"
                            className="annotation-summary-action"
                            aria-label={`Move ${label} ${direction}`}
                            onClick={() => commitMove(annotation, direction)}
                          >
                            {directionLabel}
                          </button>
                        ))}
                      </fieldset>
                      {canResizeAnnotation(annotation) ? (
                        <fieldset className="annotation-summary-action-group">
                          <legend className="sr-only">Resize {label}</legend>
                          {resizeActions.map(([action, actionLabel]) => (
                            <button
                              key={action}
                              type="button"
                              className="annotation-summary-action"
                              disabled={
                                !canResizeAnnotationByKeyboard(
                                  annotation,
                                  action,
                                )
                              }
                              aria-label={`${action.replace('-', ' ')} of ${label}`}
                              onClick={() => commitResize(annotation, action)}
                            >
                              {actionLabel}
                            </button>
                          ))}
                        </fieldset>
                      ) : null}
                      <fieldset className="annotation-summary-action-group">
                        <legend className="sr-only">
                          Layer order for {label}
                        </legend>
                        <button
                          type="button"
                          className="annotation-summary-action"
                          disabled={index === 0}
                          aria-label={`Move ${label} backward`}
                          onClick={() => {
                            if (!pageId) return;
                            controller.dispatch({
                              type: 'REORDER_ANNOTATION',
                              pageId,
                              annotationId: annotation.id,
                              toIndex: index - 1,
                            });
                          }}
                        >
                          Back
                        </button>
                        <button
                          type="button"
                          className="annotation-summary-action"
                          disabled={index === annotations.length - 1}
                          aria-label={`Move ${label} forward`}
                          onClick={() => {
                            if (!pageId) return;
                            controller.dispatch({
                              type: 'REORDER_ANNOTATION',
                              pageId,
                              annotationId: annotation.id,
                              toIndex: index + 1,
                            });
                          }}
                        >
                          Front
                        </button>
                      </fieldset>
                      {annotation.kind === 'text' ? (
                        <button
                          type="button"
                          className="annotation-summary-action"
                          aria-label={`Edit ${label}`}
                          onClick={() =>
                            controller.editTextAnnotation(annotation)
                          }
                        >
                          Edit
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="annotation-summary-action annotation-summary-delete"
                        aria-label={`Delete ${label}`}
                        onClick={() => {
                          if (!pageId) return;
                          const adjacentId = adjacentAnnotationIdAfterDelete(
                            annotations,
                            index,
                          );
                          pendingFocusRef.current = adjacentId
                            ? {
                                kind: 'annotation',
                                annotationId: adjacentId,
                              }
                            : { kind: 'heading' };
                          controller.deleteAnnotation(pageId, annotation.id);
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </section>
  );
}
