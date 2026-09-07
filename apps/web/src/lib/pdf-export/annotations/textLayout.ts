import type { PDFFont } from 'pdf-lib';

export interface TextLayoutInput {
  readonly text: string;
  readonly font: PDFFont;
  readonly fontSize: number;
  readonly lineHeight: number;
  readonly maxWidth: number;
  readonly maxHeight: number;
  readonly align: 'left' | 'center' | 'right';
}

export interface TextLayoutLine {
  readonly text: string;
  readonly width: number;
  readonly xOffset: number;
  readonly baselineY: number;
}

function splitLongToken(
  token: string,
  font: PDFFont,
  fontSize: number,
  maxWidth: number,
): string[] {
  const chunks: string[] = [];
  let current = '';
  for (const character of token) {
    const candidate = current + character;
    if (current && font.widthOfTextAtSize(candidate, fontSize) > maxWidth) {
      chunks.push(current);
      current = character;
    } else {
      current = candidate;
    }
  }
  if (current || chunks.length === 0) chunks.push(current);
  return chunks;
}

function wrapParagraph(
  paragraph: string,
  font: PDFFont,
  fontSize: number,
  maxWidth: number,
): string[] {
  if (paragraph.length === 0) return [''];

  const words = paragraph.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [''];

  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const pieces = splitLongToken(word, font, fontSize, maxWidth);
    for (const piece of pieces) {
      const candidate = current ? `${current} ${piece}` : piece;
      if (current && font.widthOfTextAtSize(candidate, fontSize) > maxWidth) {
        lines.push(current);
        current = piece;
      } else {
        current = candidate;
      }
    }
  }
  if (current) lines.push(current);
  return lines;
}

export function layoutText(input: TextLayoutInput): readonly TextLayoutLine[] {
  const lineAdvance = input.fontSize * input.lineHeight;
  const maxLines =
    input.maxHeight < input.fontSize
      ? 0
      : Math.floor((input.maxHeight - input.fontSize) / lineAdvance) + 1;
  if (maxLines <= 0) return [];

  const wrapped = input.text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .flatMap((paragraph) =>
      wrapParagraph(paragraph, input.font, input.fontSize, input.maxWidth),
    );
  return wrapped.slice(0, maxLines).map((text, index) => {
    const width = input.font.widthOfTextAtSize(text, input.fontSize);
    const remaining = Math.max(0, input.maxWidth - width);
    const xOffset =
      input.align === 'center'
        ? remaining / 2
        : input.align === 'right'
          ? remaining
          : 0;
    return {
      text,
      width,
      xOffset,
      baselineY: input.maxHeight - input.fontSize - index * lineAdvance,
    };
  });
}
