import type {
  SourceDocumentId,
  WorkspacePageId,
} from '../../features/pdf-workspace/model/types';

/**
 * A source-run identity is intentionally tied to a decoded content stream,
 * not a visual rectangle or PDF.js extraction result. The latter are useful
 * for selection, but do not identify a mutable PDF operand.
 */
export interface NativeTextRunIdentity {
  /** SHA-256 of the source File bytes observed during selection. */
  readonly sourceFileFingerprint: string;
  readonly streamFingerprint: string;
  readonly runOrdinal: number;
  readonly originalText: string;
  readonly fontResourceName: string;
  readonly fontBaseName: SupportedNativeTextFont;
  readonly fontSize: number;
  /** The verified, untransformed source Tm operands. */
  readonly textMatrix: readonly [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
}

/** Standard-14 simple fonts whose printable ASCII mapping is deterministic. */
export type SupportedNativeTextFont =
  | 'Courier'
  | 'Courier-Bold'
  | 'Courier-Oblique'
  | 'Courier-BoldOblique'
  | 'Helvetica'
  | 'Helvetica-Bold'
  | 'Helvetica-Oblique'
  | 'Helvetica-BoldOblique'
  | 'Times-Roman'
  | 'Times-Bold'
  | 'Times-Italic'
  | 'Times-BoldItalic';

/** One normalized-free PDF.js text item, expressed in source PDF user space. */
export interface NativeTextVisualRun {
  readonly text: string;
  readonly transform: readonly [number, number, number, number, number, number];
}

/**
 * Provenance for one complete visual TextItem. Text alone is intentionally
 * insufficient: a partial browser selection can otherwise collide with a
 * different raw Tj operand that happens to contain the same string.
 */
export interface NativeTextSelectionProof {
  readonly selectedRunIndex: number;
  /** Every non-empty PDF.js text item, retained in rendering order. */
  readonly runs: readonly NativeTextVisualRun[];
}

/**
 * One workspace-local replacement. The source document is never mutated:
 * export applies this to that workspace occurrence after copying its page.
 */
export interface NativeTextEdit {
  readonly id: string;
  readonly workspacePageId: WorkspacePageId;
  readonly sourceDocumentId: SourceDocumentId;
  readonly sourcePageIndex: number;
  readonly identity: NativeTextRunIdentity;
  readonly replacementText: string;
  /** Translation in original PDF user-space points, before page rotation. */
  readonly translationX: number;
  readonly translationY: number;
}

export interface NativeTextEditHistoryState {
  readonly past: readonly (readonly NativeTextEdit[])[];
  readonly present: readonly NativeTextEdit[];
  readonly future: readonly (readonly NativeTextEdit[])[];
}

export type NativeTextEditErrorCode =
  | 'source-load-failed'
  | 'invalid-selection'
  | 'unsupported-content'
  | 'unsupported-font'
  | 'ambiguous-run'
  | 'identity-mismatch'
  | 'invalid-replacement'
  | 'redaction-conflict'
  | 'form-conflict'
  | 'shared-output-stream'
  | 'verification-failed'
  | 'resource-limit'
  | 'aborted';

/** Error messages are user-safe and deliberately never include PDF operands. */
export class NativeTextEditError extends Error {
  readonly code: NativeTextEditErrorCode;

  constructor(code: NativeTextEditErrorCode, message: string) {
    super(message);
    this.name = 'NativeTextEditError';
    this.code = code;
  }
}

export interface NativeTextSelectionResult {
  readonly identity: NativeTextRunIdentity;
}
