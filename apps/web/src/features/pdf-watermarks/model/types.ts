import type { RgbColor } from '../../pdf-annotations/model/types';
import type { WorkspacePageId } from '../../pdf-workspace/model/types';

export type WatermarkTarget =
  | { readonly kind: 'all' }
  | { readonly kind: 'pages'; readonly pageIds: readonly WorkspacePageId[] };

export type WatermarkPosition =
  | 'center'
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right'
  | 'custom';

export interface WatermarkBase {
  readonly id: string;
  readonly opacity: number;
  /** Degrees relative to the final oriented page, counterclockwise. */
  readonly rotation: number;
  /** Bounded size multiplier, independent of viewer zoom and device pixels. */
  readonly scale: number;
  readonly position: WatermarkPosition;
  /** Normalized placement within the available span, left/bottom to right/top. */
  readonly customPosition: { readonly x: number; readonly y: number };
  readonly target: WatermarkTarget;
}

export interface TextWatermarkConfig extends WatermarkBase {
  readonly kind: 'text';
  readonly text: string;
  /** Physical points; export divides by UserUnit before drawing in raw PDF space. */
  readonly fontSize: number;
  readonly color: RgbColor;
}

export interface ImageWatermarkConfig extends WatermarkBase {
  readonly kind: 'image';
  readonly assetId: string;
}

export type WatermarkConfig = TextWatermarkConfig | ImageWatermarkConfig;

export interface WatermarkHistoryState {
  readonly past: readonly WatermarkHistoryEntry[];
  readonly present: WatermarkConfig | null;
  readonly future: readonly WatermarkHistoryEntry[];
}

export interface WatermarkHistoryEntry {
  readonly config: WatermarkConfig | null;
  readonly transactionId: string;
}

export interface WatermarkPreviewGeometry {
  readonly viewBox: readonly number[];
  readonly userUnit: number;
  readonly rotation: number;
}
