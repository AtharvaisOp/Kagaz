import type {
  SourceDocumentId,
  WorkspacePage,
} from '../../features/pdf-workspace/model/types';
import type { PdfAnnotation } from '../../features/pdf-annotations/model/types';
import type { AnnotationImageExportSource } from './annotations/exportContracts';
import type { FormExportSnapshot } from './forms/types';
import type { RedactionRegion } from '../../features/pdf-redactions/model/types';

export interface ExportSource {
  readonly id: SourceDocumentId;
  readonly file: File;
  readonly fileName: string;
}

export interface ExportWorkspaceRequest {
  readonly pages: readonly WorkspacePage[];
  readonly sources: ReadonlyMap<SourceDocumentId, ExportSource>;
  /** Immutable page-local annotation snapshot captured at export start. */
  readonly annotationsByPage: ReadonlyMap<string, readonly PdfAnnotation[]>;
  /** Immutable image bytes required by the page-local annotation snapshot. */
  readonly imageAssets: ReadonlyMap<string, AnnotationImageExportSource>;
  /** Immutable, serializable form metadata and committed values. */
  readonly forms: FormExportSnapshot;
  /** Pending proposals are finalized destructively, outside annotation flattening. */
  readonly redactionsByPage?: ReadonlyMap<string, readonly RedactionRegion[]>;
}

export type ExportProgress =
  | {
      readonly phase: 'preparing';
      readonly current: number;
      readonly total: number;
    }
  | {
      readonly phase: 'loading';
      readonly current: number;
      readonly total: number;
      readonly fileName: string;
    }
  | {
      readonly phase: 'building';
      readonly current: number;
      readonly total: number;
    }
  | {
      readonly phase: 'saving';
      readonly current: number;
      readonly total: number;
    };

export type PdfExportErrorCode =
  | 'export-blocked'
  | 'aborted'
  | 'missing-source'
  | 'source-read-failed'
  | 'source-pdf-invalid'
  | 'page-copy-failed'
  | 'redaction-invalid'
  | 'redaction-too-large'
  | 'redaction-render-failed'
  | 'redaction-unsafe-retention'
  | 'save-failed';

export class PdfExportError extends Error {
  readonly code: PdfExportErrorCode;
  readonly fileName: string | null;

  constructor(
    code: PdfExportErrorCode,
    message: string,
    fileName: string | null = null,
  ) {
    super(message);
    this.name = 'PdfExportError';
    this.code = code;
    this.fileName = fileName;
  }
}
