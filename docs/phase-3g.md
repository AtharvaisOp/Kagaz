# Phase 3G — Final Phase 3 hardening

Starting point: clean `main` at `b83795020b9a22030c1c075eb113480d239e2b58`.
Baseline: 376 tests; exact-SHA CI run 28 (`36678904172`) completed successfully.
Scope: Phase 3 forms/signatures only. No deployment or Phase 4 implementation.

## Implemented and architectural decisions

- Supported committed form values are projected onto the existing lazy thumbnail
  Canvas2D overlay before annotations. Text, multiline, checkbox, radio, dropdown,
  and selected option-list values use canonical widget geometry and PDF.js's
  viewport transform. Repeated widgets share a field value; duplicate sources
  remain isolated through opaque identities. No native controls, Konva stages,
  password plaintext, XFA, or fake editable signature values are added to thumbnails.
  This is a lightweight, clipped preview, not exact source appearance reproduction.
- Form discovery results are cached per source instance, and widgets indexed by
  source/page. Export indexes fields by name once instead of repeatedly walking
  the whole field tree for every value. No new package or backend call was added.
- An iterative preflight validates AcroForm references, parent/child ownership,
  cycles, duplicate widgets, missing/orphan widgets, page ownership, and finite,
  positive rectangles before recursive pdf-lib field APIs run. Nesting beyond 64
  levels fails closed to protect those downstream APIs. Ordinary annotations are
  retained only when their references resolve. Inputs are never repaired speculatively.
- Signature inspection now also detects indirect timestamp types and conflicting
  inherited signature types. ByteRange structures, dangling signature values, and
  malformed signature dictionaries remain blocked without validity claims.
  JavaScript actions are rejected at admission and export. Existing XFA,
  password-field, push-button, and unsupported-field export blocks remain intact.

## Defects repaired

1. Deleting an annotated page previously removed the entire annotation domain
   from the global history. Transactions now carry page identity and prune only
   removed pages, preserving surviving form/annotation chronology.
2. Adding a source after edits omitted its baseline from earlier history
   snapshots. Initialization now extends past/future snapshots with new defaults.
3. Async discovery initialization could race a previous render's pruning and
   erase a newly discovered source's defaults. Initialization and pruning now
   run from the same committed discovery view. Browser checks assert original
   values in both repeated widgets of both duplicate source instances.
4. Explicitly cleared radio/choice values could fall back to initial selections
   during export. Only `undefined` now falls back; intentional `null` is preserved.
5. Signature creator focus could escape its modal. Focus enters the creator,
   Tab/Shift+Tab are contained, Escape closes it, and the trigger regains focus
   when it still exists. Method tabs support arrows/Home/End. Switching tabs
   repaints the drawing or typed preview.
6. Delayed canvas-to-Blob completion could create a signature after closing the
   creator. A generation guard and busy state prevent stale and duplicate accepts.
7. Asset reset did not immediately invalidate pending registry decodes. Reset now
   revokes pending URLs and closes any late decoded image exactly once. Existing
   past/present/future reachability retains Undo/Redo assets; abandoned futures
   are reconciled normally.
8. Form discovery now checks cancellation after metadata and annotation awaits,
   rejects malformed mixed-type rectangles instead of filtering them into valid
   ones, excludes password values from the model, and exposes a safe error message.
9. Start Over pointer activation no longer blurs and commits an active form draft
   before the user decides whether to discard it. Cancel preserves the draft.
10. Unnamed-field labels no longer expose PDF annotation reference IDs.

## Files and design compliance

Changes are confined to `apps/web/src/features/pdf-forms`, annotation history,
assets and creator, viewer/thumbnail wiring, `lib/pdf-signatures`, export safety,
tests, verification scripts, and this documentation/README.

Read `design.md` completely. gptTaste was used for restrained focus, disabled/busy,
and interaction polish. Existing Inter/JetBrains Mono, dark surfaces, orange
actions, cyan focus, compact editor layout, and reduced-motion behavior remain
authoritative; no landing-page redesign, GSAP, new motion, or font dependency was
introduced. React best-practices review covered cleanup, cached discovery,
indexed lookups, and dynamic loading. Astra High was requested; the current chat
did not expose a tool to switch its own model, so that setting is not claimed.

## Executed browser verification

Chrome through the externally available Playwright runtime against local Vite;
no browser tooling was added to repository dependencies. The agent-browser CLI
was unavailable, so the existing Playwright harness approach was retained.

- `scripts/verify-phase3f.mjs`: Draw, Type, PNG/JPEG, field placement, mixed forms,
  images and annotations, duplicate sources/same names, reorder, Extract, strict
  reload, PDF.js widget inventory/rendering, signed-source rejection, and export
  click-time asset snapshots while marks are moved/deleted.
- `scripts/verify-phase3g.mjs`: native dialog accept/dismiss for clean, untouched
  focus, form, annotation, workspace, combined and changed active draft; one
  confirmation for unsaved work; Cancel preserves state; Confirm/reopen restores
  original forms and empty history. Six-edit form/signature/rectangle/checkbox/
  signature-move/dropdown sequence, Undo/Redo, new branches in all three editing
  domains, page deletion with surviving history, native input Ctrl+Z/global Undo,
  creator focus/tab repaint/stale canvas conversion, export failure preservation,
  Extract errors, and 0/90/180/270-degree form/signature exports.
- `scripts/verify-phase3g-lifecycle.mjs`: Start Over during paused export and image
  reads, rapid PDF replacement, adding a source after edits, thumbnail pixel
  changes and Undo/Redo for all supported kinds, duplicate isolation, no controls
  or Konva in thumbnails, malformed browser imports, and multiple assets/sources.
- Mobile 390×844 and 360×800: forms, rectangle, Draw/Type/Upload, unsigned field
  placement, page manager/navigation, scrolling, toolbar, Extract validation,
  Cancel/Confirm, and reduced-motion mode. No document-level horizontal overflow
  or permanent body scroll lock was observed. PDF surfaces and the compact
  toolbar intentionally scroll within their own containers.
- Screenshots inspected for both mobile layouts, form thumbnails, and rotated
  output. Browser viewport emulation does not substitute for physical-device
  stylus/touch testing; mouse/pointer input was used for drawing in these runs.

All source fixtures and artifacts are synthetic. Generated PDFs, screenshots,
and JSON observations are stored outside the repository. Repeat with Vite on
`127.0.0.1:5173`, setting `KAGAZ_ARTIFACT_DIR`, `KAGAZ_PLAYWRIGHT_MODULE`, and
optionally `KAGAZ_CHROME_PATH`, as documented for Phase 3F. Run the Phase 3F
script first to create the synthetic PNG/JPEG used by the Phase 3G scripts.

## Performance and privacy

Observed local runs, not service-level thresholds:

| Fixture                                                             | Load + discovery                         | Export          | Active rendering                             |
| ------------------------------------------------------------------- | ---------------------------------------- | --------------- | -------------------------------------------- |
| 100-page plain PDF                                                  | about 1.1–1.6 s                          | about 0.3–0.5 s | 4 main canvases, 6 thumbnails, 0 form inputs |
| 80-page form PDF                                                    | about 1.1–1.7 s                          | about 0.3–0.5 s | 4 main canvases, 6 thumbnails, 4 form inputs |
| Three duplicate sources, six pages, several signatures/images/forms | about 1.8–2.4 s including scripted edits | about 0.3–0.5 s | source-instance isolation retained           |

Diagnostic JS heap observations were roughly 69–105 MB in the many-page runs;
these are transient browser estimates, not retained-memory or leak proofs.
No hangs or accumulating render surfaces were observed. Source metadata must
still be discovered across all pages; PDF.js page proxies are cleaned afterward.
The import-time safety parse and export parse remain deliberate costs.

PDF bytes, values, images, and signatures remain browser-local. Browser runs
observed no non-GET application requests, no local/session storage persistence,
and no page errors. Application source has no sensitive console logging or
new network/storage API. No signature library or cryptographic signing was added.

## Validation and release

| Gate                                          | Result                                 |
| --------------------------------------------- | -------------------------------------- |
| `pnpm install --frozen-lockfile`              | Passed; no dependency changes          |
| `pnpm lint`                                   | Passed                                 |
| `pnpm typecheck`                              | Passed                                 |
| `pnpm test`                                   | 409 passed across 54 files             |
| `pnpm build`                                  | Passed; existing size warning retained |
| `pnpm format:check`                           | Passed                                 |
| `git diff --check`                            | Passed                                 |
| Phase 3F, Phase 3G, lifecycle browser scripts | Passed                                 |

Main JS is 755.48 kB / 232.72 kB gzip, versus 751.11 / 231.38 kB at
baseline (+4.37 kB / +1.34 kB gzip). The lazy pdf-lib chunk is unchanged at
428.21 kB / 178.33 kB gzip. The lazy safety chunk is 4.34 kB / 1.67 kB gzip.

The phase completion response records the final commit, exact-SHA CI run, final
bundle measurements, and actual results of every repository gate. Local pnpm
reports 11.19.0; CI uses repository-pinned 12.3.4. No manifests or lockfile changed.
The final unit suite contains 409 tests (33 added to the 376-test baseline), plus
the browser regressions above. The pre-existing main-bundle size warning remains
visible. pdf-lib is still outside the initial application bundle and loaded on
first PDF selection/export through dynamic boundaries.

## Acceptance checklist

- [x] Clean expected main/SHA, required documents, baseline gates and 376 tests.
- [x] Start Over clean/form/annotation/workspace/combined/draft/focus scenarios.
- [x] Native confirmation count, Cancel, Confirm, reopen and no resurrected history.
- [x] Combined annotation/page-deletion Undo chronology with no invisible step.
- [x] Canvas2D committed form thumbnails, canonical geometry, rotation and zoom independence.
- [x] Duplicate-source isolation, repeated widgets, lazy rendering and no interactive thumbnail controls.
- [x] No password plaintext or fake unsupported/XFA/signature thumbnail values.
- [x] Plain/forms/signatures/unsigned fields/duplicates/reorder/Extract export regressions.
- [x] Mixed annotations/images/signatures and all four cardinal rotations.
- [x] Click-time snapshots, cancellation, failure preservation and no partial download.
- [x] Strict output reload, removed fields/widgets and no dangling Annots.
- [x] XFA/password/push-button/JavaScript/digitally signed safety boundaries retained.
- [x] Malformed refs/missing and duplicate widgets/invalid rectangles/dimensions/nested trees.
- [x] Malformed signature values, suspicious ByteRange and indirect timestamp structures.
- [x] Discovery, decoding, source removal/reset/unmount and replacement guards audited.
- [x] Asset reachability, abandoned futures, pending cleanup and exactly-once revocation.
- [x] Unified six-edit Undo/Redo and redo invalidation across form/annotation/signature branches.
- [x] Keyboard editing/shortcuts, creator focus, field action, semantic list and error/status review.
- [x] Both mobile viewports and restrained reduced-motion interaction checks.
- [x] Representative 100/80-page and multi-source/multi-asset performance observations.
- [x] Browser-local data, no signature persistence/logging or unexpected mutation requests.
- [x] Focused regression tests and final diff review for identity/rotation/lifecycle/security/scope.
- [x] Repository install/lint/typecheck/test/build/format/diff gates passed.
- [x] No dependency sprawl, backend addition, deployment or Phase 4 implementation.

## Remaining limitations and next-phase notes

Thumbnail fonts, backgrounds, and choice layouts are intentionally approximate;
export remains the authoritative appearance. Standard Helvetica export cannot
encode every Unicode character and fails visibly without discarding work.
Conservative malformed-PDF rejection may reject unusual but repairable documents.
No arbitrary malformed-PDF repair is attempted. Extremely large PDFs may still
pressure browser memory. Physical-device touch/stylus verification remains useful;
this phase executed desktop Chrome and mobile viewport emulation.

Keep field IDs opaque. Do not move initialization back into async discovery
callbacks, clear an entire history domain for a single deleted page, replace
intentional null selections with defaults, or remove the independent parsed-object
signature safety check. Preserve synchronous Blob capture, dynamic pdf-lib imports,
canonical PDF geometry, and the existing local-first boundary in future phases.
