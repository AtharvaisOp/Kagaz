# Phase 5B — browser-local text and image watermarking

## Starting state and baseline

The phase began on clean `main` at
`0b845d4756e603d38882024a18c297bb12223952`. The requested status, branch, HEAD,
remotes and twenty-entry log were inspected before edits. Fetch independently
confirmed the same `origin/main`. [CI run 61](https://github.com/AtharvaisOp/Kagaz/actions/runs/37900534835)
was SUCCESS at that exact SHA. Vercel production deployment
`dpl_HJdi3sTQbzfj6TRqBoxKaDpU5fkG` was READY at the same baseline SHA.

Work uses `codex/phase-5b-watermarking`. No unrelated user changes were present,
and no destructive reset or force push was used.

The investigation read AGENTS.md, design.md, README and the complete Phase
3F/3G/4A/4B/4C/4D/5A records. Actual code review covered App, annotation/image
assets, redaction state and finalization, workspace identities, viewer transforms,
export snapshots, forms/signature safety, unified history, CI and browser scripts.
Documentation did not substitute for inspecting the implementation.

The pristine baseline ran before application changes with pinned pnpm 12.3.4:

| Command                                              | Actual baseline result                                                                                                            |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile`                     | Passed after preserving generated modules outside the checkout and recovering an initial OneDrive access-denied migration failure |
| `pnpm lint`                                          | Passed                                                                                                                            |
| `pnpm typecheck`                                     | Passed                                                                                                                            |
| `pnpm test`                                          | Failed locally: API 102 passed, 96 failed, 8 skipped out of 206 with native tools absent from PATH                                |
| API rerun with existing external native/Python paths | 187 passed, 11 failed, 8 skipped; OCRmyPDF unavailable, Linux-only tests skipped                                                  |
| Web baseline                                         | Passed: 564 tests in 65 files                                                                                                     |
| `node --test scripts/workspace-sample.test.mjs`      | Passed: 3 tests                                                                                                                   |
| `pnpm build`                                         | Passed, existing large frontend chunk warning retained                                                                            |
| `pnpm format:check`                                  | Passed                                                                                                                            |
| `git diff --check`                                   | Passed                                                                                                                            |

The suite baseline is **773 tests: 206 API + 564 web + 3 sampler**. A native
tool failure is not a pass. Docker is unavailable on the local Windows host;
Linux CI remains authoritative for the complete native/container envelope.
The generated module backup is outside the repository; manifests and lockfile
were not changed by setup recovery.

## Architecture investigation and decisions

An annotation-based batch would expand a single configuration into many independent
page marks, complicating edit-all behavior, targeting added pages and one-operation
history. The ordinary annotation union also only carries cardinal oriented boxes.
A small dedicated single-watermark domain better represents one configuration and
its target set without adding another annotation engine or entering the destructive
redaction domain.

Watermark geometry and appearance reuse pdf-lib, bundled PDF.js and the existing
image registry implementation. The export renderer is shared with preview so
Helvetica metrics, rotation, sizing and placement have one authoritative path.
No custom fonts, second renderer, UI library or new dependency are introduced.

The relevant public primitives were checked against the [pdf-lib page API](https://pdf-lib.js.org/docs/api/classes/pdfpage),
[font API](https://pdf-lib.js.org/docs/api/classes/pdffont) and
[PDF.js page API](https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib-PDFPageProxy.html),
alongside the installed sources. The chosen composition is an engineering
decision based on the existing Kagaz boundaries, not a library security claim.

## Data model and targeting

One text/image `WatermarkConfig` carries a stable ID, opacity, arbitrary rotation,
bounded scale, position/custom fractions and a target. Text adds content,
Helvetica font size and RGB color; image adds an existing-style registry asset ID.
Runtime Files, decoded images and object URLs remain outside serializable state.

`all` is dynamic: it includes pages added later. Current/selected/range scopes
resolve to unique `WorkspacePageId` values at Apply. Later reorder does not
reinterpret page numbers. Deletion prunes obsolete IDs from present and history;
an empty explicit target removes that configuration. Duplicate source Files have
independent workspace identities. Extract filters applicability against the
requested page snapshot.

The configuration dialog has an uncommitted draft. Preview changes never enter
export or history. Apply/edit/target change/removal each create one logical
watermark transaction in the existing editor chronology. Cancel restores the
committed appearance. Asset reachability covers draft, past, present and future;
abandoned redo resources are released. Reset invalidates late image work.
Watermark history retains at most 100 transitions. Exact transaction pruning
removes collapsed/deleted/capped watermark steps from the shared timeline without
discarding surviving form, annotation or redaction transactions.

## Geometry and appearance

Placement operates in the final oriented visible MediaBox/CropBox intersection,
then maps the result back to raw PDF user space. It accounts for UserUnit,
intrinsic rotation and workspace rotation once. Custom X/Y fractions refer to
the available span after fitting the rotated axis-aligned bounding box, using
left/bottom as zero and right/top as one. Center and named corners retain their
meaning after page rotation.

The default is centered gray DRAFT text with moderate opacity and diagonal
rotation. Text uses the same Standard Helvetica export font as existing
annotations. Unsupported glyphs fail visibly; no missing-character replacement
or custom-font subsystem is added. The single line is bounded to 200 characters.
Rotated marks fit within 5% page margins; images retain their aspect ratio.
Authoritative geometry never uses display zoom, CSS pixels or screen DPR.

The installed pdf-lib implementation emits an unkerned text operator, while its
whole-string width helper includes kerning. Fitting therefore sums individual
glyph advances. Conservative fixed Helvetica AFM bounds include accented capitals,
descenders and symmetric side bearings. This avoids clipping repeated AV pairs or
supported accented text when a long or rotated mark is fitted into a corner.

Font size is 8–144 physical points, scale is 5–100%, opacity is 0–100% and rotation
is −180–180 degrees. Physical page sides are limited to 14,400 points for watermark
placement. Preview allocations independently cap each bitmap at 4 megapixels and
4,096 pixels per side, with display DPR capped at two. Preview changes are debounced
for 90 milliseconds. A shared cancellation-aware queue allows one expensive
preview job at a time across the dialog and nearby pages. Blob reads, native
decoding and worker creation start only after debounce and slot acquisition;
obsolete queued jobs do no work. The slot remains occupied until worker cleanup
finishes. Completed PDF.js workers are released while their canvas appearance
remains visible.

## Image validation and asset lifecycle

Each watermark image is limited to 10 MiB, 8,192 pixels per side and 16 megapixels.
The watermark registry reuses the existing asset implementation and separately
bounds reachable image history to 32 megapixels and 30 MiB. Reachability includes
past, present, future and the draft; an export captures immutable Blob references
before registry cleanup can release an asset.

Preflight inspects the complete bounded PNG chunk sequence and CRCs before a
decoder can allocate pixels. It rejects duplicate headers, animated PNG frames,
invalid encoding/palette/transparency, unsupported critical chunks and trailing
content. Checking only the first IHDR was rejected because the installed PNG
decoder reads later headers and APNG frames too. JPEG preflight checks frame
headers, dimensions and the existing EXIF orientation policy. Browser decoding
and pdf-lib embedding must agree with preflight dimensions. Unsupported encodings
produce an error without changing the committed watermark.
The complete JPEG marker sequence is checked across entropy/restart/progressive
scans; additional frame headers, duplicate/post-scan EXIF and trailing data are
rejected before native decoding. Supported JPEG EXIF orientation is one unique
pre-scan default orientation record.

A separate adversarial review reproduced a synchronous pdf-lib/UPNG stall using
a 71-byte PNG with valid CRCs and a 1×1 header but malformed DEFLATE data. Chrome
accepted the same input as blank pixels, so native image decoding alone was not
sufficient validation. PNG IDAT data now passes the browser's native
`DecompressionStream('deflate')` with exact bounded scanline lengths and filter
validation, including Adam7 passes, before decoding. Input is streamed in small
chunks; output is inspected without retention, with cancellation and a deadline.
The decoded bounded Canvas appearance is then re-encoded as canonical PNG,
preserving alpha and stripping ancillary metadata. Only that trusted encoding
reaches pdf-lib's synchronous PNG decoder. JPEGs require successful native decode
and matching dimensions. A private export-scoped prepared-source cache retains
its own byte copy so callers cannot mutate the validated bytes.

Selection stores the canonical PNG Blob through the existing asset registry.
Aggregate budgets run before native pixel allocation and again against encoded
size. Native image URLs, temporary Canvas pixels and listeners are released on
success, failure and cancellation. Browsers without the required native stream
or Canvas APIs fail with a clear image error.

PNG alpha is preserved on ordinary pages. Reconstructed redacted pages are
opaque sanitized rasters. The second redaction composition also retains Phase
5A's unchanged reachable-image aggregate budget before rendering. Raw watermark
assets are embedded in the final document only when an ordinary targeted page
needs them; an entirely reconstructed export does not serialize an unused raw
watermark image.

Preview uses a transparent watermark-only PDF generated by the same drawing
path and locally rendered with PDF.js. It remains lazy and limited to rendered
pages, with cancellation and explicit pixel bounds. The screen preview is
subject to PDF.js antialiasing and display scaling; independent exported-file
inspection remains the authority.

## Export integration and redaction security compatibility

Export captures selected pages, source Files, committed forms/annotations,
annotation Blobs, redaction boxes, committed watermark configuration and watermark
Blob before asynchronous reads. Direct export also copies the watermark bytes.
Later editing or asset cleanup cannot replace an in-progress snapshot. Existing
abort/generation handling prevents stale downloads and partial-success output.

Layer order on ordinary pages is source, flattened filled forms, ordinary
annotations/visual signatures, foreground watermark, then final rotation.
Source text and vectors retain the existing copy path.

On affected pages the existing throwaway donor appearance is composed and
sanitized first. A second throwaway appearance contains **only the sanitized
raster and trusted watermark resources**. It is rendered under the existing
144 DPI/16 MP policy and embedded into the final fresh page. No donor content,
source text operator or original image object is used for foreground watermarking.
The resulting affected page remains image-only; watermark text is not a new
selectable text layer. This extra bounded render trades time for a simpler
content-removal argument.

The final all-object content/retention inspection remains after all watermark
additions. Phase 5A's source/resource allowlists and resource-sharing rejection
are not loosened. Existing signed-PDF, XFA, password-field, unsupported-form,
action/JavaScript, glyph and image/signature safety checks remain authoritative.
An unsafe structure fails without a visual-cover fallback.

Generated watermark aliases use explicit `KagazWatermarkFont`,
`KagazWatermarkImage` and `KagazWatermarkOpacity` prefixes. This avoids a copied
source's ordinary Helvetica/Image/GS alias colliding with new drawing resources;
the final retention guard inspects them without any exception.

Download, Extract and compression/OCR preparation share this export. Only existing
explicit server-tool submission can upload the already-flattened derivative.
Choosing/configuring a watermark never uploads anything. Office conversion is
unchanged. Watermarks are visual appearance, not redaction or confidentiality.

## Design and accessibility

`design.md` controls dark surfaces, orange actions, cyan focus, Inter/JetBrains
Mono typography, compact spacing and existing dialog/control patterns. The
available gpt-taste skill was successfully read and used for restrained focus,
hover, disabled/loading and reduced-motion behavior. Its unrelated AIDA,
font replacement, GSAP and redesign instructions conflict with the user/repository
requirements and are not adopted.

Native dialog semantics provide focus containment and inert background content.
Controls have labels, keyboard page targeting, visible focus and status/error
messages. Escape cancels; focus returns to the triggering control. Image selection
uses an accessible file input. All essential placement functions have numeric or
native controls; pointer dragging and new shortcuts are not required.

## Verification and release record

The final local quality gates used pinned pnpm 12.3.4:

| Command                                         | Actual local result                                                             |
| ----------------------------------------------- | ------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile`                | PASS; unchanged lockfile, 130 ms                                                |
| `pnpm lint`                                     | PASS                                                                            |
| `pnpm typecheck`                                | PASS                                                                            |
| `pnpm test`                                     | FAILED locally: web 724 passed; API 187 passed, 11 failed, 8 skipped out of 206 |
| `pnpm --filter @kagaz/web test`                 | PASS: 724 tests in 75 files                                                     |
| `node --test scripts/workspace-sample.test.mjs` | PASS: 3 tests                                                                   |
| `pnpm build`                                    | PASS; existing >700 kB frontend chunk advisory remains                          |
| `pnpm format:check`                             | PASS                                                                            |
| `git diff --check`                              | PASS                                                                            |

There are **933 configured tests: 206 API + 724 web + 3 sampler**, an increase
of 160 web tests. The eleven local failures remain the unavailable OCRmyPDF
integration cases; eight Linux-specific cases are skipped on Windows. No tests
were removed or relabelled as passes. Complete native/container results must be
established by Linux CI before release.

The existing Phase 3F, Phase 3G, Phase 3G lifecycle and unchanged Phase 5A browser
verifiers passed against the implementation. Phase 3G's two reopen helpers now
wait for the same settled editor frame their other state checks use: discovery
commits field definitions before the initialization effect. The original-value
assertions remain intact. The initial immediate read failed once with a blank
transient value; the settled-frame rerun passed.

The Phase 5A run contains 70 report rows, including independent PDF.js text
extraction, actual embedded-image decoding and qpdf 12.4.2 checks. Its source
retention/resource and image-only reconstruction checks remain active. The
focused Phase 5B invalid-image run passed twelve checks: six specific visible
UI import errors with disabled Apply/no hidden history and six typed direct
export failures. The malformed IDAT rejected in 269 ms in UI and 96.4 ms at
direct export on this Windows Chromium host.

The accepted full Phase 5B browser run completed successfully on Windows,
Node 22.17.1, Chrome 155.0.8059.39 and qpdf 12.4.2: **145 report rows,
102 actual PDF inspections across 377 pages, and 35 independently decoded
embedded sanitized raster pages**. It includes 20 typed direct export rejections,
six specific visible UI image errors and five preview/export comparisons.
There were no browser errors. All 102 PDFs passed qpdf. Artifacts are outside
the checkout at `%LOCALAPPDATA%/Kagaz/phase5b-final/phase5b`; the repeatable
script is `scripts/verify-phase5b.mjs`.

## Independent PDF and browser evidence

The verifier reloads actual exported/downloaded bytes with pdf-lib, extracts text
and independently renders with installed PDF.js, checks decoded page operators
and object/resources, runs qpdf/QDF inspection and decodes the actual embedded
RGB raster. Raw marker searches supplement these checks; compressed bytes are
not treated as an absence proof. The deterministic original markers include
SECRET-TEXT-ALPHA/BETA, ACCOUNT-123456, SECRET-FORM-ALPHA and annotation/image
markers. They remain absent from affected pages/output while ordinary source
text and form/annotation content remain present where intended.

Covered combinations include text and transparent PNG/JPEG appearance, all named
corners/custom placement, arbitrary rotation/opacity/size, long AV/accented text,
unsupported glyphs, all/current/selected/range scopes, reordered/rotated/deleted
pages, Extract, multiple/duplicate sources, forms, annotation text/images and
visual signatures. Ordinary integration exports preserve those existing values
and resources; corresponding redacted exports have **zero text operators,
fonts, native annotations or interactive fields and exactly one opaque raster**.
Decoded sanitized areas contain black or deliberately added watermark pixels;
original red/blue fixture pixels and source resources do not survive there.
Full-black-page cases independently prove foreground watermarks exist after
sanitization. All sixteen intrinsic/workspace cardinal combinations, crop offsets,
UserUnit two and conservative unsafe-retention rejection are exercised.

Actual preview ink bounds/alpha are compared with independently rendered output
using a 2.5% page-extent tolerance for antialiasing and sampling. The observed
text/image differences are smaller than that threshold. Toolbar zoom 100% and
110%, DPR two and responsive CSS scaling produce matching export geometry.
Preview cancellation, Apply/edit/remove/shared Undo/Redo, Start Over Cancel/Confirm,
late image work, abandoned assets, paused-export later removal, repeated export,
abort and typed failure are exercised without producing partial-success files.

Keyboard checks cover labelled native controls, selected-page checkboxes, dialog
focus containment, Escape and focus restoration. Desktop and 768/390/360 px
layouts passed, including scrolled mobile preview/Apply/Cancel controls and
reduced motion. The root agent inspected actual desktop, mobile footer and
exported full-black-page render screenshots against design.md.

Ordinary watermark configuration/editing/downloads caused **zero uploads** and
zero local/session document persistence. The complete local harness deliberately
submits two controlled server-tool requests after explicit Compress/OCR actions.
It intercepts each POST, independently checks the already-watermarked/sanitized
derivative, then supplies a controlled failure. Opening either dialog creates no
request. These two authorized test POSTs are not counted as ordinary local export.
Native server success/regressions remain the responsibility of the retained Linux
API/container/browser suites.

## Measured performance

These are synthetic observations on this Windows Chromium host, not universal
speed or memory guarantees. The final verifier brings its export tab to the
foreground before measuring; foreground UI download observations are separate.
An earlier background-tab run took 3.2–4.2 seconds for representative reconstructed
pages because Chrome throttled timers. Both full runs passed the same 145 checks.

| Case                                       | Input → output bytes              | Measured export time |
| ------------------------------------------ | --------------------------------- | -------------------- |
| One-page text watermark                    | 3,714 → 1,332                     | 59.4 ms              |
| Ten pages, all targeted text               | 7,896 → 7,770                     | 3.5 ms               |
| 100-page text                              | 45,986 → 46,475                   | 41.6 ms              |
| 100-page image                             | 45,986 → 45,061                   | 48.9 ms              |
| 3,072×1,536 transparent image asset        | 3,714 PDF + 95,975 image → 46,980 | 352.1 ms             |
| One redacted page + text                   | 4,078 → 18,357                    | 597.0 ms             |
| One redacted page + image                  | 4,078 → 11,705                    | 566.9 ms             |
| Ten pages, one redacted + text             | 7,896 → 22,565                    | 582.3 ms             |
| Rotated redacted page + text               | 4,079 → 19,477                    | 575.9 ms             |
| Crop offsets/UserUnit two + redaction/text | 4,122 → 40,714                    | 1,204.9 ms           |

Foreground UI export-and-download took 230 ms for plain text, 804 ms for
text/redaction and 790 ms for image/redaction in this run. Multiple sources and
duplicate reconstructed pages also passed actual download inspection. The
100-page image output references one shared watermark image object rather than
embedding it repeatedly.

Typical reconstructed bitmaps are 1,000×800: 2.4 MB decoded RGB, with 3.2 MB for
one RGBA surface by calculation. UserUnit two produced 1,760×1,360. The larger
watermark asset has 4,718,592 pixels and an 18,874,368-byte single-RGBA size by
calculation. Neither number is a measured total browser peak. Transient Chromium
JS heap estimates exclude Canvas, native decoder and worker allocations.

Rapidly superseding seven larger-image preview settings and then cancelling
completed in 2,989.6 ms, with 102 heartbeat pulses and a maximum observed gap of
658.7 ms. This records finite main-thread pauses, not a promise of uninterrupted
interaction. Its final preview was 625×500, within the 4 MP bound. All six image URLs
created in that lifecycle were released after Escape/Start Over. Existing
viewport-aware rendering stays lazy; watermark preview does not render the entire
workspace eagerly.

## Release status

Local implementation and independent verification are complete. Full exact-SHA
Linux CI, merge and production verification are required before the phase is
declared PASS; their executed release record is added after completion.

## Files and responsibilities

| Path                                                                                   | Responsibility                                                                                                |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `features/pdf-watermarks/model`                                                        | Single text/image configuration, validation, stable page targets, snapshots and bounded transactional history |
| `features/pdf-watermarks/hooks/usePdfWatermarks.ts`                                    | Draft/committed state, metadata validation, asset reachability, generation cancellation and unified history   |
| `features/pdf-watermarks/components/WatermarkDialog.tsx`                               | Accessible native configuration/targeting/preview controls                                                    |
| `features/pdf-watermarks/rendering/WatermarkPreview.tsx`, `runtime/previewJobQueue.ts` | Lazy bounded transparent appearance, serialized native decode/render and awaited cleanup                      |
| `lib/pdf-export/watermarks`                                                            | Canonical geometry, Helvetica glyph/ink metrics, trusted image boundary and shared preview/export drawing     |
| `lib/pdf-export/exportWorkspace.ts`, `redactions/finalizeRedactions.ts`, `types.ts`    | Foreground layer integration, sanitized-only redacted composition, final existing retention inspection        |
| `features/pdf-workspace/hooks/usePdfExport.ts`                                         | Immutable page-scoped watermark/Blob snapshots for Download, Extract and heavy-tool preparation               |
| `App.tsx`, editor history, annotation toolbar, PDF viewer/page and `styles.css`        | Workspace lifecycle, discoverable action, focus restoration and existing design integration                   |
| `features/pdf-annotations/runtime/annotationAssetRegistry.ts`                          | Optional abort support for pending image registrations without changing normal annotation callers             |
| `scripts/verify-phase5b.mjs`, focused tests and `.github/workflows/ci.yml`             | Repeatable actual-file verification, malformed-input checks, UI/performance evidence and CI integration       |
| `scripts/verify-phase3g.mjs`, `verify-phase3g-lifecycle.mjs`                           | Settled-frame readiness for unchanged original form-value assertions                                          |
| `README.md`, `docs/phase-5b.md`                                                        | Truthful capabilities, local privacy, limitations and engineering evidence                                    |

Paths in this table are under `apps/web/src` unless a repository-root path is
shown. No API, native worker, container, Render, environment or package/lockfile
configuration is changed. The old redaction retention and raster policies remain
unchanged.

## Limitations and Phase 5C handoff

- One active foreground configuration; no templates, repeated tiling, background
  layering or automatic OCR.
- Single-line Standard Helvetica text only, up to 200 characters. Unsupported
  glyphs are rejected before Apply/export; no silent substitution or multilingual
  claim. Phase 5C must define custom-font validation, embedding and common metrics
  for preview/export before broadening character support.
- Sizing is bounded by rotated geometry and 5% page margins. The font-size value
  is a maximum physical size and can shrink for long text, small pages or scale.
  Custom coordinates are fractions of the available fitted span, not absolute
  screen positions.
- PNGs become a bounded 8-bit Canvas appearance with alpha; ancillary metadata
  and original 16-bit precision are not preserved. Animated PNG, ambiguous JPEG
  frames/EXIF and unsupported orientation are rejected. Canvas color conversion
  is part of the chosen appearance policy.
- Redacted pages remain 144-DPI image-only pages with finite raster fidelity and
  lost selectable text/accessibility structure. Their foreground watermarks are
  rasterized too; ordinary targeted pages preserve their text/vector content.
- Existing mixed-document resource safety can conservatively reject an export.
  Extract affected pages or revise the workspace; never enlarge the allowlist or
  restore source objects to make watermarking succeed.
- Explicit bitmap, image, history and geometry budgets bound allocations but do
  not measure an exact browser peak. JS heap estimates exclude native decoder,
  worker and Canvas memory. Full memory profiling belongs before raising limits.

For Phase 5C, preserve the immutable snapshot and stable target semantics, exact
timeline pruning and reachable-asset cleanup. Keep redacted composition restricted
to sanitized pixels and newly trusted resources, followed by the unchanged final
all-object inspection. Safe font work must not rebuild a donor/OCR text layer on
redacted pages. Extend independent extraction/embedded-raster tests to distinguish
deliberate new font content from removed source content. Keep heavy-tool upload
consent explicit and retain all existing native/container verification.
