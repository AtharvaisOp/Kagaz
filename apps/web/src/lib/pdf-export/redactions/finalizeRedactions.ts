import {
  PDFDocument,
  PDFName,
  PDFNumber,
  degrees,
  type PDFPage,
} from 'pdf-lib';
import type { PdfAnnotation } from '../../../features/pdf-annotations/model/types';
import type { RedactionRegion } from '../../../features/pdf-redactions/model/types';
import type { WorkspacePage } from '../../../features/pdf-workspace/model/types';
import { normalizeRotation } from '../../../features/pdf-workspace/model/operations';
import { flattenAnnotationsOntoCopiedPage } from '../annotations/flattenAnnotations';
import type { AnnotationImageResolver } from '../annotations/exportContracts';
import type { AnnotationImageExportSource } from '../annotations/exportContracts';
import type { WatermarkConfig } from '../../../features/pdf-watermarks/model/types';
import {
  createWatermarkExportContext,
  drawWatermarkOnPage,
} from '../watermarks/renderWatermark';
import { PdfExportError } from '../types';
import { rasterizeAppearance } from './rasterizeAppearance';
import { appearanceContentFingerprints } from './retentionSafety';
import {
  REDACTION_DPI,
  redactionPixelBounds,
  redactionRasterDimensions,
} from './rasterPolicy';

function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted)
    throw new PdfExportError('aborted', 'PDF export was cancelled.');
}

function validatePageGeometry(
  page: PDFPage,
  regions: readonly RedactionRegion[],
  pageId: string,
): number {
  const media = page.getMediaBox();
  const crop = page.getCropBox();
  const userUnit =
    page.node.lookupMaybe(PDFName.of('UserUnit'), PDFNumber)?.asNumber() ?? 1;
  const rotation = page.getRotation().angle;
  if (
    ![
      media.x,
      media.y,
      media.width,
      media.height,
      crop.x,
      crop.y,
      crop.width,
      crop.height,
      userUnit,
      rotation,
    ].every(Number.isFinite) ||
    media.width <= 0 ||
    media.height <= 0 ||
    crop.width <= 0 ||
    crop.height <= 0 ||
    userUnit < 1 ||
    userUnit > 75000 ||
    rotation % 90 !== 0 ||
    regions.length === 0 ||
    regions.length > 1000
  ) {
    throw new PdfExportError(
      'redaction-invalid',
      'This page or its proposed redactions have unsupported geometry.',
    );
  }
  const left = Math.max(media.x, crop.x);
  const bottom = Math.max(media.y, crop.y);
  const right = Math.min(media.x + media.width, crop.x + crop.width);
  const top = Math.min(media.y + media.height, crop.y + crop.height);
  const scale = (userUnit * REDACTION_DPI) / 72;
  const viewport = {
    width: (right - left) * scale,
    height: (top - bottom) * scale,
    viewBox: [left, bottom, right, top],
    convertToViewportPoint: (x: number, y: number) => [
      (x - left) * scale,
      (top - y) * scale,
    ],
  };
  redactionRasterDimensions(viewport);
  const ids = new Set<string>();
  for (const region of regions) {
    if (ids.has(region.id))
      throw new PdfExportError(
        'redaction-invalid',
        'A proposed redaction has a duplicate identity.',
      );
    ids.add(region.id);
    redactionPixelBounds(region, pageId, viewport);
  }
  return userUnit;
}

/** The donor page is copied only into a throwaway appearance, never into final output. */
export async function finalizeRedactions(
  output: PDFDocument,
  source: PDFDocument,
  workspacePage: WorkspacePage,
  regions: readonly RedactionRegion[],
  annotations: readonly PdfAnnotation[],
  imageResolver: AnnotationImageResolver,
  signal?: AbortSignal,
  watermark?: {
    readonly config: WatermarkConfig;
    readonly imageAssets: ReadonlyMap<string, AnnotationImageExportSource>;
  },
): Promise<ReadonlySet<string>> {
  checkAbort(signal);
  const sourcePage = source.getPage(workspacePage.sourcePageIndex);
  const userUnit = validatePageGeometry(sourcePage, regions, workspacePage.id);
  const appearance = await PDFDocument.create();
  const [page] = await appearance.copyPages(source, [
    workspacePage.sourcePageIndex,
  ]);
  if (!page)
    throw new PdfExportError(
      'redaction-render-failed',
      'Kagaz could not prepare this redacted page.',
    );
  appearance.addPage(page);
  await flattenAnnotationsOntoCopiedPage(
    page,
    annotations,
    appearance,
    undefined,
    imageResolver,
  );
  checkAbort(signal);
  const appearanceBytes = await appearance.save();
  checkAbort(signal);
  // Save/reload also exposes the generated annotation/form appearance streams.
  const inspection = await PDFDocument.load(appearanceBytes, {
    throwOnInvalidObject: true,
  });
  const fingerprints = await appearanceContentFingerprints(
    inspection,
    () => checkAbort(signal),
    // Export preflight captures all original source resource keys. Identifiers
    // added while flattening are generated drawing references, not source data.
    false,
  );
  checkAbort(signal);
  let sanitized = await rasterizeAppearance(
    appearanceBytes,
    workspacePage.id,
    regions,
    signal,
  );
  checkAbort(signal);
  const media = sourcePage.getMediaBox();
  if (watermark) {
    // Foreground composition begins only after donor content has been removed.
    // This second isolated PDF can reach only sanitized pixels + new watermark
    // resources. Neither that PDF nor its raw watermark assets enter output.
    const composition = await PDFDocument.create();
    const composedPage = composition.addPage([media.width, media.height]);
    composedPage.setMediaBox(media.x, media.y, media.width, media.height);
    const [left, bottom, right, top] = sanitized.viewBox;
    composedPage.setCropBox(left, bottom, right - left, top - bottom);
    if (userUnit !== 1)
      composedPage.node.set(PDFName.of('UserUnit'), PDFNumber.of(userUnit));
    composedPage.setRotation(sourcePage.getRotation());
    const base = await composition.embedPng(sanitized.png);
    checkAbort(signal);
    composedPage.drawImage(base, {
      x: left,
      y: bottom,
      width: right - left,
      height: top - bottom,
    });
    const watermarkContext = await createWatermarkExportContext(
      composition,
      watermark.config,
      watermark.imageAssets,
      undefined,
      signal,
    );
    checkAbort(signal);
    drawWatermarkOnPage(
      composedPage,
      workspacePage.rotationDelta,
      watermarkContext,
    );
    const composedBytes = await composition.save();
    checkAbort(signal);
    const composedInspection = await PDFDocument.load(composedBytes, {
      throwOnInvalidObject: true,
    });
    // Keep the Phase 5A reachable image/aggregate budgets for the trusted pass.
    // These new resources are not fingerprints of the removed donor appearance.
    await appearanceContentFingerprints(
      composedInspection,
      () => checkAbort(signal),
      false,
    );
    sanitized = await rasterizeAppearance(
      composedBytes,
      workspacePage.id,
      [],
      signal,
    );
    checkAbort(signal);
  }
  const image = await output.embedPng(sanitized.png);
  checkAbort(signal);
  const replacement = output.addPage([media.width, media.height]);
  replacement.setMediaBox(media.x, media.y, media.width, media.height);
  const [left, bottom, right, top] = sanitized.viewBox;
  replacement.setCropBox(left, bottom, right - left, top - bottom);
  if (userUnit !== 1)
    replacement.node.set(PDFName.of('UserUnit'), PDFNumber.of(userUnit));
  replacement.drawImage(image, {
    x: left,
    y: bottom,
    width: right - left,
    height: top - bottom,
  });
  replacement.setRotation(
    degrees(
      normalizeRotation(
        sourcePage.getRotation().angle + workspacePage.rotationDelta,
      ),
    ),
  );
  return fingerprints;
}
