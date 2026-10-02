# Phase 4C: Office to PDF conversion

This phase adds explicit server-side DOCX, PPTX and XLSX conversion using
LibreOffice headless. It reuses the Phase 4A/4B upload, request workspace,
admission, native runner, typed errors, cancellation, deadlines, diagnostics and
cleanup. PDF editing and export remain browser-local. Conversion returns a
separate PDF derivative and does not read or mutate the active PDF workspace.

## Operation and isolation model

`POST /tools/convert-to-pdf` accepts exactly one multipart `file`. The frontend
checks the filename extension only to guide the user; choosing a file does not
send a request. The explicit **Convert** action submits the selected document.
The upload transport sends a normalized filename with only the supported family
extension, omits credentials and cache, and never automatically retries. The
server independently determines the package family from its content and requires
it to match the declared extension.

The API streams the upload to a mode-0600 file in a fresh request directory. It
does not use the supplied filename as a filesystem path or native argument. A
fixed Python inspector reads the ZIP directly; it never extracts or repairs an
archive. A validated package is renamed to a server-generated family-specific
path. A new mode-0700 LibreOffice profile and output directory are created inside
the same private workspace for each request. The profile has a fixed macro/link
policy, and its path is passed with LibreOffice's `-env:UserInstallation` option.
There is no global or shared LibreOffice profile.

The native runner receives an argument array and uses `shell: false`. The server
chooses the LibreOffice executable, headless switches, PDF filter, export options,
input path, output directory, environment and resource limits. On Linux,
`office_sandbox.py` sets `no_new_privs` and installs a seccomp filter before
replacing itself with the server-selected LibreOffice binary. It permits AF_UNIX sockets for LibreOffice's
private instance pipe and denies other socket families, socket pairs and
io_uring setup. The filter is inherited by descendants. The process runner owns
the process group, escalates termination and waits for descendants before
workspace cleanup. Profile files and conversion diagnostics are never returned
or logged.

The LibreOffice invocation uses `--headless --nologo --nodefault --norestore` and
only these fixed family filters: Writer `writer_pdf_Export`, Impress
`impress_pdf_Export`, and Calc `calc_pdf_Export`. Form fields are not exported;
external PDF view links are disabled, and hidden slides are included so the
verified PDF page count corresponds to the PPTX slide count. No client string can
select executable names, switches, filters, paths or profile locations.

## Supported and rejected packages

| Package family | Accepted | Rejected examples                                   |
| -------------- | -------- | --------------------------------------------------- |
| Word           | `.docx`  | `.doc`, `.docm`, wrong-family or disguised packages |
| PowerPoint     | `.pptx`  | `.ppt`, `.pptm`, wrong-family or disguised packages |
| Excel          | `.xlsx`  | `.xls`, `.xlsm`, wrong-family or disguised packages |

The browser's extension display is advisory. The API checks ZIP structure,
`[Content_Types].xml`, the root package relationship, family-specific main part
and family-specific relationship targets. The selected extension must agree with
that inspected family. Legacy OLE compound files are rejected before ZIP parsing.
Macro-enabled content types, VBA relationship types and macro/VBA part names are
rejected regardless of the filename. Binary, executable, OLE and embedded
package payloads are unsupported.

## OOXML security model

The inspector uses Python's ZIP reader only after checking the archive's own
bounded input size. It compares end-of-central-directory fields, central entries,
local headers, flags, compression method, CRC, sizes, data descriptors and
offsets. It rejects ZIP64, encryption, unsupported compression, hidden extra-field
interpretations, trailing data, duplicate or case-aliased names, links, absolute
paths, traversal, URI escapes, backslashes, control characters, non-ASCII aliases,
unsafe names and excessive path depth. XML is parsed without extraction and
without DTD/entity declarations. Every XML and relationship part is inspected,
not only the parts LibreOffice is expected to use.

Every relationship must be internal, resolve to an existing package part and
have a supported type. External HTTP(S), file and other targets fail closed.
Direct document resource URLs, remote workbook formulas, web connections,
external data, attached templates, ActiveX, OLE, embeddings, scripts, macros and
other active package paths are blocked. Workbook formulas are restricted to a
small local arithmetic/function grammar. Presentation slide IDs and workbook
sheet IDs must target real family-correct parts. Embedded image content is
limited to validated PNG/JPEG data; unsupported package/file payload types fail.

Workbook cell, defined-name and related formulas are restricted to local
arithmetic, ranges and a small fixed function set; remote and command-capable
functions fail closed. The inspection does not execute formulas, refresh data,
fetch templates or load remote images. The private profile disables link updates. Independently, the
LibreOffice process tree cannot create network sockets on Linux. The generated
PDF parser rejects active actions, embedded files, forms and URI actions. These
layers fail closed if package checks encounter unknown XML, ZIP or content types.

| Conversion bound             |                                    Limit |
| ---------------------------- | ---------------------------------------: |
| Uploaded file                |                                   10 MiB |
| ZIP entries                  |                                    2,048 |
| Expanded bytes per entry     |                                    8 MiB |
| Aggregate expanded ZIP bytes |                                   64 MiB |
| Entry compression ratio      |                                    100:1 |
| XML size and structure       | 16 MiB per part; 200,000 nodes; depth 64 |
| Image dimensions             |          16 megapixels; PNG or JPEG only |
| PPTX slides / XLSX sheets    |                                  50 / 20 |

## Shared lifecycle and operation limits

Compression and OCR limits remain operation-specific and unchanged. All three
operations use the same `ExecutionLimiter`: one active request and two queued
requests by default. Admission covers upload, validation, processing, response
streaming and cleanup. A queued disconnect is removed from the FIFO; shutdown
rejects queued requests and aborts active processes. Conversion has a 30-second
upload limit, 120-second native-process deadline, 180-second whole-request
deadline including queue time, 128 MiB aggregate request-workspace monitor, and
the shared 64 KiB multipart-overhead bound.

| Native/output bound         |                         Conversion policy |
| --------------------------- | ----------------------------------------: |
| PDF output                  |                                    40 MiB |
| PDF pages                   |                                        50 |
| Linux process address space |                       768 MiB per process |
| Linux CPU time              |                   120 seconds per process |
| Linux individual file size  |                                    40 MiB |
| Temporary workspace         |             128 MiB, sampled every 500 ms |
| Container verification      | 512 MiB, 0.5 CPU, 256 MiB `/tmp`, 64 PIDs |

The temporary-space watcher is a bounded periodic inventory, not an exact
filesystem quota. Production storage must remain ephemeral and bounded. Linux
`prlimit`, the container cgroup and `/tmp` tmpfs provide separate process,
aggregate-memory and disk boundaries. Windows development does not provide the
Linux address-space/CPU/file-size limits; Linux CI and the production image are
the authoritative native checks.

## API and output validation

Success returns a noncached `application/pdf` attachment named
`kagaz-converted.pdf`, with only these safe metadata headers exposed through CORS:

- `X-Kagaz-Input-Format`
- `X-Kagaz-Original-Bytes`
- `X-Kagaz-Output-Bytes`
- `X-Kagaz-Pages`

Errors use the existing JSON heavy-tool envelope. Conversion adds
`unsupported-format`, `unsafe-document` and `conversion-failed` to the shared
typed codes. Native diagnostics, command arguments, paths, document text,
filenames and stack traces stay private. The response is assigned PDF content
type only after all conversion and output checks have succeeded.

Exit status zero is insufficient. The server requires an output file within the
40 MiB limit and a valid PDF header. qpdf must report unencrypted output, pass a
strict structural check and return a positive page count within the 50-page
limit. A second Python process reloads the PDF independently with pikepdf and
PDFMiner, decodes page content streams, checks page boxes and rejects encryption,
forms, JavaScript, launch/remote/URI actions, embedded files, XFA and signatures.
Its page count must match qpdf. PPTX output must contain exactly one PDF page per
slide. The endpoint streams the derivative only after these checks; all paths,
the upload, output and profile are removed on success, error, abort and orderly
shutdown.

## Frontend and privacy

The **Convert to PDF** action appears in the empty-state header and editor header.
The shared derivative-tool lifecycle handles selection, explicit submission,
duplicate protection, processing stages, cancellation, retry, safe errors and
download. The privacy notice says: “This uploads the selected document
temporarily to the Kagaz server for conversion.” It also explains that there is
no permanent storage, PDF editing/export stay browser-local and the result is a
derivative download. Selecting a document only updates local dialog state. There
is no effect-driven upload, background retry or filename-based server path.

The dialog has a labelled file input, live status/error regions, visible focus,
focus containment and return, Escape/close cancellation, responsive widths and
reduced-motion support. It shows the selected filename and candidate extension,
but explains that the API checks the actual package only after submission.
Conversion does not call PDF workspace methods, so both an empty workspace and
an already-open PDF workspace retain their existing state.

`design.md` is authoritative: the feature reuses the existing dark surface,
Inter/JetBrains Mono typography, orange primary action, cyan privacy status,
compact modal and responsive behavior. gptTaste was used for restrained shared
interaction polish and reduced-motion review; its unrelated font, layout,
animation-framework and redesign proposals were not adopted.

## Docker, hosting and measured performance

The production image adds Debian's minimal `libreoffice-writer-nogui`,
`libreoffice-impress-nogui` and `libreoffice-calc-nogui` packages, Liberation and
DejaVu fonts, and `libseccomp2`. It does not install a desktop environment. The
existing Ghostscript, qpdf, OCRmyPDF and English Tesseract tools remain installed.
The service continues to run as the unprivileged Node user with a read-only root
filesystem and request-scoped `/tmp` paths; no persistent volume or database is
introduced.

CI builds the Phase 4B Dockerfile from the phase-start SHA and the new production
image from the same application tree, then records both image sizes and the
LibreOffice/package versions. The measured baseline image was 496,782,209 bytes
(about 473.8 MiB); the production image was 844,657,390 bytes (about 805.4 MiB),
an increase of 347,875,181 bytes (about 331.8 MiB). Debian installed
`libreoffice-writer-nogui`, `libreoffice-impress-nogui` and
`libreoffice-calc-nogui`, with their headless core/draw dependencies, rather
than a GUI desktop. The verified LibreOffice version is 7.4.7.2
40(Build:2). The image also records qpdf 11.3.0, Ghostscript 10.00.0,
OCRmyPDF 14.0.1+dfsg1 and Tesseract 5.3.0; all were present and passed their
existing checks.

The production image ran under the Phase 4B 512 MiB/0.5 CPU/256 MiB tmpfs
limits. CI then repeated representative conversions at 512 MiB/0.1 CPU with
the same 256 MiB tmpfs to model Render's current free web-service compute plan
([compute plan limits](https://render.com/docs/compute-plans)). These are small
deterministic fixtures, so the timings describe this test environment rather
than a service guarantee:

| Fixture                   | Input → PDF bytes | Pages | Runtime at 0.5 CPU | Sampled workspace at 0.5 CPU | Runtime at 0.1 CPU |
| ------------------------- | ----------------: | ----: | -----------------: | ---------------------------: | -----------------: |
| Paragraph DOCX            |   36,467 → 27,102 |     1 |           4,292 ms |                609,548 bytes |          33,198 ms |
| Image and page-break DOCX |   95,888 → 57,379 |     2 |           4,700 ms |                668,969 bytes |                  — |
| Three-slide PPTX          |   88,290 → 45,683 |     3 |           4,548 ms |                377,894 bytes |          35,397 ms |
| One-sheet XLSX            |    5,296 → 16,868 |     1 |           3,770 ms |                294,824 bytes |          27,801 ms |
| Two-sheet XLSX            |    5,966 → 18,136 |     2 |           3,710 ms |                258,524 bytes |                  — |

The converter container's cgroup memory high-water mark was 196,325,376 bytes
(187.2 MiB) at 0.5 CPU and 197,824,512 bytes (188.7 MiB) at 0.1 CPU. These are
whole-container high-water readings, not LibreOffice process RSS. The largest
sampled private workspace among these fixtures was 668,969 bytes; this is a
sampled fixture measurement, not an output or temporary-disk quota. All five
fixtures completed at 0.5 CPU; the representative DOCX, PPTX and XLSX also
completed at 0.1 CPU, taking 27.8–35.4 seconds. This shows the small documents
fit the constrained envelope, but leaves limited latency margin for large or
complex inputs. The API still enforces one active heavy operation and fixed
input, expanded-size, timeout, output, page, memory, process and temporary-space
limits. Render Free filesystems are ephemeral and free services spin down after
inactivity ([free service limitations](https://render.com/docs/free)); users
should expect cold starts and the measured CPU-limited conversion latency.

The generated `phase4c-container.json` artifact records each fixture's
input/output bytes, runtime, expected pages and sampled private-workspace size,
along with package versions, production image delta, cgroup memory high-water
marks and all 41 rejected Office attack probes.

The public deterministic fixtures cover multiple formatted DOCX paragraphs, an
embedded image and explicit page break, a three-slide PPTX with text and an image,
and one-/two-sheet XLSX workbooks with meaningful cells, formatting, print areas
and saved page setup. The verification decodes outputs using pdf-lib and qpdf in
the container, then independently extracts text and renders each PDF with PDF.js
in Chromium. Page counts, expected text, visible rendered marks and embedded
images are checked. Spreadsheet page/print behavior is verified for these
fixtures; it follows their saved print settings and is not a universal layout
guarantee.

The production-container script also exercises mismatched and hostile
filenames, all committed malformed/macro/external/archive attack fixtures,
malformed multipart, CORS rejection, Unix-socket/network isolation, non-root and
read-only runtime assumptions, temporary cleanup and existing tool versions.
Existing Phase 4A compression and Phase 4B OCR container and browser verifiers
run against the same production image after the conversion suite.

No manually triggered production deployment is part of this phase. Render's
normal Docker rebuild includes these packages. A 512 MiB / half-CPU container is
the verification envelope used here, not a broad promise that every large or
complex office document will fit a free hosting tier. Native conversions that
exceed configured time, memory, process or temporary-space bounds fail without
returning partial output. Keep fixture metrics and the current Render plan under
review before raising the one-active-operation limit.

## Known fidelity limits and handoff

Supported input is limited to DOCX, PPTX and XLSX. Legacy formats, macro content,
external links/resources, encrypted OOXML, unsupported embedded objects and
unrecognized package structures are rejected instead of repaired. Documents
with unsupported XML extensions, unusual compression, linked media or advanced
Office-only features may fail closed. Common fonts help fixtures and typical
documents but do not reproduce every installed Microsoft font. LibreOffice
pagination, theme interpretation, charts, equations, shapes and workbook print
areas can differ from Microsoft Office. No Microsoft Office pixel fidelity is
promised.

Phase 4D has not started. Its next work may audit resource ceilings, package
coverage, LibreOffice updates and hosting capacity against new evidence. Keep the
single shared heavy-tool admission policy and do not weaken the existing PDF,
OCR, compression or conversion checks to increase throughput.
