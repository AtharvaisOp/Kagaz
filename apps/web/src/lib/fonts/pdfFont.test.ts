/// <reference types="node" />
import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import {
  PDFDocument,
  PDFName,
  PDFDict,
  PDFArray,
  PDFRawStream,
  decodePDFRawStream,
} from 'pdf-lib';
import { create } from '@pdf-lib/fontkit';

import { preparePdfFont, pdfFontContextFromHelvetica } from './pdfFont';
import { validateBundledFontBytes, type FontAssetSnapshot } from './fontAssets';
import { canonicalDocumentText, documentTextGraphemes } from './textPolicy';
import { layoutText } from '../pdf-export/annotations/textLayout';
import {
  createAnnotationExportContext,
  flattenAnnotationsOntoCopiedPage,
} from '../pdf-export/annotations/flattenAnnotations';
import type { TextAnnotation } from '../../features/pdf-annotations/model/types';

const bytes = Uint8Array.from(
  await readFile(
    new URL('../../assets/fonts/NotoSans-Regular.ttf', import.meta.url),
  ),
);
const assets: FontAssetSnapshot = new Map([['noto-sans', bytes]]);
const fontkitFont = create(bytes);
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');

async function extract(
  data: Uint8Array,
  disableNormalization = false,
): Promise<string> {
  const task = pdfjs.getDocument({ data: data.slice() });
  try {
    const document = await task.promise;
    const page = await document.getPage(1);
    const content = await page.getTextContent({ disableNormalization });
    return content.items
      .map((item) => ('str' in item ? item.str : ''))
      .join('');
  } finally {
    await task.destroy();
  }
}

function mutatedTable(
  tag: string,
  mutate: (view: DataView, entry: number, offset: number) => void,
): Uint8Array {
  const modified = bytes.slice();
  const view = new DataView(modified.buffer);
  for (let index = 0; index < view.getUint16(4); index += 1) {
    const entry = 12 + index * 16;
    if (String.fromCharCode(...modified.subarray(entry, entry + 4)) === tag) {
      mutate(view, entry, view.getUint32(entry + 8));
      return modified;
    }
  }
  throw new Error('Fixture table missing');
}

describe('trusted document fonts', () => {
  it('verifies the static TTF identity, bounded tables and editable embedding permission', async () => {
    await expect(validateBundledFontBytes(bytes)).resolves.toBeUndefined();
    const invalid = [
      bytes.slice(0, -1),
      new Uint8Array(bytes.length + 1),
      mutatedTable('head', (view, entry) =>
        view.setUint32(entry + 8, 0xfffffffe),
      ),
      mutatedTable('head', (view, entry) =>
        view.setUint32(entry + 12, 0xfffffffe),
      ),
      mutatedTable('head', (view, entry) => view.setUint32(entry, 0x66766172)),
      mutatedTable('OS/2', (view, _entry, offset) =>
        view.setUint16(offset + 8, 2),
      ),
      mutatedTable('OS/2', (view, _entry, offset) =>
        view.setUint16(offset + 8, 0x200),
      ),
      mutatedTable('head', (view, _entry, offset) =>
        view.setUint32(offset + 12, 0),
      ),
    ];
    for (const candidate of invalid)
      await expect(validateBundledFontBytes(candidate)).rejects.toMatchObject({
        code: 'invalid-font',
      });
  });

  it('never fetches a font missing from an explicit export snapshot', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await expect(
      preparePdfFont(await PDFDocument.create(), 'noto-sans', new Map()),
    ).rejects.toMatchObject({ code: 'font-load-failed' });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('copies supplied asset bytes before parsing and shares one font resource per document', async () => {
    const document = await PDFDocument.create();
    const mutable = bytes.slice();
    const embed = vi.spyOn(document, 'embedFont');
    const first = preparePdfFont(
      document,
      'noto-sans',
      new Map([['noto-sans', mutable]]),
    );
    mutable.fill(0);
    const [context, repeated] = await Promise.all([
      first,
      preparePdfFont(document, 'noto-sans', assets),
    ]);
    expect(context).toBe(repeated);
    expect(embed).toHaveBeenCalledOnce();
    expect(context.validate('Ελληνικά Привет café')).toBe(
      'Ελληνικά Привет café',
    );
  });

  it.each(['Café naïve Łódź Țară', 'Ελληνικά κόσμος', 'Привет мир Ёж Україна'])(
    'embeds searchable %s with real font and ToUnicode resources',
    async (text) => {
      const document = await PDFDocument.create();
      const context = await preparePdfFont(document, 'noto-sans', assets);
      document.addPage([500, 200]).drawText(context.validate(text), {
        x: 20,
        y: 100,
        size: 16,
        font: context.font,
      });
      const output = await document.save();
      expect(await extract(output)).toBe(text);
      const reloaded = await PDFDocument.load(output);
      const dict = reloaded.context.lookup(context.font.ref, PDFDict);
      expect(dict.get(PDFName.of('Subtype'))).toEqual(PDFName.of('Type0'));
      const cmap = reloaded.context.lookup(dict.get(PDFName.of('ToUnicode')));
      if (!(cmap instanceof PDFRawStream))
        throw new Error('Missing ToUnicode stream');
      expect(
        new TextDecoder().decode(decodePDFRawStream(cmap).decode()),
      ).toContain('beginbfchar');
      const descendants = dict.lookup(PDFName.of('DescendantFonts'), PDFArray);
      const descriptor = descendants
        .lookup(0, PDFDict)
        .lookup(PDFName.of('FontDescriptor'), PDFDict);
      expect(
        reloaded.context.lookup(descriptor.get(PDFName.of('FontFile2'))),
      ).toBeInstanceOf(PDFRawStream);
    },
  );

  it.each([
    [
      '\uFB01 \uFB02 \uFB00 \uFB03 \uFB04',
      'fi fl ff ffi ffl',
      '\uFB01 \uFB02 \uFB00 \uFB03 \uFB04',
    ],
    ['a\u00A0b', 'a b', 'a b'],
  ])(
    'preserves original ToUnicode mappings while documenting viewer normalization of %s',
    async (text, defaultExtraction, unnormalizedExtraction) => {
      const document = await PDFDocument.create();
      const context = await preparePdfFont(document, 'noto-sans', assets);
      expect(context.validate(text)).toBe(text);
      document.addPage([500, 200]).drawText(text, {
        x: 20,
        y: 100,
        size: 16,
        font: context.font,
      });
      const output = await document.save();
      expect(await extract(output)).toBe(defaultExtraction);
      expect(await extract(output, true)).toBe(unnormalizedExtraction);
      const reloaded = await PDFDocument.load(output);
      const dictionary = reloaded.context.lookup(context.font.ref, PDFDict);
      const stream = reloaded.context.lookup(
        dictionary.get(PDFName.of('ToUnicode')),
      );
      if (!(stream instanceof PDFRawStream))
        throw new Error('Missing ToUnicode stream');
      const cmap = new TextDecoder().decode(
        decodePDFRawStream(stream).decode(),
      );
      for (const character of text) {
        const point = character.codePointAt(0);
        if (point === undefined) throw new Error('Missing fixture code point');
        const glyphId = fontkitFont.glyphForCodePoint(point).id;
        const source = glyphId.toString(16).padStart(4, '0').toUpperCase();
        const target = point.toString(16).padStart(4, '0').toUpperCase();
        expect(cmap).toContain(`<${source}> <${target}>`);
      }
    },
  );

  it('measures actual emitted advances and glyph ink rather than kerning or Helvetica constants', async () => {
    const document = await PDFDocument.create();
    const context = await preparePdfFont(document, 'noto-sans', assets);
    const text = 'AVAV fj café Ελληνικά';
    const size = 24;
    const measured = context.measure(text, size);
    const expected =
      (Array.from(text).reduce(
        (width, character) =>
          width +
          fontkitFont.glyphForCodePoint(character.codePointAt(0) ?? 0)
            .advanceWidth,
        0,
      ) *
        size) /
      fontkitFont.unitsPerEm;
    expect(measured.width).toBeCloseTo(expected, 8);
    expect(context.font.widthOfTextAtSize(text, size)).toBeCloseTo(expected, 8);
    expect(measured.inkBounds.maxY).toBeGreaterThan(0);
    expect(measured.inkBounds.minY).toBeLessThan(0);
    expect(context.metrics.ascent).toBe(
      fontkitFont.ascent / fontkitFont.unitsPerEm,
    );
    expect(context.metrics.descent).toBe(
      fontkitFont.descent / fontkitFont.unitsPerEm,
    );
    const shaped = context.shape('AV Ελληνικά', 24);
    expect(shaped.glyphs.map((glyph) => glyph.codePoints)).toEqual(
      Array.from(shaped.text, (character) => [character.codePointAt(0)]),
    );
    expect(
      shaped.glyphs.every(
        (glyph) =>
          glyph.id > 0 &&
          glyph.xOffset === 0 &&
          glyph.yOffset === 0 &&
          glyph.yAdvance === 0,
      ),
    ).toBe(true);
    expect(
      shaped.glyphs.reduce((sum, glyph) => sum + glyph.xAdvance, 0),
    ).toBeCloseTo(shaped.width);
  });

  it('fails closed for unknown runtime font IDs and invalid measurement inputs', async () => {
    await expect(
      preparePdfFont(await PDFDocument.create(), 'unknown' as never, assets),
    ).rejects.toMatchObject({ code: 'invalid-font' });
    const context = await preparePdfFont(
      await PDFDocument.create(),
      'noto-sans',
      assets,
    );
    for (const size of [0, -1, NaN, Infinity])
      expect(() => context.shape('text', size)).toThrowError(
        expect.objectContaining({ code: 'unsupported-shaping' }),
      );
    expect(() => context.measure('one\ntwo', 12)).toThrow();
    expect(() => context.validate('x'.repeat(10_001))).toThrow();
  });

  it('wraps a maximum-size long word without repeatedly measuring growing prefixes', async () => {
    const context = await preparePdfFont(
      await PDFDocument.create(),
      'noto-sans',
      assets,
    );
    const measure = vi.spyOn(context, 'measure');
    const text = 'AV'.repeat(5_000);
    const lines = layoutText({
      text,
      font: context.font,
      fontContext: context,
      fontSize: 10,
      lineHeight: 1.2,
      maxWidth: 40,
      maxHeight: 100_000,
      align: 'left',
    });
    expect(lines.map((line) => line.text).join('')).toBe(text);
    expect(lines.every((line) => line.width <= 40)).toBe(true);
    const measuredUnits = measure.mock.calls.reduce(
      (sum, [value]) => sum + value.length,
      0,
    );
    expect(measuredUnits).toBeLessThan(text.length * 6);
  });

  it('normalizes composed accents, preserves graphemes and rejects unsupported shaping visibly', async () => {
    const context = await preparePdfFont(
      await PDFDocument.create(),
      'noto-sans',
      assets,
    );
    expect(context.validate('Cafe\u0301\r\nΑ\u0301\rЙ')).toBe('Café\nΆ\nЙ');
    expect(documentTextGraphemes('x\u0301क्षि')).toEqual(['x\u0301', 'क्षि']);
    for (const text of [
      'x\u0301',
      'नमस्ते',
      'मराठी भाषा',
      'العربية',
      'עברית',
      'বাংলা',
      'தமிழ்',
      '中文',
      '🔥',
      'a\u200db',
      'a\u202eb',
    ])
      expect(() => context.validate(text)).toThrow();
    expect(() => context.validate('☃')).toThrowError(
      expect.objectContaining({ code: 'missing-glyph' }),
    );
    expect(canonicalDocumentText('Café', 'helvetica')).toBe('Café');
  });

  it('wraps custom annotation text on grapheme boundaries using actual ascender/descender metrics', async () => {
    const document = await PDFDocument.create();
    const context = await preparePdfFont(document, 'noto-sans', assets);
    const lines = layoutText({
      text: 'Cafe\u0301Cafe\u0301\r\nПривет',
      font: context.font,
      fontContext: context,
      fontSize: 10,
      lineHeight: 1.5,
      maxWidth: context.measure('Café', 10).width + 0.01,
      maxHeight: 60,
      align: 'right',
    });
    expect(lines.map((line) => line.text)).toEqual([
      'Café',
      'Café',
      'При',
      'вет',
    ]);
    expect(lines[0]?.baselineY).toBeCloseTo(60 - context.metrics.ascent * 10);
    expect(
      lines.every(
        (line) => line.width <= context.measure('Café', 10).width + 0.01,
      ),
    ).toBe(true);
  });

  it('exports chosen-font annotation text and keeps classic Helvetica layout semantics', async () => {
    const document = await PDFDocument.create();
    const page = document.addPage([400, 200]);
    const context = await createAnnotationExportContext(document, null, assets);
    const annotation: TextAnnotation = {
      id: 'unicode',
      workspacePageId: 'p',
      kind: 'text',
      text: 'Café Ελληνικά Привет',
      fontFamily: 'noto-sans',
      fontSizeUserUnits: 12,
      lineHeight: 1.2,
      align: 'left',
      box: { origin: { x: 20, y: 20 }, width: 350, height: 80, rotation: 0 },
      color: { r: 0, g: 0, b: 0 },
      opacity: 1,
    };
    await flattenAnnotationsOntoCopiedPage(
      page,
      [annotation],
      document,
      context,
    );
    expect(await extract(await document.save())).toBe(annotation.text);
    const classic = pdfFontContextFromHelvetica(context.font);
    expect(classic.measure('AV', 10).width).toBeGreaterThan(
      context.font.widthOfTextAtSize('AV', 10),
    );
    expect(classic.measure('AV', 10).inkBounds).toEqual({
      minX: -10,
      minY: -2.25,
      maxX: classic.measure('AV', 10).width + 10,
      maxY: 9.31,
    });
  });

  it('rejects custom annotation height, line-count and glyph-width overflow without losing text', async () => {
    const document = await PDFDocument.create();
    const context = await preparePdfFont(document, 'noto-sans', assets);
    const input = {
      text: 'Ελληνικά',
      font: context.font,
      fontContext: context,
      fontSize: 12,
      lineHeight: 1.2,
      maxWidth: 300,
      maxHeight: 100,
      align: 'left' as const,
    };
    for (const override of [
      { maxHeight: 1 },
      { text: 'Ελληνικά\nПривет\nCafé', maxHeight: 30 },
      { text: 'W', maxWidth: 1 },
      { maxWidth: NaN },
      { lineHeight: 0 },
    ])
      expect(() => layoutText({ ...input, ...override })).toThrowError(
        expect.objectContaining({ code: 'text-overflow' }),
      );
    // Unsupported text must be checked even when no baseline can fit.
    expect(() =>
      layoutText({ ...input, text: 'विद्यार्थी', maxHeight: 1 }),
    ).toThrowError(expect.objectContaining({ code: 'unsupported-script' }));
    const page = document.addPage([400, 200]);
    await expect(
      flattenAnnotationsOntoCopiedPage(
        page,
        [
          {
            id: 'overflow',
            workspacePageId: 'p',
            kind: 'text',
            text: 'Ελληνικά\nПривет',
            fontFamily: 'noto-sans',
            fontSizeUserUnits: 12,
            lineHeight: 1.2,
            align: 'left',
            box: {
              origin: { x: 20, y: 20 },
              width: 300,
              height: 1,
              rotation: 0,
            },
            color: { r: 0, g: 0, b: 0 },
            opacity: 1,
          },
        ],
        document,
        await createAnnotationExportContext(document, null, assets),
      ),
    ).rejects.toMatchObject({
      code: 'text-overflow',
      annotationId: 'overflow',
      message:
        'This text does not fit its box. Increase the box size or reduce the font size.',
    });
  });

  it('fits negative custom glyph bearings within the box at each alignment', async () => {
    const context = await preparePdfFont(
      await PDFDocument.create(),
      'noto-sans',
      assets,
    );
    const measurement = context.measure('j', 12);
    expect(measurement.inkBounds.minX).toBeLessThan(0);
    const occupied =
      Math.max(measurement.width, measurement.inkBounds.maxX) -
      measurement.inkBounds.minX;
    for (const align of ['left', 'center', 'right'] as const) {
      const [line] = layoutText({
        text: 'j',
        font: context.font,
        fontContext: context,
        fontSize: 12,
        lineHeight: 1.2,
        maxWidth: occupied + 10,
        maxHeight: 30,
        align,
      });
      expect(line).toBeDefined();
      if (!line) throw new Error('Missing fitting line');
      expect(line.xOffset + measurement.inkBounds.minX).toBeGreaterThanOrEqual(
        0,
      );
      expect(line.xOffset + measurement.inkBounds.maxX).toBeLessThanOrEqual(
        occupied + 10,
      );
      expect(line.xOffset + measurement.inkBounds.minX).toBeCloseTo(
        align === 'left' ? 0 : align === 'center' ? 5 : 10,
      );
    }
    expect(() =>
      layoutText({
        text: 'j',
        font: context.font,
        fontContext: context,
        fontSize: 12,
        lineHeight: 1.2,
        maxWidth: occupied - 0.01,
        maxHeight: 30,
        align: 'left',
      }),
    ).toThrowError(expect.objectContaining({ code: 'text-overflow' }));
  });
});
