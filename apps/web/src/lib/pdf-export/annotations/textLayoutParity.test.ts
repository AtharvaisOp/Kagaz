import { PDFDocument, StandardFonts } from 'pdf-lib';
import { describe, expect, it } from 'vitest';

import { layoutText } from './textLayout';

async function helvetica() {
  const document = await PDFDocument.create();
  return document.embedFont(StandardFonts.Helvetica);
}

describe('PDF text layout parity', () => {
  it.each([
    ['Hello world', ['Hello world']],
    ['Hello  world', ['Hello  world']],
    ['  leading', ['  leading']],
    ['trailing  ', ['trailing  ']],
    ['first\n\nsecond', ['first', '', 'second']],
    ['first\n\n\nsecond', ['first', '', '', 'second']],
  ])('preserves visible whitespace in %j', async (text, expected) => {
    const font = await helvetica();
    const lines = layoutText({
      text,
      font,
      fontSize: 10,
      lineHeight: 1.2,
      maxWidth: 500,
      maxHeight: 200,
      align: 'left',
    });
    expect(lines.map((line) => line.text)).toEqual(expected);
  });

  it('wraps narrow content without losing spaces or long-token characters', async () => {
    const font = await helvetica();
    for (const text of [
      'Hello  world near a boundary',
      'averylongunbrokentokenthatmustwrapsafely',
    ]) {
      const lines = layoutText({
        text,
        font,
        fontSize: 10,
        lineHeight: 1.2,
        maxWidth: 46,
        maxHeight: 500,
        align: 'left',
      });
      expect(lines.map((line) => line.text).join('')).toBe(text);
      expect(lines.every((line) => line.width <= 46)).toBe(true);
    }
  });

  it.each(['left', 'center', 'right'] as const)(
    'uses Helvetica metrics for %s alignment',
    async (align) => {
      const font = await helvetica();
      const [line] = layoutText({
        text: 'Kagaz',
        font,
        fontSize: 10,
        lineHeight: 1.2,
        maxWidth: 100,
        maxHeight: 40,
        align,
      });
      expect(line?.width).toBe(font.widthOfTextAtSize('Kagaz', 10));
      expect(line?.xOffset).toBe(
        align === 'left'
          ? 0
          : align === 'center'
            ? (100 - (line?.width ?? 0)) / 2
            : 100 - (line?.width ?? 0),
      );
    },
  );
});
