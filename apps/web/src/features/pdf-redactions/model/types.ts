import type { WorkspacePageId } from '../../pdf-workspace/model/types';

/** Axis-aligned rectangle in original PDF user space, before all page rotation. */
export interface RedactionBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** An editable proposal. Only the separate export finalizer removes information. */
export interface RedactionRegion {
  readonly id: string;
  readonly pageId: WorkspacePageId;
  readonly box: RedactionBox;
}

export interface RedactionHistoryState {
  readonly past: readonly (readonly RedactionRegion[])[];
  readonly present: readonly RedactionRegion[];
  readonly future: readonly (readonly RedactionRegion[])[];
}
