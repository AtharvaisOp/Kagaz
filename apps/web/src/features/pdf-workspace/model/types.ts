export type SourceDocumentId = string;
export type WorkspacePageId = string;

export type PageRotation = 0 | 90 | 180 | 270;

export type SourceDocumentStatus = 'loading' | 'ready' | 'error';

export interface SourceDocumentSummary {
  readonly id: SourceDocumentId;
  readonly fileName: string;
  readonly status: SourceDocumentStatus;
  readonly pageCount: number | null;
  readonly error: string | null;
}

export interface WorkspacePage {
  readonly id: WorkspacePageId;
  readonly sourceDocumentId: SourceDocumentId;
  readonly sourcePageIndex: number;
  readonly rotationDelta: PageRotation;
}

export interface WorkspaceSnapshot {
  readonly pages: readonly WorkspacePage[];
}

export type WorkspaceSessionStatus = 'empty' | 'active';

export interface PdfWorkspaceState {
  readonly sessionStatus: WorkspaceSessionStatus;
  readonly sources: Readonly<Record<SourceDocumentId, SourceDocumentSummary>>;
  /** Operational source metadata; it is intentionally not part of the baseline. */
  readonly sourceOrder: readonly SourceDocumentId[];
  readonly pages: readonly WorkspacePage[];
  readonly selectedPageId: WorkspacePageId | null;
  readonly baseline: WorkspaceSnapshot | null;
  readonly dirty: boolean;
}

export type WorkspaceAction =
  | {
      readonly type: 'INITIALIZE_WORKSPACE';
      readonly sources: readonly SourceDocumentSummary[];
      readonly sourceOrder: readonly SourceDocumentId[];
      readonly pages: readonly WorkspacePage[];
      readonly selectedPageId?: WorkspacePageId | null;
    }
  | {
      readonly type: 'REGISTER_SOURCE';
      readonly source: Pick<SourceDocumentSummary, 'id' | 'fileName'>;
    }
  | {
      readonly type: 'SOURCE_READY';
      readonly sourceId: SourceDocumentId;
      readonly pageCount: number;
    }
  | {
      readonly type: 'SOURCE_FAILED';
      readonly sourceId: SourceDocumentId;
      readonly error: string;
    }
  | {
      readonly type: 'APPEND_SOURCE_PAGES';
      readonly pages: readonly WorkspacePage[];
    }
  | {
      readonly type: 'SELECT_PAGE';
      readonly pageId: WorkspacePageId;
    }
  | {
      readonly type: 'MOVE_PAGE';
      readonly pageId: WorkspacePageId;
      readonly toIndex: number;
    }
  | {
      readonly type: 'DELETE_PAGE';
      readonly pageId: WorkspacePageId;
    }
  | {
      readonly type: 'ROTATE_PAGE';
      readonly pageId: WorkspacePageId;
      readonly delta?: number;
    }
  | {
      readonly type: 'RESET_WORKSPACE';
    };
