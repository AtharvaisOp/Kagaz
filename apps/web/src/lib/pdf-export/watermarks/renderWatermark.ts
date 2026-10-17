import {
  PDFDocument,
  PDFName,
  PDFNumber,
  degrees,
  drawImage,
  drawText,
  rgb,
  type PDFFont,
  type PDFImage,
  type PDFPage,
} from 'pdf-lib';
import type {
  WatermarkConfig,
  WatermarkPreviewGeometry,
} from '../../../features/pdf-watermarks/model/types';
import {
  snapshotWatermark,
  validateWatermarkModel,
} from '../../../features/pdf-watermarks/model/watermark';
import { intersectPageBoxes } from '../../../features/pdf-annotations/geometry/pageBoxes';
import type { AnnotationImageExportSource } from '../annotations/exportContracts';
import type { AnnotationExportContext } from '../annotations/flattenAnnotations';
import { PdfExportError } from '../types';
import { assertWatermarkGeometry, watermarkPlacement } from './geometry';
import { assertWatermarkImageBytes } from './imageSafety';
import { prepareWatermarkImageSource } from './nativeImage';
import type { DocumentFontId } from '../../fonts/fontCatalog';
import type { FontAssetSnapshot } from '../../fonts/fontAssets';
import {
  pdfFontContextFromHelvetica,
  preparePdfFont,
  type PdfFontContext,
} from '../../fonts/pdfFont';

export interface WatermarkExportContext {
  readonly config: WatermarkConfig;
  readonly font: PDFFont | null;
  readonly fontContext: PdfFontContext | null;
  readonly image: PDFImage | null;
}

/** Include advances and actual glyph ink so bearings/descenders fit every font. */
function textAppearanceBounds(
  context: PdfFontContext,
  text: string,
  size: number,
) {
  const measured = context.measure(text, size);
  const minX = Math.min(0, measured.inkBounds.minX);
  const maxX = Math.max(measured.width, measured.inkBounds.maxX);
  const minY = measured.inkBounds.minY;
  const maxY = measured.inkBounds.maxY;
  return { minX, minY, width: maxX - minX, height: maxY - minY };
}

function assertConfiguration(config: WatermarkConfig): void {
  const error = validateWatermarkModel(config);
  if (error) throw new PdfExportError('watermark-invalid', error);
}

function assertTextEncoding(text: string, font: PdfFontContext): string {
  if (
    !text.trim() ||
    text.length > 200 ||
    [...text].some(
      (glyph) => glyph.charCodeAt(0) < 32 || glyph.charCodeAt(0) === 127,
    )
  )
    throw new PdfExportError(
      'watermark-invalid',
      'Enter one line of watermark text, at most 200 characters, without control characters.',
    );
  try {
    return font.validate(text);
  } catch (error) {
    throw new PdfExportError(
      'watermark-unsupported-text',
      error instanceof Error
        ? error.message
        : 'This watermark contains text that the selected font cannot safely export.',
    );
  }
}

/** The same glyph validation runs before Apply, preview, and final output. */
export async function validateWatermarkText(
  text: string,
  fontFamily: DocumentFontId = 'helvetica',
): Promise<void> {
  const document = await PDFDocument.create();
  assertTextEncoding(text, await preparePdfFont(document, fontFamily));
}

/** One font/image embed per document, shared by every targeted ordinary page. */
export async function createWatermarkExportContext(
  document: PDFDocument,
  config: WatermarkConfig,
  imageAssets: ReadonlyMap<string, AnnotationImageExportSource>,
  preparedResources?: Pick<AnnotationExportContext, 'font' | 'imageCache'>,
  signal?: AbortSignal,
  fontAssets?: FontAssetSnapshot,
): Promise<WatermarkExportContext> {
  assertConfiguration(config);
  let captured = snapshotWatermark(config);
  if (captured.kind === 'text') {
    const fontFamily = captured.fontFamily ?? 'helvetica';
    const fontContext =
      fontFamily === 'helvetica' && preparedResources?.font
        ? pdfFontContextFromHelvetica(preparedResources.font)
        : await preparePdfFont(document, fontFamily, fontAssets);
    const text = assertTextEncoding(captured.text, fontContext);
    captured = snapshotWatermark({ ...captured, text });
    return {
      config: captured,
      font: fontContext.font,
      fontContext,
      image: null,
    };
  }
  const source = imageAssets.get(captured.assetId);
  if (!source || source.assetId !== captured.assetId)
    throw new PdfExportError(
      'watermark-missing-image',
      'The watermark image is no longer available. Choose the image again.',
    );
  const safeSource = await prepareWatermarkImageSource(source, signal);
  const dimensions = assertWatermarkImageBytes(
    safeSource.bytes,
    safeSource.mimeType,
  );
  try {
    const image =
      preparedResources?.imageCache.get(captured.assetId) ??
      (safeSource.mimeType === 'image/png'
        ? await document.embedPng(safeSource.bytes)
        : await document.embedJpg(safeSource.bytes));
    if (image.width !== dimensions.width || image.height !== dimensions.height)
      throw new Error('Image dimensions changed during decoding.');
    preparedResources?.imageCache.set(captured.assetId, image);
    return { config: captured, font: null, fontContext: null, image };
  } catch (error) {
    if (error instanceof PdfExportError) throw error;
    throw new PdfExportError(
      'watermark-image-invalid',
      'The watermark image could not be decoded for PDF export. Choose a valid PNG or JPEG.',
    );
  }
}

export function watermarkPageGeometry(
  page: PDFPage,
  rotationDelta: number,
): WatermarkPreviewGeometry {
  const media = page.getMediaBox();
  const crop = page.getCropBox();
  const viewBox = intersectPageBoxes(
    [media.x, media.y, media.x + media.width, media.y + media.height],
    [crop.x, crop.y, crop.x + crop.width, crop.y + crop.height],
  );
  if (!viewBox)
    throw new PdfExportError(
      'watermark-invalid',
      'This page has invalid visible bounds for watermarking.',
    );
  const geometry = {
    viewBox,
    userUnit:
      page.node.lookupMaybe(PDFName.of('UserUnit'), PDFNumber)?.asNumber() ?? 1,
    rotation: page.getRotation().angle + rotationDelta,
  };
  assertWatermarkGeometry(geometry);
  return geometry;
}

/** Validate every target's geometry without allocating its preview bitmap. */
export function validateWatermarkPageGeometry(
  geometry: WatermarkPreviewGeometry,
  context: WatermarkExportContext,
): ReturnType<typeof watermarkPlacement> {
  const { config } = context;
  assertConfiguration(config);
  assertWatermarkGeometry(geometry);
  if (config.kind === 'image') {
    if (!context.image)
      throw new PdfExportError(
        'watermark-missing-image',
        'The watermark image was not prepared.',
      );
    // Natural image dimensions have no physical authority: aspect ratio is fitted
    // to the final visible page, then the explicit scale controls its bounded size.
    const imageRatio = context.image.width / context.image.height;
    const width = geometry.viewBox[2]! - geometry.viewBox[0]!;
    const height = geometry.viewBox[3]! - geometry.viewBox[1]!;
    const naturalWidth = Math.max(width, height);
    return watermarkPlacement(
      config,
      geometry,
      naturalWidth,
      naturalWidth / imageRatio,
    );
  }
  if (!context.fontContext)
    throw new PdfExportError(
      'watermark-render-failed',
      'The watermark font was not prepared.',
    );
  const fontSize = config.fontSize / geometry.userUnit;
  const appearance = textAppearanceBounds(
    context.fontContext,
    config.text,
    fontSize,
  );
  return watermarkPlacement(
    config,
    geometry,
    appearance.width,
    appearance.height,
  );
}

export async function createWatermarkGeometryValidator(
  config: WatermarkConfig,
  imageAssets: ReadonlyMap<string, AnnotationImageExportSource>,
  signal?: AbortSignal,
): Promise<(geometry: WatermarkPreviewGeometry) => void> {
  const document = await PDFDocument.create();
  const context = await createWatermarkExportContext(
    document,
    config,
    imageAssets,
    undefined,
    signal,
  );
  return (geometry) => {
    validateWatermarkPageGeometry(geometry, context);
  };
}

function drawWatermark(
  page: PDFPage,
  geometry: WatermarkPreviewGeometry,
  context: WatermarkExportContext,
): void {
  const { config } = context;
  const placement = validateWatermarkPageGeometry(geometry, context);
  // Separate generated aliases from source-controlled Helvetica/Image/GS names.
  // The final retention guard still checks these identifiers without exceptions.
  const graphicsState = page.node.newExtGState(
    'KagazWatermarkOpacity',
    page.doc.context.obj({ Type: 'ExtGState', ca: config.opacity }),
  );
  if (config.kind === 'image') {
    if (!context.image)
      throw new PdfExportError(
        'watermark-missing-image',
        'The watermark image was not prepared.',
      );
    const imageName = page.node.newXObject(
      'KagazWatermarkImage',
      context.image.ref,
    );
    page.pushOperators(
      ...drawImage(imageName, {
        x: placement.origin.x,
        y: placement.origin.y,
        width: placement.width,
        height: placement.height,
        rotate: degrees(placement.rotation),
        graphicsState,
        xSkew: degrees(0),
        ySkew: degrees(0),
      }),
    );
    return;
  }
  if (!context.font || !context.fontContext)
    throw new PdfExportError(
      'watermark-render-failed',
      'The watermark font was not prepared.',
    );
  const fontSize = config.fontSize / geometry.userUnit;
  const appearance = textAppearanceBounds(
    context.fontContext,
    config.text,
    fontSize,
  );
  const descent = -appearance.minY * placement.sizingRatio;
  const leftBearing = -appearance.minX * placement.sizingRatio;
  const angle = (placement.rotation * Math.PI) / 180;
  const fontName = page.node.newFontDictionary(
    'KagazWatermarkFont',
    context.font.ref,
  );
  page.pushOperators(
    ...drawText(context.font.encodeText(config.text), {
      x:
        placement.origin.x +
        Math.cos(angle) * leftBearing -
        Math.sin(angle) * descent,
      y:
        placement.origin.y +
        Math.sin(angle) * leftBearing +
        Math.cos(angle) * descent,
      size: fontSize * placement.sizingRatio,
      font: fontName,
      color: rgb(config.color.r, config.color.g, config.color.b),
      graphicsState,
      xSkew: degrees(0),
      ySkew: degrees(0),
      rotate: degrees(placement.rotation),
    }),
  );
}

/** Foreground composition; the copied page receives final rotation afterwards. */
export function drawWatermarkOnPage(
  page: PDFPage,
  rotationDelta: number,
  context: WatermarkExportContext,
): void {
  drawWatermark(page, watermarkPageGeometry(page, rotationDelta), context);
}

/** Transparent, source-free appearance using exactly the final export drawing. */
export async function createWatermarkPreviewPdf(
  config: WatermarkConfig,
  geometry: WatermarkPreviewGeometry,
  imageAssets: ReadonlyMap<string, AnnotationImageExportSource>,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  assertWatermarkGeometry(geometry);
  const captured = snapshotWatermark(config);
  const document = await PDFDocument.create();
  const [left, bottom, right, top] = geometry.viewBox as readonly [
    number,
    number,
    number,
    number,
  ];
  const page = document.addPage([right - left, top - bottom]);
  page.setMediaBox(left, bottom, right - left, top - bottom);
  page.setCropBox(left, bottom, right - left, top - bottom);
  if (geometry.userUnit !== 1)
    page.node.set(PDFName.of('UserUnit'), PDFNumber.of(geometry.userUnit));
  drawWatermark(
    page,
    geometry,
    await createWatermarkExportContext(
      document,
      captured,
      imageAssets,
      undefined,
      signal,
    ),
  );
  page.setRotation(degrees(((geometry.rotation % 360) + 360) % 360));
  return document.save();
}
