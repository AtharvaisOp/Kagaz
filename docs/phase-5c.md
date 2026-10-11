# Phase 5C — Unicode typography and embedded document fonts

## Phase status

**PARTIAL relative to the full mission.** The implemented subset covers verified
Latin, accented Latin, Greek and Cyrillic text. Hindi/Marathi Devanagari and RTL
creation remain rejected because the investigated writer alternatives do not
reliably preserve logical extraction. This branch must not be merged or described
as a completed production release under the requested acceptance rules.

No API, native processing, Render, persistence, account, analytics or upload
architecture was added. Ordinary editing, font selection, Download and Extract
remain browser-local. The existing heavy-tool submission consent remains explicit.

## Starting baseline and environment

The checkout started clean on `main`, at
`79c79c2736baddda3b391934a97e98c9bc5bc796`, matching remote `origin/main`.
The remote is `https://github.com/AtharvaisOp/Kagaz.git`. No open pull requests
were found. GitHub Actions run 65, ID `38042170849`, succeeded at that SHA.
Its Linux baseline is 724 web tests, 206 API tests and 3 sampler tests: 933 passes.
Work uses `codex/phase-5c-unicode-fonts`.

The baseline was reproduced from a Git archive of that exact commit in an
external temporary directory, preserving the user's checkout. Local Windows
baseline lint, typecheck, build, format and sampler checks passed. Web tests were
724 PASS, 0 FAIL, 0 SKIP. Without configured native tools the first API run was
101 PASS, 97 FAIL, 8 SKIP; those results are not represented as application bugs.
Repeating the unchanged API baseline with qpdf, Ghostscript and the existing
Python environment produced **187 PASS, 11 FAIL, 8 SKIP**. The same native
environment on the changed branch produces the same result. The 11 failures
are OCR integration checks; the Windows host lacks the required OCRmyPDF stack.
The 8 skips include Linux-specific native Office/security checks.

The successful package-manager checks use pinned pnpm 12.3.4 and Node 22.17.1.
The initial Windows pnpm wrapper resolved a different executable and was unusable
for Turbo. A frozen install attempted while Vite held native dependency locks
failed and temporarily interrupted checks; stopping this task's Vite process and
restoring dependencies completed `pnpm install --frozen-lockfile` successfully.
Interrupted checks were discarded and rerun. qpdf is 12.4.2; real Ghostscript
and Python are used for available native regressions. No dependency lockfile
changes were introduced by the restoration.

## Implemented and file responsibilities

| Path under `apps/web/src` unless stated                                                             | Responsibility                                                                                                           |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `lib/fonts`                                                                                         | Typed catalog, exact asset validation, bounded loading, font metrics/runs, coverage, Unicode policy and support feedback |
| `assets/fonts`                                                                                      | Unmodified Noto Sans Regular static TTF and original OFL notice                                                          |
| `features/pdf-annotations/model`, `hooks/usePdfAnnotations.ts`                                      | Font IDs, line-height defaults, sessions, validation and existing history integration                                    |
| `features/pdf-annotations/components/AnnotationToolbar.tsx`                                         | Accessible native font and line-height controls, selected state and support errors                                       |
| `features/pdf-annotations/rendering/AnnotationTextNode.tsx`, `textPreviewRaster.ts`                 | Debounced, bounded, source-free committed custom-text PDF preview and awaited cleanup                                    |
| `features/pdf-annotations/rendering/TextEditorOverlay.tsx`                                          | Same bundled browser font, keyboard editing, input limits and toolbar focus transition                                   |
| `lib/pdf-export/annotations`                                                                        | Prepared fonts, custom advances/baselines, grapheme wrapping and safe box bounds                                         |
| `features/pdf-watermarks`, `lib/pdf-export/watermarks/renderWatermark.ts`                           | Font selection, copied configuration, font-specific ink/advance fitting and shared preview/export drawing                |
| `lib/pdf-export/forms/prepareFormSource.ts`                                                         | Unicode appearance font choice, field safety preservation and actual glyph geometry checks                               |
| `features/pdf-workspace/components/thumbnailAnnotations.ts`, `ThumbnailCanvas.tsx`                  | Shared custom-text layout and actual font advances in lazy Canvas thumbnails                                             |
| `lib/pdf-export/exportWorkspace.ts`, `types.ts`, `features/pdf-workspace/hooks/usePdfExport.ts`     | Click-time deep text/form/image/font snapshots and stable source records                                                 |
| `lib/pdf-export/redactions/finalizeRedactions.ts`                                                   | Snapshot font bytes in throwaway donor and sanitized-only foreground composition                                         |
| root `scripts/verify-phase5c.mjs`, `.github/workflows/ci.yml`                                       | Actual PDF verification, controls, browser behavior and additional CI gate                                               |
| root `scripts/verify-phase3g.mjs`, `verify-phase4a.mjs`, `verify-phase4b.mjs`, `verify-phase5b.mjs` | Updated exact CJK failure copy and explicit classic font fixture; existing security assertions retained                  |
| root `docs/phase5c-font-research.md`                                                                | Primary sources, font identities, licenses and actual complex-script experiments                                         |

Existing page virtualization, lazy source rendering and original image/signature
paths remain in place. Font work does not run a PDF through the API.

## Font strategy, identity and licensing

`@pdf-lib/fontkit` **1.1.1** is the sole new runtime dependency. It is the
documented custom-font companion for existing pdf-lib 1.17.1. PDF.js remains
the renderer and independent extraction oracle. No PDF engine replacement was
justified for the verified independent-glyph subset.

The selectable fonts are `helvetica` and `noto-sans`. Helvetica retains legacy
behavior. Noto Sans Regular is one static TTF: **569,208 bytes**, SHA-256
`b85c38ecea8a7cfb39c24e395a4007474fa5a4fc864f6ee33309eb4948d232d5`.
The original SIL Open Font License and copyright notice accompany it.
Sources and permission references are in the [font research record](phase5c-font-research.md).

The documented custom-font loading scope is this bundled font only. Optional
user-uploaded TTF/OTF support was omitted. This boundary checks static TrueType
signature, table count and bounds, embedding flags, unsupported variable-font
structures, actual decompressed byte length and exact digest before parsing.
The stream has a fixed allocation limit and a 15-second deadline; missing,
truncated, oversized, changed or disallowed bytes fail with typed errors.
This is integrity checking for a fixed trusted asset, not a general malicious-font
sandbox. No OS-installed font or external font CDN is needed for PDF output.

## Script support matrix

| Script/content                                               | Created text annotations and watermarks | Regenerated safe form appearances                             | Evidence/policy                                                                       |
| ------------------------------------------------------------ | --------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Basic Latin                                                  | Verified Helvetica/Noto                 | Verified                                                      | Real extraction, font dictionaries and rendered glyph checks                          |
| Accented and Latin Extended                                  | Noto, subject to exact glyph coverage   | Noto when Helvetica cannot encode                             | `Été Ångström Łódź café`, form equivalents                                            |
| Greek                                                        | Noto, subject to glyph coverage         | Noto                                                          | `Ελληνικά Καλημέρα`, `Αθήνα`                                                          |
| Cyrillic                                                     | Noto, subject to glyph coverage         | Noto                                                          | `Привет мир Україна`, `Москва`                                                        |
| Decomposed accents that compose under NFC                    | Verified canonical equivalent           | Text values normalize; choice labels requiring rewrite reject | `Cafe\u0301 A\u030a` extracts as `Café Å`                                             |
| Residual combining marks                                     | Rejected visibly                        | Rejected                                                      | Required mark positioning is outside supported writer semantics                       |
| Hindi/Marathi Devanagari                                     | Rejected visibly                        | Rejected                                                      | Thirteen actual investigation strings, five writer alternatives fail semantic quality |
| Arabic/Hebrew RTL                                            | Rejected visibly                        | Rejected                                                      | Joining/bidi writer and logical extraction not implemented                            |
| Bengali/Tamil                                                | Rejected visibly                        | Rejected                                                      | No verified shaping path                                                              |
| CJK/emoji                                                    | Rejected visibly                        | Rejected                                                      | No suitable supported bundled glyph path                                              |
| Joiners, directional controls, private/unassigned characters | Rejected                                | Rejected                                                      | Outside the independent-glyph policy                                                  |
| Other scripts, variable/color/uploaded fonts                 | Not supported or offered                | Not supported                                                 | No broader language/font claim                                                        |

Safe unchanged source appearances are preserved under existing form flattening
rules; this does not imply those source scripts can be edited or regenerated.
NFC export uses canonical equivalence, not byte-for-byte preservation of decomposed
input. The policy validates every glyph and the actual resulting fontkit run;
there is no replacement character, silent Helvetica fallback or `.notdef` output.
Viewer extraction can additionally normalize compatibility ligatures and whitespace:
default PDF.js expands `ﬁ` to `fi` and copies NBSP as an ordinary space. The original
Unicode code points remain in the embedded ToUnicode map; disabling PDF.js text
normalization preserves the tested ligatures, but still normalizes NBSP. Searchable
and copyable therefore does not promise byte- or codepoint-exact viewer output for
every admitted separator or compatibility character.

## Shaping findings and alternatives

Installed pdf-lib custom embedding consumes fontkit glyph IDs, but its ordinary
text operators ignore glyph advances/offsets returned by shaping. Full-font
ToUnicode construction can omit substituted glyphs; subset mappings alone do
not solve visual-order versus logical-order text.

The research used official Noto Sans Devanagari, all eight requested Hindi/Marathi
strings, independent vowels, matras, virama/conjuncts, joiners, numbers and mixed
Latin. Five real PDFs were rendered/extracted in Chromium PDF.js and checked
with qpdf. Explicit per-glyph positions greatly improved the native-shaped
reference comparison, but extraction still failed. Default full embedding turned
`विद्यार्थी` into `ɟवȘाथƹ`; a subset alternative produced reordered matras,
including `हिन्दी` as `िहन्दी`. A shaped cmap plus `ActualText` also failed
ordinary PDF.js logical extraction. All five PDFs passed qpdf, showing that
structural success alone cannot establish typography correctness.

The installed Indic shaper also required a research-only external regenerator
runtime shim. No shim, Devanagari selectable font or speculative shaping dependency
was shipped. The [research record](phase5c-font-research.md) contains exact hashes,
primary references, visual counts and the future logical-CID writer requirements.

## Metrics, layout and preview

The shared font boundary defines identity/asset/capabilities, canonical logical
runs, glyph IDs/code points, scaled advances/offsets, normalized ascent/descent/
line gap, emitted advance width and real glyph ink bounds. Font units, raw PDF
user units, physical watermark points, viewport pixels and UserUnit conversion
remain explicit. Optional shaping/kerning/ligature features are disabled for
Noto's verified independent glyphs, and the actual run must match that policy.

Annotation wrapping normalizes CR/LF and uses `Intl.Segmenter` graphemes.
Browsers lacking Segmenter fail visibly. Incremental advances avoid repeated
measurement of growing prefixes; document text values are capped at 10,000 UTF-16
units. Classic Helvetica keeps its historic annotation layout and isolated AFM
compatibility envelope. Generic custom-font geometry uses the actual metrics.
Custom-font overflow fails with guidance to enlarge the box or reduce font size.

Committed Noto annotation preview creates an isolated text-box PDF containing no
source document resources, then renders that PDF.js appearance. Watermarks retain
their existing source-free preview strategy and use the same font-specific drawing
path as export. Each appearance job is debounced 90 ms and uses the existing
serialized preview queue. Text canvases cap at DPR 2, 4 megapixels and 4,096 pixels
per side. Obsolete tasks/canvases are cancelled/cleared and PDF.js cleanup is awaited.
Position-only annotation edits reuse the local appearance.

The active textarea uses the exact bundled FontFace, disables kerning/ligatures,
and retains keyboard editing; native textarea line boxes are approximate. Committed
preview is the export-faithful view. Thumbnails use shared layout/baselines and
per-glyph advances with the same browser font; form thumbnails retain their prior
approximate preview scope. No exact native browser peak-memory claim is made.
Watermark thumbnails retain the existing source-only behavior; watermark parity
is verified in the dialog, main editor and downloaded PDF.

## Forms and immutable lifecycle

The current AcroForm types remain supported: text/multiline, choices, checkbox
and radio. A source's regenerated text chooses Noto only if Helvetica cannot
encode required appearance text. Clean native source appearances and read-only
values remain intact. Unicode text validates before applying; choice canonical
values remain mapped to their verified source display labels. Decomposed choice
labels that would require rewriting source semantics are rejected.

New Unicode widget appearances use actual glyph ink and the same pdf-lib layout
provider geometry. A fitting saved size remains; a clipping font substitution
can shrink within bounded auto-fit geometry, otherwise export fails closed.
The check uses the provider's final padded clip and sorted option order, including
last-row descenders. Sizes decrease only to the provider's 4 pt floor. A left-aligned
negative-bearing glyph can remain outside the clip at every size; that widget is
rejected rather than exporting missing ink. This is a provider limitation, even
when the widget has ample unused space to its right.
No XFA, signed PDF, password, push-button, encrypted editing or ambiguous widget
ownership rules were broadened. Flattened outputs have no interactive widgets.

Before any asynchronous export read, pages/order, source records, annotations
including nested geometry/color, committed forms, watermark configuration,
redactions and image/font bytes are copied. Later text/font edits, source/asset
replacement, watermark removal and Start Over cannot modify that private snapshot.
An explicitly supplied snapshot missing its selected font fails; it does not
fetch a replacement midway through export. Font resources are reused through a
document-scoped WeakMap. There is no mutable user font registry or history-owned
font asset; history stores fixed font IDs. One immutable bundled-byte promise,
one parsed trusted font and one FontFace may live for the app lifetime. Cancelled
callers release their work without invalidating another caller's fixed resource.
There are no font object URLs, font persistence or document text logs/requests.

## Redaction security and inherited image debt

The Phase 5A/5B retention policy and bitmap limits are unchanged. Custom text
fonts participate only in the throwaway current-appearance donor before pixel
sanitization, or in trusted foreground composition over already-sanitized pixels.
Final redacted pages are fresh image-only pages: no donor font dictionaries,
original streams, source form values, annotations, OCR text layers or source
images are reattached. Even deliberately new watermark text on a redacted page
is rasterized; it is not advertised as searchable text.

The old all-object inspection still rejects ambiguous/shared sensitive resources,
including conservative mixed-document collisions. Such cases must fail; extracting
affected pages can be an alternative. No security allowlist was relaxed.
The new verifier also records an explicit mixed-CID negative case: a redacted
Devanagari source and a distinct ordinary page with newly embedded Noto foreground
collide on retained font fingerprints, including common `Adobe`/`Identity` metadata.
The export rejects with `redaction-unsafe-retention`. A separate Devanagari-only
redaction and a mixed Helvetica-source/Unicode-foreground case succeed. This
conservative limitation prevents claiming every Unicode mixed-source combination.

Ordinary image annotation/visual signature PNG embedding still has the inherited
malformed-PNG availability risk recorded in Phase 5B. This font phase does not
change or broaden that image decoder boundary. The strict watermark image checks,
native canonicalization and original hostile-input/black-pixel counterexamples
remain enforced. No claim is made that ordinary-image hardening is fixed.

## Validation and independent PDF evidence

The final evidence record and acceptance checklist below distinguish supported
subset checks from the unmet full release criteria. Local logs and generated
artifacts are kept outside the repository under `%LOCALAPPDATA%/Kagaz` and
`%TEMP%/kagaz-phase5c`, not bundled into the web application.

Completed repository gates: frozen install, lint, typecheck, build, format and
diff checks; sampler 3 PASS. The complete web-only run records
**798 PASS, 0 FAIL, 0 SKIP**, across 77 files. Concurrent workspace test runs
hit two 5-second cold-start test timeouts; the web-only run passes without
changing timeout thresholds or assertions. The final sequential workspace result
adds an existing 5-second Office archive fixture timeout under load; it reports
186 API passes, 12 failures and 8 skips. The quiet, API-only final run records
**187 PASS, 11 FAIL, 8 SKIP**, exactly matching the unchanged native baseline.
The local `pnpm test` command therefore does not pass; OCR/native limitations
are recorded above, and no thresholds, skips or assertions were changed.
Linux CI run 66 independently passed the quality job at
`ec7989fed6a68b5a3f035896b1f523d2f3ad8f02`: **798 web PASS, 206 API PASS
and 3 sampler PASS; 1,007 PASS, 0 FAIL, 0 SKIP**. Lint, typecheck, build,
format and diff checks also passed there.

Existing real Chromium scripts Phase 3F, Phase 3G, Phase 3G lifecycle, Phase 4A
and Phase 5A pass. Phase 4B reaches explicit OCR submission and then fails
`ocr-failed` on this Windows environment. Phase 4C reaches explicit DOCX
submission and then fails `conversion-failed` without Linux LibreOffice/seccomp.
No container suite can run locally without Docker. All Linux native/container
CI gates remain, and the new Phase 5C verifier is appended after Phase 5B.

Run 66's production container passed Office conversion/security (8 accepted
outputs plus attack rejections), compression, constrained-resource/cancellation/
shutdown auditing (13 result entries) and native OCR (6 accepted outputs). It
then failed at the first Phase 4A browser fixture: `locator.setInputFiles` could
not find the PDF file input after the existing 15-second timeout. The saved
screenshot is entirely blank, and uploads/results/browser page-errors are empty.
API health and the initial frontend HTTP probe had already succeeded; that does
not prove transformed frontend modules loaded. Phase 5A/5B/5C CI steps were skipped.
The old workflow did not retain `/tmp/kagaz-web.log` or failed module/console
requests, so the log alone cannot establish the startup cause. The follow-up
adds those diagnostics without changing any assertion or timeout.

The complete frozen Phase 5B run passes: **148 result rows, 104 qpdf PASS checks,
zero browser errors**. Only the two deliberately consented compression/OCR
submissions make POST requests; ordinary editor, watermark and download flows
make none. Its final report is
`%LOCALAPPDATA%/Kagaz/phase5c-final/phase5b/phase5b-browser.json`.
Earlier interrupted/HMR-affected candidate runs are excluded from acceptance.

The complete frozen Phase 5C run passes with actual Node exit 0 and
`completed: true`: **115 result rows, 49 inspected PDF outputs (47 application
exports and 2 standalone embedding comparisons), 169 independently rendered/
extracted pages, 43 typed safe rejections, zero browser errors, zero POSTs and
no persistence**. All 49 outputs pass qpdf. Five independent native reference
groups have a 1.0 ink-match fraction and identical bounds; all five preview
comparisons pass the documented tolerance. Four sanitized raster pages prove
original glyphs/font/AP resources are absent, while intended foreground remains.
Both deliberately corrupt semantic/visual counterexamples are rejected despite
being structurally valid PDFs. The final report is
`%LOCALAPPDATA%/Kagaz/phase5c-acceptance-final2/phase5c/phase5c-browser.json`;
`acceptance-summary.json` beside that directory provides concise derived counts.
The prior failed run stopped in test-fixture construction before an application
export; its corrected `/DA` setup, parser-tab origin and Unicode fixture save
behavior do not relax any output assertions.

The new verifier independently examines saved/downloaded bytes using PDF.js
extraction/rendering, native-shaped browser reference pixels, font dictionary
inspection, embedded font digest, ToUnicode and qpdf. It deliberately rejects
two structurally valid counterexamples: visible correct glyphs with wrong copy
text, and correct extracted text with visibly wrong glyph output. Actual
snapshot/cancellation/history, unsupported script and security assertions are
retained, including finalized Unicode redaction and source font resources.
The independent native-font oracle requires at least 85% of reference ink samples
to match within two rendered pixels, with width/height differences at most five
pixels at 2x rendering. UI preview/export bounds use a 2.5% page-extent tolerance;
these are geometry/rendering tolerances, not permission for incorrect extracted
letters. Tested ordinary strings must extract as their expected NFC text.

## Performance and bundle budget

The baseline initial main chunk is 828.64 kB / 254.66 kB gzip. The measured
final build is 836.45 kB / 257.09 kB gzip: +7.81 kB / +2.43 kB gzip.
Fontkit is lazy: 710.93 kB / 329.66 kB gzip; pdfFont is 5.30 kB / 2.30 kB gzip,
fontAssets 3.85 kB / 1.69 kB gzip. The 569.20 kB TTF is a separate lazy asset.
Ordinary PDF opening does not require the unused custom parser/font asset.
The pre-existing main-chunk size and ineffective nativeImage dynamic import
warnings remain; the new lazy fontkit chunk also crosses the 700 kB warning.
Neither warning is hidden by raising thresholds.

Full versus subset embedding was investigated on real supported text. The
final full output was 302,565 bytes; subset output 5,821 bytes, with both
rendering and extracting correctly for that one fixture. Full embedding is
retained for the broader verified path, preserving the exact trusted font and
stable one-to-one mappings. Annotation/watermark composition reuses one font,
costing about 300 kB per output rather than per annotation/page. Regenerated form
appearances are prepared in private source documents before page copying, so
multiple form sources can retain separate font resources. Cross-source form font
deduplication remains debt. A narrow subset fixture does not certify all glyph reuse,
appearance regeneration and extraction cases; general subsetting remains debt.

Font buffers and canvas allocations have explicit bounds; JS heap samples omit
native font caches, worker memory, decoder allocations and GC timing. Never use
these observations to raise the Phase 5A bitmap limits. Detailed measured export
and preview latency is in the persisted verifier report.
The dozens-of-annotations fixture measures export and font reuse. It does not
establish peak native memory for dozens of simultaneously visible text previews.
Each preview has a canvas cap, but retained visible previews have no shared
aggregate canvas budget yet; profiling and an appropriate aggregate policy belong
in the Phase 5D follow-up.

Observed local Chromium timings from the accepted run (not a benchmark):

| Fixture                                         | Time       | Output bytes |
| ----------------------------------------------- | ---------- | ------------ |
| First Noto application export                   | 307.9 ms   | 303,025      |
| Warm single Latin annotation                    | 67.9 ms    | 303,043      |
| Watermark across 10 pages                       | 144.2 ms   | 307,160      |
| Watermark across 100 pages, one font            | 204.1 ms   | 349,755      |
| 40 annotations over 10 pages, one font          | 125.4 ms   | 308,771      |
| Unicode form appearance and flatten             | 99.9 ms    | 303,337      |
| Devanagari donor sanitization + foreground      | 1,366.4 ms | 8,234        |
| Unicode source + annotation sanitization        | 1,493.7 ms | 8,235        |
| UI annotation export/download                   | 431 ms     | 303,049      |
| UI watermark export/download                    | 481 ms     | 303,058      |
| Annotation preview settled at 120% zoom         | 1,112 ms   | —            |
| Cold Noto selection to settled watermark dialog | 973.2 ms   | —            |
| Warm Apply to settled main watermark preview    | 951.0 ms   | —            |

The 100-page JS heap sample changes from 171.7 MB to 224.1 MB; that transient
52.4 MB difference is not retained memory or a peak-allocation measurement.

A separate fresh Chrome 155 context measured asset fetch/validation/snapshot at
11.6 ms, FontFace load/add at 1.7 ms, the pdfFont module at 101.4 ms and first
font preparation at 138.2 ms (lazy parser import, hash, parsing and embedding
setup; PDF save/compression excluded). Warm snapshot/face calls were 0.1 ms,
and same-document preparation reused the existing font. Opening the app produced
zero font GETs/faces; repeated selection produced exactly one font GET and one
loaded face, with zero non-GET requests. This is one local development sample:
client caches were fresh, while Vite compilation, OS and server caches could be
warm. Evidence: `%LOCALAPPDATA%/Kagaz/phase5c-font-load-timing/font-load-timing.json`.

The separate watermark preview sample uses a fresh Chrome 155 process/context,
1440 × 1100 viewport and DPR 2. Valid `ÉΛЖ watermark` text was entered before
timing Noto selection. Settlement requires the ready marker, actual green glyph
pixels and two animation frames; Apply then reuses the warmed font/parser bytes.
The timings include Playwright dispatch, polling, the 90 ms debounce, queued PDF
generation and PDF.js worker/rendering overhead. One font GET, zero non-GET
requests and zero browser errors were observed. This source-free PDF.js path
does not create a browser FontFace. This is a single development UI sample,
with potentially warm Vite/OS/server caches, not a production benchmark.
Evidence and inspected screenshots are under
`%LOCALAPPDATA%/Kagaz/phase5c-watermark-preview-timing`.

## Design compliance and accessibility

`design.md` was read fully and remains authoritative: dark surfaces, compact
toolbar, orange primary actions, cyan focus and existing responsive layout.
The required `gpt-taste` skill was successfully used for restrained interaction
execution, native focus/hover behavior, loading/error feedback and reduced motion.
Its landing-page/RNG/GSAP redesign suggestions were inapplicable to this phase
and subordinate to the existing product specification. No feature-wide redesign
or new motion dependency was introduced.

Actual Chromium checks cover desktop, 768, 390 and 360 px, DPR 2, reduced motion,
labelled font selectors, keyboard editing, dialog Escape/focus restoration,
Undo/Redo, Start Over, and preview/download parity. Screenshots were also visually
inspected; font controls fit the existing dialog/toolbar language. Exact tolerances
and final measurements are retained by the verifier, rather than inferred from
screenshots alone.

## Git, CI and deployment boundary

The phase remains on `codex/phase-5c-unicode-fonts`. No merge or production
deployment has been performed: the full mission's Devanagari extraction criterion
is unmet. `main` is still the starting SHA when last checked. Publishing a draft
PR for this verified subset is reviewable progress, not permission to merge it.
Implementation commit: `fba795c4c00e832c4a286224049d7ce1f5d6c104`,
`feat: add Unicode font embedding and shared text layout`.
Verification/report commit: `ec7989fed6a68b5a3f035896b1f523d2f3ad8f02`,
`test: verify Unicode PDFs and document phase 5c limits`.
Both commits were pushed successfully. The attached [draft PR #5](https://github.com/AtharvaisOp/Kagaz/pull/5)
targets `main`. [GitHub Actions run 66](https://github.com/AtharvaisOp/Kagaz/actions/runs/38153558094),
ID `38153558094`, tested exact head `ec7989fed6a68b5a3f035896b1f523d2f3ad8f02`:
quality **PASS**, production-container **FAIL** at the early Phase 4A startup
described above. Native audits passed; later redaction/watermark/Unicode gates
were skipped. The run's 18-file artifact is preserved externally under
`%LOCALAPPDATA%/Kagaz/phase5c-ci66`; it is not evidence of a completed branch CI run.
Exact follow-up branch SHA and CI outcomes must be checked after publication;
neither local results nor the passing quality job imply final branch CI success.
No Render configuration or API deployment changes are required.

## Full acceptance checklist

- [x] Valid custom font loads safely within the documented bundled-static-TTF scope.
- [x] Supported fonts embed as actual PDF font resources with extraction mappings.
- [x] Text annotations use chosen fonts and preserve existing style controls/history.
- [x] Text watermarks use chosen fonts and actual font-specific placement metrics.
- [x] Supported form appearance handling is implemented and precisely scoped.
- [x] Font-specific metrics replace generic Helvetica assumptions; classic behavior is isolated.
- [x] Committed preview and export use shared drawing/layout with documented tolerances.
- [x] Verified Latin, Latin Extended, Greek and Cyrillic render and extract correctly.
- [x] Unsupported scripts/glyphs fail visibly without fallback or partial downloads.
- [x] Supported ordinary-page text is searchable/selectable/copyable under PDF.js extraction policy.
- [x] Devanagari shaping was meaningfully investigated and no broken support is claimed.
- [ ] Hindi/Marathi Devanagari logical extraction and correct shaping are delivered.
- [x] Font assets remain browser-local with no third-party document font service.
- [x] Font lifecycle, history and immutable byte/configuration snapshots are covered.
- [x] Changed, malformed, oversized and missing bundled assets are rejected within bounds.
- [x] Independent inspection uses extraction, rendered glyphs, font objects and qpdf.
- [x] Redaction retains sanitized-only construction and unchanged all-object checks.
- [x] No new upload or persistence is introduced; heavy-tool consent remains explicit.
- [x] Complete Phase 5A/5B/5C accepted verifier evidence is recorded.
- [x] Accessibility, mobile layout and reduced motion are exercised in real Chromium.
- [ ] All final quality/native/container gates pass at the branch release SHA.
- [ ] Exact final-SHA GitHub Actions success is recorded.
- [ ] Final deployment SHA and anonymous production Unicode behavior are verified.
- [x] Documentation accurately scopes unsupported scripts and technical debt.

## Next phase / engineer handoff

Do not put Devanagari in the menu by adding font bytes alone. It requires an
occurrence-aware logical CID/ToUnicode writer, real glyph positioning and cluster
mapping, dependable extraction in PDF.js and another parser, mixed-script fonts,
and full form/preview/redaction tests. ActualText alone did not solve the tested
path. Keep the unsupported-script errors until that evidence exists.

Phase 5D should profile browser memory and large-PDF performance: repeated
source-free preview document/worker setup, font parsing/snapshot copies, visible
thumbnail updates, 100-page exports, native Canvas allocations and GC behavior.
Evaluate verified subsetting and parser/appearance reuse without weakening text
semantics or cancellation. Keep all original redaction limits and counterexamples.
Ordinary annotation/visual-signature PNG hardening needs a focused subsequent
change with a reproduced hostile fixture and proven bounded handling; it is not
resolved by this phase.
