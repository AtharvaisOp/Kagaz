import type { PageViewport } from 'pdfjs-dist';

import type { PdfOrientedBox, PdfPoint } from '../model/types';
import { orientedBoxFromBasis, pdfOrientedBoxToCorners } from './orientedBox';

export type CoordinateViewport = Readonly<
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

export interface ViewportPoint {
  readonly x: number;
  readonly y: number;
}

export interface ViewportRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export type ViewportQuad = readonly [
  ViewportPoint,
  ViewportPoint,
  ViewportPoint,
  ViewportPoint,
];

function finitePair(value: unknown): readonly [number, number] {
  if (!Array.isArray(value) || value.length !== 2) {
    throw new RangeError(
      'PDF.js coordinate conversion must return two values.',
    );
  }

  const pair = value as readonly unknown[];
  if (
    typeof pair[0] !== 'number' ||
    !Number.isFinite(pair[0]) ||
    typeof pair[1] !== 'number' ||
    !Number.isFinite(pair[1])
  ) {
    throw new RangeError(
      'PDF.js coordinate conversion returned non-finite values.',
    );
  }

  return [pair[0], pair[1]];
}

function assertFinitePositive(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a finite positive number.`);
  }
}

export function clientPointToViewportPoint(
  client: { readonly x: number; readonly y: number },
  bounds: Pick<DOMRectReadOnly, 'left' | 'top' | 'width' | 'height'>,
  viewport: CoordinateViewport,
): ViewportPoint {
  assertFinitePositive(bounds.width, 'Overlay width');
  assertFinitePositive(bounds.height, 'Overlay height');
  if (!Number.isFinite(client.x) || !Number.isFinite(client.y)) {
    throw new RangeError('Client coordinates must be finite.');
  }

  return {
    x: (client.x - bounds.left) * (viewport.width / bounds.width),
    y: (client.y - bounds.top) * (viewport.height / bounds.height),
  };
}

export function viewportPointToPdfPoint(
  point: ViewportPoint,
  viewport: CoordinateViewport,
): PdfPoint {
  const [x, y] = finitePair(viewport.convertToPdfPoint(point.x, point.y));
  return { x, y };
}

export function pdfPointToViewportPoint(
  point: PdfPoint,
  viewport: CoordinateViewport,
): ViewportPoint {
  const [x, y] = finitePair(viewport.convertToViewportPoint(point.x, point.y));
  return { x, y };
}

export function pdfUserLengthToViewportPixels(
  length: number,
  viewport: CoordinateViewport,
): number {
  if (!Number.isFinite(length) || length < 0) {
    throw new RangeError('PDF user length must be finite and non-negative.');
  }

  const scale = viewportScale(viewport);
  assertFinitePositive(scale, 'Viewport scale');
  return length * scale;
}

export function viewportPixelsToPdfUserLength(
  pixels: number,
  viewport: CoordinateViewport,
): number {
  if (!Number.isFinite(pixels) || pixels < 0) {
    throw new RangeError('Viewport length must be finite and non-negative.');
  }

  const scale = viewportScale(viewport);
  assertFinitePositive(scale, 'Viewport scale');
  return pixels / scale;
}

export function pdfOrientedBoxToViewportQuad(
  box: PdfOrientedBox,
  viewport: CoordinateViewport,
): ViewportQuad {
  return pdfOrientedBoxToCorners(box).map((point) =>
    pdfPointToViewportPoint(point, viewport),
  ) as unknown as ViewportQuad;
}

export function viewportRectToPdfOrientedBox(
  rect: ViewportRect,
  viewport: CoordinateViewport,
): PdfOrientedBox {
  if (
    !Number.isFinite(rect.x) ||
    !Number.isFinite(rect.y) ||
    !Number.isFinite(rect.width) ||
    !Number.isFinite(rect.height) ||
    rect.width <= 0 ||
    rect.height <= 0
  ) {
    throw new RangeError(
      'Viewport rectangle must have finite positive dimensions.',
    );
  }

  const origin = viewportPointToPdfPoint(
    { x: rect.x, y: rect.y + rect.height },
    viewport,
  );
  const rightPoint = viewportPointToPdfPoint(
    { x: rect.x + rect.width, y: rect.y + rect.height },
    viewport,
  );
  const upPoint = viewportPointToPdfPoint({ x: rect.x, y: rect.y }, viewport);

  const box = orientedBoxFromBasis(
    origin,
    { x: rightPoint.x - origin.x, y: rightPoint.y - origin.y },
    { x: upPoint.x - origin.x, y: upPoint.y - origin.y },
  );
  if (!box) {
    throw new RangeError(
      'Viewport rectangle did not map to a cardinal PDF box.',
    );
  }
  return box;
}

export { pdfOrientedBoxToCorners };

function viewportScale(viewport: CoordinateViewport): number {
  const a = viewport.transform[0];
  const b = viewport.transform[1];
  if (a === undefined || b === undefined) {
    throw new RangeError('Viewport transform must contain scale values.');
  }
  return Math.hypot(a, b);
}
