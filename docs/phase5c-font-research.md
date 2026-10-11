# Phase 5C font engineering evidence

This records the font engine investigation, including unsuccessful alternatives.
It does not claim Devanagari product support or a completed Phase 5C release.

## Shipped capability boundary

| Script or character class                             | Policy                               | Reason                                                                                               |
| ----------------------------------------------------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| Basic Latin                                           | Helvetica and Noto Sans              | Existing Standard14 path retained; custom path independently embedded and extracted                  |
| Latin Extended and accented Latin                     | Noto Sans, subject to glyph coverage | Actual font glyphs and advances; unsupported code points fail visibly                                |
| Greek                                                 | Noto Sans, subject to glyph coverage | Independent NFC glyphs; real PDF extraction and font dictionary tests                                |
| Cyrillic                                              | Noto Sans, subject to glyph coverage | Independent NFC glyphs; real PDF extraction and font dictionary tests                                |
| Decomposed accents that NFC composes                  | Noto Sans                            | Exported text uses the canonically equivalent NFC sequence                                           |
| Combining sequences that remain after NFC             | Rejected                             | The installed PDF writer does not emit the required mark offsets                                     |
| Hindi/Marathi Devanagari                              | Rejected                             | Positioned display alone does not produce reliable logical extraction with the investigated mappings |
| Arabic and Hebrew                                     | Rejected                             | Joining and bidirectional layout are not implemented; no RTL claim                                   |
| Bengali and Tamil                                     | Rejected                             | Script shaping has not been verified                                                                 |
| CJK and emoji                                         | Rejected                             | No appropriate bundled coverage or supported export path                                             |
| Joiners, bidi controls, private/unassigned characters | Rejected                             | Outside the verified independent-glyph policy                                                        |

Noto's Unicode glyph coverage is not itself the support matrix. The policy first
admits the verified script classes, then checks every code point against the
actual font, then verifies the resulting run has one expected glyph per code
point and zero offsets, vertical advances, or substituted glyph IDs. Missing
glyphs never reach `.notdef`. Optional GSUB/GPOS features are disabled explicitly.
No Helvetica fallback can corrupt selected Noto text.

## Assets and licensing

The shipped document font is **Noto Sans Regular**, one static TrueType file,
569,208 bytes, SHA-256
`b85c38ecea8a7cfb39c24e395a4007474fa5a4fc864f6ee33309eb4948d232d5`.
It was obtained from the [official Noto font repository](https://github.com/notofonts/noto-fonts/blob/main/hinted/ttf/NotoSans/NotoSans-Regular.ttf).
The unmodified [SIL Open Font License](../apps/web/src/assets/fonts/OFL.txt)
and copyright notice accompany the font. The license permits bundling and PDF
embedding; `OS/2.fsType` is also checked before parsing, following the
[OpenType embedding-permission specification](https://learn.microsoft.com/en-us/typography/opentype/spec/os2#fstype).

The investigated Devanagari font is not a selectable product font. It is the
official [Noto Sans Devanagari Regular static TTF](https://github.com/notofonts/noto-fonts/blob/main/hinted/ttf/NotoSansDevanagari/NotoSansDevanagari-Regular.ttf),
219,212 bytes, SHA-256
`385e78e6359a9d88a0f243d53b1209d7548361ba2194e2b9ec779bcaa7e8949d`.
The same Noto OFL applies. The research font and generated comparison artifacts
were kept outside the repository in `%LOCALAPPDATA%/Kagaz/phase5c-research`.
The exception is a 5,987-byte synthetic Devanagari source PDF committed for
redaction regressions. Its embedded subset, generation method, hash and imperfect
extraction are documented in the [fixture provenance](../apps/web/src/lib/fonts/fixtures/README.md),
with the original [Devanagari OFL notice](../apps/web/src/lib/fonts/fixtures/OFL-Devanagari.txt).
That fixture does not add a selectable or supported Devanagari document font.

## Installed writer behavior

`pdf-lib` 1.17.1 custom embedding calls `font.layout(text, features)`, encodes
the returned glyph IDs, and computes width from `glyph.advanceWidth`. It does
not emit the run's `positions.xAdvance`, `yAdvance`, `xOffset`, or `yOffset`.
This was checked in the installed `CustomFontEmbedder`,
`CustomFontSubsetEmbedder`, `PDFPage.drawText`, and drawing-operator sources,
alongside the [official embedding API](https://pdf-lib.js.org/docs/api/classes/pdfdocument#embedfont)
and [fontkit's layout contract](https://github.com/Hopding/fontkit#fontlayoutstring-features--glyphrun).

Full embedding creates its `ToUnicode` map from cmap-covered glyphs; shaped
substitution glyphs can be absent. Subsetting records shaped glyph code points,
but visual-order glyphs and repeated contextual IDs do not establish logical
Unicode order. The standard Helvetica whole-string width includes AFM kerning,
while its emitted `Tj` is unkerned. The adapter retains the historic annotation
layout and watermark envelope, and exposes actual unkerned advances for generic
measurements.

The shared boundary exposes font/asset identity, policy/capabilities, coverage
validation, logical runs with IDs/code points/advances/offsets, normalized ascent,
descent and line gap, actual emitted width and glyph ink bounds. Annotation
wrapping uses [Intl.Segmenter graphemes](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/Segmenter),
normalizes CR/LF, preserves cluster boundaries and uses actual custom-font
baselines. Incremental advances prevent repeated shaping of growing prefixes.
Text values are bounded to 10,000 UTF-16 units. Noto annotations reject values
that exceed the box's line capacity, advance width or actual glyph ink bounds;
they do not silently truncate a successful export. Negative left bearings receive
baseline room, and the oriented PDF box remains an additional clipping boundary.
Classic Helvetica retains its previous truncation behavior. Preview rasterization uses the same PDF text path, while the
active editor loads the same bundled bytes through [FontFace](https://developer.mozilla.org/en-US/docs/Web/API/FontFace).

## Actual Devanagari alternatives tested

The research executed thirteen synthetic strings, including all required
`नमस्ते`, `मराठी भाषा`, `कागदपत्र`, `विद्यार्थी`, `प्रकल्प`, `क्षेत्र`,
`कृपया`, and `हिन्दी`. Additional lines include independent vowels, pre/post
matras, anusvara/visarga, virama/conjuncts, ZWJ/ZWNJ, Devanagari/Latin mixed text,
numbers and punctuation.

The installed fontkit Indic shaper initially threw `ReferenceError:
regeneratorRuntime is not defined`. A research-only copy of the
[regenerator runtime source](https://github.com/facebook/regenerator/blob/main/packages/runtime/runtime.js)
was loaded externally to investigate the later shaping and extraction stages.
It was not added to the production dependency tree. Its downloaded SHA-256 was
`7beda998b3fd277f3548e12b277bafc3037d243421f007032d38dffee412224c`.

Five actual PDFs were generated, reloaded/extracted/rendered using PDF.js in
Chrome, and independently checked with qpdf 12.4.2. An independently shaped
Canvas reference uses browser-native shaping and the identical Devanagari bytes.
Explicit glyph-position alternatives emit a separate `Tm` per glyph, preserving
fontkit advances and offsets. A later alternative replaces the `ToUnicode` cmap
with shaped-glyph `codePoints`; the last adds UTF-16 `ActualText` marked content.

| Alternative                             | PDF bytes | Missing dark reference pixels | Structural qpdf result | Extraction outcome                                                    |
| --------------------------------------- | --------: | ----------------------------: | ---------------------- | --------------------------------------------------------------------- |
| Default full embedding                  |    97,282 |                         2,857 | Exit 0                 | `विद्यार्थी` becomes `ɟवȘाथƹ`                                         |
| Default subset embedding                |    10,976 |                         1,061 | Exit 0                 | Pre-base matras precede logical consonants; `हिन्दी` becomes `िहन्दी` |
| Explicit positions, full embedding      |    97,722 |                           212 | Exit 0                 | Shaped glyph mappings remain missing/corrupt                          |
| Explicit positions plus shaped cmap     |    98,322 |                           212 | Exit 0                 | Visual-order matras and context mappings remain incorrect             |
| Explicit positions, cmap and ActualText |    98,616 |                           212 | Exit 0                 | PDF.js ordinary text extraction still follows glyph mappings          |

The reference has 8,429 dark pixels. Missing-reference-pixel counts use a dark
reference threshold of 128 and a PDF light threshold of 192. Differences include
antialiasing and are a diagnostic comparison, not a proof of perfect rendering.
Explicit positions clearly improve appearance, but they do not establish the
required logical search/copy semantics. Subset mappings combine adjacent lines
in some extraction items, and the mixed-font line also exposes unsupported Latin
glyph coverage in the investigated Devanagari face. None of these outcomes is
advertised as product support.

Artifacts comprise five PDFs and render PNGs, a native reference PNG,
`research-results.json` with per-glyph positions and extracted items, and the
external research script. Structural success is not treated as Unicode success.

## Lifetime and security

Only the fixed checked-in font is accepted. Optional user font upload was omitted;
there is no misleading arbitrary-font validation or malicious-font sandbox claim.
The loader checks the decompressed stream length independently of Content-Length,
caps it at the known file size, has a 15-second deadline, verifies SFNT directory
bounds/static format/embedding flags and checks the exact SHA-256 before parsing.
A fixed trusted asset plus integrity checking is a materially narrower boundary
than accepting uploaded fonts.

One bounded bundle-byte promise and one FontFace can be retained for the app
lifetime. Each export receives private byte copies, and caller cancellation
returns promptly without invalidating another caller's shared immutable resource.
There are no font object URLs, remote font providers, document text requests or
font persistence. Font resources are cached by document through a WeakMap and
reused across annotations, watermarks and form appearance generation. An explicit
snapshot missing its selected font fails rather than fetching mutable fallback
data. Failed loads are retryable. Runtime unknown font IDs fail closed.

Redacted pages use these fonts only in throwaway appearance composition before
sanitization, or for trusted foreground watermark composition after sanitization.
Their final output must remain one opaque raster with no fonts/text operators.
No font work modifies the Phase 5A/5B retention allowlists or reattaches donor
resources. The major phase record reports complete verifier results separately.

## Follow-up needed before Devanagari support

A reliable extension needs a verified glyph-position writer plus occurrence-aware
logical Unicode mappings for reordered marks, conjuncts and repeated glyphs,
including dependable extraction in PDF.js and another parser. `ActualText` alone
did not solve the inspected PDF.js path. It also needs mixed-script runs with
appropriate fonts, browser reference comparisons, line-break cluster mapping,
form appearance integration, and the existing redaction/lifecycle regressions.
Do not merely add the investigated Devanagari TTF to the font menu.
