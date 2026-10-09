import type { RedactionRegion } from '../../../features/pdf-redactions/model/types';
import { PdfExportError } from '../types';

/** Independent of display zoom, CSS scale and device pixel ratio. */
export const REDACTION_DPI = 144;
export const REDACTION_MAX_SIDE = 8192;
export const REDACTION_MAX_PIXELS = 16_000_000;
export const REDACTION_MAX_IMAGE_PIXELS = 32_000_000;

export interface RedactionViewport {
  readonly width: number;
  readonly height: number;
  readonly viewBox: readonly number[];
  readonly convertToViewportPoint: (x: number, y: number) => number[];
}

export function redactionRasterDimensions(
  viewport: Pick<RedactionViewport, 'width' | 'height'>,
): { width: number; height: number } {
  const width = Math.ceil(viewport.width);
  const height = Math.ceil(viewport.height);
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0 ||
    width > REDACTION_MAX_SIDE ||
    height > REDACTION_MAX_SIDE ||
    width * height > REDACTION_MAX_PIXELS
  ) {
    throw new PdfExportError(
      'redaction-too-large',
      'This page is too large to safely finalize redactions at 144 DPI. Use a smaller page size.',
    );
  }
  return { width, height };
}

/** Outward rounding and a one-pixel fringe also overwrite antialiased edge pixels. */
export function redactionPixelBounds(
  region: RedactionRegion,
  pageId: string,
  viewport: RedactionViewport,
): { x: number; y: number; width: number; height: number } {
  const { box } = region;
  const view = viewport.viewBox;
  if (
    region.pageId !== pageId ||
    !region.id ||
    view.length !== 4 ||
    !view.every(Number.isFinite) ||
    ![
      box.x,
      box.y,
      box.width,
      box.height,
      box.x + box.width,
      box.y + box.height,
    ].every(Number.isFinite) ||
    box.width <= 0 ||
    box.height <= 0 ||
    box.x < view[0]! ||
    box.y < view[1]! ||
    box.x + box.width > view[2]! ||
    box.y + box.height > view[3]!
  ) {
    throw new PdfExportError(
      'redaction-invalid',
      'A proposed redaction has invalid geometry. Edit or remove it before exporting.',
    );
  }
  const corners = [
    viewport.convertToViewportPoint(box.x, box.y),
    viewport.convertToViewportPoint(box.x + box.width, box.y + box.height),
  ];
  if (
    corners.some(
      (corner) => corner.length !== 2 || !corner.every(Number.isFinite),
    )
  ) {
    throw new PdfExportError(
      'redaction-invalid',
      'Kagaz could not map a proposed redaction onto the PDF page.',
    );
  }
  const dimensions = redactionRasterDimensions(viewport);
  const left = Math.max(
    0,
    Math.floor(Math.min(corners[0]![0]!, corners[1]![0]!)) - 1,
  );
  const top = Math.max(
    0,
    Math.floor(Math.min(corners[0]![1]!, corners[1]![1]!)) - 1,
  );
  const right = Math.min(
    dimensions.width,
    Math.ceil(Math.max(corners[0]![0]!, corners[1]![0]!)) + 1,
  );
  const bottom = Math.min(
    dimensions.height,
    Math.ceil(Math.max(corners[0]![1]!, corners[1]![1]!)) + 1,
  );
  return { x: left, y: top, width: right - left, height: bottom - top };
}
