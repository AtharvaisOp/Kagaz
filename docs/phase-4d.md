# Phase 4D — heavy-tool hardening and deployment-envelope audit

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

Small startup, approximately input-ceiling image compression, 300-page compression
and 1/10/20 independently embedded OCR scans are measured. Scans repeat the same
synthetic English image and are not diverse photographs. A fresh-profile DOCX
measures Office startup. Image sizes compare against the starting Phase 4C
Dockerfile using the same current build context. Health readiness excludes image
pull, Docker launch and Render provider cold start. Queue timing based on preceding
client response completion is an observation, not exact server queue residence.

Local post-change lint, typecheck, build, format and diff checks have passed.
Web verification executed 60 files / 477 tests. Focused real-Python PDF/Office
tests executed 88 passed and one Linux-only skip on Windows. Linux container and
browser results will be recorded from the branch CI before this phase is closed.

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

Vercel project discovery succeeded, but deployment listing returned permission
denied. Live deployment/version claims therefore require separate verified evidence.
No hosting plan or paid resource is changed by this phase.

## Acceptance and next-phase handoff

Completion requires the following evidence. The remaining Linux/container gates
must pass before merging to main or changing the phase status to PASS.

- [x] Starting repository state, history and architecture reviewed.
- [x] Baseline commands recorded without suppressing failures.
- [x] Existing heavy-tool architecture and security boundaries audited.
- [x] Discovered defects fixed with targeted regressions.
- [x] No dependency sprawl, automatic upload, persistence or privacy regression.
- [x] Fail-closed input/output validation preserved and strengthened.
- [x] Design read; gpt-taste used for transport error copy, with no layout changes.
- [ ] Resource limits justified by completed constrained measurements.
- [ ] Production container tested, including all native tool versions.
- [ ] Browser/API integration and response validation executed.
- [ ] Cleanup, cancellation, admission recovery and shutdown verified in Linux.
- [ ] Final documentation, exact test counts and deployment evidence synchronized.
- [ ] Full quality gates passing on the completed commit.

The next agent must retain explicit consent and the shared one-active-operation
policy. Reassess native security advisories and actual deployment controls before
raising limits. Keep Phase 4A/B/C records as historical evidence; current policies
and measurements belong here. Later product features remain outside this phase.
