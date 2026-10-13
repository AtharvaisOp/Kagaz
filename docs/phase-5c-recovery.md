# Phase 5C-R — Devanagari investigation and scoped Unicode release

## Decision and status

**Original Phase 5C status: PARTIAL.** Correct Hindi/Marathi Devanagari creation
has not been established end to end in Kagaz. It remains visibly rejected in
annotations, watermarks and regenerated form appearances. A standalone Type 3
PDF demonstrates a promising way to preserve shaped appearance and logical
text in two extractors, but PDF.js still loses joiners and the writer is not
integrated with the editor. No Devanagari font, fontkit runtime shim or second
PDF engine has been added to the product.

**Release decision: a deliberately scoped Latin/Greek/Cyrillic release.** The
existing branch's verified behavior is useful independently of complex-script
support. PR #5 can become ready for review with that accurate scope after the
recovery verification passes. Merge, final-main CI, Vercel promotion and
anonymous production proof are separate gates. This document must not be read
as evidence that any pending gate passed.

The recovery began on `codex/phase-5c-unicode-fonts` at
`8584d534d973b13b095827ec42ed058ffb29303f` with draft
[PR #5](https://github.com/AtharvaisOp/Kagaz/pull/5). `origin/main` was
`79c79c2736baddda3b391934a97e98c9bc5bc796`. The prior Phase 5C commits
and working product implementation were not discarded.

## Released-scope contract

| Created content                                                                             | Supported writer path                           | Limit                                                                                              |
| ------------------------------------------------------------------------------------------- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Basic Latin                                                                                 | Existing Helvetica; validated bundled Noto Sans | Exact glyph coverage and current text-box/form bounds                                              |
| Accented and Extended Latin                                                                 | Bundled Noto Sans                               | Exact glyph coverage; NFC-composable accents export in canonical form                              |
| Greek and Cyrillic                                                                          | Bundled Noto Sans                               | Independently rendered and extracted fixture coverage, not every language-specific shaping pattern |
| Hindi/Marathi Devanagari                                                                    | **Visible rejection**                           | No editor-created Devanagari PDF text                                                              |
| Arabic/Hebrew RTL; Bengali/Tamil; CJK/emoji; residual combining marks; directional controls | **Visible rejection**                           | No silent fallback, `.notdef` or partial download                                                  |

The supported path remains browser-local: fixed licensed Noto Sans bytes are
integrity-checked and embedded via pdf-lib 1.17.1 and `@pdf-lib/fontkit` 1.1.1;
PDF.js 6.3.289 renders previews and verifies downloads. Real font advances,
ink bounds and grapheme wrapping feed annotations, watermarks and eligible form
appearances. Export captures private immutable source, text, form, watermark,
redaction and font snapshots and reuses a font per document. A PDF viewer can
normalize compatibility ligatures or NBSP on copy. Deliberately added text on
freshly reconstructed redacted pages is rasterized and is not searchable.

## Prior failure reproduced and diagnostic separation

The [original font research](phase5c-font-research.md) evaluated thirteen
Hindi/Marathi fixture strings, including `नमस्ते`, `मराठी भाषा`, `कागदपत्र`,
`विद्यार्थी`, `प्रकल्प`, `क्षेत्र`, `कृपया` and `हिन्दी`. Five real conventional
font-writer PDFs passed qpdf but did not meet both visual and logical acceptance.
Default full embedding could extract `विद्यार्थी` as `ɟवȘाथƹ`; subsetting
reordered a matra so `हिन्दी` became `िहन्दी`; explicit glyph positioning
substantially improved appearance without fixing ToUnicode. A shaped cmap and
`ActualText` marked content did not correct ordinary PDF.js extraction. A
structurally valid PDF is therefore insufficient evidence for script support.

The later occurrence-CID experiments tested the hypothesis that a unique code
for each shaped glyph occurrence would fix mapping collisions. Both real
`occurrence-first.pdf` and `occurrence-last.pdf` pass qpdf; **21/21 lines** still
fail exact PDF.js extraction. For example, the former extracts `नमस्ते` as
`नमस्ते \u0004\u0005`. Occurrence identity alone does not resolve visual-order
marks, clusters or the extraction engine's treatment of grouped glyphs.

[PDF.js issue #21890](https://github.com/mozilla/pdf.js/issues/21890)
isolates a _separate_ extractor defect: a multi-code-point Indic glyph could be
classified as a zero-width mark, creating a false gap after explicit positioning.
[PR #21960](https://github.com/mozilla/pdf.js/pull/21960) merged an upstream fix
on 2026-10-06. Kagaz's locked PDF.js 6.3.289 is an affected issue version; no
unverified dependency upgrade or local extraction patch was shipped. That bug
does not explain every earlier font cmap/subsetting error or the remaining
joiner loss. The old writer and PDF.js both contribute to the observed failures.

The Indic path in the installed `@pdf-lib/fontkit` also throws
`ReferenceError: regeneratorRuntime is not defined` in the research/browser
environment. [pdf-lib issue #1419](https://github.com/Hopding/pdf-lib/issues/1419)
reports the same failure for Gujarati. An external research-only runtime copy
allowed subsequent experiments; a workaround has not been accepted into Kagaz.
The existing independent-glyph Latin/Greek/Cyrillic path remains unaffected.

## New Type 3 hypothesis and actual PDF evidence

A dedicated low-level research writer shapes each grapheme with Noto Sans
Devanagari, converts positioned glyph outlines to a Type 3 character procedure,
and assigns one occurrence-specific PDF character code per **logical Unicode
scalar**. The first scalar paints the cluster; its other scalar codes carry no
ink. Dividing the cluster's advance across those codes avoids the multi-code-
point category problem in the pinned PDF.js for the tested strings. Type 3
fonts have a one-byte code space, so the stress writer shards long rows.

The 165,052-byte `type3-split.pdf` research output is **outside
the repository**, at
`%LOCALAPPDATA%/Kagaz/phase5c-recovery-research/type3-split.pdf` with companion
`type3-split.json`. Its SHA-256 is
`c468e6a73a4d8174727a536712ad15b6ebdeab6c4ff83c74dcbf630c0e792614`.
qpdf 12.4.2 exits 0. It contains three pages and 21 lines: the thirteen
fixture strings plus four multi-sentence paragraphs repeated on the next page.

| Inspection                                                 | Actual result                                                                                                                                                                                      |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PDF.js 6.3.289, `disableNormalization: true`               | 18/21 exact source lines. The three lines containing ZWJ/ZWNJ lose those scalars: `क्‍ष क्‌ष` extracts as `क्ष क्ष`, and the two repeated paragraphs show the same loss.                           |
| PDFMiner 20251230                                          | 21/21 exact lines, including joiners.                                                                                                                                                              |
| pypdf 6.10.0                                               | 21/21 exact lines, including joiners.                                                                                                                                                              |
| PDFium 5.14.0 versus Chromium Canvas native-font reference | Page 1: 22 of 8,184 dark reference pixels missing at the strict threshold; pages 2/3: 52 of 10,418 each. Antialiasing accounts for some pixel variation; this only supports the tested appearance. |

The 369,867-byte, five-page `type3-stress-split.pdf` (SHA-256
`1a5a2ec71e6a6da5a57ff28a750f66e9b484fff257e4344fb95438689fd86ead`)
adds a 615-scalar row,
three Type 3 shards, repeated paragraphs, mixed Latin/numerals and rotated/
scaled rows. It passes qpdf. PDFMiner and pypdf extract all **26/26** lines
exactly; PDF.js extracts **23/26** exactly and the three joiner lines only if
ZWJ/ZWNJ are discarded. In independent PDFium/Chromium comparison, every
reference ink pixel has corresponding PDF ink within a one-pixel neighborhood,
including rotation/scaling. A fresh Node synthetic build measured 936.8 ms and
a transient +4.94 MB JS-heap change. Neither number establishes browser or
large-document limits. The Type 3 `cluster` variant misgroups **17/21** PDF.js
lines, so merely mapping a whole grapheme to one code is not a solution.

All scripts, PDFs, JSON extraction rows, reference screenshots and PDFium renders
remain under `%LOCALAPPDATA%/Kagaz/phase5c-recovery-research`. The Type 3 proof
has **no** Kagaz annotation, watermark, form, preview, download, wrapping,
history, immutable-snapshot, cancellation or redaction integration. It has not
proved per-scalar selection geometry, cross-reader copy/paste, resource bounds
for large documents, acceptable bundle size, or a production-safe Indic shaping
runtime. These are release criteria, not minor polish. No product claim or font
menu change follows from the synthetic PDFs.

## Security, lifecycle and separate PNG debt

The scoped release retains Phase 5A fresh-page redaction: affected output pages
contain only an opaque sanitized image, not a copied donor page, source font,
form AP, original stream, OCR layer or original image. Retained-object checks,
original-content fingerprints, raster bounds and black-pixel/hostile-input
counterexamples remain mandatory. Deliberately new Unicode foreground on a
redacted page is rasterized with the sanitized appearance and is not called
searchable. The accepted Phase 5C verifier inspected four real sanitized raster
pages, including one Unicode foreground, and found no original source glyph or
font/AP resources. Its mixed-CID retained-resource collision fails closed with
`redaction-unsafe-retention`; no allowlist was relaxed. Ordinary editing still
makes no upload or persistence request; heavy tools keep explicit submit consent.

The inherited ordinary **image annotation and visual-signature PNG availability
issue** is a separate follow-up. Phase 5B reproduced it with a **71-byte PNG**:
valid CRCs and 1×1 header, malformed DEFLATE, accepted by Chrome as blank pixels,
then able to stall synchronous pdf-lib/UPNG embedding. Phase 5B added bounded
DEFLATE validation and canonicalization to _watermark_ images, while ordinary
image annotations and imported visual signatures kept the prior native-decode
then direct-embed path. No unsafe completed PDF or redaction-retention bypass was
demonstrated. A dedicated fix should use that exact hostile fixture, require a
bounded typed failure before pdf-lib embedding, verify cancellation and event-
loop responsiveness, preserve valid PNG transparency and signature behavior,
and rerun redaction/ordinary-image regressions. Do not fold a broad decoder
redesign into the font release.

## Verification and release ledger

The recovery preflight reproduced the old successful subset: previous complete
Chromium Phase 5C evidence has **115 result rows, 49 actual PDF outputs, 169
independently rendered/extracted pages, 43 typed safe rejections, zero browser
errors and zero ordinary-workflow uploads**. All 49 PDFs passed qpdf; the
deliberately broken visual/copy counterexamples were rejected. Phase 5B recorded
148 rows and 104 qpdf PASS outputs. Phase 5A redaction invariants passed in the
same accepted browser run. The unchanged local Windows API environment records
187 PASS, 11 FAIL, 8 SKIP because OCRmyPDF/Linux-native fixtures are unavailable;
that local `pnpm test` result is not called green.

The **extended recovery Chromium verifier** has now completed with **122 result
rows, 49 actual PDF outputs, 169 independently rendered/extracted pages, 50
typed safe rejections and zero browser errors/uploads**. There are 50 qpdf-PASS
result rows because one separate, deliberately wrong semantic counterexample is
also structurally valid. This local verifier pass does not replace final Linux
CI or production inspection. The changed verifier must be exercised at its
committed SHA in the full pipeline.

[GitHub Actions run 68](https://github.com/AtharvaisOp/Kagaz/actions/runs/38257585289)
at **exact starting SHA** `8584d534d973b13b095827ec42ed058ffb29303f`
passed both jobs: 798 web + 206 API + 3 sampler = **1,007 PASS / 0 FAIL /
0 SKIP**, with Phase 5A/5B/5C browser, native and container checks. An earlier
run 66 failed at a blank initial browser page before the phase gates; the cause
was not proven. Runs 67 and 68 succeeded with retained startup diagnostics,
without changing assertions or timeouts. The new Phase 5C-R verifier extension
and documentation need **new** exact-head CI evidence; previous run 68 cannot
certify uncommitted recovery work.

| Release gate                                                          | State in this recovery record                                                                              |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Scoped product implementation                                         | Preserved; Devanagari still visibly rejected                                                               |
| Adversarial verifier extension                                        | Local Chromium PASS: 122 rows, 49 actual PDFs, 169 pages, 50 typed rejections, zero browser errors/uploads |
| Frozen install, lint, typecheck, build, format/diff, sampler          | Passed at starting SHA; rerun at recovery head                                                             |
| Phase 5A/5B/5C and native/container gates                             | Passed in run 68 at starting SHA; rerun at recovery head                                                   |
| PR #5 accurately retitled, reviewed and ready                         | Pending                                                                                                    |
| Scoped branch exact-SHA CI                                            | Pending                                                                                                    |
| Merge to `main` and exact-main CI                                     | Pending                                                                                                    |
| Vercel READY at exact main SHA, alias and anonymous browser/PDF proof | Pending                                                                                                    |

The current branch's bundle measurement is the prior phase's: initial main chunk
836.45 kB / 257.09 kB gzip versus 828.64 / 254.66 baseline; lazy fontkit
710.93 / 329.66 kB gzip and separate 569.20 kB Noto TTF. Repeated annotation
and watermark appearances reuse a document font. The research Type 3 output
has **no product bundle cost**, because neither its writer nor its Devanagari
font is shipped. Full embedding remains the validated production choice;
subsetting, aggregate preview-canvas memory and cross-source form-font reuse
remain future work.

## Design and engineering handoff

No recovery research modified the UI. The verified subset continues to follow
`design.md`: dark compact workspace, orange primary actions, cyan visible focus,
responsive toolbar/dialog controls. The original Phase 5C UI implementation
used the required gptTaste skill for restrained focus, loading/error feedback
and reduced-motion polish. Existing desktop, 768/390/360 px, keyboard,
Undo/Redo, Start Over and preview/download checks must remain green in the
recovery verifier. No new motion or frontend design system is proposed.

A future dedicated Devanagari phase must either engineer a bounded Type 3/
logical-scalar writer or prove a maintained browser-compatible font solution.
It must resolve PDF.js joiner copy behavior and test the upstream category fix
on an actual released dependency before relying on it; characterize selection
geometry, fontkit Indic runtime, large-document resource growth and font
licensing. Then integrate the same shaping model with all annotation/watermark/
form/preview/export/snapshot/rotation/redaction paths, proving both native
appearance and logical extraction from real Kagaz downloads. Keep visible
rejections until that full product evidence exists. In parallel, schedule the
focused malformed-PNG availability hardening described above.

## Recovery acceptance checklist

- [x] Existing branch and PR reused; starting SHA and baseline recorded.
- [x] Earlier shaping/mapping failures reproduced and distinguished from the upstream PDF.js issue.
- [x] Occurrence-CID and Type 3 hypotheses produced actual qpdf-valid PDFs.
- [x] Type 3 proof inspected with PDF.js, PDFMiner, pypdf, PDFium and Chromium reference pixels.
- [x] PDF.js joiner loss and missing product integration explicitly block Devanagari enablement.
- [x] Verified Latin/Greek/Cyrillic scope and unsupported-script rejections remain explicit.
- [x] Redaction invariants and inherited ordinary-PNG issue are documented separately.
- [x] Recovery verifier extension has local accepted counts and adversarial extraction evidence.
- [ ] Complete recovery regression envelope, including native/container gates, passes at a committed SHA.
- [ ] Recovery branch final-SHA quality/native/container CI passes.
- [ ] PR #5 accurately describes the narrower release and is ready for review.
- [ ] Scoped release is merged with exact-main CI and anonymous production proof.
- [ ] Original full Phase 5C Devanagari acceptance is complete.
