import type {
  PageRotation,
  WorkspacePageId,
} from '../../pdf-workspace/model/types';

export type AnnotationId = string;
export type AnnotationAssetId = string;

export type AnnotationKind =
  | 'text'
  | 'highlight'
  | 'freehand'
  | 'rectangle'
  | 'ellipse'
  | 'line'
  | 'image'
  | 'signature';

export interface PdfPoint {
  readonly x: number;
  readonly y: number;
}

export interface PdfOrientedBox {
  readonly origin: PdfPoint;
  readonly width: number;
  readonly height: number;
  readonly rotation: PageRotation;
}

export interface RgbColor {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

export interface StrokeStyle {
  readonly color: RgbColor;
  readonly widthUserUnits: number;
  readonly opacity: number;
}

export interface FillStyle {
  readonly color: RgbColor;
  readonly opacity: number;
}

export interface AnnotationBase<K extends AnnotationKind> {
  readonly id: AnnotationId;
  readonly workspacePageId: WorkspacePageId;
  readonly kind: K;
}

export interface TextAnnotation extends AnnotationBase<'text'> {
  readonly box: PdfOrientedBox;
  readonly text: string;
  readonly fontFamily: 'helvetica';
  readonly fontSizeUserUnits: number;
  readonly lineHeight: number;
  readonly align: 'left' | 'center' | 'right';
  readonly color: RgbColor;
  readonly opacity: number;
}

export interface HighlightAnnotation extends AnnotationBase<'highlight'> {
  readonly box: PdfOrientedBox;
  readonly fill: FillStyle;
}

export interface FreehandAnnotation extends AnnotationBase<'freehand'> {
  readonly points: readonly [PdfPoint, PdfPoint, ...PdfPoint[]];
  readonly stroke: StrokeStyle;
}

export interface RectangleAnnotation extends AnnotationBase<'rectangle'> {
  readonly box: PdfOrientedBox;
  readonly stroke: StrokeStyle | null;
  readonly fill: FillStyle | null;
}

export interface EllipseAnnotation extends AnnotationBase<'ellipse'> {
  readonly box: PdfOrientedBox;
  readonly stroke: StrokeStyle | null;
  readonly fill: FillStyle | null;
}

export interface LineAnnotation extends AnnotationBase<'line'> {
  readonly start: PdfPoint;
  readonly end: PdfPoint;
  readonly stroke: StrokeStyle;
}

export interface ImageAnnotation extends AnnotationBase<'image'> {
  readonly box: PdfOrientedBox;
  readonly assetId: AnnotationAssetId;
  readonly opacity: number;
}

export type SignatureMethod = 'draw' | 'type' | 'upload';

export interface SignatureAnnotation extends AnnotationBase<'signature'> {
  readonly box: PdfOrientedBox;
  readonly assetId: AnnotationAssetId;
  readonly method: SignatureMethod;
  readonly opacity: number;
}

export type PdfAnnotation =
  | TextAnnotation
  | HighlightAnnotation
  | FreehandAnnotation
  | RectangleAnnotation
  | EllipseAnnotation
  | LineAnnotation
  | ImageAnnotation
  | SignatureAnnotation;

export interface AnnotationDocument {
  readonly byPage: Partial<Record<WorkspacePageId, readonly PdfAnnotation[]>>;
}

export interface AnnotationSelection {
  readonly workspacePageId: WorkspacePageId;
  readonly annotationId: AnnotationId;
}

export type AnnotationPatch = Partial<PdfAnnotation>;

export type AnnotationUpdate =
  AnnotationPatch | ((annotation: PdfAnnotation) => PdfAnnotation);

export interface AnnotationHistoryState {
  readonly past: readonly AnnotationDocument[];
  readonly present: AnnotationDocument;
  readonly future: readonly AnnotationDocument[];
  readonly baseline: AnnotationDocument;
  readonly dirty: boolean;
}
