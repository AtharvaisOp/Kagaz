# Phase 5A — true browser-local PDF redaction

Phase status: **PARTIAL — implementation and local removal verification completed;
final CI, merge and production verification pending**. This record deliberately
does not declare the phase complete before those release checks have results.

## Starting state and baseline

Work began with a clean checkout at the verified `main` commit
`9dc23b2f00ff37c2f94a2e9c3abf4e3efed8a4bc`. The required `git status`,
`git branch --show-current`, `git rev-parse HEAD`, `git remote -v` and
`git log --oneline -20` were inspected before modification. Remote/default branch
and successful CI run 58 were verified independently of the supplied snapshot.
Implementation uses `codex/phase-5a-redaction`; no destructive reset, force push or
discard of unrelated source work was used.

The review covered AGENTS.md, design.md, README, the complete Phase 3F/3G and
4A/4B/4C/4D records, annotation state/rendering, workspace/page identity and
operations, PDF.js viewport rendering, unified annotation/form history, form
flattening, signature safety, export, browser fixtures/scripts and CI. In
particular, the existing rectangle annotation is a visual drawing operation. It
cannot serve as destructive redaction.

The baseline was reproduced from a pristine archive of the starting SHA with
the repository's pinned pnpm 12.3.4, outside the modifying checkout:

| Command                                         | Executed baseline result                                                                                  |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile`                | Passed with pinned pnpm 12.3.4                                                                            |
| `pnpm lint`                                     | Passed                                                                                                    |
| `pnpm typecheck`                                | Passed                                                                                                    |
| `pnpm test`                                     | Failed locally: API 102 passed, 96 failed, 8 skipped out of 206; required native/Python tools were absent |
| `pnpm --filter @kagaz/web test`                 | Passed: 477 tests                                                                                         |
| `node --test scripts/workspace-sample.test.mjs` | Passed: 3 tests                                                                                           |
| `pnpm build`                                    | Passed; existing frontend chunk-size warning retained                                                     |
| `pnpm format:check`                             | Passed                                                                                                    |
| `git diff --check`                              | Passed                                                                                                    |

Portable Ghostscript, qpdf and Python tooling was subsequently configured outside
the repository. That local API run reached **187 passed, 11 failed, 8 skipped**.
OCRmyPDF remains unavailable, and Linux-specific tests are skipped on Windows.
These failures are not passes. Docker is absent and WSL is disabled; the existing
production-container suites require Linux CI. The baseline count is 206 API +
477 web + 3 sampler = **686 tests**, independent of local native availability.

An initial desktop pnpm wrapper and partially migrated generated `node_modules`
directories caused missing executable and OneDrive access-denied failures.
Generated directories were preserved outside the repository and the pinned
manager's frozen installation was rerun successfully. No lockfile or dependency
change was needed. Those setup attempts are not successful quality-gate results.

## Implemented behavior and design

The existing editor toolbar now has a **Redact** control. Users can draw one or
more pending rectangular regions, select them, move them, resize them or remove
them. The semantic **Pending redactions** section also supports adding a region
and editing X, Y, width and height without using the page canvas. Applying the
four geometry fields is one history transaction.

A native **Redactions on page** selector keeps keyboard management tied to a
stable workspace identity independently of the visible-page scroll observer.
Choosing an unloaded page navigates to it and waits for its preview bounds.
Selecting a proposal on the canvas reveals that proposal's page in the manager.
The selector has an exact accessible name through its visible label, so option
text does not change its name as pages are added. Choosing a page clears proposal
selection without creating a history transaction.
Desktop thumbnail selection also no longer restores mobile-dialog focus or
scrolls the workspace back to the toolbar.

Pending regions have a dark preview, a dashed orange border and a pending label.
Selected regions have the existing cyan focus/selection language. The editor
explains that export permanently removes information and converts affected pages
to images, losing selectable text. A pending proposal does not modify the opened
source. Successful export leaves proposals editable for another export.

`design.md` remains authoritative: existing dark surfaces, Inter/JetBrains Mono,
orange/cyan accents, borders, spacing and toolbar structure are retained. The
available `gpt-taste` skill was read and used for restrained hover, visible focus,
selected-state feedback and responsive interaction quality. Its landing-page
layout/font/GSAP prescriptions conflict with this existing editor and were not
applied. No UI library, flashy animation or new animation dependency was added;
existing reduced-motion support remains active.

No shortcut was added because the existing annotation keys V/T/H/P/R/E/L/S already
have meanings. Selecting an annotation or activating an ordinary annotation tool
exits Redact mode. Redaction state does not borrow annotation colors, styles or
annotation export semantics.

## Technical investigation and architecture decision

The current stack provides PDF rendering and viewport transforms in PDF.js,
page copying and PNG embedding in pdf-lib, and pixel read/write plus PNG encoding
in Canvas. The relevant public APIs were checked in the
[PDF.js page API](https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib-PDFPageProxy.html)
and [pdf-lib document API](https://pdf-lib.js.org/docs/api/classes/pdfdocument).

| Approach                                  | Investigation and decision                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Selective content-stream/object rewriting | Rejected for this phase. Correct removal would require handling nested Form XObjects, clipping, transforms, text positioning/encodings, shared image resources, masks, transparency and alternate representations. The existing libraries expose parsing/rendering/copying primitives but no complete geometric semantic redactor. A home-grown operator filter could miss source information or alter unrelated appearance. |
| Rasterize only affected pages             | Selected. Compose the complete intended page appearance in an isolated temporary PDF, render it at a fixed policy resolution, overwrite covered samples, and build a fresh output page using only the sanitized image. The source page is never copied into final output.                                                                                                                                                    |
| Hybrid within a redacted page             | Rejected. Retaining original text/vector/image objects outside the box still requires proving that shared resources and hidden representations cannot expose information inside it. That has the same incomplete selective-removal problem.                                                                                                                                                                                  |
| Hybrid at document/page level             | Selected. Affected pages are reconstructed; unaffected pages retain the existing copy/flatten path when their retained object graph passes the stricter mixed-redaction safety policy.                                                                                                                                                                                                                                       |

The conclusion that arbitrary selective rewriting is not defensible with the
current implementation is an engineering inference from the reviewed code/API
surface and tested resource-sharing failures. It is not a claim that PDF.js or
pdf-lib cannot be used to build a larger redaction engine in a future phase.

Visual covering was rejected because drawing an opaque rectangle leaves original
text operators, image samples and form/annotation values recoverable. Production
redaction has a separate destructive path under `lib/pdf-export/redactions`;
there is no `redaction` member in the ordinary annotation union and no fallback
to flattening a black rectangle over retained source content.

## State, history and page lifecycle

The distinct proposal model is:

```ts
interface RedactionRegion {
  id: string;
  pageId: WorkspacePageId;
  box: { x: number; y: number; width: number; height: number };
}
```

IDs are stable and geometry is validated before acceptance. Selection and active
tool state are separate from persisted proposal geometry. The redaction reducer
has bounded past/present/future snapshots; the unified editor timeline now has a
third `redaction` domain alongside annotations and forms. Add, committed move,
committed resize, geometry Apply and removal produce history; selection, identical
geometry and invalid/missing edits do not. A new edit invalidates redo across all
three domains, preserving chronological Undo/Redo.

Workspace page identity, rather than position or source filename, binds a region.
Reordering and rotation retain that identity. Two additions of the same file have
different source/page identities. Added PDFs do not inherit proposals. Deleted
pages/source removal prune both present and history snapshots; timeline pruning
removes transactions for those pages and collapses redundant history states.
Start Over clears proposal state, registered bounds, selection and unified
history. Replacing/opening a new workspace cannot revive stale regions.

The export hook snapshots selected page identities, proposals and copied boxes
before asynchronous work. Extraction receives only the selected pages' proposals.
Removed pages and later edits cannot change an in-flight export snapshot. Abort
or failure returns no partial downloadable PDF; a later independent export can
succeed. Repeated export does not progressively alter the workspace.

Pointer gestures retain canonical start geometry. A viewport/page/tool change
recreates the overlay and cancels stale work, releases capture and clears its
temporary preview. A deleted region cannot be committed or selected by a late
pointer-up. Selection changes after a completed gesture so showing the geometry
editor above the page cannot shift the gesture's coordinate origin midway through
drawing. These details repair real interaction failures found during review.

## Canonical geometry and rotation

Boxes use original PDF user-space coordinates, before intrinsic source rotation
or workspace rotation delta. Screen pixels, current DPR, thumbnail dimensions and
CSS widths are never authoritative. Pointer coordinates first map from the
surface's current client rectangle into its PDF.js viewport, then use
`convertToPdfPoint`; previews use the inverse viewport transform. Bounds derive
from the visible PDF view box, supporting nonzero crop/media origins and UserUnit.

Export validates MediaBox/CropBox, the visible intersection, UserUnit, finite
extents, positive dimensions, unique region IDs, matching workspace page identity
and cardinal rotation. The complete appearance is rendered with rotation zero;
the sanitized page is reconstructed with its original raw media origin, effective
crop box and UserUnit. Intrinsic source rotation plus workspace rotation delta is
applied once to the fresh page. Source 0/90/180/270 and workspace 0/90/180/270
combinations are independently exercised.

Pixel coverage rounds outward with floor/ceil and an additional one-pixel fringe
to remove antialiased boundary samples. Overlaps are merged into horizontal
intervals while sanitizing each row. A positive subpixel region still overwrites
pixels; invalid, nonfinite or outside-page geometry fails before rendering.
The fringe can remove a little visible material just outside the proposed box.

## Export integration and security argument

The pipeline keeps the existing safety stages and introduces a deliberate branch:

1. Snapshot requested pages, source bytes, annotations, form state and proposals.
2. Perform the existing signed-PDF, executable-action and form/signature checks.
   XFA, password fields, unsupported forms and unsafe signature structures remain
   blocked. Existing glyph and image/signature asset validation remains active.
3. Prepare and flatten supported filled forms on the in-memory source document.
   Before ordinary annotation flattening, fingerprint original affected-source
   resource compounds and material dictionary keys across all source identities.
   Compare these with preserved-source resource graphs and reject shared payloads.
4. For each unaffected requested page, retain the existing page-copy, ordinary
   annotation flattening and final-rotation path, subject to retained-object checks.
5. For each affected page, copy it only into a throwaway one-page appearance PDF.
   Flatten ordinary annotations and visual signatures into that appearance.
6. Render that appearance locally, overwrite every covered pixel with opaque
   black RGBA samples, encode the sanitized raster as PNG, and embed it in a newly
   created output page. Source page dictionaries/resources never enter that page.
7. Flush the output, inspect all serialized objects for forbidden original
   representations and detached donor pages, then save only if the checks pass.

The fresh affected page contains the sanitized image and its drawing operators.
It has no source text layer, original vector/content streams, source image,
AcroForm values, original annotation records or attached alternate page. The
source document's title/metadata is not copied into the newly created document.
Generated feature metadata does not contain redacted text. No OCR or replacement
text layer is generated.

Copying an apparently unaffected page can retain a shared image, font/CMap or a
cross-page/hidden reference from the donor. Mixed exports therefore have additional
fail-closed safeguards:

- Preserved pages accept only a narrow standard page/resource/appearance
  vocabulary and valid resource value kinds. Native source annotations,
  cross-page annotation destinations, metadata, attachments, marked-content
  alternate text/properties, external streams and unknown custom fields are
  rejected. Resource symbol-table keys remain names; their values are traversed.
- Original affected-source resource compounds and material dictionary keys are
  SHA-256 fingerprinted before ordinary annotation flattening, across every source
  identity. Preserved-source graphs are checked before copying. The final check
  repeats compound and key comparisons in preserved output graphs, excluding
  freshly generated sanitized pages from these resource comparisons.
- After appearance composition, reachable nontrivial streams, nonempty PDF
  strings/hex strings, material PDF names and nonstructural keys outside the
  Resources subgraph are fingerprinted too. Newly generated annotation style
  compounds and resource identifiers are not treated as original-source data.
  Stream/string/name checking remains active throughout that subgraph. The final
  check walks all serialized objects, including detached ones, and rejects retained
  representations or an orphan `/Page`. Known content-free graphics wrappers are
  narrowly exempted without inflating attacker-controlled streams.
- The graph traversal has a fixed object budget. Image dimensions are resolved
  through indirect names/numbers and checked before browser decoding. Unknown
  dictionaries, unexpected resource types or rendering failures never trigger
  visual-cover fallback.
- Resources also receive bounded, context-resolved compound hashes. Dictionary
  keys are sorted, array order is retained and indirect references resolve to
  child hashes; raw streams are never inflated for this inspection. These hashes
  reject numeric font-width/graphics-state payloads shared across separate source
  instances before copying and again in the final preserved resource graphs.
  Same-source object identity is checked too. Only closed Standard14 font
  definitions containing known Type/Subtype/BaseFont/Encoding constants are
  exempt; source-controlled resource aliases are not exempt. Cycles, missing
  references, more than 128 levels or the object limit fail closed.

The distinction between original-source resources and generated appearance
resources is deliberate. A regression reproduced three harmless compound-hash
collisions: the generated `/ca 1` and `/CA 1` opacity dictionaries and their
ExtGState resource table. The original-source resource comparison had zero
collisions in that case. Generated resource identifiers can also recur on
preserved pages. Treating
post-flatten style compounds and resource identifiers as original data blocked
otherwise safe annotation/mixed-source exports. The repaired checks collect
original compounds and keys before those styles are generated, retain strict final
preserved-resource checks, and keep post-flatten content and asset fingerprints.
Source-controlled aliases, numeric font-width payloads and original graphics-state
payloads remain covered; this is a provenance distinction, not a broader resource
allowlist.

The guards are intentionally conservative. Shared embedded fonts/CMaps, repeated
image streams, compound payloads or coincident resource identifiers can block a
mixed export even when the user's visible secret does not occur on another page.
The error directs users to
extract affected pages separately. This compatibility cost is preferable to
silently retaining an alternate representation.

The supported security boundary is the finalized PDF produced by this pipeline
and the inspection methods below. It is not forensic erasure of the original
source file, browser memory, previous downloads or information independently
visible elsewhere. The opened source remains in memory for editable proposals.
Users must mark each independently visible occurrence of information they wish
to remove. Hash checks add defense against exact retained representations; the
fresh-page construction and strict preserved-resource policy provide the primary
structural argument. They are not a general recognizer of every possible encoding
of an arbitrary secret.

## Raster quality, limits and cleanup

Resolution is **144 DPI**, independent of display zoom, CSS scale or screen DPR.
It is a deliberate legibility/size tradeoff rather than a claim of original vector
fidelity. The installed PDF.js worker remains locally bundled. Rendering uses an
opaque white-backed canvas and strict error handling; the PDF.js documented
[loading parameters](https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib.html)
include the image/error controls used here. Application-side budgets are also
checked before allocating the raster.

| Limit                                 | Policy                                                                                            |
| ------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Raster side                           | At most 8,192 pixels                                                                              |
| Raster area                           | At most 16,000,000 pixels per affected page                                                       |
| Input image area                      | At most 16,000,000 pixels per image                                                               |
| Aggregate reachable input image area  | At most 32,000,000 pixels per affected appearance                                                 |
| Pending regions finalized on one page | At most 1,000                                                                                     |
| Traversed PDF object graph            | At most 100,000 objects per check                                                                 |
| Resolved resource graph depth         | At most 128 levels; cycles and unresolved references are rejected                                 |
| Rotation / UserUnit                   | Cardinal rotation; finite UserUnit from 1 through 75,000, still subject to physical raster limits |
| Affected-page scheduling              | Sequential; one active page rasterization                                                         |

Oversized physical pages/images fail with a clear export error; quality is not
silently reduced to squeeze them through. PDF.js `maxImageSize` and strict errors
also guard inline image decoding. Limits constrain ordinary work but are not a
complete native-memory quota for the browser or a malicious PDF decoder sandbox.
There is no per-document peak-memory claim.

The canvas backing buffer and mutable ImageData are approximately two RGBA-sized
allocations while sanitizing; PNG encoding, PDF parsing, image decoding, worker
memory and output bytes add overhead. At 1,000 × 800 this is about 3.2 MB per RGBA
buffer, or 6.4 MB for those two buffers; the embedded RGB samples are about 2.4 MB
before compression. At the area ceiling, two RGBA buffers alone are about 128 MB.
These are allocation arithmetic, not measured peak memory.

Abort checks occur around asynchronous stages and during pixel rows. Finally
blocks cancel active render tasks, release page/worker resources and zero the
canvas dimensions. The output is published only after final validation. Redacted
pages lose selectable/searchable text, vector fidelity and original accessibility
semantics; file size can increase. Unaffected supported pages remain on the
existing lossless source-content path. OCR is explicitly outside Phase 5A.

## Accessibility

The toolbar control has a clear accessible name and pressed state. A named
**Pending redactions** section provides keyboard-selectable proposal buttons,
an Add action, labeled native numeric geometry fields, Apply and per-region
Remove actions. It is the management path for users who cannot draw on a canvas.
The native **Redactions on page** control has a stable exact accessible name and
offers every current workspace page. Real keyboard Home/ArrowDown/Enter selects
the second duplicate source, and Add/Enter retains that identity even after focus
scrolls to the header. A separate initially unloaded ten-page probe used End/Enter
and Add/Enter to create a region on page 10 after preview bounds loaded.
Selection is not a history event; Apply is one event. Successful geometry changes
preserve logical focus, removal restores focus to a remaining region or the
section heading, and status/errors are announced. The pointer preview is hidden
from the accessibility tree to avoid duplicating the semantic list.

Focus states use existing cyan/orange styling. Controls wrap into a compact layout
at narrow widths without clipping the X/Y/width/height fields. Reduced-motion
verification exercises controls while `prefers-reduced-motion` is active.
The accepted browser run proves Apply focus, removal-to-heading focus and pointer
gestures. Native geometry inputs retain visible cyan focus at 768, 390 and 360 px;
both the management controls and actual rendered page are inspected at each size.

## Independent content-removal verification

Deterministic synthetic fixtures contain `SECRET-TEXT-ALPHA`,
`SECRET-TEXT-BETA`, `ACCOUNT-123456`, `PRIVATE-IMAGE-MARKER`,
`SECRET-ANNOTATION-ALPHA` and `SECRET-HIDDEN-CONTENTS`. The harness first proves
source content is present. Verification consumes downloaded PDF bytes, rather
than relying on the canvas used by finalization.

| Independent check                     | Executed evidence in the accepted stable browser run                                                                                                                            |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PDF.js text extraction                | Affected output pages expose no text, including the known digital/form/annotation secrets; unredacted pages in the ten-page case remain selectable                              |
| PDF.js operator/annotation inspection | Affected pages have zero text-showing operators, one image appearance and no retained native annotation records                                                                 |
| pdf-lib reload/object inspection      | Downloaded output reloads, has the requested page count/rotation and fresh raster page resources; original image stream hashes are absent                                       |
| Actual embedded-image inspection      | Decodes the raster from the exported PDF and checks covered sample ranges are black; source image samples are not retained beneath an overlay                                   |
| Independent render                    | Reloads and renders the downloaded result, checking sanitized region pixels and rotation rather than the editing preview                                                        |
| qpdf 12.4.2                           | `--check` succeeds; QDF with object streams disabled and streams uncompressed supports a second parser's structure and marker checks                                            |
| Raw/QDF marker search                 | Known deterministic secret strings are absent where the assertion is meaningful; supplemental to decoded/object checks, since compression/encodings alone can defeat raw search |

Direct export unit tests inject the rendering boundary to test pipeline structure,
safety ordering, retention guards and failure behavior. They do not substitute for
the real-browser raster tests. Browser cases cover digital/partial text, source
images, vector graphics, filled forms, annotation text, all ordinary annotation
kinds, placed image annotations, visual signatures, overlapping regions, edges,
tiny boxes, all intrinsic/workspace rotation combinations, crop/media offsets,
UserUnit, reordered/duplicate/mixed sources and extraction.

Focused negative tests cover nonfinite/invalid geometry, huge pages/images,
duplicate or mismatched IDs, unsupported retained resources, native comments and
cross-page destinations, shared image/CMap streams, hidden strings/material
names/numeric resource data, orphan page objects, signed/executable input,
unsafe assets/glyphs, abort, renderer failure and later successful export. A
review reproduction that hid the secret in a shared resource string initially
escaped stream-only checking; the repaired guard fingerprints strings and rejects
that exact case. Later review reproduced retention through source-controlled
dictionary keys and numeric font/graphics-state compound payloads; key fingerprints
and bounded context-resolved resource hashes now reject those representations
across both same-source and separately loaded source documents. Invalid resource
value kinds, cyclic references and unknown nested fields also have regressions. These
findings were repaired before freezing application sources.

## Browser verification and observations

The final accepted local report has **70 result rows**: **42 independent PDF
inspections**, **25 typed expected rejections** and **3 source/pointer proofs**.
It has `errors: []`, `requests: []`, successful zero-persistence assertions, and
required qpdf 12.4.2 checks. The report is
`C:/Users/athar/AppData/Local/Kagaz/phase5a-final-accepted/phase5a/phase5a-browser.json`.
It uses a real Chromium browser at desktop size with DPR 2 and
exercises 768, 390 and 360 px layouts plus reduced motion. Drawing at 100% and
120% zoom exports the same canonical target; scrolling, numeric Apply/Undo/Redo,
adding/reopening PDFs, deletion and Start Over are covered. Existing Phase 3F,
3G and lifecycle browser suites also passed in stable local runs.

Desktop and narrow-layout proposal-list and exported-page screenshots were
visually inspected against design.md. Inspection found clipped numeric controls
in the first inherited horizontal layout; the summary now has its own restrained
wrapping grid. Selection-triggered page shifting during a pointer gesture was
also reproduced and repaired. The final accepted run proves keyboard/focus,
pointer move/resize at 100% and 120%, cancellation on mid-drag zoom and identical
canonical output rasters across both zooms. It includes retained-resource probes,
fully rendered mobile assertions, initially unloaded page selection and duplicate
source identities. A ten-page case with public annotations on a preserved page
also passes after the generated-style provenance repair.

Some earlier runs were invalidated by live HMR during concurrent edits. Another
apparent indefinite viewer-loading fault was traced to the independent verifier
tab being frontmost, which throttled the application's background rendering and
IntersectionObserver/animation-frame work. Bringing the application tab forward
resolved the harness problem; a minimal app-only reproduction remained healthy.
The later 68-row interrupted report is likewise not counted as a pass; the complete
70-row rerun above supplies the final evidence. No production viewer
workaround was introduced for the harness behavior.

The redaction harness records every non-GET request. The accepted ordinary
redaction/export run recorded none. It makes no API calls and adds no endpoint,
upload, storage, account or persistence. Existing explicitly submitted server
compression/OCR/Office conversion flows are unchanged.

## Performance observations

These are single local Chromium measurements from the final accepted run, not
latency guarantees. UI export timing includes the download event; direct-case
timing measures export. Independent parsing/inspection is outside that timing.
The standard synthetic page is 500 × 400 PDF units, yielding a 1,000 × 800 bitmap
at 144 DPI. Rotation metadata does not inflate those raw raster dimensions.

| Representative export          | Observed time | Input/output size      | Raster behavior                                           |
| ------------------------------ | ------------- | ---------------------- | --------------------------------------------------------- |
| One-page text via UI           | 694 ms        | 3,968 B → 12,422 B     | One 1,000 × 800 affected page                             |
| Ten pages, one affected        | 846 ms        | 8,847 B → 14,357 B     | One raster; other nine pages retain selectable text       |
| Three affected pages           | 2,558.6 ms    | 5,054 B → 18,777 B     | Three sequential rasters                                  |
| Image-heavy page               | 919.9 ms      | 3,242,856 B → 12,079 B | One raster; synthetic noisy image covered by sanitization |
| Intrinsic 90° + workspace 0°   | 619.5 ms      | 3,969 B → 12,422 B     | One raster; final rotation 90°                            |
| Crop/media offset + UserUnit 2 | 1,010.2 ms    | 4,011 B → 27,231 B     | One 1,760 × 1,360 crop raster, bounded by the same limits |

The image-heavy reduction is specific to this fixture's covered content, not a
compression promise. Other redactions can increase file size. Chromium heap
samples were available: the text export's before/after samples were 38,517,817 /
54,723,192 B; the ten-page case's were 67,964,387 / 76,091,510 B. They omit
worker/canvas/native allocations and are not a measured whole-process peak or a
memory-leak proof. The actual embedded UserUnit 2 raster decodes to 7,180,800 RGB
bytes; its minimum canvas RGBA allocation is 9,574,400 bytes. Policy arithmetic and
sequential scheduling are therefore reported separately from observed latency.

## Validation record and exact counts

Application sources are frozen for final validation. The current web suite has
**564 tests in 65 files**, an increase of 87 over the 477-test baseline. API remains
**206**, and the workspace sampler remains **3**. The final local web and sampler
runs passed all 564 + 3 tests. The export-focused checkpoint passed 171 tests
across 10 files, including 45 finalizer tests. The expected complete Linux count is **773**; it is an expected
count until final CI executes it.
No skipped local native test is included in a claimed complete pass.

| Check                                                     | Current result                                                                                                                     |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Recovered pinned `pnpm install --frozen-lockfile`         | Passed                                                                                                                             |
| Final repository `pnpm lint`                              | Passed                                                                                                                             |
| Final repository `pnpm typecheck`                         | Passed                                                                                                                             |
| Final `pnpm --filter @kagaz/web test`                     | Passed: 564 tests across 65 files                                                                                                  |
| Final `pnpm test` / 206 API tests                         | Failed locally: 187 passed, 11 failed, 8 skipped; OCRmyPDF unavailable and Linux-only cases skipped; complete Linux result pending |
| `node --test scripts/workspace-sample.test.mjs`           | Passed: 3 tests                                                                                                                    |
| Final repository `pnpm build`                             | Passed; existing approximately 700 kB frontend chunk warning                                                                       |
| Final repository `pnpm format:check`                      | Passed after final local record synchronization                                                                                    |
| Final `git diff --check`                                  | Passed after final local record synchronization                                                                                    |
| Focused redaction/history/annotation UI suite             | Passed: 56 tests across 8 files at its recorded checkpoint                                                                         |
| Web lint/typecheck after UI stabilization                 | Passed at the recorded checkpoint                                                                                                  |
| Finalizer/retention/export focused regressions            | Passed: 171 tests across 10 files, including 45 finalizer tests                                                                    |
| Earlier stable/focus Phase 5A browser checkpoints         | Passed at recorded 51/55-row checkpoints; superseded by the complete final run                                                     |
| Final resource-guard/mobile-render Phase 5A browser rerun | Passed: 70 rows, 42 independent PDF inspections, 25 typed expected rejections, 3 source/pointer proofs; qpdf required and executed |
| Existing Phase 3F/3G/lifecycle browser scripts            | Passed locally                                                                                                                     |
| Phase 4A/4B/4C/4D API/container/browser CI                | Preserved in configuration; final Linux run pending                                                                                |

CI adds one focused browser-local redaction step to the existing production
verification job, reusing Playwright/Vite and synthetic fixtures. qpdf is required
for that step. Every previous Phase 4A/B/C/D validation remains active. There is
no new dependency or lockfile change.

Repeatable local commands, with the existing native prerequisites installed:

```sh
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
node --test scripts/workspace-sample.test.mjs
pnpm build
pnpm format:check
git diff --check
```

Start Vite on 127.0.0.1:5173, then run the browser harness with an artifact directory
outside the repository and qpdf on PATH:

```sh
KAGAZ_ARTIFACT_DIR=/tmp/kagaz-phase5a \
KAGAZ_REQUIRE_QPDF=1 \
node scripts/verify-phase5a.mjs
```

`KAGAZ_APP_URL` selects the app (default `http://127.0.0.1:5173`);
`KAGAZ_VERIFIER_URL` selects the independent local PDF.js inspection tab;
`KAGAZ_QPDF_PATH` or `QPDF_PATH` selects qpdf;
`KAGAZ_CHROME_PATH` optionally selects a browser executable; and
`KAGAZ_PLAYWRIGHT_MODULE` can select the existing installed Playwright package.
`--direct` limits the run to direct export cases. `--production` exercises the
deployed UI while the verifier tab uses the local installed parser. These are
verification-only environment settings, not application features or uploads.

## Important files changed

| Area                               | Files and responsibility                                                                                                 |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Proposal domain/state              | `apps/web/src/features/pdf-redactions/model/{types,geometry,reducer}.ts`, `hooks/usePdfRedactions.ts` and focused tests  |
| Proposal interaction/accessibility | `features/pdf-redactions/rendering/RedactionOverlay.tsx`, `components/RedactionSummary.tsx` and semantic component tests |
| Unified chronology                 | `features/editor-history/{types,useEditorHistory}.ts`, `model/timeline.ts` and tests                                     |
| Editor integration                 | `apps/web/src/App.tsx`, `features/pdf-viewer/{PdfViewer,PdfPage}.tsx`, annotation toolbar/summary and `styles.css`       |
| Export snapshot and contracts      | `features/pdf-workspace/hooks/usePdfExport.ts`, its tests, `lib/pdf-export/{exportWorkspace,types}.ts`                   |
| Destructive finalization           | `lib/pdf-export/redactions/{finalizeRedactions,rasterizeAppearance,rasterPolicy,retentionSafety}.ts` and tests           |
| Independent verification/CI        | `scripts/verify-phase5a.mjs`, `.github/workflows/ci.yml`                                                                 |
| Capability and phase record        | `README.md`, `docs/phase-5a.md`                                                                                          |

No API source, Render configuration, database, shared server contract, dependency
manifest or lockfile needs a redaction change. The existing ordinary annotation
flattening module is reused only to compose appearance before destructive raster
reconstruction; it does not finalize proposals.

## Release and deployment record

| Item                                | Current recorded state                                                |
| ----------------------------------- | --------------------------------------------------------------------- |
| Branch                              | `codex/phase-5a-redaction`                                            |
| Starting SHA                        | `9dc23b2f00ff37c2f94a2e9c3abf4e3efed8a4bc`                            |
| Phase implementation commit/message | Pending verified commit                                               |
| Final SHA / push / merge            | Pending final gates and release                                       |
| Final CI run/result                 | Pending; successful starting-state run 58 is not final-phase evidence |
| Vercel deployment/final SHA         | Pending exact final-SHA deployment                                    |
| Production redaction removal smoke  | Pending downloaded-output verification                                |
| Production no-upload assertion      | Pending; accepted local redaction run has no non-GET requests         |
| Render/API change                   | None required or introduced                                           |

After the verified branch is merged, wait for final CI, confirm Vercel's READY
deployment is built from the exact final SHA, and execute the production redaction
smoke using synthetic files. Inspect downloaded output with the same independent
checks and confirm ordinary redaction/export generates no API upload. A Vercel
build succeeding without a matching SHA and production test is insufficient.
No Render deployment/configuration action belongs to this browser-local phase.

## Deviations and limitations

- Selective text/vector preservation on affected pages is intentionally omitted;
  the safe fallback rasterizes only those pages. Their selectable text and
  original accessibility structure are lost, and 144 DPI has finite fidelity.
- Mixed exports conservatively reject shared/unknown retained resources and native
  annotations. Extracting affected pages can avoid retaining those structures;
  no insecure automatic fallback exists.
- Original browser/source files are not erased. Each independent visible copy of
  sensitive information requires its own proposal.
- Browser canvas/decoder overhead is not an exact measured peak-memory guarantee.
  Oversized pages/images fail; unsupported PDFs can fail closed even when other
  viewers render them.
- Local Windows cannot execute the complete Linux native/container envelope.
  Those results and the exact production deployment remain release requirements,
  explicitly incomplete until synchronized here.

## Full acceptance checklist

- [x] Redaction tool exists.
- [x] Redaction regions use canonical document geometry.
- [x] Pending redactions are editable/removable.
- [x] Redactions participate correctly in history/lifecycle.
- [x] Finalized output truly removes covered information in supported exports.
- [x] Digital text redaction is proven by extraction and object inspection.
- [x] Image-content redaction is proven by actual embedded-raster inspection.
- [x] Rotated pages are proven across intrinsic/workspace cardinal combinations.
- [x] Forms/annotations/signatures interactions are proven.
- [x] Extract is proven.
- [x] Multiple sources are proven.
- [x] Original page content is not retained underneath rasterized redacted pages.
- [x] Existing export safety checks remain intact.
- [x] No server upload is introduced.
- [x] No persistence is introduced.
- [x] Accessibility path exists.
- [x] Mobile/responsive behavior is verified at 768, 390 and 360 px; final focus/gesture/browser run passed.
- [x] Performance is bounded by explicit raster/image/graph limits.
- [x] Relevant web and lifecycle regression tests pass; final Linux native checks are recorded separately.
- [ ] Existing API/container suites pass in final Linux CI.
- [x] Documentation accurately separates executed evidence and pending checks.
- [ ] Final CI is green.
- [ ] Production frontend is verified at the final SHA, including no API upload.

## Notes for Phase 5B

Keep proposals separate from ordinary annotations. Never bypass the fresh affected
page or change finalization to an opaque rectangle over the donor. Preserve the
source safety, glyph/image/signature checks, strict retention checks and final
all-object guard when extending export. A retained-resource compatibility change
requires a concrete counterexample plus independent removal evidence; do not
merely enlarge the allowlist to make a fixture pass.

Keep raw PDF geometry authoritative. Test intrinsic rotation, workspace rotation,
crop/media offsets, UserUnit, CSS scale and zoom whenever viewer or export
transforms change. Preserve cancellation and one-page-at-a-time resource cleanup.
The semantic geometry editor and unified history must remain usable even if the
pointer overlay evolves.

Do not add OCR to reconstructed redacted pages without a new security model and
proof that removed information cannot be rebuilt. Do not raise raster/image limits
without real browser memory measurements. Watermarks or other future appearance
operations must compose before redaction sanitization when they belong beneath
it; their source assets must not create alternate recoverable representations.
Complete and retain the exact CI/deployment record before treating this phase as
the starting PASS baseline for further work.
