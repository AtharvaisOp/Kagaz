# Phase 3F — Visual signature export

Committed starting SHA: `cac53afaa6ff4193245002f52a298649f35d0502`.
Inherited working tree: dirty, explicitly authorized Phase 3F work.
Known committed baseline: 324 tests; exact-SHA CI run 27 completed successfully.
No pristine-baseline test run is claimed. The inherited implementation ran 346
tests successfully before the additional repairs and coverage described below.

## Inherited file review

Every tracked diff and both untracked files were read before further edits.
All 31 files were Phase 3F related. No unrelated or suspicious files were found.
“Incomplete” below describes the inherited state, not an unexplained change.
Paths are relative to `apps/web/src/`.

| File                                                                      | Initial classification and validation                                                                                                                                                                           |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `features/pdf-annotations/components/annotationSummary.ts`                | Valid: identifies field-targeted visual marks.                                                                                                                                                                  |
| `features/pdf-annotations/hooks/usePdfAnnotations.ts`                     | Incomplete: field placement and removal of export block were valid; asynchronous cancellation needed tightening. Browser placement/delete/Undo/Redo verified.                                                   |
| `features/pdf-annotations/model/signature.test.ts`                        | Valid: domain, target, and reachability coverage.                                                                                                                                                               |
| `features/pdf-annotations/model/types.ts`                                 | Valid: signature remains its own kind with source/widget target metadata.                                                                                                                                       |
| `features/pdf-annotations/model/validation.ts`                            | Valid: validates optional target identity.                                                                                                                                                                      |
| `features/pdf-annotations/geometry/signatureFieldFit.ts` (untracked)      | Valid: contains/centers with an 8% margin in canonical raw coordinates. Integrated and retained.                                                                                                                |
| `features/pdf-annotations/geometry/signatureFieldFit.test.ts` (untracked) | Valid: aspect ratio and center tested at all four cardinal rotations.                                                                                                                                           |
| `features/pdf-forms/components/FormStatusNotice.tsx`                      | Valid: distinguishes visual placement and form flattening.                                                                                                                                                      |
| `features/pdf-forms/discovery/discoverPdfForms.test.ts`                   | Incomplete: PDF.js signature metadata coverage needed stronger structural and real-browser checks.                                                                                                              |
| `features/pdf-forms/discovery/discoverPdfForms.ts`                        | Incomplete: PDF.js signatures alone omit malformed or value-only signatures. Added independent parsed-object safety boundary. Browser checks also exposed and repaired the existing zero-MaxLen interpretation. |
| `features/pdf-forms/hooks/usePdfForms.ts`                                 | Valid: retains signature safety metadata during discovery.                                                                                                                                                      |
| `features/pdf-forms/model/exportSafety.test.ts`                           | Valid: unsigned/signed capability distinction.                                                                                                                                                                  |
| `features/pdf-forms/model/exportSafety.ts`                                | Incomplete: signed flag must precede a `none` status. Repaired.                                                                                                                                                 |
| `features/pdf-forms/model/exportSnapshot.test.ts`                         | Valid: source safety metadata in snapshot fixtures.                                                                                                                                                             |
| `features/pdf-forms/model/types.ts`                                       | Valid: explicitly labels detection as structural, not verification.                                                                                                                                             |
| `features/pdf-forms/rendering/FormWidgetLayer.test.tsx`                   | Valid: action and placed-state semantics. Browser adds actual keyboard and history checks.                                                                                                                      |
| `features/pdf-forms/rendering/FormWidgetLayer.tsx`                        | Incomplete: action was appropriate but needed read-only-field guard.                                                                                                                                            |
| `features/pdf-viewer/PdfPage.tsx`                                         | Incomplete: correct page/widget targeting; placement now requires discovered AcroForm state.                                                                                                                    |
| `features/pdf-viewer/PdfViewer.tsx`                                       | Valid: passes the field creator handler through.                                                                                                                                                                |
| `features/pdf-workspace/hooks/usePdfExport.test.ts`                       | Valid: signature IDs join image snapshot IDs and friendly missing-asset errors.                                                                                                                                 |
| `features/pdf-workspace/hooks/usePdfExport.ts`                            | Valid: preserves signature kind, uses committed state, and maps safe errors.                                                                                                                                    |
| `lib/pdf-export/annotations/exportContracts.ts`                           | Valid: replaces obsolete unsupported-signature error with missing-asset error.                                                                                                                                  |
| `lib/pdf-export/annotations/flattenAnnotations.test.ts`                   | Incomplete: added exact Rectangle/Signature/Text and reversed ordering, mixed image/signature cache checks.                                                                                                     |
| `lib/pdf-export/annotations/flattenAnnotations.ts`                        | Valid: shared embedding cache and raw-geometry drawing in array order.                                                                                                                                          |
| `lib/pdf-export/annotations/imageAssets.ts`                               | Incomplete: sequential registry lookups were mutable across awaits. All Blobs are now captured synchronously.                                                                                                   |
| `lib/pdf-export/exportWorkspace.test.ts`                                  | Incomplete: added click-time state, move/delete, Undo/Redo, missing-asset, and page-rotation coverage.                                                                                                          |
| `lib/pdf-export/exportWorkspace.ts`                                       | Incomplete: removing the Phase 3E block was valid; actual-source safety checks needed to run even for a `plain` snapshot.                                                                                       |
| `lib/pdf-export/formExport.test.ts`                                       | Incomplete: initial cleanup tests expanded to nested/merged/repeated/unsafe structures and duplicate source identities.                                                                                         |
| `lib/pdf-export/forms/prepareFormSource.ts`                               | Incomplete: empty appearance strategy was valid; added post-flatten field/widget/ref guards.                                                                                                                    |
| `lib/pdf-export/forms/types.ts`                                           | Valid: signed-PDF and cleanup errors are separate from visual signatures.                                                                                                                                       |
| `styles.css`                                                              | Valid: orange field action, cyan focus, mono labels, restrained 140ms transitions, existing reduced-motion override.                                                                                            |

## Architecture and investigation

`SignatureAnnotation` remains distinct from `ImageAnnotation`. Both use the
existing PNG/JPEG asset registry, export snapshot, and embedding cache. Rendering
iterates the annotation array once; no separate signature pass changes z-order.
Annotation boxes stay in raw PDF user space; the copied page rotation is applied
once after content is drawn. PNG alpha becomes a PDF image soft mask.

The registry snapshot captures every immutable Blob before the first await.
Reducer updates replace annotations rather than mutating captured objects.
Export operates on original Files and temporary pdf-lib documents; it does not
commit form/annotation edits, clear dirty state, or modify undo history.

The installed pdf-lib 1.17.1 source and its
[PDFSignature API](https://pdf-lib.js.org/docs/api/classes/pdfsignature) and
[PDFForm API](https://pdf-lib.js.org/docs/api/classes/pdfform) were inspected.
The following behaviors were reproduced in tests:

- An unsigned signature with no appearance makes `removeField()` and `flatten()`
  throw. Signature fields do not generate their own appearances.
- `copyPages()` alone copies widgets but does not carry the source AcroForm root:
  the reloaded output can have zero pdf-lib fields and still have PDF.js widgets.
- With an appearance supplied, pdf-lib can remove or flatten a signed field. Its
  APIs do not protect the existing digital signature.
- `removeField()` can remove an appearance reference from page Annots instead
  of the widget reference, while deleting the widget object. Merely saving and
  reloading without checking Annots does not establish safety.

For unsigned fields, export first validates geometry and page/widget ownership.
It assigns temporary empty appearances, removes signature fields, flattens
supported ordinary forms, removes captured widget Annots references, and checks
that no fields, widgets, or unresolved page annotations remain. Temporary
appearances are discarded. Visual signatures are then drawn as page content.
Nested field trees, merged field/widgets, and repeated widgets are covered.
Unsupported structures fail closed; they are not rewritten speculatively.

## Signed-source policy

PDF.js clears raw signature widget values and filters malformed signature ranges
out of `getSignatures()`. Consequently its discovery metadata is insufficient for
this safety decision. A dynamically imported pdf-lib parser examines objects
before a source enters the editable workspace and again before export changes
any source document. It rejects signature values, dangling values, inherited
signature types, byte-range dictionaries, and signature/timestamp contents.
The check includes inline and compressed object structures. It deliberately
prefers false positives to changing an existing signature.

User message: “This PDF contains a digital-signature value or byte-range
structure. Kagaz does not modify digitally signed PDFs because changes can
invalidate the signature.”

This is neither certificate verification nor signer authentication. Source
rejection prevents page changes, form edits, annotations, and export for that
source. Other valid files in a batch can still be used.

## Browser artifact verification

Executed in local Chrome against Vite, using synthetic documents and signatures:

- Draw → place → Download → strict reload, PDF.js render and image inventory.
- Type, PNG upload, and JPEG upload → Download → inspect.
- Drawn, typed, and PNG outputs contain image soft masks; JPEG remains opaque.
- 0° and intrinsic 90° artifacts visually inspected; geometry tests cover
  0°/90°/180°/270°. Keyboard field activation and auto-placement also tested at 90°.
- Filled text, checked checkbox, visual signature, Rectangle, and Image together.
- Extract a signature page and separately extract an unsigned page.
- Undo → signature absent; Redo → present. Field deletion/Undo restores the
  placement affordance and subsequently restores the visual mark.
- Pause export during Blob reading, move and delete the signature, then resume:
  captured output retains the mark; the next export omits it.
- Import the same form twice, fill independent values, place different visual
  signatures into same-named fields, reorder pages, export, and compare image
  streams and text by page. Associations remain correct.
- Reject a signature value without a ByteRange before an editable page appears.
- Desktop 1440×1100 and mobile 390×844 layouts inspected; reduced-motion mode
  exercised. No page-level horizontal overflow, browser errors, or non-GET
  application requests were observed in the completed run.

The browser exercise caught a real form-discovery defect: absent MaxLen is
reported as zero by PDF.js. It is now normalized to no length limit, including
repeated-widget metadata, rather than truncating filled text to an empty string.
One development run was invalidated by editing/formatting while Vite HMR was
active; the full suite was rerun against stable source before accepting results.

`scripts/verify-phase3f.mjs` reproduces these checks. It uses an externally
available Playwright installation and Chrome; neither is added to production or
repository dependencies. Start Vite on 127.0.0.1:5173, create an artifact directory
outside the repository, then configure:

```text
KAGAZ_ARTIFACT_DIR=<existing external output directory>
KAGAZ_PLAYWRIGHT_MODULE=<path to installed playwright package>
KAGAZ_CHROME_PATH=<Chrome executable path, or omit for Playwright Chromium>
node scripts/verify-phase3f.mjs
```

The harness saves PDFs, editor screenshots, rendered artifact screenshots, and
`browser-results.json`. Only synthetic fixture content is used. It never uploads
PDF/signature bytes, sends signing requests, or creates a persistent signature
library.

## Local quality gates

| Gate                             | Result                                                                                                          |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile` | Passed; manifests and lockfile unchanged. Local bundled pnpm reports 11.19.0; repository CI uses pinned 12.3.4. |
| `pnpm lint`                      | Passed.                                                                                                         |
| `pnpm typecheck`                 | Passed.                                                                                                         |
| `pnpm test`                      | 376 passed across 52 files; net +52 from the known 324-test baseline.                                           |
| `pnpm build`                     | Passed; Vite warns about the main chunk exceeding 700 kB.                                                       |
| `pnpm format:check`              | Passed.                                                                                                         |
| `git diff --check`               | Passed.                                                                                                         |

Production build: main JS 751.11 kB / 231.38 kB gzip; pdf-lib lazy chunk
428.21 kB / 178.33 kB gzip; signature-safety lazy chunk 2.47 kB / 1.22 kB gzip.
There is no static pdf-lib import from the main application. The size warning is
reported, not suppressed; broader bundle optimization is outside Phase 3F.
Final commit and exact-SHA CI status are recorded in the phase completion report.

## Design and scope

Read `design.md` in full and used gptTaste for interaction polish. The existing
Inter/JetBrains Mono, dark surfaces, orange actions, cyan focus, compact density,
and reduced-motion rules take priority over that skill's landing-page and GSAP
suggestions. No visual redesign or animation dependency was introduced.

No deployment configuration changed. No deployment or Phase 3G implementation
was performed. Backend, package manifests, and lockfile remain unchanged.

## Acceptance checklist

- [x] Draw, Type, PNG, JPEG signature export through original signature asset IDs.
- [x] PNG transparency and shared embedding cache.
- [x] Canonical position, size, rotation, and exact forward/reverse z-order.
- [x] Download and signature-page/unsigned-page Extract.
- [x] Pending signature remains blocked; missing asset fails with friendly error.
- [x] Immutable click-time asset and state snapshot; move/delete race verified.
- [x] Undo/Redo export inclusion and field affordance restoration.
- [x] Text field + checkbox + signature + Rectangle + Image artifact.
- [x] Duplicate sources, same-name fields, reordered multi-PDF association.
- [x] Signed-source import/export block without validity claims.
- [x] Safe unsigned field action, creator reuse, fit, and source/widget targeting.
- [x] Strict reload, zero fields, zero widgets, no dangling output refs.
- [x] Existing form/annotation regression suite, including unsafe-source guards.
- [x] Browser execution and 0°/90° artifact inspection.
- [x] Local-only processing, no signature persistence or logging.
- [x] No new dependency; pdf-lib remains a lazy chunk.

## Limitations and next-phase notes

Visual signatures are not cryptographic digital signatures. There is no
certificate signing, PKI, PAdES, certificate/signature verification, backend
signing, or signature persistence. XFA, password fields, push-button actions, and
unknown form structures remain unsupported. Ordinary form/annotation text still
uses Standard Helvetica; unsupported Unicode fails clearly. Typed signatures
are rasterized locally by the browser.

Signed sources are rejected, even if a signature is malformed or unverifiable.
Unsigned fields require safe structure; export removes all unsigned widgets,
including unused ones. A visual mark does not populate a cryptographic `/V`.
The extra import-time parse adds CPU/memory cost for large files; it is retained
to prevent editing before safety is known. Never weaken this boundary to rely
solely on PDF.js signature metadata. Preserve raw-space geometry and synchronous
Blob capture when extending export. Phase 3G has not been started.
