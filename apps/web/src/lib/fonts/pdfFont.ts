import { StandardFonts, type PDFDocument, type PDFFont } from 'pdf-lib';
import type { Font, GlyphRun, TypeFeatures } from '@pdf-lib/fontkit';

import {
  documentFontLabel,
  isDocumentFontId,
  type DocumentFontId,
} from './fontCatalog';
import { FontTextError } from './fontErrors';
import {
  snapshotFontAssets,
  validateBundledFontBytes,
  type FontAssetSnapshot,
} from './fontAssets';
import { canonicalDocumentText } from './textPolicy';

export interface FontInkBounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

export interface FontMeasurement {
  /** Advance of the glyphs actually emitted by pdf-lib, in requested size units. */
  readonly width: number;
  readonly inkBounds: FontInkBounds;
}

export interface FontMetrics {
  /** Metrics normalized to one em; multiply by the desired PDF/user-unit size. */
  readonly ascent: number;
  readonly descent: number;
  readonly lineGap: number;
  readonly unitsPerEm: number;
}

export interface LogicalTextGlyph {
  readonly id: number;
  readonly codePoints: readonly number[];
  /** Advances and offsets are scaled to requested PDF/user-unit font size. */
  readonly xAdvance: number;
  readonly yAdvance: number;
  readonly xOffset: number;
  readonly yOffset: number;
}

export interface LogicalTextRun extends FontMeasurement {
  readonly text: string;
  readonly glyphs: readonly LogicalTextGlyph[];
}

export interface PdfFontContext {
  readonly font: PDFFont;
  readonly fontId: DocumentFontId;
  readonly metrics: FontMetrics;
  validate(text: string): string;
  measure(text: string, size: number): FontMeasurement;
  shape(text: string, size: number): LogicalTextRun;
}

const documentFonts = new WeakMap<
  PDFDocument,
  Map<DocumentFontId, Promise<PdfFontContext>>
>();
let parsedBundledFont: Promise<{
  readonly font: Font;
  readonly features: TypeFeatures;
}> | null = null;
let validationHelvetica: Promise<PdfFontContext> | null = null;

function assertRunSize(size: number, text: string): void {
  if (!Number.isFinite(size) || size <= 0 || text.includes('\n'))
    throw new FontTextError(
      'unsupported-shaping',
      'Text measurement needs one line and a finite positive font size.',
    );
}

/** Historical Helvetica AFM envelope retained only in this compatibility adapter. */
export function pdfFontContextFromHelvetica(font: PDFFont): PdfFontContext {
  const validate = (text: string): string => {
    const normalized = canonicalDocumentText(text, 'helvetica');
    try {
      for (const line of normalized.split('\n')) font.encodeText(line);
    } catch {
      throw new FontTextError(
        'missing-glyph',
        'Text contains characters unsupported by Helvetica. Choose Noto Sans for Latin, Greek or Cyrillic Unicode text.',
      );
    }
    return normalized;
  };
  const shape = (text: string, size: number): LogicalTextRun => {
    const canonical = validate(text);
    assertRunSize(size, canonical);
    const glyphs = Array.from(canonical, (character) => ({
      id: Number.parseInt(font.encodeText(character).asString(), 16),
      codePoints: [character.codePointAt(0) ?? 0],
      xAdvance: font.widthOfTextAtSize(character, size),
      yAdvance: 0,
      xOffset: 0,
      yOffset: 0,
    }));
    const width = glyphs.reduce((total, glyph) => total + glyph.xAdvance, 0);
    return {
      text: canonical,
      glyphs,
      width,
      inkBounds: {
        minX: -size,
        minY: -0.225 * size,
        maxX: width + size,
        maxY: 0.931 * size,
      },
    };
  };
  return {
    font,
    fontId: 'helvetica',
    metrics: { ascent: 0.931, descent: -0.225, lineGap: 0, unitsPerEm: 1000 },
    validate,
    // StandardFontEmbedder.widthOfTextAtSize(string) includes kerning;
    // drawText emits an unkerned Tj. Sum single-glyph advances instead.
    measure: shape,
    shape,
  };
}

function independentGlyphFeatures(font: Font): TypeFeatures {
  // Optional GSUB/GPOS is deliberately disabled: pdf-lib emits glyph IDs and
  // discards positions. Supported NFC scripts do not need contextual shaping.
  return Object.fromEntries(
    font.availableFeatures.map((feature) => [feature, false]),
  );
}

async function compatibleFontkit(): Promise<
  Parameters<PDFDocument['registerFontkit']>[0]
> {
  const module: unknown = await import('@pdf-lib/fontkit');
  if (!module || typeof module !== 'object')
    throw new FontTextError(
      'font-load-failed',
      'The PDF font engine could not be loaded.',
    );
  const runtime: unknown =
    'create' in module ? module : 'default' in module ? module.default : null;
  if (
    !runtime ||
    typeof runtime !== 'object' ||
    !('create' in runtime) ||
    typeof runtime.create !== 'function'
  )
    throw new FontTextError(
      'font-load-failed',
      'The PDF font engine is incompatible with this browser.',
    );
  // The package publishes namespace typings but Vite exposes its ESM default;
  // the checked create boundary reconciles that packaging difference only.
  return runtime as Parameters<PDFDocument['registerFontkit']>[0];
}

function checkedRun(
  font: Font,
  features: TypeFeatures,
  text: string,
): GlyphRun {
  for (const character of text) {
    const point = character.codePointAt(0);
    if (point === undefined || !font.hasGlyphForCodePoint(point)) {
      throw new FontTextError(
        'missing-glyph',
        `Noto Sans does not contain ${point === undefined ? 'this character' : `U+${point.toString(16).toUpperCase().padStart(4, '0')}`}. Choose supported text before exporting.`,
      );
    }
  }
  const run = font.layout(text, features);
  const characters = Array.from(text);
  if (run.glyphs.length !== characters.length || run.direction === 'rtl') {
    throw new FontTextError(
      'unsupported-shaping',
      'This text requires contextual shaping that Kagaz cannot safely export yet.',
    );
  }
  for (let index = 0; index < run.glyphs.length; index += 1) {
    const glyph = run.glyphs[index];
    const position = run.positions[index];
    const point = characters[index]?.codePointAt(0);
    if (
      !glyph ||
      !position ||
      point === undefined ||
      glyph.id === 0 ||
      glyph.id !== font.glyphForCodePoint(point).id ||
      position.xOffset !== 0 ||
      position.yOffset !== 0 ||
      position.yAdvance !== 0 ||
      Math.abs(position.xAdvance - glyph.advanceWidth) > 0.0001
    ) {
      throw new FontTextError(
        'unsupported-shaping',
        'This glyph sequence needs positioning or substitution that the PDF export path cannot preserve.',
      );
    }
  }
  return run;
}

function measureRun(
  run: GlyphRun,
  size: number,
  unitsPerEm: number,
): FontMeasurement {
  const scale = size / unitsPerEm;
  let advance = 0;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const glyph of run.glyphs) {
    const bbox = glyph.bbox;
    if (bbox.maxX > bbox.minX && bbox.maxY > bbox.minY) {
      minX = Math.min(minX, advance + bbox.minX);
      minY = Math.min(minY, bbox.minY);
      maxX = Math.max(maxX, advance + bbox.maxX);
      maxY = Math.max(maxY, bbox.maxY);
    }
    advance += glyph.advanceWidth;
  }
  return {
    width: advance * scale,
    inkBounds: Number.isFinite(minX)
      ? {
          minX: minX * scale,
          minY: minY * scale,
          maxX: maxX * scale,
          maxY: maxY * scale,
        }
      : { minX: 0, minY: 0, maxX: 0, maxY: 0 },
  };
}

async function parseBundledFont(assets?: FontAssetSnapshot): Promise<{
  readonly font: Font;
  readonly features: TypeFeatures;
  readonly bytes: Uint8Array;
}> {
  const bytes = assets
    ? assets.get('noto-sans')
    : (await snapshotFontAssets(['noto-sans'])).get('noto-sans');
  if (!bytes)
    throw new FontTextError(
      'font-load-failed',
      'The selected document font is missing from this export.',
    );
  const copy = Uint8Array.from(bytes);
  await validateBundledFontBytes(copy);
  const fontkit = await compatibleFontkit();
  let font: Font;
  try {
    font = fontkit.create(copy);
  } catch {
    throw new FontTextError(
      'invalid-font',
      'The bundled document font could not be parsed.',
    );
  }
  if (
    font.unitsPerEm <= 0 ||
    font.numGlyphs > 65535 ||
    !Number.isFinite(font.ascent) ||
    !Number.isFinite(font.descent)
  )
    throw new FontTextError(
      'invalid-font',
      'The bundled document font has unsupported metrics.',
    );
  return { font, bytes: copy, features: independentGlyphFeatures(font) };
}

export async function preparePdfFont(
  document: PDFDocument,
  fontId: DocumentFontId,
  assets?: FontAssetSnapshot,
): Promise<PdfFontContext> {
  if (!isDocumentFontId(fontId))
    throw new FontTextError(
      'invalid-font',
      'The selected document font is not supported by Kagaz.',
    );
  let fonts = documentFonts.get(document);
  if (!fonts) {
    fonts = new Map();
    documentFonts.set(document, fonts);
  }
  const cached = fonts.get(fontId);
  if (cached) return cached;
  // Copy caller-owned snapshot bytes before the first await.
  const captured = assets
    ? new Map(
        Array.from(
          assets,
          ([id, bytes]) => [id, Uint8Array.from(bytes)] as const,
        ),
      )
    : undefined;
  const pending = (async (): Promise<PdfFontContext> => {
    if (fontId === 'helvetica')
      return pdfFontContextFromHelvetica(
        await document.embedFont(StandardFonts.Helvetica),
      );
    const { font: parsed, bytes, features } = await parseBundledFont(captured);
    const fontkit = await compatibleFontkit();
    document.registerFontkit(fontkit);
    // Full embedding avoids shaped-glyph subset mapping risks. There is one
    // resource per document. Actual size overhead is independently measured.
    const font = await document.embedFont(bytes, {
      subset: false,
      features,
      customName: 'KagazNotoSans',
    });
    const validate = (text: string): string => {
      const canonical = canonicalDocumentText(text, fontId);
      for (const line of canonical.split('\n'))
        checkedRun(parsed, features, line);
      return canonical;
    };
    const shape = (text: string, size: number): LogicalTextRun => {
      const canonical = validate(text);
      assertRunSize(size, canonical);
      const run = checkedRun(parsed, features, canonical);
      const scale = size / parsed.unitsPerEm;
      const characters = Array.from(canonical);
      return {
        text: canonical,
        ...measureRun(run, size, parsed.unitsPerEm),
        glyphs: run.glyphs.map((glyph, index) => ({
          id: glyph.id,
          codePoints: [characters[index]?.codePointAt(0) ?? 0],
          xAdvance: glyph.advanceWidth * scale,
          yAdvance: 0,
          xOffset: 0,
          yOffset: 0,
        })),
      };
    };
    return {
      font,
      fontId,
      metrics: {
        ascent: parsed.ascent / parsed.unitsPerEm,
        descent: parsed.descent / parsed.unitsPerEm,
        lineGap: parsed.lineGap / parsed.unitsPerEm,
        unitsPerEm: parsed.unitsPerEm,
      },
      validate,
      measure: shape,
      shape,
    };
  })();
  fonts.set(fontId, pending);
  try {
    return await pending;
  } catch (error: unknown) {
    fonts.delete(fontId);
    if (error instanceof FontTextError) throw error;
    throw new FontTextError(
      'font-load-failed',
      `${documentFontLabel(fontId)} could not be prepared for PDF export. Reload and try again.`,
    );
  }
}

/** UI validation parses the one trusted bundled font once, without a PDF document. */
export async function validateDocumentText(
  fontId: DocumentFontId,
  text: string,
): Promise<string> {
  if (!isDocumentFontId(fontId))
    throw new FontTextError(
      'invalid-font',
      'The selected document font is not supported by Kagaz.',
    );
  if (fontId === 'helvetica') {
    // This temporary document stays in the lazy font chunk and carries no page
    // or user document; subsequent UI validation reuses its font promise below.
    validationHelvetica ??= (async () => {
      const { PDFDocument } = await import('pdf-lib');
      return preparePdfFont(await PDFDocument.create(), fontId);
    })();
    const context = await validationHelvetica;
    return context.validate(text);
  }
  const canonical = canonicalDocumentText(text, fontId);
  parsedBundledFont ??= parseBundledFont().catch((error: unknown) => {
    parsedBundledFont = null;
    throw error;
  });
  const { font, features } = await parsedBundledFont;
  for (const line of canonical.split('\n')) checkedRun(font, features, line);
  return canonical;
}
