# Checkpoint B — OCR rejection diagnosis

Status: PARTIAL for the original incident, PASS for synthetic stage diagnosis and
privacy-safe instrumentation. The owner's two response envelopes alone do not
identify which input predicate failed; their original PDF/rejection-stage record
is not available here. Do not label the original incident resolved.

## Verified behavior and exact stage map

| Input/check                                                       | Result and stage                                                                                                                     |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Encrypted PDF                                                     | qpdf `--is-encrypted`, input-validation / encrypted; rejected.                                                                       |
| Damaged PDF or qpdf recovery warning                              | qpdf check, input-validation / invalid-input; rejected without repair.                                                               |
| More than 20 pages                                                | qpdf page inventory, input-validation / page-limit.                                                                                  |
| Interactive AcroForm                                              | qpdf form inventory, input-validation / interactive-forms.                                                                           |
| URI hyperlink, JavaScript, external/active structures, signatures | `validate_pdf_structure` inside native inventory, source-inspection / unsafe-structure.                                              |
| Harmless local GoTo link or passive note                          | Shared safety scan passes; OCR's stricter `/Annots` check rejects at source-inspection / annotations. It is not evidence of malware. |
| Page over 1008 points per side after UserUnit                     | source-inspection / page-dimensions.                                                                                                 |
| Image/mask above 16 MP                                            | source-inspection / image-budget.                                                                                                    |
| Effective raster above 400 DPI or 16 MP                           | source-inspection / raster-budget.                                                                                                   |
| Nested/excessive resources                                        | source-inspection / resource-budget.                                                                                                 |
| Digital selectable text                                           | pagesOcred=0; no-ocr-needed if all pages skipped; no engine dispatch.                                                                |
| Existing text plus scan on the same page                          | Whole page skipped by the existing conservative `--skip-text` policy.                                                                |
| Separate digital and scanned pages                                | Digital pages skipped; scanned pages are candidates.                                                                                 |
| Image-only scan or outlined glyph graphics                        | OCR candidate, not proof recognition will succeed.                                                                                   |
| Empty page                                                        | Skipped. Blank raster scans remain candidates and can fail meaningful-recognition verification.                                      |

Synthetic 960x540 presentation PDFs with text, images and URI/local links reproduce
the two distinct annotation/action rejection stages. This is not an assertion
that Microsoft PowerPoint produced the owner's PDF. Linux integration additionally
checks the existing real `slides.pptx` -> LibreOffice PDF derivative reaches
`no-ocr-needed` without an OCR engine dispatch. Native Microsoft PowerPoint is not
available in this environment.

Browser OCR preparation calls the normal workspace export. Kagaz annotations and
form values are drawn/flattened through existing contracts; ordinary source page
annotations/links can survive page copying. Therefore a successful browser export
does not imply that the OCR route's stricter native policy will accept the file.

## Changes and safety decisions

Added fixed `{ event, stage, category }` rejection diagnostics around OCR and fixed
native rejection markers. The API accepts only enum categories from native stdout;
it never logs arbitrary native text, document text, paths, filenames, identity,
headers, exception messages or dumps. The response schema/status stays unchanged.
Diagnostics cannot affect processing, cancellation, reservation or cleanup.

Updated frontend disclosure and 422 guidance to explain selecting readable text,
mixed-page skipping, invisible recognition, limits and source-annotation/link
restrictions. Neither `no-ocr-needed` nor OCR success means the visible source is
editable. No automatic conversion, forced OCR, rasterization, link removal or
flattening was introduced.

No compatibility restriction was relaxed. The URI policy is explicit in the
shared security scanner and its attack tests. The harmless local-link rejection
comes from OCR's visual-derivative retention contract: the output verifier checks
streams, images, geometry and text but does not independently verify annotation
destinations/appearances. Simply accepting annotations could silently lose or
change content. A bounded future compatibility change must whitelist inert local
links, canonicalize destination targets by output page identity and compare their
geometry/semantics after OCR. External-link removal or raster conversion would
need an explicit user-reviewed derivative option and disclosure of interactivity,
selectability, layout and accessibility effects. No such lossy step was taken.

All upload/page/dimension/image/DPI/memory/CPU/time/workspace limits, active-content
checks, `--skip-text`, retention verification and resource cleanup are preserved.

## Files and design

Changed native OCR inspection, `ocr.ts`, internal error categorization and qpdf
validation tags; added `ocrDiagnostics` and native/mocked stage tests; expanded
PPTX integration coverage; updated OCR dialog/client copy and browser feedback
regression/CI. `pdf_safety.py` and the browser export pipeline are inspected but
unchanged. No dependency or configuration changes.

Read `design.md` and the required gpt-taste skill; kept the existing dialog,
typography, surfaces, controls, focus/escape behavior and reduced-motion support.
Only explanatory text changes; no redesign or new motion.

## Validation and remaining work

- Mock OCR HTTP plus diagnostic tests: 43 passed.
- Native OCR classifications plus existing shared malicious-structure tests:
  43 passed (15 new inventory cases + 28 shared safety cases). Local diagnostics
  used an isolated external Python environment with pikepdf 10.17/OCRmyPDF 17.13;
  deployment uses the unchanged Debian image, verified by Linux CI.
- Frontend OCR tests: 28 passed; dialog text additionally asserts mixed-page and
  source-editing limitations.
- `verify-ocr-feedback.mjs`: passed in Chromium with both captured response codes
  mocked; no backend upload occurred. Desktop/mobile screenshots inspected, retry
  and Escape checked. Artifacts are outside Git in the task artifact directory.
- `pnpm lint`, `pnpm typecheck`, `pnpm build`, format and diff checks pass on the
  release candidate. An initial test-only require-await lint error was repaired.
- Real OCR engine/LibreOffice tests and full container/emulator checks require
  Linux CI; do not represent local mocked feedback as native OCR success.

No production deployment or settings change is performed. After review and green
CI, merge the separate PR to deploy diagnostics. A new user-initiated OCR request
can then identify a failing stage without logging content. The historical envelope
cannot be retroactively assigned a root cause.

## Acceptance checklist

- [x] Inspect OCR/native safety/browser export and frontend handling.
- [x] Reproduce common synthetic digital/mixed/scanned/outlined/blank PDFs.
- [x] Reproduce presentation dimensions, text/images and both hyperlink classes.
- [x] Identify exact synthetic validation predicates; preserve malicious rejection.
- [x] Add fixed-category diagnostics and privacy/engine-nondispatch tests.
- [x] Clarify selection/OCR/unsupported-document guidance without lossy conversion.
- [x] Preserve existing resource and security limits.
- [ ] Attribute the owner's original unsupported PDF to a specific predicate;
      requires its stage metadata or a separately supplied reproduction.
- [ ] Enable broader source-annotation compatibility; retention verification is
      required before safely changing this policy.

Next agents must not fix this by bypassing `validate_pdf_structure`, deleting
links silently, increasing resource limits, or forcing OCR over digital pages.
