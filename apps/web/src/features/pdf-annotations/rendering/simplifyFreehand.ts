import type { ViewportPoint } from '../geometry/coordinateTransforms';

function distance(left: ViewportPoint, right: ViewportPoint): number {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

export function dedupeViewportPoints(
  points: readonly ViewportPoint[],
  minDistance = 1,
): readonly ViewportPoint[] {
  if (points.length < 2) return points;
  const threshold = Math.max(0, minDistance);
  const result: ViewportPoint[] = [points[0]!];
  for (let index = 1; index < points.length - 1; index += 1) {
    const point = points[index]!;
    if (distance(point, result[result.length - 1]!) >= threshold) {
      result.push(point);
    }
  }
  const last = points[points.length - 1]!;
  if (result[result.length - 1] !== last) result.push(last);
  return result;
}

function perpendicularDistance(
  point: ViewportPoint,
  start: ViewportPoint,
  end: ViewportPoint,
): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (dx === 0 && dy === 0) return distance(point, start);
  return (
    Math.abs(dy * point.x - dx * point.y + end.x * start.y - end.y * start.x) /
    Math.hypot(dx, dy)
  );
}

export function simplifyRdp(
  points: readonly ViewportPoint[],
  tolerance = 1.5,
): readonly ViewportPoint[] {
  if (points.length <= 2) return points;
  const epsilon = Math.max(0, tolerance);
  let maxDistance = epsilon;
  let splitIndex = -1;
  const start = points[0]!;
  const end = points[points.length - 1]!;
  for (let index = 1; index < points.length - 1; index += 1) {
    const current = perpendicularDistance(points[index]!, start, end);
    if (current > maxDistance) {
      maxDistance = current;
      splitIndex = index;
    }
  }
  if (splitIndex < 0) return [start, end];
  const left = simplifyRdp(points.slice(0, splitIndex + 1), epsilon);
  const right = simplifyRdp(points.slice(splitIndex), epsilon);
  return [...left.slice(0, -1), ...right];
}
