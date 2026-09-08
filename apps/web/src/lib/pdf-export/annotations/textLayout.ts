import type { PDFFont } from 'pdf-lib';

import {
  TEXT_BOX_INSET_USER_UNITS,
  textBoxContentDimensions,
} from '../../../features/pdf-annotations/model/textLayoutPolicy';

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

function appendRun(
  lines: string[],
  current: string,
  run: string,
  font: PDFFont,
  fontSize: number,
  maxWidth: number,
): string {
  let next = current;
  for (const character of run) {
    const candidate = next + character;
    if (next && font.widthOfTextAtSize(candidate, fontSize) > maxWidth) {
      lines.push(next);
      next = character;
    } else {
      next = candidate;
    }
  }
  return next;
}

function splitLongRun(
  lines: string[],
  run: string,
  font: PDFFont,
  fontSize: number,
  maxWidth: number,
): string {
  let current = '';
  for (const character of run) {
    const candidate = current + character;
    if (current && font.widthOfTextAtSize(candidate, fontSize) > maxWidth) {
      lines.push(current);
      current = character;
    } else {
      current = candidate;
    }
  }
  return current;
}

function wrapParagraph(
  paragraph: string,
  font: PDFFont,
  fontSize: number,
  maxWidth: number,
): string[] {
  if (paragraph.length === 0) return [''];

  const lines: string[] = [];
  let current = '';

  for (const run of paragraph.match(/ +|[^ ]+/g) ?? []) {
    const candidate = current + run;
    if (font.widthOfTextAtSize(candidate, fontSize) <= maxWidth) {
      current = candidate;
      continue;
    }

    if (/^ +$/.test(run)) {
      current = appendRun(lines, current, run, font, fontSize, maxWidth);
      continue;
    }

    if (current) lines.push(current);
    current = splitLongRun(lines, run, font, fontSize, maxWidth);
  }

  if (current || lines.length === 0) lines.push(current);
  return lines;
}

export function layoutText(input: TextLayoutInput): readonly TextLayoutLine[] {
  const content = textBoxContentDimensions(input.maxWidth, input.maxHeight);
  const lineAdvance = input.fontSize * input.lineHeight;
  const maxLines =
    content.height < input.fontSize
      ? 0
      : Math.floor((content.height - input.fontSize) / lineAdvance) + 1;
  if (maxLines <= 0) return [];

  const wrapped = input.text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .flatMap((paragraph) =>
      wrapParagraph(paragraph, input.font, input.fontSize, content.width),
    );
  return wrapped.slice(0, maxLines).map((text, index) => {
    const width = input.font.widthOfTextAtSize(text, input.fontSize);
    const remaining = Math.max(0, content.width - width);
    const xOffset =
      input.align === 'center'
        ? remaining / 2
        : input.align === 'right'
          ? remaining
          : 0;
    return {
      text,
      width,
      xOffset: xOffset + TEXT_BOX_INSET_USER_UNITS,
      baselineY:
        input.maxHeight -
        TEXT_BOX_INSET_USER_UNITS -
        input.fontSize -
        index * lineAdvance,
    };
  });
}
