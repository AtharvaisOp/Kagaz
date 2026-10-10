import type {
  WatermarkConfig,
  WatermarkPreviewGeometry,
} from '../../../features/pdf-watermarks/model/types';
import { PdfExportError } from '../types';

export interface WatermarkPlacement {
  readonly origin: { readonly x: number; readonly y: number };
  readonly width: number;
  readonly height: number;
  readonly rotation: number;
  readonly sizingRatio: number;
  /** Axis-aligned bounds in the final oriented, bottom-left page frame. */
  readonly orientedBounds: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
}

/** Explicit physical geometry bound, separate from lower bitmap preview limits. */
export const WATERMARK_MAX_PAGE_POINTS = 14_400;

export function assertWatermarkGeometry(
  geometry: WatermarkPreviewGeometry,
): void {
  const { viewBox, userUnit, rotation } = geometry;
  if (
    viewBox.length !== 4 ||
    !viewBox.every(Number.isFinite) ||
    !(viewBox[2]! > viewBox[0]!) ||
    !(viewBox[3]! > viewBox[1]!) ||
    !Number.isFinite(userUnit) ||
    userUnit < 1 ||
    userUnit > 75000 ||
    !Number.isFinite(rotation) ||
    rotation % 90 !== 0 ||
    !Number.isFinite((viewBox[2]! - viewBox[0]!) * userUnit) ||
    !Number.isFinite((viewBox[3]! - viewBox[1]!) * userUnit) ||
    (viewBox[2]! - viewBox[0]!) * userUnit > WATERMARK_MAX_PAGE_POINTS ||
    (viewBox[3]! - viewBox[1]!) * userUnit > WATERMARK_MAX_PAGE_POINTS
  )
    throw new PdfExportError(
      'watermark-invalid',
      'This page has unsupported geometry for watermarking.',
    );
}

/**
 * Fit the rotated box before anchoring it. All coordinates are PDF user units;
 * cardinal page rotation maps the final oriented page frame back into raw space.
 */
export function watermarkPlacement(
  config: WatermarkConfig,
  geometry: WatermarkPreviewGeometry,
  naturalWidth: number,
  naturalHeight: number,
): WatermarkPlacement {
  assertWatermarkGeometry(geometry);
  const [left, bottom, right, top] = geometry.viewBox as readonly [
    number,
    number,
    number,
    number,
  ];
  const rotation = ((geometry.rotation % 360) + 360) % 360;
  const rawWidth = right - left;
  const rawHeight = top - bottom;
  const pageWidth = rotation % 180 === 0 ? rawWidth : rawHeight;
  const pageHeight = rotation % 180 === 0 ? rawHeight : rawWidth;
  const marginX = pageWidth * 0.05;
  const marginY = pageHeight * 0.05;
  const availableWidth = pageWidth - 2 * marginX;
  const availableHeight = pageHeight - 2 * marginY;
  const angle = (config.rotation * Math.PI) / 180;
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const widthBeforeFit =
    Math.abs(naturalWidth * cosine) + Math.abs(naturalHeight * sine);
  const heightBeforeFit =
    Math.abs(naturalWidth * sine) + Math.abs(naturalHeight * cosine);
  const sizingRatio =
    Math.min(
      1,
      availableWidth / widthBeforeFit,
      availableHeight / heightBeforeFit,
    ) * config.scale;
  const width = naturalWidth * sizingRatio;
  const height = naturalHeight * sizingRatio;
  const extentWidth = widthBeforeFit * sizingRatio;
  const extentHeight = heightBeforeFit * sizingRatio;
  if (
    ![
      width,
      height,
      sizingRatio,
      extentWidth,
      extentHeight,
      pageWidth,
      pageHeight,
    ].every(Number.isFinite) ||
    width <= 0 ||
    height <= 0 ||
    extentWidth > availableWidth + 1e-7 ||
    extentHeight > availableHeight + 1e-7
  )
    throw new PdfExportError(
      'watermark-invalid',
      'This watermark cannot be safely fitted inside the page.',
    );
  const horizontal = config.position.endsWith('left')
    ? 0
    : config.position.endsWith('right')
      ? 1
      : config.position === 'custom'
        ? config.customPosition.x
        : 0.5;
  const vertical = config.position.startsWith('bottom')
    ? 0
    : config.position.startsWith('top')
      ? 1
      : config.position === 'custom'
        ? config.customPosition.y
        : 0.5;
  const x = marginX + (availableWidth - extentWidth) * horizontal;
  const y = marginY + (availableHeight - extentHeight) * vertical;
  const minimumX = Math.min(
    0,
    width * cosine,
    -height * sine,
    width * cosine - height * sine,
  );
  const minimumY = Math.min(
    0,
    width * sine,
    height * cosine,
    width * sine + height * cosine,
  );
  const orientedX = x - minimumX;
  const orientedY = y - minimumY;
  const origin =
    rotation === 0
      ? { x: left + orientedX, y: bottom + orientedY }
      : rotation === 90
        ? { x: right - orientedY, y: bottom + orientedX }
        : rotation === 180
          ? { x: right - orientedX, y: top - orientedY }
          : { x: left + orientedY, y: top - orientedX };
  return {
    origin,
    width,
    height,
    sizingRatio,
    rotation: rotation + config.rotation,
    orientedBounds: { x, y, width: extentWidth, height: extentHeight },
  };
}
