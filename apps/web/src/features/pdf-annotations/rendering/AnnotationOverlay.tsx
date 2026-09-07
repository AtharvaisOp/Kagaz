import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import type Konva from 'konva';
import { Layer, Stage, Transformer } from 'react-konva';

import {
  replaceAnnotationBox,
  translateAnnotation,
  isBoxAnnotation,
  type AnnotationViewport,
} from './annotationProjection';
import {
  captureAnnotationGesture,
  constrainedTransformBox,
  gestureMatchesViewport,
  transformedAnnotationBox,
  transformedOrientedAnnotationBox,
  type AnnotationGestureSnapshot,
} from './annotationGesture';
import { KonvaAnnotationNode } from './KonvaAnnotationNode';
import { AnnotationDraft } from './AnnotationDraft';
import {
  createAnnotationFromDraft,
  createCreationDraftSession,
  type CreationDraft,
} from './annotationCreation';
import {
  createImagePlacementBox,
  createTextPlacementBox,
} from './annotationPlacement';
import { TextEditorOverlay } from './TextEditorOverlay';

import { viewportPointToPdfPoint } from '../geometry/coordinateTransforms';
import type {
  PdfAnnotation,
  PdfOrientedBox,
  TextAnnotation,
} from '../model/types';
import type { TextEditSession } from '../model/textEditSession';
import type { AnnotationAssetRegistry } from '../runtime/annotationAssetRegistry';
import type { PendingImagePlacement } from '../hooks/usePdfAnnotations';
import type {
  AnnotationStyleDefaults,
  AnnotationTool,
} from '../model/editorTypes';
import type { ViewportPoint } from '../geometry/coordinateTransforms';

interface AnnotationOverlayProps {
  readonly workspacePageId: string;
  readonly viewport: AnnotationViewport;
  readonly viewportSignature: string;
  readonly annotations: readonly PdfAnnotation[];
  readonly selectedAnnotationId: string | null;
  readonly onSelectAnnotation: (
    pageId: string,
    annotationId: string | null,
  ) => void;
  readonly onCommitAnnotation: (annotation: PdfAnnotation) => void;
  readonly activeTool: AnnotationTool;
  readonly styleDefaults: AnnotationStyleDefaults;
  readonly createAnnotationId: () => string;
  readonly onCreateAnnotation: (annotation: PdfAnnotation) => void;
  readonly assetRegistry: AnnotationAssetRegistry;
  readonly pendingImage: PendingImagePlacement | null;
  readonly textEditSession: TextEditSession | null;
  readonly onBeginTextCreation: (pageId: string, box: PdfOrientedBox) => void;
  readonly onEditText: (annotation: TextAnnotation) => void;
  readonly onUpdateText: (sessionId: string, text: string) => void;
  readonly onCommitText: (sessionId: string) => void;
  readonly onCancelText: (sessionId: string) => void;
  readonly onPlaceImage: (pageId: string, box: PdfOrientedBox) => void;
}

function isBoxNode(annotation: PdfAnnotation): boolean {
  return isBoxAnnotation(annotation);
}

function pdfDeltaFromViewportDelta(
  deltaX: number,
  deltaY: number,
  viewport: AnnotationViewport,
): { readonly x: number; readonly y: number } {
  const origin = viewportPointToPdfPoint({ x: 0, y: 0 }, viewport);
  const moved = viewportPointToPdfPoint({ x: deltaX, y: deltaY }, viewport);
  return { x: moved.x - origin.x, y: moved.y - origin.y };
}

export function AnnotationOverlay({
  workspacePageId,
  viewport,
  viewportSignature,
  annotations,
  selectedAnnotationId,
  onSelectAnnotation,
  onCommitAnnotation,
  activeTool,
  styleDefaults,
  createAnnotationId,
  onCreateAnnotation,
  assetRegistry,
  pendingImage,
  textEditSession,
  onBeginTextCreation,
  onEditText,
  onUpdateText,
  onCommitText,
  onCancelText,
  onPlaceImage,
}: AnnotationOverlayProps) {
  const nodeRefs = useRef(new Map<string, Konva.Node>());
  const transformerRef = useRef<Konva.Transformer>(null);
  const gestureRef = useRef<AnnotationGestureSnapshot | null>(null);
  const creationRef = useRef(createCreationDraftSession());
  const creationContextKey = `${workspacePageId}\0${viewportSignature}\0${activeTool}`;
  const [creationState, setCreationState] = useState<{
    readonly contextKey: string;
    readonly draft: CreationDraft | null;
  }>({ contextKey: creationContextKey, draft: null });
  if (creationState.contextKey !== creationContextKey) {
    setCreationState({ contextKey: creationContextKey, draft: null });
  }
  const creationDraft = creationState.draft;
  const creating = activeTool !== 'select';
  const selectedAnnotation = annotations.find(
    (annotation) => annotation.id === selectedAnnotationId,
  );

  const cancelCreation = useCallback(() => {
    creationRef.current.cancel();
    setCreationState({ contextKey: creationContextKey, draft: null });
  }, [creationContextKey]);

  useLayoutEffect(() => {
    gestureRef.current = null;
    creationRef.current.cancel();
  }, [activeTool, viewportSignature, workspacePageId]);

  useEffect(
    () => () => {
      creationRef.current.cancel();
    },
    [],
  );

  useLayoutEffect(() => {
    const transformer = transformerRef.current;
    if (!transformer) {
      return;
    }

    const node =
      selectedAnnotation && isBoxNode(selectedAnnotation)
        ? nodeRefs.current.get(selectedAnnotation.id)
        : undefined;
    transformer.nodes(!creating && node ? [node] : []);
    transformer.getLayer()?.batchDraw();
  }, [creating, selectedAnnotation]);

  const registerNode = (annotationId: string, node: Konva.Node | null) => {
    if (node) {
      nodeRefs.current.set(annotationId, node);
    } else {
      nodeRefs.current.delete(annotationId);
    }
  };

  const handleDragStart = (annotation: PdfAnnotation, node: Konva.Node) => {
    onSelectAnnotation(workspacePageId, annotation.id);
    gestureRef.current = captureAnnotationGesture(
      annotation,
      viewportSignature,
      {
        x: node.x(),
        y: node.y(),
        width: node.width(),
        height: node.height(),
        scaleX: node.scaleX(),
        scaleY: node.scaleY(),
        rotation: node.rotation(),
      },
    );
  };

  const handleTransformStart = (
    annotation: PdfAnnotation,
    node: Konva.Node,
  ) => {
    onSelectAnnotation(workspacePageId, annotation.id);
    gestureRef.current = captureAnnotationGesture(
      annotation,
      viewportSignature,
      {
        x: node.x(),
        y: node.y(),
        width: node.width(),
        height: node.height(),
        scaleX: node.scaleX(),
        scaleY: node.scaleY(),
        rotation: node.rotation(),
      },
    );
  };

  const handleDragEnd = (node: Konva.Node) => {
    const gesture = gestureRef.current;
    gestureRef.current = null;
    if (!gesture || !gestureMatchesViewport(gesture, viewportSignature)) {
      node.position({
        x: gesture ? gesture.start.x : node.x(),
        y: gesture ? gesture.start.y : node.y(),
      });
      return;
    }

    const delta = pdfDeltaFromViewportDelta(
      node.x() - gesture.start.x,
      node.y() - gesture.start.y,
      viewport,
    );
    node.position({ x: gesture.start.x, y: gesture.start.y });
    onCommitAnnotation(translateAnnotation(gesture.annotation, delta));
  };

  const handleTransformEnd = (node: Konva.Node) => {
    const gesture = gestureRef.current;
    gestureRef.current = null;
    if (!gesture || !gestureMatchesViewport(gesture, viewportSignature)) {
      node.scale({ x: 1, y: 1 });
      if (gesture) {
        node.position({ x: gesture.start.x, y: gesture.start.y });
      }
      return;
    }

    const box =
      gesture.annotation.kind === 'text' || gesture.annotation.kind === 'image'
        ? transformedOrientedAnnotationBox(
            gesture.annotation,
            {
              x: node.x(),
              y: node.y(),
              width: node.width(),
              height: node.height(),
              scaleX: node.scaleX(),
              scaleY: node.scaleY(),
              rotation: node.rotation(),
            },
            viewport,
          )
        : transformedAnnotationBox(
            gesture.annotation,
            {
              x: node.x(),
              y: node.y(),
              width: node.width(),
              height: node.height(),
              scaleX: node.scaleX(),
              scaleY: node.scaleY(),
              rotation: node.rotation(),
            },
            viewport,
          );
    node.scale({ x: 1, y: 1 });
    if (!box) {
      return;
    }

    onCommitAnnotation(replaceAnnotationBox(gesture.annotation, box));
  };

  const stagePoint = (
    event: Konva.KonvaEventObject<PointerEvent>,
  ): ViewportPoint | null => {
    const point = event.target.getStage()?.getPointerPosition();
    return point && Number.isFinite(point.x) && Number.isFinite(point.y)
      ? { x: point.x, y: point.y }
      : null;
  };

  const handleCreationDown = (event: Konva.KonvaEventObject<PointerEvent>) => {
    if (!creating || event.target !== event.currentTarget) return;
    if (activeTool === 'image' && !pendingImage) return;
    const point = stagePoint(event);
    if (!point) return;
    const draft: CreationDraft = {
      tool: activeTool,
      workspacePageId,
      viewportSignature,
      viewport,
      start: point,
      current: point,
      points: [point],
    };
    creationRef.current.begin(draft);
    setCreationState({ contextKey: creationContextKey, draft });
  };

  const handleCreationMove = (event: Konva.KonvaEventObject<PointerEvent>) => {
    const current = creationRef.current.current;
    if (!current) return;
    const point = stagePoint(event);
    if (!point) return;
    const points =
      current.tool === 'freehand' ? [...current.points, point] : current.points;
    const next = { ...current, current: point, points };
    creationRef.current.update(next);
    setCreationState({ contextKey: creationContextKey, draft: next });
  };

  const handleCreationUp = (event: Konva.KonvaEventObject<PointerEvent>) => {
    const current = creationRef.current.complete({
      tool: activeTool,
      workspacePageId,
      viewportSignature,
    });
    setCreationState({ contextKey: creationContextKey, draft: null });
    if (!current) return;
    const point = stagePoint(event) ?? current.current;
    const draft = { ...current, current: point };
    if (draft.tool === 'text') {
      onBeginTextCreation(
        workspacePageId,
        createTextPlacementBox(draft.start, draft.current, draft.viewport),
      );
      return;
    }
    if (draft.tool === 'image') {
      if (!pendingImage) return;
      onPlaceImage(
        workspacePageId,
        createImagePlacementBox(
          draft.start,
          draft.current,
          pendingImage.width / pendingImage.height,
          draft.viewport,
        ),
      );
      return;
    }
    const annotation = createAnnotationFromDraft(
      draft,
      styleDefaults,
      createAnnotationId(),
    );
    if (annotation) onCreateAnnotation(annotation);
  };

  return (
    <div
      className={`annotation-overlay${creating ? ' annotation-overlay--creating' : ''}`}
      data-annotation-overlay="true"
      data-viewport-signature={viewportSignature}
      style={{
        width: viewport.width,
        height: viewport.height,
        touchAction: creating ? 'none' : 'pan-y',
      }}
    >
      <Stage
        width={viewport.width}
        height={viewport.height}
        preventDefault={false}
        style={{ width: viewport.width, height: viewport.height }}
        onPointerDown={(event) => {
          if (creating) {
            handleCreationDown(event);
          } else if (event.target === event.currentTarget) {
            onSelectAnnotation(workspacePageId, null);
          }
        }}
        onPointerMove={creating ? handleCreationMove : undefined}
        onPointerUp={creating ? handleCreationUp : undefined}
        onPointerCancel={creating ? cancelCreation : undefined}
        onPointerLeave={creating ? cancelCreation : undefined}
      >
        <Layer>
          {annotations.map((annotation) => (
            <KonvaAnnotationNode
              key={annotation.id}
              annotation={annotation}
              viewport={viewport}
              selected={annotation.id === selectedAnnotationId}
              interactive={!creating}
              nodeRef={(node) => registerNode(annotation.id, node)}
              onSelect={() =>
                onSelectAnnotation(workspacePageId, annotation.id)
              }
              onDragStart={(node) => handleDragStart(annotation, node)}
              onDragEnd={handleDragEnd}
              onTransformStart={(node) =>
                handleTransformStart(annotation, node)
              }
              onTransformEnd={(node) => {
                if (isBoxNode(annotation)) {
                  handleTransformEnd(node);
                }
              }}
              onEditText={() =>
                annotation.kind === 'text' && onEditText(annotation)
              }
              assetRegistry={assetRegistry}
            />
          ))}
          {creationDraft &&
          creationDraft.tool === activeTool &&
          creationDraft.viewportSignature === viewportSignature ? (
            <AnnotationDraft draft={creationDraft} styles={styleDefaults} />
          ) : null}
          <Transformer
            ref={transformerRef}
            visible={!creating && selectedAnnotation !== undefined}
            rotateEnabled={false}
            flipEnabled={false}
            keepRatio={selectedAnnotation?.kind === 'image'}
            enabledAnchors={[
              'top-left',
              'top-center',
              'top-right',
              'middle-left',
              'middle-right',
              'bottom-left',
              'bottom-center',
              'bottom-right',
            ]}
            boundBoxFunc={(oldBox, newBox) =>
              constrainedTransformBox(oldBox, newBox)
            }
          />
        </Layer>
      </Stage>
      {textEditSession ? (
        <TextEditorOverlay
          session={textEditSession}
          viewport={viewport}
          onChange={onUpdateText}
          onCommit={onCommitText}
          onCancel={onCancelText}
        />
      ) : null}
    </div>
  );
}
