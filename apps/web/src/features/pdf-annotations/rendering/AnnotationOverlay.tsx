import { useEffect, useLayoutEffect, useRef } from 'react';
import type Konva from 'konva';
import { Layer, Stage, Transformer } from 'react-konva';

import {
  replaceAnnotationBox,
  translateAnnotation,
  isBoxAnnotation,
  type AnnotationViewport,
} from './annotationProjection';
import { KonvaAnnotationNode } from './KonvaAnnotationNode';

import {
  viewportPointToPdfPoint,
  viewportRectToPdfOrientedBox,
} from '../geometry/coordinateTransforms';
import type { PdfAnnotation, PdfOrientedBox } from '../model/types';

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

interface GestureSnapshot {
  readonly annotation: PdfAnnotation;
  readonly signature: string;
  readonly startX: number;
  readonly startY: number;
}

function isBoxNode(annotation: PdfAnnotation): boolean {
  return (
    isBoxAnnotation(annotation) &&
    annotation.kind !== 'text' &&
    annotation.kind !== 'image'
  );
}

function createBoxFromNode(
  node: Konva.Node,
  viewport: AnnotationViewport,
  isEllipse: boolean,
): PdfOrientedBox | null {
  const scaleX = node.scaleX();
  const scaleY = node.scaleY();
  const width = node.width() * scaleX;
  const height = node.height() * scaleY;
  if (scaleX <= 0 || scaleY <= 0 || width <= 0 || height <= 0) {
    return null;
  }

  try {
    return viewportRectToPdfOrientedBox(
      {
        x: isEllipse ? node.x() - width / 2 : node.x(),
        y: isEllipse ? node.y() - height / 2 : node.y(),
        width,
        height,
      },
      viewport,
    );
  } catch {
    return null;
  }
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
  const gestureRef = useRef<GestureSnapshot | null>(null);
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
    gestureRef.current = {
      annotation,
      signature: viewportSignature,
      startX: node.x(),
      startY: node.y(),
    };
  };

  const handleDragEnd = (node: Konva.Node) => {
    const gesture = gestureRef.current;
    gestureRef.current = null;
    if (!gesture || gesture.signature !== viewportSignature) {
      node.position({
        x: gesture?.startX ?? node.x(),
        y: gesture?.startY ?? node.y(),
      });
      return;
    }

    const delta = pdfDeltaFromViewportDelta(
      node.x() - gesture.startX,
      node.y() - gesture.startY,
      viewport,
    );
    node.position({ x: gesture.startX, y: gesture.startY });
    onCommitAnnotation(translateAnnotation(gesture.annotation, delta));
  };

  const handleTransformEnd = (node: Konva.Node) => {
    const gesture = gestureRef.current;
    gestureRef.current = null;
    if (!gesture || gesture.signature !== viewportSignature) {
      node.scale({ x: 1, y: 1 });
      return;
    }

    const box = createBoxFromNode(
      node,
      viewport,
      gesture.annotation.kind === 'ellipse',
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
              newBox.width < 8 ||
              newBox.height < 8 ||
              newBox.width < 0 ||
              newBox.height < 0
                ? oldBox
                : newBox
            }
          />
        </Layer>
      </Stage>
    </div>
  );
}
