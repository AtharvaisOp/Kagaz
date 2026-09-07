import type { PageViewport } from 'pdfjs-dist';

import {
  pdfOrientedBoxToViewportQuad,
  pdfPointToViewportPoint,
  pdfUserLengthToViewportPixels,
  type CoordinateViewport,
  type ViewportPoint,
  type ViewportQuad,
  type ViewportRect,
} from '../geometry/coordinateTransforms';

import type {
  AnnotationKind,
  FreehandAnnotation,
  PdfAnnotation,
  PdfOrientedBox,
  RgbColor,
} from '../model/types';

export type AnnotationViewport = Readonly<
  Pick<
    PageViewport,
    | 'width'
    | 'height'
    | 'viewBox'
    | 'userUnit'
    | 'rotation'
    | 'transform'
    | 'convertToPdfPoint'
    | 'convertToViewportPoint'
  >
>;

export interface BoxAnnotationProjection {
  readonly kind: 'box';
  readonly annotationKind: Extract<
    AnnotationKind,
    'text' | 'highlight' | 'rectangle' | 'ellipse' | 'image'
  >;
  readonly quad: ViewportQuad;
  readonly bounds: ViewportRect;
}

export interface LineAnnotationProjection {
  readonly kind: 'line';
  readonly points: readonly [ViewportPoint, ViewportPoint];
}

export interface FreehandAnnotationProjection {
  readonly kind: 'freehand';
  readonly points: readonly ViewportPoint[];
}

export type AnnotationProjection =
  | BoxAnnotationProjection
  | LineAnnotationProjection
  | FreehandAnnotationProjection;

export function viewportQuadBounds(quad: ViewportQuad): ViewportRect {
  const xValues = quad.map((point) => point.x);
  const yValues = quad.map((point) => point.y);
  const x = Math.min(...xValues);
  const y = Math.min(...yValues);
  return {
    x,
    y,
    width: Math.max(...xValues) - x,
    height: Math.max(...yValues) - y,
  };
}

export function projectPdfBox(
  box: PdfOrientedBox,
  viewport: CoordinateViewport,
): { readonly quad: ViewportQuad; readonly bounds: ViewportRect } {
  const quad = pdfOrientedBoxToViewportQuad(box, viewport);
  return { quad, bounds: viewportQuadBounds(quad) };
}

export function projectAnnotation(
  annotation: PdfAnnotation,
  viewport: AnnotationViewport,
): AnnotationProjection {
  switch (annotation.kind) {
    case 'text':
    case 'highlight':
    case 'rectangle':
    case 'ellipse':
    case 'image': {
      const projection = projectPdfBox(annotation.box, viewport);
      return {
        kind: 'box',
        annotationKind: annotation.kind,
        ...projection,
      };
    }
    case 'line':
      return {
        kind: 'line',
        points: [
          pdfPointToViewportPoint(annotation.start, viewport),
          pdfPointToViewportPoint(annotation.end, viewport),
        ],
      };
    case 'freehand':
      return {
        kind: 'freehand',
        points: annotation.points.map((point) =>
          pdfPointToViewportPoint(point, viewport),
        ),
      };
  }
}

export function flattenViewportPoints(
  points: readonly ViewportPoint[],
): number[] {
  return points.flatMap((point) => [point.x, point.y]);
}

export function colorToRgba(color: RgbColor, opacity: number): string {
  return `rgba(${Math.round(color.r * 255)}, ${Math.round(
    color.g * 255,
  )}, ${Math.round(color.b * 255)}, ${opacity})`;
}

export function translateAnnotation(
  annotation: PdfAnnotation,
  delta: { readonly x: number; readonly y: number },
): PdfAnnotation {
  switch (annotation.kind) {
    case 'text':
    case 'highlight':
    case 'rectangle':
    case 'ellipse':
    case 'image':
      return {
        ...annotation,
        box: {
          ...annotation.box,
          origin: {
            x: annotation.box.origin.x + delta.x,
            y: annotation.box.origin.y + delta.y,
          },
        },
      };
    case 'line':
      return {
        ...annotation,
        start: {
          x: annotation.start.x + delta.x,
          y: annotation.start.y + delta.y,
        },
        end: {
          x: annotation.end.x + delta.x,
          y: annotation.end.y + delta.y,
        },
      };
    case 'freehand':
      return {
        ...annotation,
        points: annotation.points.map((point) => ({
          x: point.x + delta.x,
          y: point.y + delta.y,
        })) as unknown as FreehandAnnotation['points'],
      };
  }
}

export function replaceAnnotationBox(
  annotation: PdfAnnotation,
  box: PdfOrientedBox,
): PdfAnnotation {
  if (!('box' in annotation)) {
    return annotation;
  }
  return { ...annotation, box };
}

export function isBoxAnnotation(annotation: PdfAnnotation): boolean {
  return 'box' in annotation;
}

export function annotationStrokeWidth(
  annotation: PdfAnnotation,
  viewport: CoordinateViewport,
): number {
  if (annotation.kind === 'line' || annotation.kind === 'freehand') {
    return pdfUserLengthToViewportPixels(
      annotation.stroke.widthUserUnits,
      viewport,
    );
  }
  if (
    (annotation.kind === 'rectangle' || annotation.kind === 'ellipse') &&
    annotation.stroke
  ) {
    return pdfUserLengthToViewportPixels(
      annotation.stroke.widthUserUnits,
      viewport,
    );
  }
  return 1;
}
