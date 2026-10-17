import type { WorkspacePageId } from '../pdf-workspace/model/types';

export type AssistantOperation =
  | { readonly type: 'select_page'; readonly pageId: WorkspacePageId }
  | {
      readonly type: 'rotate_pages';
      readonly pageIds: readonly WorkspacePageId[];
      readonly degrees: 90 | -90;
    }
  | {
      readonly type: 'move_page';
      readonly pageId: WorkspacePageId;
      readonly toIndex: number;
    }
  | { readonly type: 'delete_page'; readonly pageId: WorkspacePageId }
  | { readonly type: 'set_text_watermark'; readonly text: string }
  | { readonly type: 'remove_watermark' }
  | {
      readonly type: 'add_text_annotation';
      readonly pageId: WorkspacePageId;
      readonly text: string;
      readonly position: 'center';
    };

export interface AssistantPageSnapshot {
  readonly id: WorkspacePageId;
  readonly pageNumber: number;
  readonly rotationDegrees: number;
}

export interface AssistantWorkspaceSnapshot {
  readonly pages: readonly AssistantPageSnapshot[];
  readonly selectedPageId: WorkspacePageId | null;
  readonly watermark: {
    readonly present: boolean;
    readonly kind: 'text' | 'image' | null;
    readonly targetPageCount: number;
  };
  /** Local stale-state token; never included in provider context. */
  readonly revision: string;
}

export type InterpretationResult =
  | { readonly kind: 'proposal'; readonly operation: AssistantOperation }
  | {
      readonly kind: 'unsupported' | 'ambiguous' | 'invalid';
      readonly message: string;
    };

export type AssistantExecutionResult =
  | { readonly kind: 'applied'; readonly message: string }
  | { readonly kind: 'cancelled'; readonly message: string }
  | { readonly kind: 'rejected'; readonly message: string }
  | { readonly kind: 'failed'; readonly message: string };
