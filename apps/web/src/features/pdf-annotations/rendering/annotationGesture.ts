import { viewportRectToPdfOrientedBox } from '../geometry/coordinateTransforms';
import { viewportOrientedFrameToPdfBox } from '../geometry/orientedFrame';

import type { AnnotationViewport } from './annotationProjection';
import type { PdfAnnotation, PdfOrientedBox } from '../model/types';

export const MIN_TRANSFORM_SIZE = 8;

export interface AnnotationNodeGeometry {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly scaleX: number;
  readonly scaleY: number;
  readonly rotation?: number;
}

export function transformedOrientedAnnotationBox(
  annotation: PdfAnnotation,
  geometry: AnnotationNodeGeometry,
  viewport: AnnotationViewport,
): PdfOrientedBox | null {
  if (!('box' in annotation) || geometry.scaleX <= 0 || geometry.scaleY <= 0) {
    return null;
  }
  return viewportOrientedFrameToPdfBox(
    {
      x: geometry.x,
      y: geometry.y,
      width: geometry.width * geometry.scaleX,
      height: geometry.height * geometry.scaleY,
      angle: geometry.rotation ?? 0,
    },
    viewport,
  );
}

interface TransformBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface AnnotationGestureSnapshot {
  readonly annotation: PdfAnnotation;
  readonly signature: string;
  readonly start: AnnotationNodeGeometry;
}

export function captureAnnotationGesture(
  annotation: PdfAnnotation,
  signature: string,
  geometry: AnnotationNodeGeometry,
): AnnotationGestureSnapshot {
  return { annotation, signature, start: geometry };
}

export function gestureMatchesViewport(
  gesture: AnnotationGestureSnapshot | null,
  viewportSignature: string,
): boolean {
  return gesture !== null && gesture.signature === viewportSignature;
}

export function constrainedTransformBox<T extends TransformBounds>(
  oldBox: T,
  newBox: T,
  minimumSize = MIN_TRANSFORM_SIZE,
): T {
  return newBox.width < minimumSize ||
    newBox.height < minimumSize ||
    newBox.width < 0 ||
    newBox.height < 0
    ? oldBox
    : newBox;
}

export function transformedAnnotationBox(
  annotation: PdfAnnotation,
  geometry: AnnotationNodeGeometry,
  viewport: AnnotationViewport,
): PdfOrientedBox | null {
  if (!('box' in annotation) || geometry.scaleX <= 0 || geometry.scaleY <= 0) {
    return null;
  }

  const width = geometry.width * geometry.scaleX;
  const height = geometry.height * geometry.scaleY;
  if (width <= 0 || height <= 0) {
    return null;
  }

  try {
    return viewportRectToPdfOrientedBox(
      {
        x: annotation.kind === 'ellipse' ? geometry.x - width / 2 : geometry.x,
        y: annotation.kind === 'ellipse' ? geometry.y - height / 2 : geometry.y,
        width,
        height,
      },
      viewport,
    );
  } catch {
    return null;
  }
}
