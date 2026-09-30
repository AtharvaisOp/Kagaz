# Phase 4A: heavy-tool foundation and compression

Starting point: `main`, `1fc433722c603982329ed8d9c368b39ff4fc0126`, clean tree,
409 browser tests, CI run 29 successful. This phase does not implement OCR,
conversion, persistence or production deployment.

## Boundaries and decisions

`usePdfExport.prepareWorkspace` and ordinary Download/Extract use the same
`preparePages` snapshot and `exportWorkspace` implementation. Pages, source Files,
committed forms, annotations and asset Blobs are captured before asynchronous
reads. The existing signature, XFA, password-field, form-draft and glyph checks
remain authoritative. Compression never receives individual source files or a
PDF.js document, never calls a workspace mutation action, and never uploads from
an effect, on file selection or on opening the dialog.

`CompressDialog` owns one short-lived controller. Only its submit event prepares
and uploads a PDF. Duplicate clicks are guarded synchronously with a ref. Cancel,
Escape, close and unmount abort the request and invalidate late completions. A
result stays only in memory until the dialog closes; download uses the existing
object URL lifecycle. Retry exports the current snapshot again, once per explicit
attempt. There is no background retry or speculative export.

`ToolService` coordinates admission, request deadline, temp workspace, upload,
compression, streamed response and cleanup. `ExecutionLimiter` bounds the **whole
request**, rather than only the Ghostscript command, to avoid unlimited disk
uploads and validations accumulating while the native tool is busy. The default
is one admitted request and two queued requests, in FIFO order. A queued request
can abort without consuming a slot; shutdown rejects queued work and aborts active
work, waits for cleanup, then closes remaining HTTP connections.

`receivePdf` uses Busboy and backpressured streams. It caps files/fields/parts,
field sizes, file size, total multipart bytes (including chunked bodies), and upload
time. The parser is never destroyed reentrantly from its own event callbacks:
destruction is deferred to a microtask, and all file writes settle before cleanup.
It ignores user filenames and MIME declarations, writes `input.pdf` exclusively
with mode 0600 inside a generated private directory, and accepts one preset enum.

`runNative` uses `spawn` with argument arrays, `shell: false`, closed stdin and an
environment allowlist. It continuously drains stdout/stderr while retaining at
most 16 KiB of each. Neither stream is returned or logged. On Linux, `prlimit`
sets address-space/CPU/file limits; a detached process group is terminated with
SIGTERM and then SIGKILL after 250 ms. The promise settles on **close**, so cleanup
cannot race a still-running native process. Windows/macOS development retains the
timeout and termination controls but does not have the Linux resource bounds.

`compressPdf` checks PDF magic and size, rejects encryption (including empty user
passwords), requires qpdf `--check` status 0, caps page count and rejects an
interactive AcroForm inventory. Ghostscript writes PDF 1.7 with fixed quality
settings, SAFER, stop-on-PDF-error/warning and automatic orientation disabled.
The output must exist, pass its own header/encryption/structural checks and retain
the input page count. Only then is size compared. Equal/larger output returns the
exact validated browser export with an `unchanged` outcome and zero savings. Any
failed or corrupt derivative is an error, never a reason to return unvalidated
bytes.

The frontend validates response type, PDF magic, all metadata relationships and
actual body length. It bounds streamed bytes to the declared result size, itself
bounded by the generated input. Shared types contain only real web/API contracts.
There is no Redis, external queue, database or server dependency in local tools.

## Design and accessibility

`design.md` was read in full. The addition uses the existing dark surfaces,
Inter/JetBrains Mono, cyan selection border, orange primary action, toolbar and
dialog dimensions. The gptTaste skill was used for a restrained 160 ms/4 px
entrance, 140 ms preset hover/selection feedback and existing tactile button
states. Repository instructions and `design.md` supersede its landing-page,
random-layout, typography replacement and mandatory GSAP instructions; those
would redesign the editor or add an unnecessary animation dependency.

Native modal semantics supply inert background content and focus containment.
Escape is also captured when disabling the submit button has moved focus to body,
before editor shortcuts can consume it. Focus returns to the toolbar trigger.
Presets are labelled radios in a fieldset; errors and stages have live messages.
The existing reduced-motion rule covers the new transitions. Progress is
indeterminate: the fetch API does not provide truthful upload or native processing
percentages. Results distinguish savings from already-compact output.

## Repeatable verification

Install Node 22.13+, pnpm **12.3.4**, Ghostscript, qpdf and (on Linux) util-linux.
On Windows export `GHOSTSCRIPT_PATH` and `QPDF_PATH` to the shell. Run:

```sh
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm format:check
git diff --check
```

Real native integration tests are required, not skipped. Unit/HTTP coverage
includes all presets, literal arguments, exit codes, bounded diagnostics, timeout,
termination, abort, queue saturation, malformed/empty/wrong input, limits including
chunked bodies, hostile filenames, strict structural validation, missing/corrupt
output, page loss, fallback, CORS, shutdown and cleanup. Each server test asserts
that its temp root is empty. Client tests cover consent markup, preset semantics,
export blockers, exact generated multipart bytes, trusted error messages, response
size/metadata integrity and network/cancel behavior. Browser checks exercise
controller behavior in the real React application.

Build the actual production image and run the smoke test:

```sh
docker build -f apps/api/Dockerfile -t kagaz-api:verify .
node scripts/verify-phase4a-container.mjs
```

The smoke test starts Node with 512 MiB memory, a read-only filesystem, a bounded
ephemeral tmpfs, dropped capabilities and no new privileges. It checks health,
non-root user, native versions, all presets, invalid requests, PDF readability,
temp cleanup, image size and cgroup memory peak. The final image installs only
Ghostscript, qpdf and util-linux; tests and Playwright are excluded from its
production dependency deployment.

For editor/API verification, start both applications, install Chromium with
`pnpm exec playwright install chromium`, set `KAGAZ_ARTIFACT_DIR` to a directory
outside the repository, and run `node scripts/verify-phase4a.mjs`. The script:

- Uploads generated fixtures locally, then tests compression only after explicit submit.
- Covers plain content, reorder/delete/rotation, annotations, filled form,
  visual signature and multiple sources with real native derivatives.
- Parses returned PDFs with pdf-lib and renders with PDF.js; compares text,
  page count, displayed geometry, images and pixel marks outside the lossy photo region.
- Verifies pending-signature/password-form/glyph export blockers prevent uploads.
- Tests busy/cancel/stale completion, server failure/retry, network errors,
  keyboard containment/return and 1440/768/390/360 px layouts with reduced motion.
- Checks API malformed input, page errors and absence of browser persistence.

CI now installs real tools for the quality job, builds the Docker image, runs its
smoke test, and verifies the editor against that container. Browser screenshots and
JSON results are uploaded as an Actions artifact. It does not deploy anything.

## Observed local performance

Portable Ghostscript 10.08.0 and qpdf 12.4.2 on Windows, synthetic 2,431,081-byte
PDF with a 900×900 random RGB image:

| Preset       | Returned bytes |       Savings | Approximate native validation + compression |
| ------------ | -------------: | ------------: | ------------------------------------------: |
| High quality |      2,431,081 | 0% (fallback) |                                      0.54 s |
| Balanced     |        402,504 |        83.44% |                                      0.45 s |
| Maximum      |        533,051 |        78.07% |                                      0.44 s |

Preset ordering is not a promise of monotonic size; Ghostscript's encoding choices
depend on content. The browser scenarios use a smaller displayed image, with
roughly 2.43–4.86 MB browser exports returning 0.133–0.143 MB. Their reported wall
times include downloads and independent PDF rendering checks, not just the server.
These synthetic measurements are evidence of functional processing, not a
production throughput benchmark on Render's much slower free CPU allocation.

## Security review and practical limits

- No shell interpolation, frontend-native switches, user paths or filename-derived output paths.
- No unlimited native concurrency or waiting uploads; failed responses close connections.
- Validation and Ghostscript are resource/time bounded; inputs never inherit server secrets.
- CORS origins are configurable and denied origins are rejected before upload processing.
- PDF content, paths, filenames, stacks and native stderr never enter public errors.
- Cleanup occurs after streams/processes close, including disconnect and shutdown.
- Ordinary export and all Phase 3 safety code remain browser-local and authoritative.

CORS is a browser origin policy, not authentication for non-browser clients. This
public API has bounded admission but no account-based quotas or distributed abuse
prevention. Native tooling is still an untrusted-document attack surface: SAFER,
non-root execution and process limits are defenses, not a VM sandbox. Keep Debian
security updates current by rebuilding the image. Temp cleanup is guaranteed by
the request lifecycle for catchable failures and orderly shutdown; a hard kill or
host crash cannot run a finally block. Hosting storage remains ephemeral and is
not used for retention. Advanced non-visible PDF structures, image fidelity and
archival semantics are not promised by pdfwrite. Windows resource enforcement is
less strict than the production Linux runtime.

Render configuration retains `plan: free`, Singapore, `/health`, `main` and the
existing auto-deploy trigger. There is no persistent disk or hosting upgrade.
Before the next normal frontend deployment, set `VITE_API_URL` to the configured
API origin. No manual deployment was performed in this phase.

## Acceptance checklist

- [x] Inspect starting branch/SHA/tree, instructions, design, export/API/shared types, Docker/Render/CI and UI conventions.
- [x] Reuse safe browser export; upload only one current flattened workspace PDF after explicit consent.
- [x] Reusable isolated workspace, native runner, timeout, cancellation, bounded diagnostics, exit handling and cleanup.
- [x] Ghostscript engine, three documented presets, strict output validation and deterministic larger-output policy.
- [x] One disk-backed PDF upload, conservative multipart/file/page/time limits, malformed/encrypted/interactive rejection.
- [x] PDF response with CORS-exposed metadata and small shared typed friendly errors.
- [x] One processing slot, two abortable FIFO waiters, overload response, orderly shutdown and release after cleanup.
- [x] Dialog privacy notice, preset selection, preparation/server stages, cancel/retry, duplicate guard, savings and derivative download.
- [x] Preserve Phase 3 blockers and local workflows; no workspace mutation, persistence, analytics or background uploads.
- [x] Minimal Docker binaries, non-root runtime and unchanged Render free-plan configuration.
- [x] Security tests: injection/path tricks, oversized/chunked input, native failures/termination, concurrency, leaks, abort, CORS and shutdown.
- [x] Keep all 409 baseline tests; add 62 meaningful unit/HTTP/native/client tests (471 total).
- [x] Local real editor/API checks: plain, reordered/rotated/deleted, annotations, filled form, visual signature, multiple sources and error cases.
- [x] Inspect/render returned PDFs with pdf-lib/PDF.js and observe explicit-action-only uploads.
- [x] Measure representative native runs and verify responsive/keyboard/reduced-motion states in a real browser.
- [x] Review the entire diff and repair concrete parser, modal, environment propagation and response-bound issues.
- [x] Frozen install, lint, typecheck, tests, build, format and diff checks.
- [ ] Production Docker build, health, real compression and cleanup: executed by the new exact-SHA CI job; pending result at initial commit.
- [ ] Commit/push and exact-SHA GitHub Actions result: pending at initial commit.
- [x] No manual production deployment, OCR, conversion, Phase 4B implementation, hosting upgrade or persistent disk.

### Documentation sources

- [Ghostscript pdfwrite and preset behavior](https://ghostscript.readthedocs.io/en/latest/VectorDevices.html)
- [qpdf inspection, validation and JSON options](https://qpdf.readthedocs.io/en/latest/cli.html)
- [Render free-service limits](https://render.com/docs/free)
- [Render compute resources](https://render.com/docs/compute-plans)

### Next-phase handoff

Reuse the workspace/admission/runner/error lifecycle for future heavy operations.
Introduce a separate operation/preset contract and validator only when Phase 4B or
4C is explicitly authorized. Do not expose arbitrary binary names, switches or
paths to clients. Preserve all local export safety blockers and keep uploads
behind explicit consent. Add native binaries only with the feature that uses them.
