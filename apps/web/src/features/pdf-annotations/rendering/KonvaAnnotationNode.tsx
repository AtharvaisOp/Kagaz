import type Konva from 'konva';
import { Ellipse, Group, Line, Rect, Text } from 'react-konva';

import {
  annotationStrokeWidth,
  colorToRgba,
  flattenViewportPoints,
  projectAnnotation,
  type AnnotationViewport,
} from './annotationProjection';

import { pdfUserLengthToViewportPixels } from '../geometry/coordinateTransforms';

import type { PdfAnnotation } from '../model/types';

interface KonvaAnnotationNodeProps {
  readonly annotation: PdfAnnotation;
  readonly viewport: AnnotationViewport;
  readonly selected: boolean;
  readonly nodeRef: (node: Konva.Node | null) => void;
  readonly onSelect: () => void;
  readonly onDragStart: (node: Konva.Node) => void;
  readonly onDragEnd: (node: Konva.Node) => void;
  readonly onTransformEnd: (node: Konva.Node) => void;
}

function selectFromEvent(
  event: Konva.KonvaEventObject<PointerEvent>,
  onSelect: () => void,
): void {
  event.cancelBubble = true;
  onSelect();
}

export function KonvaAnnotationNode({
  annotation,
  viewport,
  selected,
  nodeRef,
  onSelect,
  onDragStart,
  onDragEnd,
  onTransformEnd,
}: KonvaAnnotationNodeProps) {
  const projection = projectAnnotation(annotation, viewport);
  const selectedStroke = selected ? '#06b6d4' : undefined;
  const strokeWidth = annotationStrokeWidth(annotation, viewport);

  if (annotation.kind === 'line' && projection.kind === 'line') {
    return (
      <Group
        ref={nodeRef}
        id={annotation.id}
        draggable
        preventDefault={false}
        onPointerDown={(event) => selectFromEvent(event, onSelect)}
        onDragStart={(event) => onDragStart(event.target)}
        onDragEnd={(event) => onDragEnd(event.target)}
      >
        <Line
          points={flattenViewportPoints(projection.points)}
          stroke={
            selectedStroke ??
            colorToRgba(annotation.stroke.color, annotation.stroke.opacity)
          }
          strokeWidth={strokeWidth}
          lineCap="round"
          lineJoin="round"
          listening={false}
        />
      </Group>
    );
  }

  if (annotation.kind === 'freehand' && projection.kind === 'freehand') {
    return (
      <Group
        ref={nodeRef}
        id={annotation.id}
        draggable
        preventDefault={false}
        onPointerDown={(event) => selectFromEvent(event, onSelect)}
        onDragStart={(event) => onDragStart(event.target)}
        onDragEnd={(event) => onDragEnd(event.target)}
      >
        <Line
          points={flattenViewportPoints(projection.points)}
          stroke={
            selectedStroke ??
            colorToRgba(annotation.stroke.color, annotation.stroke.opacity)
          }
          strokeWidth={strokeWidth}
          lineCap="round"
          lineJoin="round"
          tension={0.15}
          listening={false}
        />
      </Group>
    );
  }

  if (projection.kind !== 'box') {
    return null;
  }

  const { bounds } = projection;
  const interactive = annotation.kind !== 'text' && annotation.kind !== 'image';
  const common = {
    id: annotation.id,
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    draggable: interactive,
    preventDefault: false,
    onPointerDown: (event: Konva.KonvaEventObject<PointerEvent>) =>
      selectFromEvent(event, onSelect),
    onDragStart: (event: Konva.KonvaEventObject<DragEvent>) =>
      onDragStart(event.target),
    onDragEnd: (event: Konva.KonvaEventObject<DragEvent>) =>
      onDragEnd(event.target),
    onTransformEnd: (event: Konva.KonvaEventObject<Event>) =>
      onTransformEnd(event.target),
  };

  if (annotation.kind === 'ellipse') {
    const ellipseStroke =
      selectedStroke ??
      (annotation.stroke
        ? colorToRgba(annotation.stroke.color, annotation.stroke.opacity)
        : undefined);
    return (
      <Ellipse
        ref={nodeRef}
        {...common}
        x={bounds.x + bounds.width / 2}
        y={bounds.y + bounds.height / 2}
        radiusX={bounds.width / 2}
        radiusY={bounds.height / 2}
        fill={
          annotation.fill
            ? colorToRgba(annotation.fill.color, annotation.fill.opacity)
            : undefined
        }
        stroke={ellipseStroke}
        strokeWidth={strokeWidth}
      />
    );
  }

  if (annotation.kind === 'text') {
    return (
      <Text
        ref={nodeRef}
        {...common}
        text={annotation.text}
        fontFamily="Inter"
        fontSize={Math.max(
          8,
          pdfUserLengthToViewportPixels(annotation.fontSizeUserUnits, viewport),
        )}
        fill={colorToRgba(annotation.color, annotation.opacity)}
        padding={2}
      />
    );
  }

  const fill =
    annotation.kind === 'highlight' || annotation.kind === 'rectangle'
      ? annotation.fill
      : null;
  const stroke = annotation.kind === 'rectangle' ? annotation.stroke : null;
  const imagePlaceholder = annotation.kind === 'image';

  return (
    <Rect
      ref={nodeRef}
      {...common}
      fill={
        imagePlaceholder
          ? 'rgba(6, 182, 212, 0.1)'
          : fill
            ? colorToRgba(fill.color, fill.opacity)
            : undefined
      }
      stroke={
        selectedStroke ??
        (imagePlaceholder
          ? '#06b6d4'
          : stroke
            ? colorToRgba(stroke.color, stroke.opacity)
            : undefined)
      }
      dash={imagePlaceholder ? [6, 4] : undefined}
      strokeWidth={strokeWidth}
    />
  );
}
