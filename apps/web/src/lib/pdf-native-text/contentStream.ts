import { NativeTextEditError, type SupportedNativeTextFont } from './types';

const MAX_CONTENT_BYTES = 1_000_000;
const MAX_TOKENS = 40_000;
const MAX_TEXT_LENGTH = 512;
const MAX_COORDINATE = 1_000_000;

type Token =
  | {
      readonly kind: 'word' | 'name' | 'number' | 'structural';
      readonly start: number;
      readonly end: number;
      readonly value: string;
    }
  | {
      readonly kind: 'string';
      readonly start: number;
      readonly end: number;
      readonly value: string;
    };

export interface ParsedNativeTextRun {
  readonly ordinal: number;
  readonly text: string;
  readonly fontResourceName: string;
  readonly fontSize: number;
  readonly textMatrix: readonly [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  readonly textTokenRange: readonly [number, number];
  readonly matrixOperandRange: readonly [number, number];
}

interface MutableTextObject {
  fontResourceName: string | null;
  fontSize: number | null;
  textMatrix: readonly [number, number, number, number, number, number] | null;
  textToken: Extract<Token, { readonly kind: 'string' }> | null;
  matrixRange: readonly [number, number] | null;
}

function fail(message: string): never {
  throw new NativeTextEditError('unsupported-content', message);
}

function isWhitespace(byte: number): boolean {
  return (
    byte === 0 ||
    byte === 9 ||
    byte === 10 ||
    byte === 12 ||
    byte === 13 ||
    byte === 32
  );
}

function isDelimiter(byte: number): boolean {
  return (
    byte === 40 ||
    byte === 41 ||
    byte === 60 ||
    byte === 62 ||
    byte === 91 ||
    byte === 93 ||
    byte === 123 ||
    byte === 125 ||
    byte === 47 ||
    byte === 37
  );
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  let value = '';
  for (let index = start; index < end; index += 1) {
    const byte = bytes[index];
    if (byte === undefined || byte > 0x7f)
      fail(
        'This page uses non-ASCII source content that cannot be safely edited.',
      );
    value += String.fromCharCode(byte);
  }
  return value;
}

function decodedLiteralString(
  bytes: Uint8Array,
  start: number,
): {
  readonly end: number;
  readonly value: string;
} {
  let index = start + 1;
  let depth = 1;
  const decoded: number[] = [];
  while (index < bytes.length) {
    const byte = bytes[index++];
    if (byte === undefined) break;
    if (byte === 40) {
      depth += 1;
      decoded.push(byte);
      continue;
    }
    if (byte === 41) {
      depth -= 1;
      if (depth === 0) {
        const text = ascii(Uint8Array.from(decoded), 0, decoded.length);
        return { end: index, value: text };
      }
      decoded.push(byte);
      continue;
    }
    if (byte !== 92) {
      decoded.push(byte);
      continue;
    }

    const escaped = bytes[index++];
    if (escaped === undefined)
      fail('This page contains an unfinished PDF string.');
    switch (escaped) {
      case 110:
        decoded.push(10);
        break;
      case 114:
        decoded.push(13);
        break;
      case 116:
        decoded.push(9);
        break;
      case 98:
        decoded.push(8);
        break;
      case 102:
        decoded.push(12);
        break;
      case 13:
        if (bytes[index] === 10) index += 1;
        break;
      case 10:
        break;
      default: {
        if (escaped >= 48 && escaped <= 55) {
          let octal = String.fromCharCode(escaped);
          for (let remaining = 0; remaining < 2; remaining += 1) {
            const next = bytes[index];
            if (next === undefined || next < 48 || next > 55) break;
            octal += String.fromCharCode(next);
            index += 1;
          }
          const value = Number.parseInt(octal, 8);
          if (value > 255)
            fail('This page contains an invalid PDF string escape.');
          decoded.push(value);
        } else {
          decoded.push(escaped);
        }
      }
    }
  }
  fail('This page contains an unfinished PDF string.');
}

function lex(bytes: Uint8Array): readonly Token[] {
  if (bytes.length > MAX_CONTENT_BYTES) {
    throw new NativeTextEditError(
      'resource-limit',
      'This page content is too large for safe source-text editing.',
    );
  }
  const tokens: Token[] = [];
  let index = 0;
  while (index < bytes.length) {
    while (index < bytes.length && isWhitespace(bytes[index] ?? -1)) index += 1;
    if (index >= bytes.length) break;
    if (bytes[index] === 37)
      fail(
        'This page contains comments, so Kagaz cannot prove that removed source text is not retained.',
      );
    if (tokens.length >= MAX_TOKENS) {
      throw new NativeTextEditError(
        'resource-limit',
        'This page has too many PDF operators for safe source-text editing.',
      );
    }
    const start = index;
    const current = bytes[index];
    if (current === 40) {
      const literal = decodedLiteralString(bytes, index);
      tokens.push({
        kind: 'string',
        start,
        end: literal.end,
        value: literal.value,
      });
      index = literal.end;
      continue;
    }
    if (current === 47) {
      index += 1;
      const nameStart = index;
      while (
        index < bytes.length &&
        !isWhitespace(bytes[index] ?? -1) &&
        !isDelimiter(bytes[index] ?? -1)
      )
        index += 1;
      if (index === nameStart) fail('This page contains an empty PDF name.');
      const value = ascii(bytes, nameStart, index);
      if (value.includes('#'))
        fail(
          'This page uses escaped PDF resource names that cannot be safely edited.',
        );
      tokens.push({ kind: 'name', start, end: index, value });
      continue;
    }
    if (
      current === 60 ||
      current === 62 ||
      current === 91 ||
      current === 93 ||
      current === 123 ||
      current === 125
    ) {
      const next = bytes[index + 1];
      if ((current === 60 || current === 62) && next === current) {
        index += 2;
        tokens.push({
          kind: 'structural',
          start,
          end: index,
          value: current === 60 ? '<<' : '>>',
        });
      } else {
        index += 1;
        tokens.push({
          kind: 'structural',
          start,
          end: index,
          value: String.fromCharCode(current ?? 0),
        });
      }
      continue;
    }
    while (
      index < bytes.length &&
      !isWhitespace(bytes[index] ?? -1) &&
      !isDelimiter(bytes[index] ?? -1)
    )
      index += 1;
    if (index === start)
      fail('This page contains unsupported PDF content syntax.');
    const value = ascii(bytes, start, index);
    tokens.push({
      kind: /^[+-]?(?:(?:\d+\.?\d*)|(?:\.\d+))$/u.test(value)
        ? 'number'
        : 'word',
      start,
      end: index,
      value,
    });
  }
  return tokens;
}

function numberOperand(token: Token | undefined): number | null {
  if (!token || token.kind !== 'number') return null;
  const value = Number(token.value);
  return Number.isFinite(value) && Math.abs(value) <= MAX_COORDINATE
    ? value
    : null;
}

function isSupportedText(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= MAX_TEXT_LENGTH &&
    [...value].every((character) => {
      const code = character.charCodeAt(0);
      return code >= 0x20 && code <= 0x7e;
    })
  );
}

function invalidTextObject(): never {
  return fail(
    'This text uses positioning or styling operators outside Kagaz’s verified source-text subset.',
  );
}

/**
 * Parses only a deliberately tiny PDF content language. Any graphics operator,
 * CTM, XObject, array/TJ form, clipping state, or unexpected operand rejects
 * the complete stream rather than risking a partial transformation.
 */
export function parseStrictNativeTextRuns(
  bytes: Uint8Array,
): readonly ParsedNativeTextRun[] {
  const tokens = lex(bytes);
  const runs: ParsedNativeTextRun[] = [];
  let operands: Token[] = [];
  let textObject: MutableTextObject | null = null;
  let graphicsDepth = 0;

  for (const token of tokens) {
    if (token.kind !== 'word') {
      operands.push(token);
      continue;
    }
    const operator = token.value;
    if (!textObject) {
      if (operator === 'BT') {
        if (operands.length !== 0) invalidTextObject();
        textObject = {
          fontResourceName: null,
          fontSize: null,
          textMatrix: null,
          textToken: null,
          matrixRange: null,
        };
      } else if (operator === 'q') {
        if (operands.length !== 0) invalidTextObject();
        graphicsDepth += 1;
      } else if (operator === 'Q') {
        if (operands.length !== 0 || graphicsDepth === 0) invalidTextObject();
        graphicsDepth -= 1;
      } else {
        invalidTextObject();
      }
      operands = [];
      continue;
    }

    if (operator === 'ET') {
      if (
        operands.length !== 0 ||
        !textObject.fontResourceName ||
        textObject.fontSize === null ||
        !textObject.textMatrix ||
        !textObject.textToken ||
        !textObject.matrixRange
      )
        invalidTextObject();
      if (!isSupportedText(textObject.textToken.value)) {
        fail(
          'This text contains characters outside Kagaz’s verified Latin source-text subset.',
        );
      }
      runs.push({
        ordinal: runs.length,
        text: textObject.textToken.value,
        fontResourceName: textObject.fontResourceName,
        fontSize: textObject.fontSize,
        textMatrix: textObject.textMatrix,
        textTokenRange: [textObject.textToken.start, textObject.textToken.end],
        matrixOperandRange: textObject.matrixRange,
      });
      textObject = null;
      operands = [];
      continue;
    }

    if (operator === 'Tf') {
      if (textObject.fontResourceName || operands.length !== 2)
        invalidTextObject();
      const [font, fontSize] = operands;
      const parsedSize = numberOperand(fontSize);
      if (
        !font ||
        font.kind !== 'name' ||
        parsedSize === null ||
        parsedSize <= 0
      )
        invalidTextObject();
      textObject.fontResourceName = font.value;
      textObject.fontSize = parsedSize;
    } else if (operator === 'Tm') {
      if (textObject.textMatrix || operands.length !== 6) invalidTextObject();
      const values = operands.map(numberOperand);
      if (values.some((value) => value === null)) invalidTextObject();
      const [a, b, c, d, e, f] = values as [
        number,
        number,
        number,
        number,
        number,
        number,
      ];
      if (a !== 1 || b !== 0 || c !== 0 || d !== 1) {
        fail(
          'This text has a scaled, rotated, or skewed text matrix that Kagaz cannot safely edit.',
        );
      }
      textObject.textMatrix = [a, b, c, d, e, f];
      const first = operands[0];
      const last = operands[5];
      if (!first || !last) invalidTextObject();
      textObject.matrixRange = [first.start, last.end];
    } else if (operator === 'Tj') {
      if (
        textObject.textToken ||
        !textObject.fontResourceName ||
        !textObject.textMatrix ||
        operands.length !== 1
      )
        invalidTextObject();
      const sourceText = operands[0];
      if (!sourceText || sourceText.kind !== 'string') {
        fail(
          'This text uses a non-literal string operand that Kagaz cannot safely edit.',
        );
      }
      textObject.textToken = sourceText;
    } else {
      invalidTextObject();
    }
    operands = [];
  }

  if (textObject || operands.length !== 0 || graphicsDepth !== 0) {
    fail('This page contains an incomplete PDF content stream.');
  }
  if (runs.length === 0)
    fail(
      'Kagaz could not find a verified editable source-text run on this page.',
    );
  return runs;
}

export function assertValidNativeReplacementText(text: string): void {
  if (!isSupportedText(text)) {
    throw new NativeTextEditError(
      'invalid-replacement',
      'Use 1–512 printable Latin characters. Line breaks, emoji, and unsupported scripts cannot be safely written into this source font.',
    );
  }
}

export function escapePdfLiteralString(text: string): Uint8Array {
  assertValidNativeReplacementText(text);
  let escaped = '(';
  for (const character of text) {
    if (character === '\\' || character === '(' || character === ')')
      escaped += '\\';
    escaped += character;
  }
  escaped += ')';
  return new TextEncoder().encode(escaped);
}

export function formatPdfNumber(value: number): string {
  if (!Number.isFinite(value) || Math.abs(value) > MAX_COORDINATE) {
    throw new NativeTextEditError(
      'invalid-replacement',
      'The requested text position is outside Kagaz’s safe PDF coordinate limit.',
    );
  }
  const normalized = Math.round(value * 10_000) / 10_000;
  const text = normalized
    .toFixed(4)
    .replace(/(?:\.0+|(?:(\.\d*?[1-9]))0+)$/u, '$1');
  return text === '-0' ? '0' : text;
}

export function encodeReplacementMatrix(
  matrix: readonly [number, number, number, number, number, number],
): Uint8Array {
  return new TextEncoder().encode(matrix.map(formatPdfNumber).join(' '));
}

export function replaceContentRanges(
  source: Uint8Array,
  replacements: readonly {
    readonly range: readonly [number, number];
    readonly bytes: Uint8Array;
  }[],
): Uint8Array {
  const ordered = [...replacements].sort(
    (left, right) => left.range[0] - right.range[0],
  );
  let cursor = 0;
  let length = source.length;
  for (const replacement of ordered) {
    const [start, end] = replacement.range;
    if (start < cursor || end < start || end > source.length)
      fail('Kagaz could not safely update this PDF text operand.');
    length += replacement.bytes.length - (end - start);
    cursor = end;
  }
  const output = new Uint8Array(length);
  cursor = 0;
  let outputOffset = 0;
  for (const replacement of ordered) {
    const [start, end] = replacement.range;
    output.set(source.subarray(cursor, start), outputOffset);
    outputOffset += start - cursor;
    output.set(replacement.bytes, outputOffset);
    outputOffset += replacement.bytes.length;
    cursor = end;
  }
  output.set(source.subarray(cursor), outputOffset);
  return output;
}

const SUPPORTED_FONTS = new Set<SupportedNativeTextFont>([
  'Courier',
  'Courier-Bold',
  'Courier-Oblique',
  'Courier-BoldOblique',
  'Helvetica',
  'Helvetica-Bold',
  'Helvetica-Oblique',
  'Helvetica-BoldOblique',
  'Times-Roman',
  'Times-Bold',
  'Times-Italic',
  'Times-BoldItalic',
]);

export function asSupportedNativeTextFont(
  value: string,
): SupportedNativeTextFont | null {
  return SUPPORTED_FONTS.has(value as SupportedNativeTextFont)
    ? (value as SupportedNativeTextFont)
    : null;
}
