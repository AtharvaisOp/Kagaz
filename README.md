# Kagaz

Kagaz is a browser-first PDF workspace for combining and arranging documents
locally. Open one or several PDFs, inspect their pages, reorder them, rotate or
delete pages, extract a range, and download the result without sending PDF
bytes to a server. **Compress PDF** and **OCR PDF** are explicit server operations:
only after submission does Kagaz upload a flattened export of the current PDF
workspace. **Convert to PDF** uploads a separately selected DOCX, PPTX or XLSX
only after the user submits conversion. Those temporary server operations return
derivative downloads; ordinary PDF editing and export remain browser-local.

## Phase 1 capabilities

- Open one or multiple PDF files, including drag-and-drop selection
- Keep valid files when a mixed selection contains invalid files
- View multi-page documents with lazy, viewport-aware rendering
- Navigate with the page manager and stable page identities
- Reorder pages with drag-and-drop or Move Up/Move Down controls
- Rotate pages in 90-degree increments
- Delete pages while protecting the final page in a workspace
- Add more PDFs to an existing workspace, including duplicate selections
- Merge sources according to the current workspace order
- Extract single pages, inclusive ranges, and comma-separated page expressions
- Download edited, merged, or extracted PDFs
- Keep PDF editing and export browser-local

The current workspace is intentionally lightweight: zoom is display state,
while page order, deletion, rotation, and selection are logical workspace
state. Start Over protects workspace, annotation, and meaningful in-progress
editor work with one discard confirmation.

## Phase 2 annotation capabilities

- Create and edit text, highlight, freehand, rectangle, ellipse, line, and
  image annotations
- Move, resize, style, select, delete, and undo/redo annotation edits
- Add PNG or JPEG images locally without uploading source bytes
- JPEGs containing non-default camera orientation metadata are rejected until
  they are saved or rotated normally
- Preview annotations in the page manager thumbnails and in a compact semantic
  annotation list for the current page
- Flatten all seven annotation kinds into browser-local Download and Extract
  output while preserving page order, rotation, and z-order

Text export currently uses PDF Standard Helvetica. Characters that Helvetica
cannot encode are rejected with an actionable export error rather than being
silently replaced.

## Phase 3 form capabilities

- Discover and fill standard AcroForm text, multiline text, checkbox, radio,
  dropdown, option-list, and multiselect fields in the browser
- Keep repeated widgets synchronized while preserving independent values for
  duplicate PDF source instances
- Download or Extract supported form pages as flattened, non-interactive PDF
  content alongside Kagaz annotations
- Keep XFA, password fields, push buttons, and unknown form
  structures blocked from export with source-specific guidance
- Reject form appearance text that Standard Helvetica cannot encode instead
  of corrupting the exported PDF

## Phase 3F visual signatures

- Draw, type, or choose a PNG/JPEG signature locally, then place, move, resize,
  delete, or undo/redo it like other visual annotations
- Download and Extract flatten visual signatures in annotation order, preserving
  PNG transparency, canonical PDF geometry, and page rotation
- Safe unsigned AcroForm signature widgets offer **Place visual signature**;
  the existing creator centers the mark inside that widget without stretching it
- Export snapshots all required image and signature Blobs before any asynchronous
  reads, so later editor changes and resource cleanup cannot change the output
- Sources containing digital-signature values or byte-range structures are
  rejected before entering the editable workspace and checked again at export

These marks are **visual electronic signatures**, not cryptographic PDF digital
signatures. Kagaz does not sign with certificates, verify certificates or signers,
or retain a signature library. Pending unplaced signatures still block export.
Unsigned fields are removed during flattening, including unfilled ones; the
exported PDF contains page content, not interactive signature widgets.

See [Phase 3F engineering and verification notes](docs/phase-3f.md) for the
pdf-lib investigation, supported structures, inherited-change review, and
repeatable browser artifact checks.

## Phase 3G hardening

Committed supported form values now appear in lazy Canvas2D page thumbnails,
including repeated widgets and independent duplicate sources. Thumbnail text is
an approximate preview, not a replacement for the exported PDF appearance.
Malformed field trees, ambiguous widget ownership, invalid geometry, digital
signature structures, and JavaScript actions fail closed. Source discovery,
reset, image assets, and the unified form/annotation history have additional
lifecycle protection.

See [Phase 3G audit and verification](docs/phase-3g.md) for defects repaired,
repeatable browser scripts, performance observations, and remaining limitations.

## Browser-local watermarking

Use **Watermark** to configure one foreground text or PNG/JPEG image watermark.
Preview text/color, font size, opacity, rotation, bounded size and center/corner
or custom placement before Apply. Apply, edit and remove are single shared
Undo/Redo transactions; slider previews and Cancel do not change the document.

Target all pages, the current page, selected pages or explicit ranges. **All
pages** includes PDFs added later. Other scopes resolve to stable workspace page
identities when applied, so reordering retains the intended pages; deleted pages
are removed from the target. Download, Extract and explicitly submitted
compression/OCR preparation use the committed configuration.

Watermarking stays entirely in the browser and introduces no upload or document
storage. Ordinary pages preserve their text/vector content. On redacted pages,
the foreground watermark is composed using only the already-sanitized raster,
then flattened into a fresh image-only page; original page content is never
restored. Watermarks are visual marks, not a confidentiality mechanism.

Text uses Standard Helvetica and rejects unsupported characters visibly. Text
is limited to one line of 200 characters; oversized marks are fitted within page
margins. Image aspect ratio and PNG transparency are preserved; non-default JPEG
camera orientation and excessive image sizes are rejected. Reconstructed
redacted pages retain Phase 5A's 144 DPI fidelity and accessibility limitations.

See [Phase 5B architecture and verification](docs/phase-5b.md) for placement,
asset lifecycle, independent PDF evidence and limitations.

## Browser-local redaction

Use **Redact** to propose rectangular regions, then move, resize or remove them
before Download or Extract. The current-page semantic list also supports keyboard
creation and precise geometry edits. Proposals participate in the shared Undo/Redo
history and stay associated with their pages through reordering and rotation.

Export permanently overwrites the marked pixels and rebuilds each affected page
from a sanitized, opaque PNG at 144 DPI. Original page text, images, form values,
annotations and visual signatures are never placed underneath that bitmap in the
final page. Unaffected pages use the existing page-copy path where safe. PDF bytes
remain in the browser; ordinary redaction and export do not upload or persist them.
The open source and editable proposals remain available after export.

Affected pages lose selectable/searchable text, original vectors and source
accessibility semantics; files may grow. There is no automatic OCR. Rasterization
is bounded to 16 megapixels and 8,192 pixels per side, with additional input-image
budgets. Unsupported geometry, failed rendering or unsafe retained source objects
stop export. A mixed export can also be blocked when preserved pages contain
source annotations, alternate representations or shared original resources,
including coincident source-controlled resource identifiers. Extract affected
pages separately or redact all sharing pages. Information visibly
repeated outside the marked regions must be addressed separately.

See [Phase 5A architecture and removal evidence](docs/phase-5a.md) for the security
boundary, limits, independent PDF/image checks and measured verification.

## Privacy-first architecture

PDF source files stay in the browser for editing and ordinary export. Compression and OCR
temporarily send one generated, flattened PDF containing the current page order,
rotations, annotations, images, filled forms, visual signatures, finalized
redactions and committed watermarks. It never sends
individual source files. Existing form/signature export blockers apply before any
upload. Each server tool creates a derivative download and leaves the workspace intact.

Office conversion sends only the separately selected Office document after explicit
submission. The API streams uploads to a private temporary directory, checks PDF
structure with qpdf and bounded pikepdf inspection, or checks OOXML before
LibreOffice. It runs the selected native operation, validates the result and
streams it back. Temporary files are
deleted after processing/download, errors, disconnection and orderly shutdown.
There is no permanent PDF storage, database persistence or content analytics.
Logs contain error codes rather than PDF contents, filenames or native stderr.

```text
Browser
|
+-- SourceDocumentRegistry: PDF.js documents and loading lifecycle
+-- WorkspacePage[]: order, source page, rotation, selection
+-- Thumbnail / main viewer
+-- pdf-lib export: browser-local Blob download

Backend
+-- Explicit /tools/compress or /tools/ocr
|   +-- flattened workspace > native processing > validation > download > cleanup
+-- Explicit /tools/convert-to-pdf
    +-- separately selected Office document > inspection > conversion > validation > cleanup
```

PDF.js is responsible for preview and rendering. The workspace and annotation
reducers store serializable logical edits. The source registry owns browser
`File` objects and PDF.js runtime resources, while the annotation asset
registry owns decoded PNG/JPEG runtime assets and their object URLs. The export
layer snapshots the required source files and annotation assets by stable IDs,
then lazy-loads pdf-lib in the browser. Phase 3F also loads that separate chunk
on first PDF selection to inspect parsed signature structures before editing;
PDF.js intentionally omits raw signature values from widget metadata. This adds
a temporary parse of the source for safety, without putting pdf-lib in the
initial application bundle or uploading any bytes.

## Technology

- React 19, Vite, TypeScript, and Tailwind CSS
- PDF.js through `pdfjs-dist`
- `pdf-lib` for browser-local output generation
- `@dnd-kit/react` for page reordering
- Vitest for deterministic model, lifecycle, and export tests
- pnpm workspaces and Turborepo
- Express 5 and Docker for the API foundation
- Ghostscript for compression, qpdf for structural validation, Busboy for streamed uploads
- OCRmyPDF and Tesseract for English searchable PDF derivatives
- LibreOffice headless for DOCX, PPTX and XLSX to PDF conversion
- GitHub Actions, Vercel, and Render deployment paths

## Local development

Prerequisites: Node.js 22.13 or newer and pnpm 12.3.4.

```bash
pnpm install
pnpm dev
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm format:check
```

The web app runs at `http://localhost:5173`; the API defaults to
`http://localhost:4000`. Editing and ordinary export do not require the API.
Compression requires Ghostscript, qpdf and Python with pikepdf on PATH, or their
executable paths in the API environment. OCR additionally requires OCRmyPDF, Tesseract English data
and Python with OCRmyPDF's dependencies. Office conversion also requires the
headless LibreOffice Writer/Impress/Calc packages, Liberation/DejaVu fonts and
libseccomp on Linux. On Debian/Ubuntu, install the equivalents of:
`ghostscript qpdf util-linux ocrmypdf tesseract-ocr-eng libreoffice-writer-nogui
libreoffice-impress-nogui libreoffice-calc-nogui fonts-liberation fonts-dejavu-core
libseccomp2`.
On Windows, set `GHOSTSCRIPT_PATH` to `gswin64c.exe` and `QPDF_PATH` to `qpdf.exe`.
The Linux runner uses `prlimit` from util-linux for resource bounds. API integration
tests deliberately require these native tools; they are not silently skipped.

Vite proxies `/tools` to the local API. Use the `localhost` URL to match the
default CORS origin. Set `VITE_API_URL` for a separately hosted frontend; see
`apps/web/.env.example`. Native paths set only in `apps/api/.env` are loaded by
the running API; for repository tests, export them into the shell environment.

Run one application directly when useful:

```bash
pnpm --filter @kagaz/web dev
pnpm --filter @kagaz/api dev
```

The web production output is written to `apps/web/dist`. The API entry point
is `apps/api/dist/index.js`.

## API environment

Copy `apps/api/.env.example` to `apps/api/.env` only when custom local values
are needed.

| Variable           | Default                                 | Purpose                                               |
| ------------------ | --------------------------------------- | ----------------------------------------------------- |
| `PORT`             | `4000`                                  | API listening port; hosting platforms may provide it. |
| `CORS_ORIGINS`     | `http://localhost:5173`                 | Comma-separated API origins.                          |
| `LIBREOFFICE_PATH` | `/usr/lib/libreoffice/program/oosplash` | Server-selected native LibreOffice headless launcher. |

`GHOSTSCRIPT_PATH` (default `gs`) and `QPDF_PATH` (default `qpdf`) optionally
select native executables using server-controlled configuration. `OCRMYPDF_PATH`
(default `ocrmypdf`) selects OCRmyPDF. `OCR_PYTHON_PATH` (default `python3`) selects
Python for all PDF/Office inspectors;
OCRmyPDF locates Ghostscript and Tesseract on PATH. Export these variables into the
shell for repository tests as well as API development. No secrets are
required for local development. The LibreOffice executable remains
server-controlled; uploads cannot choose its path, filters or arguments.

## Compression contract and limits

`POST /tools/compress` accepts multipart fields `file` (exactly one PDF) and
`preset` (`high-quality`, `balanced`, `maximum`). Success returns `application/pdf`.
The API exposes `X-Kagaz-Original-Bytes`, `X-Kagaz-Compressed-Bytes`,
`X-Kagaz-Saved-Bytes`, `X-Kagaz-Saved-Percent`, `X-Kagaz-Preset` and
`X-Kagaz-Outcome` (`compressed` or `unchanged`) through CORS. Errors return
`{ "error": { "code": "…", "message": "…" } }` with a small shared typed contract.
Responses are not cached.

| Level               | Ghostscript setting | Color/gray image target |
| ------------------- | ------------------- | ----------------------- |
| High quality        | `/printer`          | 300 dpi                 |
| Balanced            | `/ebook`            | 150 dpi                 |
| Maximum compression | `/screen`           | 72 dpi                  |

Kagaz also disables automatic page rotation, uses PDF 1.7 output to retain
transparency, and enables stream/font compression and duplicate-image detection.
These are quality presets, not promises about exact file size or monotonic savings.
If the validated derivative is equal to or larger than the input, the API returns
the exact validated browser export with zero savings. It never returns a failed
or partially validated derivative as a fallback.

Input is limited to **20 MiB and 300 pages**. One request owns the processing slot;
at most two wait in an abortable FIFO queue. Admission covers upload through cleanup,
so both disk use and native concurrency are bounded. Overflow returns `server-busy`
(503 with `Retry-After`). Multipart body overhead is capped at 64 KiB, upload time
at 30 seconds, each native process at 60 seconds, and the total request including
queue time at 120 seconds. Linux native processes have a 384 MiB address-space
limit, 60 CPU seconds and a 40 MiB file-size limit. Aggregate private workspace
use is monitored against 128 MiB. Multipart part headers have a 16 KiB parser
bound. Encrypted files, interactive AcroForms, digital-signature structures,
active actions, attachments, external streams, executable PostScript XObjects,
malformed structures and qpdf recovery warnings are rejected on input and output.
The browser gives compression 150 seconds before aborting, allowing the server's
120-second deadline to return a typed error.

See [Phase 4A engineering and verification](docs/phase-4a.md) for implementation
boundaries, repeatable container/browser checks, security review and limitations.

## English searchable PDF OCR

Choose **OCR PDF**, read the privacy notice and press **Start OCR**. Kagaz prepares
the current flattened workspace using the same guarded browser export as Download
and compression, uploads exactly that derivative, and offers **Download searchable
PDF**. Current page order, deletions, rotations, annotations, forms and visual
signatures are included. The active workspace is unchanged. Cancel aborts the
request; Retry takes a fresh snapshot only after another explicit submit.
Progress uses preparation and upload/processing stages without estimated percentages.

`POST /tools/ocr` accepts one multipart `file` and `language=eng`. Success returns
`application/pdf` and exposed `X-Kagaz-Original-Bytes`, `X-Kagaz-Output-Bytes`,
`X-Kagaz-Pages`, `X-Kagaz-Ocr-Language`, `X-Kagaz-Pages-Ocred` and
`X-Kagaz-Pages-Skipped`. Shared errors add `unsupported-language`, `no-ocr-needed`
and `ocr-failed`. Counts describe validated searchable additions and skipped
existing-text/blank pages, rather than estimates from native logs.

OCRmyPDF uses `--skip-text`, standard PDF output, English hOCR text layers, no image
optimization and no image preprocessing. Original image bytes, page geometry and
original drawing streams must survive; existing digital text must remain extractable,
and pages requiring OCR must yield meaningful text. Blank vector pages are preserved.
A wholly digital/blank PDF returns `no-ocr-needed`; image pages with no recognized
text fail validation rather than claiming searchability. Output may grow in size.

OCR has separate limits: **10 MiB, 20 pages, 14 inches per side, 400 DPI, 16 MP
per image/raster**, 40 MiB output, a 240-second native deadline and a 300-second
total deadline including queue time. Linux native processes have 768 MiB address
space, 240 CPU seconds and 40 MiB per-file limits; aggregate temporary files are
monitored against a 192 MiB budget. These process bounds complement container/host
memory and ephemeral disk limits. Windows development lacks Linux resource bounds.
All three server tools share one admission slot and
two abortable FIFO waiters. Do not increase OCR concurrency on Render's limited
free CPU without measurements.

See [Phase 4B engineering and verification](docs/phase-4b.md) for architecture,
synthetic fixtures, Docker/browser checks, performance, security and limitations.
OCR uses no cloud API, permanent storage or OCR text/content logging.

## Office documents to PDF

Choose **Convert to PDF** from the empty state or editor header. Kagaz shows the
privacy notice and checks only the selected filename extension in the browser;
selecting a file does not upload it. Press **Convert** to upload that document
temporarily for server-side conversion. The API identifies the OOXML package
structure itself, rejects macro-enabled or active/external content, and returns a
validated PDF derivative download. It does not open, replace or modify the active
PDF workspace. The upload and request-scoped LibreOffice profile are deleted
after success, failure, cancellation or orderly shutdown. No document is
persistently stored, entered into a database, or used for content analytics.

`POST /tools/convert-to-pdf` accepts exactly one multipart `file` with a DOCX,
PPTX or XLSX package. The response is `application/pdf`; exposed metadata headers
report the detected input format, input/output bytes and validated PDF page count.
The server requires the declared filename family to match the package, then uses
a fixed family-specific PDF export filter. Legacy DOC/PPT/XLS, macro-enabled
DOCM/PPTM/XLSM, encrypted or malformed ZIP packages, macros, external
relationships, embedded packages and unsupported active content fail closed.

OOXML packages are inspected in place without archive extraction. ZIP metadata,
local headers and central-directory records must agree with actual decompressed
bytes and CRC, including directory records. Entry count, expanded bytes, entry
bytes, compression ratio and cumulative XML nodes are bounded. Every relationship must
resolve inside the package and external targets are rejected. LibreOffice gets a
fresh private user profile for each request. On Linux, a seccomp filter preserves
local Unix sockets needed for its private instance pipe and denies network socket
creation in the office process tree. Its output must pass a PDF signature check,
qpdf structure/encryption/page checks, and an independent pikepdf/PDFMiner reload
before the API streams it back.

Spreadsheet output follows each workbook's saved print area and page setup.
Fonts, pagination, line breaks and layout can differ from Microsoft Office; the
conversion is a practical derivative, not a pixel-fidelity promise. See
[Phase 4C architecture, security and measured verification](docs/phase-4c.md) for
operation limits, Docker impact, representative runtime/memory measurements,
browser and native checks, and hosting constraints.

## Deployment

### Vercel

The intended frontend configuration uses the repository root:

- Repository: `AtharvaisOp/Kagaz`
- Root Directory: `./`
- Framework: Vite
- Node.js: 24.x (verified current Vercel project setting; API/CI use 22.23.3)
- Install Command: `pnpm install --frozen-lockfile`
- Build Command: `pnpm --filter @kagaz/web build`
- Output Directory: `apps/web/dist`

The production frontend is `https://kagaz-personal.vercel.app`. All three server
tools require the frontend build variable
`VITE_API_URL=https://kagaz-api.onrender.com`, configured in Vercel's Production
environment during Phase 4D. An empty value uses same-origin `/tools` routes,
which Vite proxies locally but Vercel does not. Environment changes require a new
frontend build. Source editing and ordinary export work without this variable.

Verify the production deployment's commit and API build variable in Vercel after
promotion; repository configuration alone does not prove the live version.

### Render

The API service is `kagaz-api` at
`https://kagaz-api.onrender.com`. Its health endpoint is:

```text
https://kagaz-api.onrender.com/health
```

The Render Blueprint uses the `main` branch, Docker, the Singapore region,
and `/health` as its health check. `CORS_ORIGINS` is configured for the
intended production frontend origin. The free tier, health check, region, branch
and commit-triggered auto-deploy configuration are retained. The Node 22.23.3 /
Debian Trixie production image installs
Ghostscript, qpdf, util-linux, OCRmyPDF, English Tesseract data, minimal headless
LibreOffice Writer/Impress/Calc packages, Liberation/DejaVu fonts and libseccomp,
then runs as the unprivileged Node user. No persistent disk is assumed. Render
Free provides 512 MiB RAM and 0.1 CPU. The read-only root filesystem, 256 MiB
temporary filesystem, dropped capabilities and 64-task limit in CI's Docker
verification are additional tested runtime settings; `render.yaml` does not
declare those Docker flags. See [Phase 4D audit](docs/phase-4d.md) for deployment
evidence, resource measurements and remaining isolation limits.

## Current limitations

- Password-protected PDFs cannot be opened; password entry is not available.
- There is no persistence or cloud collaboration yet.
- Exported AcroForms are flattened and cannot be edited as forms afterward.
- XFA is unsupported. Unsigned signature fields are supported only with
  unambiguous page/widget ownership and valid geometry; unsafe structures fail
  closed. Existing digital-signature structures block import and export.
- Visual signatures are not cryptographic digital signatures. Certificate
  signing, verification, and signature persistence are not implemented.
- Password fields and push-button or PDF JavaScript behavior are not exported.
- OCR supports English only and recognition is imperfect; review searchable text.
- Office conversion supports DOCX, PPTX and XLSX. Layout and fonts can differ from
  Microsoft Office; spreadsheets follow their saved print settings.
- Pages with any existing text are skipped, including pages mixing digital text
  and scans. No automatic language detection, forced OCR, rotation correction or
  deskew is provided.
- Compression is lossy for images and may change document-level metadata and
  other non-visible features. It targets a flattened visual derivative rather
  than archival equivalence. Savings depend on PDF content.
- Render's free service can cold-start; request timeouts and retry are intentional.
- Canvas annotations are projected visually; the current-page semantic list is
  the keyboard and screen-reader path for existing annotations.
- Text export is limited to glyphs supported by Standard Helvetica; custom
  font embedding is not implemented.
- There are no accounts, cloud storage, or collaboration features.
- Very large PDFs may create browser memory pressure.
- The page-copy export workflow may not preserve every document-level feature,
  such as outlines or advanced interactive structures.

## Roadmap

- Phase 2 — annotations (complete)
- Phase 3 — forms and visual signatures (complete)
- Phase 4A/4B — server-backed compression and OCR (complete)
- Phase 4C — Office to PDF conversion (complete)
- Phase 4D — [heavy-tool hardening and measured resource audit](docs/phase-4d.md) (complete)
- Phase 5A — [true browser-local redaction](docs/phase-5a.md) (complete)
- Phase 5B — [browser-local text and image watermarking](docs/phase-5b.md) (complete)

The browser-local architecture remains the default for operations that can be
performed safely on the device.
