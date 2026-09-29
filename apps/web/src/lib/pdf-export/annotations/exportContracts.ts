export type AnnotationExportErrorCode =
  | 'unsupported-text-font'
  | 'missing-image-asset'
  | 'missing-signature-asset'
  | 'image-read-failed'
  | 'unsupported-image-format'
  | 'image-embed-failed';

export interface AnnotationImageExportSource {
  readonly assetId: string;
  readonly mimeType: 'image/png' | 'image/jpeg';
  readonly bytes: Uint8Array | ArrayBuffer;
}

export interface AnnotationImageResolver {
  readonly resolve: (
    assetId: string,
  ) =>
    | AnnotationImageExportSource
    | null
    | Promise<AnnotationImageExportSource | null>;
}

/** Shared across the eagerly loaded controller and lazy export implementation. */
export class AnnotationExportError extends Error {
  readonly code: AnnotationExportErrorCode;
  readonly annotationId: string | null;
  readonly assetId: string | null;

  constructor(
    code: AnnotationExportErrorCode,
    message: string,
    annotationId: string | null = null,
    assetId: string | null = null,
  ) {
    super(message);
    this.name = 'AnnotationExportError';
    this.code = code;
    this.annotationId = annotationId;
    this.assetId = assetId;
  }
}
