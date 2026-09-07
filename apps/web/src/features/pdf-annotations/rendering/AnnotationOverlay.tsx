import { useEffect, useLayoutEffect, useRef } from 'react';
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
  type AnnotationGestureSnapshot,
} from './annotationGesture';
import { KonvaAnnotationNode } from './KonvaAnnotationNode';

import { viewportPointToPdfPoint } from '../geometry/coordinateTransforms';
import type { PdfAnnotation } from '../model/types';

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
}

function isBoxNode(annotation: PdfAnnotation): boolean {
  return (
    isBoxAnnotation(annotation) &&
    annotation.kind !== 'text' &&
    annotation.kind !== 'image'
  );
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
}: AnnotationOverlayProps) {
  const nodeRefs = useRef(new Map<string, Konva.Node>());
  const transformerRef = useRef<Konva.Transformer>(null);
  const gestureRef = useRef<AnnotationGestureSnapshot | null>(null);
  const selectedAnnotation = annotations.find(
    (annotation) => annotation.id === selectedAnnotationId,
  );

  useEffect(() => {
    gestureRef.current = null;
  }, [viewportSignature]);

  useLayoutEffect(() => {
    const transformer = transformerRef.current;
    if (!transformer) {
      return;
    }

    const node =
      selectedAnnotation && isBoxNode(selectedAnnotation)
        ? nodeRefs.current.get(selectedAnnotation.id)
        : undefined;
    transformer.nodes(node ? [node] : []);
    transformer.getLayer()?.batchDraw();
  }, [selectedAnnotation]);

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

    const box = transformedAnnotationBox(
      gesture.annotation,
      {
        x: node.x(),
        y: node.y(),
        width: node.width(),
        height: node.height(),
        scaleX: node.scaleX(),
        scaleY: node.scaleY(),
      },
      viewport,
    );
    node.scale({ x: 1, y: 1 });
    if (!box) {
      return;
    }

    onCommitAnnotation(replaceAnnotationBox(gesture.annotation, box));
  };

  return (
    <div
      className="annotation-overlay"
      data-annotation-overlay="true"
      data-viewport-signature={viewportSignature}
      style={{ width: viewport.width, height: viewport.height }}
    >
      <Stage
        width={viewport.width}
        height={viewport.height}
        preventDefault={false}
        style={{ width: viewport.width, height: viewport.height }}
        onPointerDown={(event) => {
          if (event.target === event.currentTarget) {
            onSelectAnnotation(workspacePageId, null);
          }
        }}
      >
        <Layer>
          {annotations.map((annotation) => (
            <KonvaAnnotationNode
              key={annotation.id}
              annotation={annotation}
              viewport={viewport}
              selected={annotation.id === selectedAnnotationId}
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
            />
          ))}
          <Transformer
            ref={transformerRef}
            rotateEnabled={false}
            flipEnabled={false}
            keepRatio={false}
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
    </div>
  );
}
