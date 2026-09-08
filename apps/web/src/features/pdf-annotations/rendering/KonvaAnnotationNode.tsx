import type Konva from 'konva';
import { Ellipse, Group, Image, Line, Rect, Text } from 'react-konva';

import {
  annotationStrokeWidth,
  colorToRgba,
  flattenViewportPoints,
  projectAnnotation,
  type AnnotationViewport,
} from './annotationProjection';

import { projectPdfBoxToOrientedFrame } from '../geometry/orientedFrame';
import { useAnnotationAsset } from '../runtime/useAnnotationAsset';
import { projectTextBoxInset, projectTextFontSize } from './textProjection';

import type { AnnotationAssetRegistry } from '../runtime/annotationAssetRegistry';
import type { ImageAnnotation, PdfAnnotation } from '../model/types';

interface KonvaAnnotationNodeProps {
  readonly annotation: PdfAnnotation;
  readonly viewport: AnnotationViewport;
  readonly selected: boolean;
  readonly interactive?: boolean;
  readonly nodeRef: (node: Konva.Node | null) => void;
  readonly onSelect: () => void;
  readonly onDragStart: (node: Konva.Node) => void;
  readonly onDragEnd: (node: Konva.Node) => void;
  readonly onTransformStart: (node: Konva.Node) => void;
  readonly onTransformEnd: (node: Konva.Node) => void;
  readonly onEditText: () => void;
  readonly assetRegistry: AnnotationAssetRegistry;
}

function selectFromEvent(
  event: Konva.KonvaEventObject<PointerEvent>,
  onSelect: () => void,
): void {
  event.cancelBubble = true;
  onSelect();
}

interface ImageNodeProps {
  readonly annotation: ImageAnnotation;
  readonly registry: AnnotationAssetRegistry;
  readonly common: Record<string, unknown>;
  readonly nodeRef: (node: Konva.Node | null) => void;
}

function AnnotationImageNode({
  annotation,
  registry,
  common,
  nodeRef,
}: ImageNodeProps) {
  const asset = useAnnotationAsset(registry, annotation.assetId);
  if (!asset) return null;
  return (
    <Image
      ref={nodeRef}
      {...common}
      image={asset.image}
      opacity={annotation.opacity}
    />
  );
}

export function KonvaAnnotationNode({
  annotation,
  viewport,
  selected,
  interactive = true,
  nodeRef,
  onSelect,
  onDragStart,
  onDragEnd,
  onTransformStart,
  onTransformEnd,
  onEditText,
  assetRegistry,
}: KonvaAnnotationNodeProps) {
  const projection = projectAnnotation(annotation, viewport);
  const selectedStroke = selected ? '#06b6d4' : undefined;
  const strokeWidth = annotationStrokeWidth(annotation, viewport);

  if (annotation.kind === 'line' && projection.kind === 'line') {
    return (
      <Group
        ref={nodeRef}
        id={annotation.id}
        draggable={interactive && selected}
        listening={interactive}
        preventDefault={interactive && selected}
        onPointerDown={(event) =>
          interactive && selectFromEvent(event, onSelect)
        }
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
        draggable={interactive && selected}
        listening={interactive}
        preventDefault={interactive && selected}
        onPointerDown={(event) =>
          interactive && selectFromEvent(event, onSelect)
        }
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
  if (annotation.kind === 'text' || annotation.kind === 'image') {
    const frame = projectPdfBoxToOrientedFrame(annotation.box, viewport);
    const orientedCommon = {
      id: annotation.id,
      x: frame.x,
      y: frame.y,
      width: frame.width,
      height: frame.height,
      rotation: frame.angle,
      listening: interactive,
      draggable: interactive && selected,
      preventDefault: interactive && selected,
      onPointerDown: (event: Konva.KonvaEventObject<PointerEvent>) =>
        interactive && selectFromEvent(event, onSelect),
      onDblClick: () => annotation.kind === 'text' && onEditText(),
      onDblTap: () => annotation.kind === 'text' && onEditText(),
      onDragStart: (event: Konva.KonvaEventObject<DragEvent>) =>
        onDragStart(event.target),
      onDragEnd: (event: Konva.KonvaEventObject<DragEvent>) =>
        onDragEnd(event.target),
      onTransformStart: (event: Konva.KonvaEventObject<Event>) =>
        onTransformStart(event.target),
      onTransformEnd: (event: Konva.KonvaEventObject<Event>) =>
        onTransformEnd(event.target),
    };
    if (annotation.kind === 'image') {
      return (
        <AnnotationImageNode
          annotation={annotation}
          registry={assetRegistry}
          common={orientedCommon}
          nodeRef={nodeRef}
        />
      );
    }
    return (
      <Text
        ref={nodeRef}
        {...orientedCommon}
        text={annotation.text}
        fontFamily="Helvetica, Arial, sans-serif"
        fontSize={projectTextFontSize(annotation.fontSizeUserUnits, viewport)}
        lineHeight={annotation.lineHeight}
        align={annotation.align}
        fill={colorToRgba(annotation.color, annotation.opacity)}
        padding={projectTextBoxInset(viewport)}
      />
    );
  }
  const boxInteractive = interactive;
  const common = {
    id: annotation.id,
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    listening: boxInteractive,
    draggable: boxInteractive && selected,
    preventDefault: selected && boxInteractive,
    onPointerDown: (event: Konva.KonvaEventObject<PointerEvent>) =>
      boxInteractive && selectFromEvent(event, onSelect),
    onDragStart: (event: Konva.KonvaEventObject<DragEvent>) =>
      onDragStart(event.target),
    onDragEnd: (event: Konva.KonvaEventObject<DragEvent>) =>
      onDragEnd(event.target),
    onTransformStart: (event: Konva.KonvaEventObject<Event>) =>
      onTransformStart(event.target),
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

  const fill =
    annotation.kind === 'highlight' || annotation.kind === 'rectangle'
      ? annotation.fill
      : null;
  const stroke = annotation.kind === 'rectangle' ? annotation.stroke : null;

  return (
    <Rect
      ref={nodeRef}
      {...common}
      fill={fill ? colorToRgba(fill.color, fill.opacity) : undefined}
      stroke={
        selectedStroke ??
        (stroke ? colorToRgba(stroke.color, stroke.opacity) : undefined)
      }
      strokeWidth={strokeWidth}
    />
  );
}
