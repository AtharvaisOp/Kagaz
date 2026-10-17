import type { PDFFont } from 'pdf-lib';
import type { PdfFontContext } from '../../fonts/pdfFont';
import { FontTextError } from '../../fonts/fontErrors';
import {
  canonicalDocumentText,
  documentTextGraphemes,
} from '../../fonts/textPolicy';

import {
  TEXT_BOX_INSET_USER_UNITS,
  textBoxContentDimensions,
} from '../../../features/pdf-annotations/model/textLayoutPolicy';

export interface TextLayoutInput {
  readonly text: string;
  readonly font: PDFFont;
  readonly fontContext?: PdfFontContext;
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
  fontContext: PdfFontContext | undefined,
  fontSize: number,
  maxWidth: number,
): string {
  let next = current;
  let width = measuredWidth(current, font, fontContext, fontSize);
  for (const character of documentTextGraphemes(run)) {
    const candidate = next + character;
    const candidateWidth = appendedWidth(
      next,
      width,
      character,
      font,
      fontContext,
      fontSize,
    );
    if (next && candidateWidth > maxWidth) {
      lines.push(next);
      next = character;
      width = measuredWidth(character, font, fontContext, fontSize);
    } else {
      next = candidate;
      width = candidateWidth;
    }
  }
  return next;
}

function splitLongRun(
  lines: string[],
  run: string,
  font: PDFFont,
  fontContext: PdfFontContext | undefined,
  fontSize: number,
  maxWidth: number,
): string {
  let current = '';
  let width = 0;
  for (const character of documentTextGraphemes(run)) {
    const candidate = current + character;
    const candidateWidth = appendedWidth(
      current,
      width,
      character,
      font,
      fontContext,
      fontSize,
    );
    if (current && candidateWidth > maxWidth) {
      lines.push(current);
      current = character;
      width = measuredWidth(character, font, fontContext, fontSize);
    } else {
      current = candidate;
      width = candidateWidth;
    }
  }
  return current;
}

function wrapParagraph(
  paragraph: string,
  font: PDFFont,
  fontContext: PdfFontContext | undefined,
  fontSize: number,
  maxWidth: number,
): string[] {
  if (paragraph.length === 0) return [''];

  const lines: string[] = [];
  let current = '';
  let width = 0;

  for (const run of paragraph.match(/ +|[^ ]+/g) ?? []) {
    const candidate = current + run;
    const candidateWidth = appendedWidth(
      current,
      width,
      run,
      font,
      fontContext,
      fontSize,
    );
    if (candidateWidth <= maxWidth) {
      current = candidate;
      width = candidateWidth;
      continue;
    }

    if (/^ +$/.test(run)) {
      current = appendRun(
        lines,
        current,
        run,
        font,
        fontContext,
        fontSize,
        maxWidth,
      );
      width = measuredWidth(current, font, fontContext, fontSize);
      continue;
    }

    if (current) lines.push(current);
    current = splitLongRun(lines, run, font, fontContext, fontSize, maxWidth);
    width = measuredWidth(current, font, fontContext, fontSize);
  }

  if (current || lines.length === 0) lines.push(current);
  return lines;
}

function appendedWidth(
  current: string,
  width: number,
  run: string,
  font: PDFFont,
  context: PdfFontContext | undefined,
  size: number,
): number {
  const runWidth = measuredWidth(run, font, context, size);
  if (!current || !run || context?.fontId === 'noto-sans')
    return width + runWidth;
  // Helvetica AFM kerning is pair-local. Measure only the boundary pair,
  // preserving legacy widths without remeasuring an ever-growing paragraph.
  const before = current.slice(-1);
  const after = run.slice(0, 1);
  const adjustment =
    font.widthOfTextAtSize(before + after, size) -
    font.widthOfTextAtSize(before, size) -
    font.widthOfTextAtSize(after, size);
  return width + runWidth + adjustment;
}

function measuredWidth(
  text: string,
  font: PDFFont,
  context: PdfFontContext | undefined,
  size: number,
): number {
  // Keep the established Helvetica annotation layout unchanged. Custom fonts
  // use the same advances as the emitted PDF glyphs and source-free preview.
  return context?.fontId === 'noto-sans'
    ? context.measure(text, size).width
    : font.widthOfTextAtSize(text, size);
}

export function layoutText(input: TextLayoutInput): readonly TextLayoutLine[] {
  const canonical =
    input.fontContext?.validate(input.text) ??
    canonicalDocumentText(input.text, 'helvetica');
  const content = textBoxContentDimensions(input.maxWidth, input.maxHeight);
  const custom = input.fontContext?.fontId === 'noto-sans';
  const overflow = () => {
    throw new FontTextError(
      'text-overflow',
      'This text does not fit its box. Increase the box size or reduce the font size.',
    );
  };
  if (
    custom &&
    ![input.fontSize, input.lineHeight, input.maxWidth, input.maxHeight].every(
      (value) => Number.isFinite(value) && value > 0,
    )
  )
    overflow();
  if (custom && canonical.length === 0) return [];
  const ascent = custom
    ? input.fontContext.metrics.ascent * input.fontSize
    : input.fontSize;
  const descent = custom
    ? input.fontContext.metrics.descent * input.fontSize
    : 0;
  const firstLineHeight = ascent - descent;
  const lineAdvance = input.fontSize * input.lineHeight;
  const maxLines =
    content.height < firstLineHeight
      ? 0
      : Math.floor((content.height - firstLineHeight) / lineAdvance) + 1;
  if (maxLines <= 0) {
    if (custom) overflow();
    return [];
  }

  const wrapped = canonical
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .flatMap((paragraph) =>
      wrapParagraph(
        paragraph,
        input.font,
        input.fontContext,
        input.fontSize,
        content.width,
      ),
    );
  if (custom && wrapped.length > maxLines) overflow();
  return wrapped.slice(0, maxLines).map((text, index) => {
    const measurement = custom
      ? input.fontContext.measure(text, input.fontSize)
      : null;
    const width =
      measurement?.width ??
      measuredWidth(text, input.font, input.fontContext, input.fontSize);
    // A negative left bearing needs baseline room even when its advance fits.
    // Keep alignment over the occupied advance/ink envelope for custom text.
    const leftBearing = measurement
      ? Math.min(0, measurement.inkBounds.minX)
      : 0;
    const occupiedWidth = measurement
      ? Math.max(width, measurement.inkBounds.maxX) - leftBearing
      : width;
    if (custom && occupiedWidth > content.width + 1e-6) overflow();
    const remaining = Math.max(0, content.width - occupiedWidth);
    const xOffset =
      input.align === 'center'
        ? remaining / 2
        : input.align === 'right'
          ? remaining
          : 0;
    const baselineY =
      input.maxHeight -
      TEXT_BOX_INSET_USER_UNITS -
      ascent -
      index * lineAdvance;
    const adjustedOffset = xOffset - leftBearing + TEXT_BOX_INSET_USER_UNITS;
    if (
      measurement &&
      (adjustedOffset + measurement.inkBounds.minX <
        TEXT_BOX_INSET_USER_UNITS - 1e-6 ||
        adjustedOffset + measurement.inkBounds.maxX >
          input.maxWidth - TEXT_BOX_INSET_USER_UNITS + 1e-6 ||
        baselineY + measurement.inkBounds.minY <
          TEXT_BOX_INSET_USER_UNITS - 1e-6 ||
        baselineY + measurement.inkBounds.maxY >
          input.maxHeight - TEXT_BOX_INSET_USER_UNITS + 1e-6)
    )
      overflow();
    return {
      text,
      width,
      xOffset: adjustedOffset,
      baselineY,
    };
  });
}
