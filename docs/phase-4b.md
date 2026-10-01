# Phase 4B: English OCR and searchable PDF derivatives

Starting point: clean `main`, `7fa5d2a4601c4d750da95cbf96137f5c6bb65dd2`,
471 existing tests, exact-SHA CI run 31 completed successfully. This phase adds
only OCR; conversion, Phase 4C, cloud OCR, persistence and manual deployment are
outside its scope.

## Engine and preservation policy

OCRmyPDF orchestrates Tesseract rather than a custom raster/OCR/reassembly pipeline.
The production image uses Debian Bookworm's packaged OCRmyPDF and its required
Python/image dependencies, existing Ghostscript/qpdf, and English Tesseract data.
No application npm dependency or large language catalogue is added. The distro
Tesseract dependency also includes its small orientation data pack; language
selection remains strictly `eng` and orientation correction is not exposed.

Fixed arguments select `eng`, `--skip-text`, standard PDF, `--optimize 0`, hOCR,
one worker, a 60-second Tesseract page timeout and a 16 MP image budget. hOCR is
appropriate to English and is documented as compatible with PDF.js text
segmentation. PDF/A conversion, forced OCR, lossy optimization, cleaning,
rotation correction and deskew are disabled. The existing page rotation remains
part of the workspace export. Language packs can be added later by extending the
explicit language contract and image installation together.

Pages with any text operators are skipped conservatively, including mixed text
and image content on the **same page**. Page-wise mixed documents retain digital
text and OCR their separate scanned pages. This protects digital typography but
does not repair damaged old OCR or OCR a scan underneath a typed form/annotation.
Blank vector pages are copied and counted as skipped. An entirely digital/blank
document returns `no-ocr-needed`, without invoking OCRmyPDF. An image-only page
with no meaningful recognized text (including a blank raster scan) causes
`ocr-failed`, rather than a false successful-searchability claim. Recognition is
imperfect; reviewers must examine text before relying on it.

## Shared lifecycle and limits

`ToolService.handle` selects compression or OCR inside the existing admission,
request deadline, private workspace, multipart streaming, native runner,
response-streaming and cleanup lifecycle. Both tools share one active request and
two abortable FIFO waiters; OCR cannot overlap another heavy request. Admission
continues to cover upload through cleanup. The existing parser selects one
operation-specific enum field and byte limit. User filenames and MIME declarations
have no path or execution authority.

Compression's existing defaults remain intact. OCR uses a distinct profile:

| Boundary                        | OCR limit                          |
| ------------------------------- | ---------------------------------- |
| Generated input                 | 10 MiB                             |
| Pages                           | 20                                 |
| Physical page                   | 14 inches per side                 |
| Source/raster DPI               | 400                                |
| Image and page raster           | 16 MP                              |
| Output/native individual file   | 40 MiB                             |
| Native wall deadline            | 240 seconds                        |
| Whole request including queue   | 300 seconds                        |
| Tesseract per page              | 60 seconds                         |
| Linux per-process address space | 768 MiB                            |
| Linux per-process CPU           | 240 seconds                        |
| Aggregate temporary files       | 192 MiB monitored every 500 ms     |
| Temporary inventory             | 4,096 entries, 16 directory levels |

Address-space bounds are per process, not aggregate RSS. The 512 MiB container
memory limit, CPU cap and bounded tmpfs in verification provide independent
aggregate enforcement; hosting memory limits serve that role on Render. The disk
monitor has a sampling interval, so it is not an exact filesystem quota. Deploy
on ephemeral bounded storage and keep host/container limits enforced. Windows
development lacks `prlimit`; production Linux is the authoritative resource test.

The native runner still uses fixed executable/argument arrays, `shell: false`,
closed stdin, an environment allowlist and bounded/drained diagnostics. OCR
thread counts are bounded in its environment. SIGTERM escalates to process-group
SIGKILL even if the parent closes early; settlement waits for that escalation
before cleanup. Windows uses `taskkill /T /F` for owned descendants. A regression
test covers a parent that exits while its child ignores SIGTERM. Shutdown and
disconnect use this same path. Neither stderr nor OCR content is returned or logged.

## API and independent validation

`POST /tools/ocr` accepts exactly `file` and `language=eng`. Success is a noncached
PDF attachment with shared `OcrMetadata` headers: original/output bytes, pages,
language, pages OCRed and pages skipped. Output may legitimately be larger.
`unsupported-language`, `no-ocr-needed` and `ocr-failed` extend existing typed
errors. CORS exposes metadata only to configured origins and rejects denied
origins before parsing. CORS is not authentication or a distributed quota.

Header, encryption, strict qpdf structural checks, page counts and AcroForm
inventory are shared with compression. The OCR preflight additionally checks
page dimensions, source/raster DPI, image/mask pixels, nested resource count,
unflattened annotations and unsafe signed/XFA/JavaScript structures. Its fixed
Python inspector uses pikepdf, PDFMiner and OCRmyPDF's page inventory, which are
already OCRmyPDF dependencies, inside a bounded native process. Its stdout contains
only page counts, never text.

Exit zero is insufficient. Output must pass the PDF/header/qpdf checks, retain
page count and reload with pikepdf/PDFMiner. Each page must keep its boxes,
rotation, image/mask encoded-byte digests and original drawing streams in order.
OCRmyPDF coalesces multiple streams, so their individual contents are checked in
sequence rather than requiring old stream separators. Existing digital text is
compared using whitespace-normalized digests; each page requiring OCR must yield
meaningful extracted characters. Missing, corrupt, nonsearchable or changed
output fails closed. Fixture verification independently reloads with pdf-lib and
PDF.js, checks expected English words without punctuation-perfect matching, and
compares rendered pixels.

These are preservation and structural checks, not a general semantic proof for
every advanced PDF feature. The browser export supplies a flattened visual
derivative. Existing PDF/signature/form safety remains authoritative before upload.

## Frontend, design and privacy

`OcrDialog` uses `prepareWorkspace`, without source uploads or workspace mutations.
Compression and OCR now share their short-lived derivative controller, bounded
response transport and native modal/focus handling. Only explicit Submit exports
and uploads; opening, selection and effects do not upload. Cancel/close/Escape/
unmount invalidate late completions, duplicate submits use a synchronous ref,
and Retry takes a new snapshot. Results stay in memory until dialog close.

The notice says: “This uploads the current PDF temporarily to the Kagaz server for
OCR.” It explains English OCR, scanned-page text, skipped existing text,
temporary retention and ordinary browser-local editing. Progress is stage-based.
Download uses the existing object-URL lifecycle. Server/network/export errors use
safe local messages, and all pending-signature, signed-source, form, XFA,
password-field and glyph blockers remain in the same export implementation.

`design.md` was read fully. Its Inter/JetBrains Mono, dark surfaces, cyan notice,
orange primary action, border geometry and existing responsive dialog layout are
retained. gptTaste was successfully used for the shared restrained 160 ms/4 px
entrance, tactile controls and 140 ms option feedback. The existing reduced-motion
rule covers them. Its unrelated landing-page/RNG/font-replacement/GSAP directives
conflict with repository design and dependency rules and were not adopted. React
review checked explicit event-triggered work, refs for transient buffers,
unmount cleanup, semantic controls and shared event listeners.

Temporary input, intermediates and output are removed after download, failure,
abort and orderly shutdown. No cloud OCR, database, permanent storage, background
retry, text logging or PDF logging exists. A hard kill/host crash cannot execute
`finally`; hosting storage stays ephemeral. Native PDF tools remain an untrusted
document attack surface; keep distro security updates current by rebuilding.

## Repeatable verification

Use Node 22.13+, pnpm 12.3.4 and the native tools. On Debian/Ubuntu:

```sh
apt-get install --no-install-recommends ghostscript qpdf util-linux ocrmypdf tesseract-ocr-eng
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm format:check
git diff --check
```

Native integration tests are required and not skipped. Deterministic synthetic
PNG fixtures use high-contrast English text, a two-degree skew and a mildly blurred
lower-resolution scan. No private documents are used. pdf-lib constructs multi-page,
mixed, marked, blank and rotated PDFs from them. HTTP tests cover language/path/
multipart attacks, OCR-specific limits, strict output checks, admission,
timeout/disconnect/shutdown and empty temporary roots. Client tests cover consent,
all blocker messages, exact generated multipart bytes, trusted errors and bounded
metadata/body validation. Process and disk-budget tests exercise actual enforcement.

Start the web app and API, set `KAGAZ_ARTIFACT_DIR` outside the repository, install
Chromium with `pnpm exec playwright install chromium`, then run:

```sh
node scripts/verify-phase4b.mjs
node scripts/verify-phase4a.mjs
```

The OCR browser script tests scanned, multi-page, mixed, reorder/delete/rotation,
annotations, filled forms, visual signatures, blockers, cancel/retry, friendly
server/network failure, focus containment/return, reduced motion and 1440/768/390/
360 px layouts. It downloads actual derivatives, extracts expected text with
PDF.js, renders and compares pixels, observes explicit-only POST requests,
checks workspace snapshots and tests compression afterward. Existing Phase 4A
verification remains a full regression check.

CI builds the production image and a comparison image using the original Phase 4A
Dockerfile with the same application build (isolating the native dependency size
increase). It runs all-preset compression smoke, real editor verification and OCR
container smoke with non-root/read-only/no-new-privileges/512 MiB/0.5 CPU/tmpfs
controls. `verify-phase4b-container.mjs` records installed versions, image delta,
one/ten/mixed-page runtimes and sizes, cgroup memory peak, expected PDF.js text,
pdf-lib/qpdf checks and cleanup. Artifacts contain only synthetic fixtures and
verification reports. It does not deploy production.

## Sources

- [OCRmyPDF existing text, limits and hOCR](https://ocrmypdf.readthedocs.io/en/v14.0.1/advanced.html)
- [OCRmyPDF preservation/optimization choices](https://ocrmypdf.readthedocs.io/en/v14.0.1/cookbook.html)
- [Debian Bookworm OCRmyPDF dependencies](https://packages.debian.org/bookworm/ocrmypdf)

## Acceptance checklist

- [x] Inspect clean expected SHA, instructions/design/README/Phase 4A, all relevant infrastructure and baseline CI.
- [x] OCRmyPDF/Tesseract English-only; no custom OCR pipeline, cloud service, conversion, LibreOffice or Phase 4C.
- [x] Reuse admission, multipart, isolated workspace, native runner, typed errors, cancellation and cleanup.
- [x] Upload only the current flattened browser export after explicit consent; keep every Phase 3 blocker and workspace unchanged.
- [x] Skip existing text, preserve blank vector pages, reject nonsearchable output; document same-page mixed-text and recognition limits.
- [x] Separate OCR input/page/raster/time/resource/disk policies and one active heavy request.
- [x] Header/qpdf/page-count/independent-text/image/geometry/content checks before PDF response.
- [x] Synthetic clean/skewed/multi-page/mixed/marked/blank/low-quality/rotated quality fixtures and meaningful failure tests.
- [x] Accessible English/privacy/stage/cancel/retry/download dialog with restrained reduced-motion-aware feedback.
- [x] Docker and CI verification scripts cover binaries, compression, OCR, searchability, performance, non-root execution and cleanup.
- [ ] Final complete quality-gate run and actual production container/browser verification.
- [ ] Commit/push origin/main without force and confirm exact-SHA CI success.

## Handoff

Do not loosen compression globally to tune OCR. Update `OCR_POLICY`, the Python
preflight, client metadata/limits, tests and documented limits together when changing
OCR limits. Do not infer pages OCRed from native stderr or upload original source
files. Keep OCRmyPDF option selection server-owned. Shared browser derivative
logic lives in `pdf-heavy-tools`; operation-specific metadata and copy stay with
each tool. Phase 4C is not implemented or authorized by this phase.
