import type { DocumentFontId } from './fontCatalog';
import { FontTextError } from './fontErrors';

const SUPPORTED_LETTER =
  /[\p{Script=Latin}\p{Script=Greek}\p{Script=Cyrillic}]/u;
const COMMON_CHARACTER = /[\p{Number}\p{Punctuation}\p{Symbol}\p{Separator}]/u;
const MARK = /\p{Mark}/u;
const CONTROL =
  /[\p{Control}\p{Format}\p{Surrogate}\p{Private_Use}\p{Unassigned}]/u;

/**
 * pdf-lib's custom-font drawing discards fontkit's glyph offsets. Until a
 * positioned-glyph writer and logical extraction maps are verified, only
 * scripts whose NFC text maps to independent glyphs are admitted.
 */
export function canonicalDocumentText(
  text: string,
  fontId: DocumentFontId,
): string {
  if (text.length > 10_000)
    throw new FontTextError(
      'unsupported-shaping',
      'Document text is limited to 10,000 UTF-16 units per text value. Split the text into smaller annotations or values.',
    );
  const normalized = text.replace(/\r\n?/g, '\n');
  if (fontId === 'helvetica') return normalized;
  const canonical = normalized.normalize('NFC');
  for (const character of canonical) {
    if (character === '\n') continue;
    if (MARK.test(character)) {
      throw new FontTextError(
        'unsupported-shaping',
        'This combining sequence needs glyph positioning that Kagaz cannot safely export. Use a composed Latin, Greek or Cyrillic character.',
      );
    }
    if (CONTROL.test(character)) {
      throw new FontTextError(
        'unsupported-script',
        'Directional controls, joiners and non-printing characters cannot be exported by this font path.',
      );
    }
    if (
      !SUPPORTED_LETTER.test(character) &&
      !COMMON_CHARACTER.test(character)
    ) {
      throw new FontTextError(
        'unsupported-script',
        'Noto Sans export currently supports Latin, Greek and Cyrillic. Devanagari, right-to-left scripts and other complex scripts need shaping and extraction support that is not available yet.',
      );
    }
  }
  return canonical;
}

/** Intl.Segmenter preserves combining and conjunct clusters at wrap boundaries. */
export function documentTextGraphemes(text: string): readonly string[] {
  if (typeof Intl.Segmenter !== 'function') {
    throw new FontTextError(
      'unsupported-shaping',
      'This browser needs Intl.Segmenter for safe Unicode text wrapping. Update the browser and try again.',
    );
  }
  return Array.from(
    new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text),
    ({ segment }) => segment,
  );
}
