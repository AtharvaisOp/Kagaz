# Phase 4D — heavy-tool hardening and deployment-envelope audit

Phase status: **PASS**. The complete implementation passed Linux CI run 50;
subsequent audit-only commits extend the evidence without changing application
behavior. The final branch must also pass CI before main is updated.

## Starting state and baseline

The audit started on 6 October 2026 at
`193f59719fcebe4c1011ebb0386891f9f5c68088`. The checkout was clean, on `main`,
with `origin=https://github.com/AtharvaisOp/Kagaz.git`. The required `git status`,
`git branch --show-current`, `git rev-parse HEAD`, `git remote -v` and
`git log --oneline -20` were executed before edits. Fetch and GitHub inspection
confirmed the same remote/default branch, no open issues or PRs, and successful
CI run 49 (`36990239587`) for that SHA. Work uses `codex/phase-4d-hardening`.

The architecture review read AGENTS.md, design.md, README, the Phase 3F/3G and
4A/4B/4C records, manifests, environment examples, shared contracts, heavy-tool
clients/dialogs, API tools, native inspectors, deployment files and verification
scripts. Git history was inspected for the preceding phases' rationale.

Initial Windows baseline:

| Command                          | Executed result                                                                                     |
| -------------------------------- | --------------------------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile` | Passed using the desktop fallback pnpm 11.19.0                                                      |
| `pnpm lint`                      | Passed                                                                                              |
| `pnpm typecheck`                 | Passed                                                                                              |
| `pnpm test`                      | Failed: API 93 passed, 62 failed, 6 skipped because native/Python tools were absent; web 467 passed |
| `pnpm build`                     | Passed; existing large-chunk warning retained                                                       |
| `pnpm format:check`              | Passed                                                                                              |
| `git diff --check`               | Passed                                                                                              |

Docker is absent locally and WSL is disabled (`Wsl/0x80070422`). Native failures
were recorded, not skipped or relabeled as passes. Python/pikepdf were subsequently
provisioned outside the repository for targeted inspector tests. Exact pnpm
12.3.4 was also provisioned outside the repository; its frozen install passed
after partially migrated generated module directories were moved to a temporary
backup. No tracked or user source files were removed.

## Audited architecture and decisions

Ordinary editing, rendering, annotations, forms, visual signatures and export stay
in the browser. Compression/OCR receive only the explicitly submitted flattened
workspace. Office conversion receives only the separately selected Office file
after explicit submission. Selection, dialogs and retries never initiate background
uploads. There is no persistent document storage or document-content telemetry.

All three routes share one active slot and two abortable FIFO waiters. Admission
covers upload, native processing, response streaming and cleanup. Queue time counts
against each request deadline. Excess work receives typed `server-busy`/503 with
`Retry-After: 5`. This bounded admission model is retained.

Native binaries, arguments, PDF presets, LibreOffice filters, paths and policies
remain server-owned. Execution uses argument arrays with `shell: false`, a reduced
environment, private workspaces, Linux prlimit and native deadlines. LibreOffice
gets a fresh private profile and inherited seccomp policy denying Internet socket
creation while allowing required Unix sockets. CORS is an origin policy, not
authentication or a denial-of-service quota.

qpdf's encryption, structural warning and page checks remain independent from
pikepdf's active-object policy. These checks answer different questions; no
validation was removed merely to reduce startup cost. Output integrity checks
remain mandatory even for compression's unchanged fallback.

## Defects found and repaired

- Compression previously inspected qpdf structure/AcroForms but could return
  active content through its unchanged fallback. A bounded common PDF inspector
  now validates source and derivative objects, including inline dictionaries and
  stream dictionaries. OCR and conversion share that policy while retaining
  their additional content/fidelity checks.
- The prior OCR/converted-PDF traversal missed stream dictionaries and nested
  inline active structures. The common walker rejects JavaScript, URI/launch/
  remote actions, forms/signature structures, attachments, external file streams,
  reference XObjects and executable PostScript XObjects. Local direct/named
  destinations and single local GoTo actions remain supported. Action chains
  fail closed, including cycles; ordinary outline linked lists remain supported.
- Python ZipExtFile trusts declared uncompressed lengths. Independent bounded
  raw-deflate validation now requires the actual output length, end-of-stream,
  trailing-byte state and CRC to match metadata, including directory records.
  Underdeclared, trailing-deflate and directory-payload probes previously accepted
  by the starting inspector now fail.
- XML node limits were per part while trees for all parts were retained. A
  cumulative 200,000-node budget is enforced during chunked XML parsing. Two
  individually valid 120,000-node parts previously passed; their combined package
  now fails before conversion.
- Malformed oversized multipart headers could emit a parser error without closing
  it, retaining admission until the upload deadline. Deferred parser destruction
  now promptly settles parsing and cleanup. Ineffective Busboy options were
  removed; Busboy 1.6's actual header-byte bound is 16 KiB.
- A successful native parent could leave descendants with independent stdio.
  Unix close now kills residual process-group members; Linux waits for live
  members to exit before filesystem cleanup/admission release. Redundant delayed
  escalation is canceled once close performs terminal group cleanup.
- Linux prlimit's execution failures 126/127 now map to safe server errors rather
  than malformed-user-input errors. Diagnostics remain private.
- Existing dangling symlinks could evade canonical workspace checking because
  ENOENT was treated as a removed entry. Still-existing unresolved links now abort.
- Compression lacked an aggregate workspace watcher. It now has an explicit
  128 MiB budget; OCR/Office budgets are explicitly sourced from their policies.
- Browser error parsing previously buffered unbounded JSON responses. It is now
  limited to 8 KiB, cancels rejected bodies, requires exact PDF media type and a
  complete PDF header, and rejects fractional/tiny byte metadata. Compression
  now has a 150-second browser deadline preserving typed server timeout responses.
- Locked proxy-addr 2.0.7 had a published advisory. Only its transitive lock entry
  was updated to 2.0.8; no dependency or framework was added.

| Security boundary                                                  | Audit result                                                                                                                                                                     |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ZIP bombs, ratios, metadata, traversal and symlinks                | Bounded raw payload validation, consistent local/central records, safe package names, no extraction; new expansion/CRC/node regressions                                          |
| Multipart, chunked input, filename and MIME tricks                 | Streamed byte counter independent of Content-Length; exact field counts/names; bounded headers/time; server inspects actual content; Office filename is only a consistency claim |
| Office macros, embeddings, external relationships/formulas/data    | Existing active-part/relationship/formula restrictions retained; independent Linux network denial; structural inspection is not a complete OOXML schema allowlist                |
| PDF JavaScript/actions, attachments, encryption, malformed objects | Strict qpdf checks plus bounded all-object safety policy; local destinations preserved; unknown/active actions, chained actions, external streams and PS rejected                |
| Executable, shell, path and filter injection                       | Server-owned values, fixed generated destinations, `shell: false`, reduced native environment; no client process controls                                                        |
| Temp leakage, disconnect, cancellation and shutdown                | Private directories, exclusive writes, work tracked through cleanup, canonical link validation, Linux residual-group retirement, bounded diagnostics and safe error codes        |
| Output amplification, admission starvation and slot leaks          | Output/per-file/aggregate limits retained, compression budget added, FIFO/deadline/recovery regressions and production overflow/cancel/shutdown probes passed                    |
| Native-code escape and host exhaustion                             | Process groups, prlimit and tested cgroup/tmpfs/PID envelope constrain ordinary failures; native RCE and host-level isolation limits remain explicit below                       |

## Resource policies

| Policy                         | Compression        | OCR               | Office conversion              |
| ------------------------------ | ------------------ | ----------------- | ------------------------------ |
| Input                          | 20 MiB / 300 pages | 10 MiB / 20 pages | 10 MiB OOXML / 50 output pages |
| Output / per-file native limit | 40 MiB             | 40 MiB            | 40 MiB                         |
| Request / native wall deadline | 120 s / 60 s       | 300 s / 240 s     | 180 s / 120 s                  |
| Native address space / CPU     | 384 MiB / 60 s     | 768 MiB / 240 s   | 768 MiB / 120 s                |
| Monitored aggregate workspace  | 128 MiB            | 192 MiB           | 128 MiB                        |
| Browser deadline               | 150 s              | 330 s             | 210 s                          |

Upload deadlines remain 30 seconds and body overhead 64 KiB. OOXML retains 2,048
entries, 8 MiB per entry, 64 MiB aggregate expansion and ratio 100. XML depth is
64; the cumulative XML node limit is now 200,000. The common PDF walk also has
200,000 nodes and depth 64. OCR retains 14-inch sides, 400 DPI and 16 MP image/
raster limits. No existing upload, page, concurrency or deadline ceiling was raised.

Address space is not resident memory and child limits are not a tree-wide memory
quota. The 500 ms workspace watcher measures logical file size and cannot prevent
all transient growth, hard-link disk accounting or an exploited process escaping
the intended workspace. A host/container memory and temporary-disk envelope is
still necessary. The new compression budget leaves 68 MiB beyond its maximum
20 MiB source plus 40 MiB derivative for bounded native intermediates.

## Native versions, dependencies and security analysis

The production image and CI Node runtime move from Node 22.20.0/Bookworm to
Node 22.23.3/Trixie. This is a security-maintenance change, not a version-only
refresh. Debian records Bookworm vulnerabilities fixed in Trixie's Ghostscript,
qpdf and LibreOffice packages. The new verifier records Debian package revisions
and enforces minimum Ghostscript `10.05.1~dfsg-1+deb13u2` and LibreOffice
`4:25.2.3-2+deb13u8`, rather than relying on upstream version banners.

Sources: [Node 22.23.3 release](https://nodejs.org/en/blog/release/v22.23.3),
[Ghostscript JPEG2000 advisory](https://security-tracker.debian.org/tracker/CVE-2026-39919),
[qpdf advisory](https://security-tracker.debian.org/tracker/CVE-2024-24246),
[LibreOffice embedded-font advisory](https://security-tracker.debian.org/tracker/CVE-2026-63275),
[LibreOffice URL advisory](https://security-tracker.debian.org/tracker/CVE-2026-63278),
[proxy-addr advisory](https://github.com/advisories/GHSA-jqcg-44mw-7w3h).

`pnpm audit --prod` after the focused proxy-addr patch returned **No known
vulnerabilities found**. This does not audit Debian binaries. Debian still records
[CVE-2026-103226](https://security-tracker.debian.org/tracker/CVE-2026-103226) for
Trixie's Ghostscript pdfwrite and native-tool residual risk remains. Fixed
English traineddata is server-owned; client uploads cannot select Tesseract
traineddata files. No claim of vulnerability-free native tooling is made.

No dependency was added. The existing slim multi-stage image, production-only
pnpm deploy, no-GUI LibreOffice, no-recommends packages and removed apt lists are
retained. Fonts support output fidelity; required OCR dependencies were not
removed without evidence that the runtime can do without them.

Executed production versions from run 50:

| Runtime/package                      | Exact executed version     |
| ------------------------------------ | -------------------------- |
| Node / Python                        | v22.23.3 / 3.13.5          |
| Ghostscript                          | 10.05.1~dfsg-1+deb13u2     |
| qpdf                                 | 12.2.0-1                   |
| OCRmyPDF                             | 16.7.0+dfsg1-3             |
| Tesseract / English data             | 5.5.0-1+b1 / 1:4.1.0-2     |
| pikepdf                              | 9.5.2+dfsg-1+b2            |
| PDFMiner                             | 20221105+dfsg-1.1~deb13u1  |
| LibreOffice core/Writer/Impress/Calc | 4:25.2.3-2+deb13u8         |
| libseccomp / util-linux              | 2.6.0-2 / 2.41.5-0+deb13u1 |

## CI, measurements and verification method

CI preserves frozen install, lint, typecheck, mandatory real-native integration
tests, build, formatting and diff checks. Production Docker builds and the
Phase 4A/4B/4C native/container/browser paths remain. Office hostile probes increase
from 41 to 45. The new Phase 4D script creates fresh containers for scaling probes,
records numeric-only artifacts, profiles native stages and exercises queue overflow,
queued cancellation, active cancellation/recovery and shutdown with pending work.

The constrained image uses 512 MiB memory, 256 MiB noexec/nosuid tmpfs, read-only
root, dropped capabilities, no-new-privileges, init and 64 tasks. Resource probes
use 0.1 CPU. Lifecycle/queue probes use 0.5 CPU to observe live work deterministically.
Cgroup `memory.peak` is the aggregate high-water mark. At 250 ms intervals the
sampler records memory.current, summed process RSS, process count, cgroup task
count and logical/allocated workspace/tmpfs use. RSS sums can double-count shared
pages; samples can miss brief peaks. Sampler/cleanup overhead is included in CPU
and memory. OOM-kill and PID-saturation counters must stay zero.

Small startup, approximately input-ceiling image compression, 300-page compression,
1/10/20 independently embedded OCR scans and a 16 MP / 400 DPI raster are measured.
Scans repeat the same
synthetic English image and are not diverse photographs. A fresh-profile DOCX
measures Office startup. Image sizes compare against the starting Phase 4C
Dockerfile using the same current build context. Health readiness excludes image
pull, Docker launch and Render provider cold start. Queue timing based on preceding
client response completion is an observation, not exact server queue residence.

Local post-change lint, typecheck, build, format and diff checks have passed.
Linux CI run 50 (`37500390164`) passed the complete quality job on
`ce5e15b0092307dfb14fe9ea84c62ba09de3d901`: 206 API and 477 web tests, with no
skips; frozen install, lint, typecheck, build, format and diff checks also passed.
Web verification executed 60 files / 477 tests. Focused real-Python PDF/Office
tests executed 89 passed and one Linux-only skip on Windows. A full local rerun
with Python executed API 181 passed, 17 failed and 8 skipped (206 total); remaining
failures require unavailable Ghostscript/qpdf/OCRmyPDF. Linux container and
browser paths also completed successfully in run 50. Its logs contain every
`PHASE_4A_CONTAINER_PASSED`, `PHASE_4B_CONTAINER_PASSED`,
`PHASE_4C_CONTAINER_PASSED`, `PHASE_4D_CONTAINER_PASSED` and Phase 4A/B/C browser
success marker.

## Executed resource/performance results

[CI run 50](https://github.com/AtharvaisOp/Kagaz/actions/runs/37500390164)
tested `ce5e15b0092307dfb14fe9ea84c62ba09de3d901`. Its `phase4d-verification`
artifact contains numeric reports and browser screenshots. The numeric resource
and Office reports are preserved in [phase-4d-measurements.json](phase-4d-measurements.json)
so evidence survives GitHub artifact expiration. Each scaling row below is a
single fresh-container observation at 512 MiB / 0.1 CPU, not a percentile or
worst-case guarantee. Cgroup memory is charged memory, not a sum of unique physical
resident pages across shared mappings.

| Synthetic workload                | HTTP time (s) | CPU use (s) | Cgroup peak (MiB) | Sampled workspace logical / allocated (MiB) | Sampled RSS sum (MiB) | Processes / tasks | Result                      |
| --------------------------------- | ------------: | ----------: | ----------------: | ------------------------------------------: | --------------------: | ----------------: | --------------------------- |
| Small compression                 |         5.401 |       0.812 |             41.29 |                                 0.06 / 0.07 |                116.52 |            4 / 20 | Valid unchanged PDF         |
| 19,447,001-byte image compression |        21.732 |       2.420 |             74.64 |                               30.66 / 30.67 |                123.42 |            4 / 19 | 4,165,572-byte PDF          |
| 300-page compression              |        15.060 |       1.745 |             59.76 |                                 0.31 / 0.32 |                126.54 |            4 / 20 | Valid 300-page PDF          |
| 1 independent OCR scan            |        22.501 |       2.543 |            128.74 |                                 0.35 / 0.36 |                223.33 |            5 / 20 | Valid searchable PDF        |
| 10 independent OCR scans          |       104.906 |      10.702 |            131.53 |                                 3.42 / 3.59 |                225.28 |            5 / 19 | Valid searchable PDF        |
| 20 independent OCR scans          |       202.607 |      20.398 |            138.47 |                                 6.84 / 7.17 |                235.88 |            5 / 19 | Valid searchable PDF        |
| 16 MP / 400 DPI color OCR probe   |        11.996 |       1.472 |            118.39 |                                 0.55 / 0.55 |                173.52 |            5 / 19 | Typed `ocr-failed`, cleaned |
| Fresh-profile paragraph DOCX      |        18.302 |       2.091 |            179.79 |                                 0.58 / 0.69 |                333.77 |            7 / 20 | Valid 1-page PDF            |

Every row had zero OOM events/kills and zero PID saturation. Peak sampled tmpfs
use was 40.56 MiB for the failed raster probe, versus only 0.55 MiB in named
private files. This demonstrates why a pathname/logical-size watcher alone is
not a complete temporary-space quota; open/unlinked allocations and native
temporary behavior require an independently bounded filesystem. The exact
internal cause of that raster failure was not established by run 50, and its
118.39 MiB reading does not prove successful 16 MP OCR memory consumption.
The admitted 16 MP ceiling is a safety bound, not a guarantee of processing
success. It was retained along with the stricter existing per-file/native bounds.

OCR page scaling is roughly linear in this workload. The 20-page job uses most
of the native deadline margin; doubling active jobs on 0.1 CPU would compete for
the same CPU and threaten the 300-second request envelope. These measurements
support retaining one active job and fixed FIFO/deadline rejection. Memory
headroom on small fixtures does not justify increased concurrency. Compression's
largest sampled workspace was 30.66 MiB, below 128 MiB, with maximum source/output
headroom preserved. OCR/Office workspace limits remain 192/128 MiB; neither
representative set approached those limits, and more complex files may fail.

The Office family suite completed all five fixtures at 0.5 CPU (3.799–5.330 s)
and DOCX/PPTX/XLSX representatives at 0.1 CPU (38.703 / 42.302 / 30.703 s).
Its container memory high-water marks were 187.40 MiB at 0.5 CPU and 186.73 MiB
at 0.1 CPU. Variation from the separate fresh-profile DOCX probe illustrates
why these single observations should not be treated as latency guarantees.

The small compression stage profile spent 1,495 ms in Ghostscript, 2,397 ms in
two Python safety inspections and 705 ms in seven qpdf invocations. The small
Office stage profile spent 8,500 ms in the sandbox/LibreOffice conversion stage,
1,706 ms in OOXML inspection, 1,602 ms in output inspection and 204 ms in qpdf.
These measure whole stages, including startup and processing, not isolated
executable launch latency. Native/import/profile overhead is material for small
files. Persistent profiles or long-lived native workers were not introduced;
their isolation/lifecycle costs would require separate evidence.

Health readiness after Docker launch was 2.271–2.526 s. The production image was
852,778,009 bytes (813.27 MiB), versus 852,007,195 bytes for the starting Dockerfile
with current context: +770,814 bytes (0.74 MiB). The largest installed payloads
are LibreOffice core (107,346 KiB), common files (48,558 KiB) and ICU (37,371 KiB),
followed by required Writer/Calc engines. No safe major image reduction was
demonstrated; the security refresh has negligible image-size impact.

At 0.5 CPU, queue overflow returned 503/Retry-After 5, a queued request was
canceled, and the first waiter completed after the OCR response. Its total
queued-request observation was 17,896 ms; the preceding active response completed
17,028 ms after queue submission. These are client observations, not exact server
queue residence. Active cancellation cleaned native work/files in 231 ms and a
subsequent compression succeeded. SIGTERM with active and queued work exited 0
in 174 ms; the supervisor observed zero private workspaces and zero known native
processes before container exit. Typed shutdown errors/disconnection were accepted
as designed. Linux parent-success/orphan and missing-executable regressions also
executed in the 206-test native suite.

## Browser and design verification

The existing browser scripts executed against the real production image:
six compression outputs, eight OCR outputs and all five Office fixtures plus
empty-state/editor/retry flows. They checked explicit upload boundaries, metadata,
download bytes, page order/rotation, annotations, flattened forms, visual signatures,
OCR expected words and digital-text retention, pixel comparisons, Office text/
rendered marks/images, cancellation, safe errors and response validation.
All three browser JSON reports recorded empty error arrays.

Dialog screenshots cover 360, 390, 768 and 1440 px. The audit manually inspected
the 1440 px compression/Office and 390 px OCR screenshots: restrained dark surfaces,
Inter/monospace hierarchy, cyan focus/privacy accents and orange primary actions
match design.md. The live frontend's conversion dialog and Escape/focus restoration
were also inspected. gpt-taste was read and used for error/loading-state copy review;
no TSX, CSS, motion framework, layout or consent flow changed. Existing reduced-motion,
keyboard and focus behavior is preserved.

## Deployment envelope and limitations

With the user's confirmed workspace, the Render connector verified the existing
`kagaz-api` service `srv-daeric740ujc738f4790`: Free, Singapore, one instance,
same repository/main, Dockerfile `apps/api/Dockerfile`, root context, `/health`,
commit auto-deploy and live starting SHA. [Render compute plans](https://render.com/docs/compute-plans)
publish 512 MiB / 0.1 CPU for Free. [Free service documentation](https://render.com/docs/free)
describes idle spin-down and ephemeral filesystems; [deployment lifecycle](https://render.com/docs/deploys)
documents a default 30-second shutdown grace period.

`render.yaml` does not encode CI's read-only root, tmpfs size, capability or task
flags. Those Docker results prove an explicit constrained deployment envelope,
not that Render Free provides every isolation control. Free has no SSH and no
documented application-controlled hard ephemeral-disk quota. Abrupt host termination
cannot execute application cleanup. Ephemeral storage reduces persistence but is
not a forensic erasure guarantee.

Native process groups/resource ceilings are not a complete native-code sandbox.
An exploited binary can escape its group or access files readable by its account;
Office's network seccomp filter does not provide general filesystem isolation.
Compression/OCR have no equivalent network seccomp rule. Kernel uninterruptible
I/O can delay Linux group retirement; admission remains held while a live member
could write. Windows successful-parent orphan cleanup is not claimed.

Vercel connector deployment listing returned permission denied and direct project
retrieval returned 404. Its CLI fallback succeeded: production deployment
`dpl_9KgPz59D25sKHpcYEEg96ZNiMVQE` was READY on the starting SHA/main, and project
inspection confirmed the root/build/install/output settings and Node 24.x.
A browser visit to the public frontend verified the current Office conversion
dialog's explicit consent, disabled submit without a selected file, Escape dismissal
and focus restoration. The live API health
endpoint returned 200 in 22.84 seconds on the first observation; this includes network
and possible idle startup and is not a reproducible provider cold-start benchmark.
Render's CPU/memory metrics query returned empty series, not zero usage.
No hosting plan or paid resource is changed by this phase.

Inspection of the starting production frontend's compiled clients found an empty
API origin and no Render URL. Same-origin `/tools/compress` returned 404: the
deployed server-tool integration was misconfigured despite local/CI proxy tests.
The existing Vercel project's public `VITE_API_URL` was set to
`https://kagaz-api.onrender.com` for Production, using the authenticated CLI after
the connector's project lookup failed. This requires the next frontend build;
production deployment metadata and explicit synthetic tool submissions are
checked after main is updated. No API URL is hardcoded in application source.

Vercel CLI inspection also unexpectedly created an automation bypass token.
The audit-created token is specifically revoked without regeneration; no existing
protection settings or tokens are intentionally changed. Credential values are
excluded from this record.

## Acceptance and next-phase handoff

The implementation acceptance below is supported by run 50's executed evidence.
The final audit commit's CI is checked before main is updated.

- [x] Starting repository state, history and architecture reviewed.
- [x] Baseline commands recorded without suppressing failures.
- [x] Existing heavy-tool architecture and security boundaries audited.
- [x] Discovered defects fixed with targeted regressions.
- [x] No dependency sprawl, automatic upload, persistence or privacy regression.
- [x] Fail-closed input/output validation preserved and strengthened.
- [x] Design read; gpt-taste used for transport error copy, with no layout changes.
- [x] Resource limits justified by completed constrained measurements and safe failures.
- [x] Production container tested, including exact native tool versions.
- [x] Browser/API integration and response validation executed.
- [x] Cleanup, cancellation, admission recovery and shutdown verified in Linux.
- [x] Documentation, exact test counts and deployment envelope synchronized.
- [x] Full quality gates passed on the recorded implementation commit.

The next agent must retain explicit consent and the shared one-active-operation
policy. Reassess native security advisories and actual deployment controls before
raising limits. Keep Phase 4A/B/C records as historical evidence; current policies
and measurements belong here. Later product features remain outside this phase.
The 16 MP color raster's typed failure and temporary-space discrepancy merit
focused investigation before expanding OCR compatibility. Do not treat a sampled
low peak during a failed job as proof that its complete processing fits 512 MiB.
