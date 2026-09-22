import {
  annotationStrokeWidth,
  projectAnnotation,
  type AnnotationViewport,
} from '../../pdf-annotations/rendering/annotationProjection';
import { projectTextFontSize } from '../../pdf-annotations/rendering/textProjection';
import type { AnnotationImageAsset } from '../../pdf-annotations/runtime/annotationAssetRegistry';

import type {
  PdfAnnotation,
  RgbColor,
} from '../../pdf-annotations/model/types';

export type ThumbnailPoint = Readonly<{ x: number; y: number }>;

export interface ThumbnailAssetLookup {
  get(assetId: string): AnnotationImageAsset | null;
}

interface ThumbnailPaint {
  readonly color: RgbColor;
  readonly opacity: number;
}

interface ThumbnailStroke extends ThumbnailPaint {
  readonly width: number;
}

export type ThumbnailAnnotationCommand =
  | {
      readonly kind: 'box';
      readonly annotationKind: 'highlight' | 'rectangle';
      readonly points: readonly [
        ThumbnailPoint,
        ThumbnailPoint,
        ThumbnailPoint,
        ThumbnailPoint,
      ];
      readonly fill: ThumbnailPaint | null;
      readonly stroke: ThumbnailStroke | null;
    }
  | {
      readonly kind: 'ellipse';
      readonly center: ThumbnailPoint;
      readonly radiusX: number;
      readonly radiusY: number;
      readonly rotation: number;
      readonly fill: ThumbnailPaint | null;
      readonly stroke: ThumbnailStroke | null;
    }
  | {
      readonly kind: 'line' | 'freehand';
      readonly points: readonly ThumbnailPoint[];
      readonly stroke: ThumbnailStroke;
    }
  | {
      readonly kind: 'text';
      readonly points: readonly [
        ThumbnailPoint,
        ThumbnailPoint,
        ThumbnailPoint,
        ThumbnailPoint,
      ];
      readonly text: string;
      readonly fontSize: number;
      readonly align: 'left' | 'center' | 'right';
      readonly color: RgbColor;
      readonly opacity: number;
    }
  | {
      readonly kind: 'image';
      readonly points: readonly [
        ThumbnailPoint,
        ThumbnailPoint,
        ThumbnailPoint,
        ThumbnailPoint,
      ];
      readonly opacity: number;
      readonly image: CanvasImageSource | null;
    };

function paint(color: RgbColor, opacity: number): ThumbnailPaint {
  return { color, opacity };
}

function stroke(
  color: RgbColor,
  opacity: number,
  width: number,
): ThumbnailStroke {
  return { color, opacity, width };
}

function orientedBoxPoints(
  projection: Extract<
    ReturnType<typeof projectAnnotation>,
    { readonly kind: 'box' }
  >,
) {
  return projection.quad;
}

function boxRotation(
  points: readonly [
    ThumbnailPoint,
    ThumbnailPoint,
    ThumbnailPoint,
    ThumbnailPoint,
  ],
): number {
  const topLeft = points[3];
  const topRight = points[2];
  return Math.atan2(topRight.y - topLeft.y, topRight.x - topLeft.x);
}

/** Builds cheap, read-only thumbnail draw commands from canonical PDF geometry. */
export function projectThumbnailAnnotations(
  annotations: readonly PdfAnnotation[],
  viewport: AnnotationViewport,
  assets?: ThumbnailAssetLookup,
): readonly ThumbnailAnnotationCommand[] {
  return annotations.flatMap<ThumbnailAnnotationCommand>((annotation) => {
    const projection = projectAnnotation(annotation, viewport);
    switch (annotation.kind) {
      case 'highlight':
        if (projection.kind !== 'box') return [];
        return [
          {
            kind: 'box' as const,
            annotationKind: 'highlight' as const,
            points: orientedBoxPoints(projection),
            fill: paint(annotation.fill.color, annotation.fill.opacity),
            stroke: null,
          },
        ];
      case 'rectangle':
        if (projection.kind !== 'box') return [];
        return [
          {
            kind: 'box' as const,
            annotationKind: 'rectangle' as const,
            points: orientedBoxPoints(projection),
            fill: annotation.fill
              ? paint(annotation.fill.color, annotation.fill.opacity)
              : null,
            stroke: annotation.stroke
              ? stroke(
                  annotation.stroke.color,
                  annotation.stroke.opacity,
                  annotationStrokeWidth(annotation, viewport),
                )
              : null,
          },
        ];
      case 'ellipse':
        if (projection.kind !== 'box') return [];
        return [
          {
            kind: 'ellipse' as const,
            center: {
              x: (projection.quad[0].x + projection.quad[2].x) / 2,
              y: (projection.quad[0].y + projection.quad[2].y) / 2,
            },
            radiusX:
              Math.hypot(
                projection.quad[2].x - projection.quad[3].x,
                projection.quad[2].y - projection.quad[3].y,
              ) / 2,
            radiusY:
              Math.hypot(
                projection.quad[0].x - projection.quad[3].x,
                projection.quad[0].y - projection.quad[3].y,
              ) / 2,
            rotation: boxRotation(projection.quad),
            fill: annotation.fill
              ? paint(annotation.fill.color, annotation.fill.opacity)
              : null,
            stroke: annotation.stroke
              ? stroke(
                  annotation.stroke.color,
                  annotation.stroke.opacity,
                  annotationStrokeWidth(annotation, viewport),
                )
              : null,
          },
        ];
      case 'line':
        if (projection.kind !== 'line') return [];
        return [
          {
            kind: 'line' as const,
            points: projection.points,
            stroke: stroke(
              annotation.stroke.color,
              annotation.stroke.opacity,
              annotationStrokeWidth(annotation, viewport),
            ),
          },
        ];
      case 'freehand':
        if (projection.kind !== 'freehand') return [];
        return [
          {
            kind: 'freehand' as const,
            points: projection.points,
            stroke: stroke(
              annotation.stroke.color,
              annotation.stroke.opacity,
              annotationStrokeWidth(annotation, viewport),
            ),
          },
        ];
      case 'text':
        if (projection.kind !== 'box') return [];
        return [
          {
            kind: 'text' as const,
            points: orientedBoxPoints(projection),
            text: annotation.text,
            fontSize: projectTextFontSize(
              annotation.fontSizeUserUnits,
              viewport,
            ),
            align: annotation.align,
            color: annotation.color,
            opacity: annotation.opacity,
          },
        ];
      case 'image':
      case 'signature':
        if (projection.kind !== 'box') return [];
        return [
          {
            kind: 'image' as const,
            points: orientedBoxPoints(projection),
            opacity: annotation.opacity,
            image: assets?.get(annotation.assetId)?.image ?? null,
          },
        ];
    }
  });
}

function cssColor(color: RgbColor, opacity: number): string {
  return `rgba(${Math.round(color.r * 255)}, ${Math.round(
    color.g * 255,
  )}, ${Math.round(color.b * 255)}, ${opacity})`;
}

function drawPolygon(
  context: CanvasRenderingContext2D,
  points: readonly ThumbnailPoint[],
): void {
  const first = points[0];
  if (!first) return;
  context.beginPath();
  context.moveTo(first.x, first.y);
  for (const point of points.slice(1)) context.lineTo(point.x, point.y);
  context.closePath();
}

function drawStroke(
  context: CanvasRenderingContext2D,
  value: ThumbnailStroke,
): void {
  context.strokeStyle = cssColor(value.color, value.opacity);
  context.lineWidth = Math.max(0.5, value.width);
  context.lineCap = 'round';
  context.lineJoin = 'round';
}

function wrapCanvasLine(
  context: CanvasRenderingContext2D,
  value: string,
  maxWidth: number,
): readonly string[] {
  if (value.length === 0) return [''];
  const lines: string[] = [];
  let current = '';
  for (const character of value) {
    const candidate = current + character;
    if (current.length > 0 && context.measureText(candidate).width > maxWidth) {
      lines.push(current);
      current = character;
    } else {
      current = candidate;
    }
  }
  if (current.length > 0 || lines.length === 0) lines.push(current);
  return lines;
}

/** Draws a projected command list without creating a Konva stage or decoding assets. */
export function drawThumbnailAnnotations(
  context: CanvasRenderingContext2D,
  commands: readonly ThumbnailAnnotationCommand[],
  pixelRatio = 1,
): void {
  context.save();
  context.scale(pixelRatio, pixelRatio);
  for (const command of commands) {
    if (command.kind === 'box') {
      drawPolygon(context, command.points);
      if (command.fill) {
        context.fillStyle = cssColor(command.fill.color, command.fill.opacity);
        context.fill();
      }
      if (command.stroke) {
        drawStroke(context, command.stroke);
        context.stroke();
      }
    } else if (command.kind === 'ellipse') {
      context.beginPath();
      context.ellipse(
        command.center.x,
        command.center.y,
        command.radiusX,
        command.radiusY,
        command.rotation,
        0,
        Math.PI * 2,
      );
      if (command.fill) {
        context.fillStyle = cssColor(command.fill.color, command.fill.opacity);
        context.fill();
      }
      if (command.stroke) {
        drawStroke(context, command.stroke);
        context.stroke();
      }
    } else if (command.kind === 'line' || command.kind === 'freehand') {
      const first = command.points[0];
      if (!first) continue;
      context.beginPath();
      context.moveTo(first.x, first.y);
      for (const point of command.points.slice(1))
        context.lineTo(point.x, point.y);
      drawStroke(context, command.stroke);
      context.stroke();
    } else if (command.kind === 'text') {
      const topLeft = command.points[3];
      const topRight = command.points[2];
      const bottomLeft = command.points[0];
      if (!topLeft || !topRight || !bottomLeft) continue;
      const angle = Math.atan2(topRight.y - topLeft.y, topRight.x - topLeft.x);
      const width = Math.hypot(topRight.x - topLeft.x, topRight.y - topLeft.y);
      const lineHeight = command.fontSize * 1.15;
      context.save();
      context.translate(topLeft.x, topLeft.y);
      context.rotate(angle);
      context.fillStyle = cssColor(command.color, command.opacity);
      context.font = `${command.fontSize}px Helvetica, Arial, sans-serif`;
      context.textBaseline = 'top';
      context.textAlign = command.align;
      const lines = command.text
        .split(/\r\n?|\n/)
        .flatMap((line) => wrapCanvasLine(context, line, width));
      for (const [index, line] of lines.entries()) {
        if (
          index * lineHeight >
          Math.hypot(bottomLeft.x - topLeft.x, bottomLeft.y - topLeft.y)
        )
          break;
        const x =
          command.align === 'center'
            ? width / 2
            : command.align === 'right'
              ? width
              : 0;
        context.fillText(line, x, index * lineHeight);
      }
      context.restore();
    } else if (command.kind === 'image' && command.image) {
      drawPolygon(context, command.points);
      context.save();
      context.globalAlpha = command.opacity;
      const topLeft = command.points[3];
      const topRight = command.points[2];
      const bottomLeft = command.points[0];
      if (topLeft && topRight && bottomLeft) {
        const width = Math.hypot(
          topRight.x - topLeft.x,
          topRight.y - topLeft.y,
        );
        const height = Math.hypot(
          bottomLeft.x - topLeft.x,
          bottomLeft.y - topLeft.y,
        );
        context.translate(topLeft.x, topLeft.y);
        context.rotate(
          Math.atan2(topRight.y - topLeft.y, topRight.x - topLeft.x),
        );
        context.beginPath();
        context.rect(0, 0, width, height);
        context.clip();
        context.drawImage(command.image, 0, 0, width, height);
      }
      context.restore();
    }
  }
  context.restore();
}
