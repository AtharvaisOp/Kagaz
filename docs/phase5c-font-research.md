# Phase 5C font engineering evidence

This records the font engine investigation, including unsuccessful alternatives
and the Phase 5C-R synthetic Type 3 proof. It does not claim Devanagari product
support or a completed full Phase 5C release. The deliberately narrower
Latin/Greek/Cyrillic release decision is in [the recovery note](phase-5c-recovery.md).

## Shipped capability boundary

| Script or character class                             | Policy                               | Reason                                                                              |
| ----------------------------------------------------- | ------------------------------------ | ----------------------------------------------------------------------------------- |
| Basic Latin                                           | Helvetica and Noto Sans              | Existing Standard14 path retained; custom path independently embedded and extracted |
| Latin Extended and accented Latin                     | Noto Sans, subject to glyph coverage | Actual font glyphs and advances; unsupported code points fail visibly               |
| Greek                                                 | Noto Sans, subject to glyph coverage | Independent NFC glyphs; real PDF extraction and font dictionary tests               |
| Cyrillic                                              | Noto Sans, subject to glyph coverage | Independent NFC glyphs; real PDF extraction and font dictionary tests               |
| Decomposed accents that NFC composes                  | Noto Sans                            | Exported text uses the canonically equivalent NFC sequence                          |
| Combining sequences that remain after NFC             | Rejected                             | The installed PDF writer does not emit the required mark offsets                    |
| Hindi/Marathi Devanagari                              | Rejected                             | The later Type 3 synthetic proof is not integrated and PDF.js still loses joiners   |
| Arabic and Hebrew                                     | Rejected                             | Joining and bidirectional layout are not implemented; no RTL claim                  |
| Bengali and Tamil                                     | Rejected                             | Script shaping has not been verified                                                |
| CJK and emoji                                         | Rejected                             | No appropriate bundled coverage or supported export path                            |
| Joiners, bidi controls, private/unassigned characters | Rejected                             | Outside the verified independent-glyph policy                                       |

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
An independent [pdf-lib issue #1419](https://github.com/Hopding/pdf-lib/issues/1419)
reports the same Indic `@pdf-lib/fontkit` runtime failure. A shim lets the
research script continue; it is not evidence of a supported browser build or
a defensible production fix. The repo remains pinned to fontkit 1.1.1 for its
verified independent-glyph path.

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

## Phase 5C-R: occurrence-specific Type 3 experiment

The recovery started at `8584d534d973b13b095827ec42ed058ffb29303f`.
No production font, shim or PDF engine was added for this experiment. Generated
PDFs, scripts, JSON and PNG comparisons are outside the repository in
`%LOCALAPPDATA%/Kagaz/phase5c-recovery-research`.

The first new hypothesis gave each occurrence a distinct CID/ToUnicode entry
while using positioned native font glyphs. The `occurrence-first.pdf` and
`occurrence-last.pdf` PDFs pass qpdf but **all 21 lines** fail exact PDF.js
extraction: for example `नमस्ते` becomes `नमस्ते \u0004\u0005` in the former
and `नम\u0003\u0004स्ते` in the latter. Repeated glyphs and visual/logical
cluster order are not repaired by occurrence codes alone.

The distinct Type 3 hypothesis draws each fontkit-shaped grapheme cluster's
glyph outlines in a character procedure and assigns a fresh one-byte character
code and one-scalar ToUnicode mapping to each _logical_ source scalar. The first
scalar's procedure paints the cluster; other scalar procedures paint nothing.
`type3-cluster.pdf`, which maps a whole cluster to one code, misgroups 17/21
PDF.js lines. `type3-split.pdf` divides the cluster's advance among its scalar
codes to avoid falsely classifying a multi-code-point glyph as zero-width. This
is a research construction, not Kagaz's PDF output path or a complete text
selection model. It needs Type 3 shards because each font has a one-byte code
space; the long 615-scalar stress line uses three shards.

The 165,052-byte, three-page `type3-split.pdf` has SHA-256
`c468e6a73a4d8174727a536712ad15b6ebdeab6c4ff83c74dcbf630c0e792614`
and passes qpdf 12.4.2. Its JSON records thirteen fixture lines (including all
eight required Hindi/Marathi strings), four paragraph lines and the same four
paragraphs repeated. The exact extraction result is:

| Extractor / renderer                                       | Observed result on the 21-line proof                                                                                                                                                                          |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PDF.js 6.3.289 with `disableNormalization: true`           | 18/21 lines exactly match. Three joiner-bearing lines lose U+200D/U+200C: `क्‍ष क्‌ष` becomes `क्ष क्ष`; the two repeated paragraphs change the same way.                                                     |
| PDFMiner 20251230                                          | 21/21 lines exactly match the source, including joiners.                                                                                                                                                      |
| pypdf 6.10.0                                               | 21/21 lines exactly match the source, including joiners.                                                                                                                                                      |
| PDFium 5.14.0 compared with Chromium Canvas native shaping | Page 1: 22 missing dark pixels among 8,184 reference dark pixels; pages 2 and 3: 52/10,418 each. Pixel thresholds and renderer antialiasing make this a visual comparison, not a universal correctness proof. |

The separate five-page, 369,867-byte `type3-stress-split.pdf` extends the same
13 fixtures with repeated paragraphs, a 615-scalar line, mixed Latin/numerals,
rotation and scaling. qpdf passes; PDFMiner and pypdf extract all 26 lines
exactly. PDF.js matches 23/26 exactly and the other three only after its joiner
loss is allowed. In a PDFium/Chromium comparison, every reference ink pixel has
PDF ink within one pixel; the long-line page has 521 initially missing dark
pixels of 9,816 before that one-pixel neighborhood check. One fresh Node run
built the synthetic stress PDF in 936.8 ms with a 4.94 MB transient JS-heap
increase. This is not a large-document, browser, export or memory budget.

[PDF.js issue #21890](https://github.com/mozilla/pdf.js/issues/21890)
demonstrates a separate false inserted space after a multi-code-point Indic glyph
when positioned text advances are interpreted as a zero-width mark. Its fix,
[PR #21960](https://github.com/mozilla/pdf.js/pull/21960), merged upstream on
2026-10-06, groups and anchors the Unicode-category alternatives. Kagaz's
lockfile still resolves PDF.js 6.3.289, one affected version in that issue.
That bug explains a concrete _extractor_ failure mode in an earlier positioned
strategy; it does not explain every cmap/subsetting failure, fix Kagaz's pinned
build, or restore the Type 3 proof's joiners. Font-writer and extractor faults
must continue to be tested independently.

The synthetic writer has no annotation/watermark/form integration, no committed
PDF.js preview, no app download test, no selection-geometry proof, no cancellation
or export-snapshot behavior, and no aggregate Type 3 resource/memory bound.
The larger Type 3 PDF and per-occurrence char procedures also need a size and
performance decision. Its glyph-outline strategy uses research-only Noto Sans
Devanagari and the external fontkit runtime shim. It cannot qualify as a
selectable product font on these results. Source PDFs, exact JSON extraction and
PDFium/Chromium images remain outside the tracked product tree.

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

A reliable extension must choose and bound a defensible writer. An occurrence-
aware CID/ToUnicode writer would still need correct glyph positioning and
cluster mappings; the Type 3 outline/scalar approach additionally needs a
PDF.js joiner/selection solution and resource bounds. Both require extraction
in PDF.js and another parser. `ActualText` alone did not solve the inspected
PDF.js path. Product evidence must also cover mixed-script runs with appropriate
fonts, wrapping and rotation, browser reference comparisons, annotations,
watermarks, form appearance integration, immutable snapshots, cancellation and
the existing redaction/lifecycle regressions. Do not merely add the investigated
Devanagari TTF to the font menu.
