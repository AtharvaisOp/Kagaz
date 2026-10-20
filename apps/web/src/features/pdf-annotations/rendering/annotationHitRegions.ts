import type { PdfAnnotation } from '../model/types';
import {
  projectAnnotation,
  annotationStrokeWidth,
  type AnnotationViewport,
} from './annotationProjection';

/** A full-page canvas must not swallow native selection in otherwise empty space. */
export function annotationHitClip(
  annotations: readonly PdfAnnotation[],
  selectedId: string | null,
  viewport: AnnotationViewport,
): string {
  const paths = annotations.flatMap((annotation) => {
    const projection = projectAnnotation(annotation, viewport);
    const points =
      projection.kind === 'box' ? projection.quad : projection.points;
    if (!points.length) return [];
    const margin = Math.max(
      annotation.id === selectedId ? 14 : 3,
      annotationStrokeWidth(annotation, viewport) / 2 + 2,
    );
    let left = Infinity,
      top = Infinity,
      right = -Infinity,
      bottom = -Infinity;
    for (const point of points) {
      left = Math.min(left, point.x - margin);
      top = Math.min(top, point.y - margin);
      right = Math.max(right, point.x + margin);
      bottom = Math.max(bottom, point.y + margin);
    }
    return [`M${left} ${top}H${right}V${bottom}H${left}Z`];
  });
  return paths.length ? `path('${paths.join(' ')}')` : 'inset(100%)';
}
