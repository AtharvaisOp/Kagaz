export type FontTextErrorCode =
  | 'missing-glyph'
  | 'unsupported-script'
  | 'unsupported-shaping'
  | 'text-overflow'
  | 'font-load-failed'
  | 'invalid-font';

export class FontTextError extends Error {
  readonly code: FontTextErrorCode;

  constructor(code: FontTextErrorCode, message: string) {
    super(message);
    this.name = 'FontTextError';
    this.code = code;
  }
}
