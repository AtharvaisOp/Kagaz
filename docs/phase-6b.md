# Phase 6B — local document retrieval

## Phase status

**IN PROGRESS — PR review, Linux CI, and production verification remain.** The
active branch is `codex/phase-6b-document-retrieval`, based on the verified
starting `main` commit `b2e157b9ce6dab18a76ac2757786b1b0f64ee637`. The
implementation commit is `9c6af6be37716c1ec924385af7c749afe36a8f79`; PR #13 is
open at https://github.com/AtharvaisOp/Kagaz/pull/13. The Vercel preview check
is green. Exact-head GitHub Actions run 99 passed its quality job and existing
Phase 4/5/6A container/browser regressions, then failed in the Phase 6B browser
verifier: after selecting page 4, the test clicked “Add redaction region” before
the page preview had made the action available. The verifier now explicitly
waits for that action to become enabled; the full local browser matrix passes
with the wait. A follow-up commit is pending. Initial inspection found a clean
starting checkout and no open pull request for this work. The package-manager
command for this host is `npx --yes pnpm@12.3.4` because the installed global
shim is pnpm 11.25.0.

## Current implementation

Ask PDF extends the existing Phase 6A dialog. It performs local exact-phrase
and keyword retrieval against selectable text extracted by PDF.js from the
documents already owned by `SourceDocumentRegistry`. It does not introduce a
second PDF loading system or a live model connection. The index keeps original
display text apart from normalized matching text and returns passage matches,
not generated answers.

The current implementation includes:

- Typed text extraction, passage indexing, deterministic BM25-style scoring,
  exact phrase matching, page filtering, excerpts, and bounded ranked results.
- Stable workspace page IDs in result identities. Page numbers are resolved
  from the latest workspace ordering when results render and when they are
  navigated.
- Explicit `source-pdf` versus `committed-form-value` provenance. Supported
  text, multiline, radio, dropdown, and option-list committed values are
  labeled by field name. Temporary drafts, password values, checkboxes,
  annotations, watermarks, filenames, and UI metadata are not indexed.
- Source text caching by source document ID and source page index, so repeated
  workspace occurrences share extraction while retaining distinct citations.
- Complete retrieval exclusion and cache purging for a source page with a
  pending redaction. The exclusion is based on the proposal’s stable page
  identity; no text or form value from that page is extracted or searched.
- A future context-sharing value object that requires explicit consent,
  selected passages, bounded text, current page citations, a disclosure, and
  an untrusted-document-data marker. It is not sent anywhere.
- A per-page PDF.js page lease used by the viewer, thumbnails, extraction,
  watermarks, and source registry retirement. Destructive page/document cleanup
  waits for active render or extraction work to finish.

## Search behavior and limits

The fixed retrieval limits live in
`apps/web/src/features/pdf-assistant/retrieval/index.ts`:

| Resource                             |                      Limit |
| ------------------------------------ | -------------------------: |
| Workspace page occurrences           |                      1,500 |
| Unique source pages                  |                      1,000 |
| Extracted characters per source page |                     24,000 |
| Total source and form text           |       2,000,000 characters |
| Committed form passages              |                        500 |
| Form text                            |         100,000 characters |
| One form value                       |           2,000 characters |
| Passage chunks                       |                     10,000 |
| Chunk text                           |           1,100 characters |
| Query                                |             400 characters |
| Quoted exact phrase                  |             240 characters |
| Excerpt                              |             420 characters |
| Returned results                     | 100; initially displays 20 |

PDF.js extraction is sequential (effective concurrency one), cancellable, and
yields between pages. It tolerates malformed text items, imposes a per-page
character ceiling, and uses the registry’s already-loaded document proxy.
Chunking favors paragraphs and sentence boundaries, with overlap for long
passages. Unicode normalization is used for matching while original display
text is retained. Repeated edge lines are suppressed conservatively. PDF.js
text order can be imperfect for complex page layouts; tables, multi-column
content, and scanned pages do not receive semantic reconstruction or OCR.

If extraction, character, occurrence, chunk, or passage limits are reached,
the interface reports partial indexing rather than claiming the whole
workspace was searched. Search remains read-only. Document text cannot reach
the Phase 6A command interpreter or executor; edits still use validated,
approval-gated Phase 6A operations.

## Privacy and redaction boundary

The session index is held in application memory and is cleared on Start Over,
workspace replacement, or assistant unmount. No document text is written to
local storage, session storage, IndexedDB, or a remote vector store. The browser
search path has no model or analytics request and does not upload PDF bytes,
source text, form values, filenames, or search results. Future context sharing
is only prepared as a typed object; remote generation is disabled pending
separate authenticated access, quotas, spending controls, and explicit user
consent.

Pending redactions are a hard exclusion. If any logical occurrence identifies
a source page with a pending region, the source page key is blocked across all
duplicate workspace occurrences. Cached source text and committed form values
for that page are removed. Start Over clears the index before the replacement
workspace is used. A finalized sanitized PDF opened as a new document receives
its own ordinary extraction.

## Validation checkpoint

The standalone verifier is `scripts/verify-phase6b.mjs`. It generates
synthetic PDFs with known text, Unicode, form values, repeated text, and
image-only pages, plus 100- and 300-page benchmark documents. Browser scenarios
cover exact and natural-language keyword searches, page citations, page edits,
duplicate sources, redaction exclusions, cancellation, search replacement,
Start Over, mobile layouts, and network/storage boundaries.

Latest completed checks:

- `pnpm install --frozen-lockfile`: passed using pnpm 12.3.4 after stopping the
  local Vite preview that held Windows module files open.
- `pnpm lint`: passed in all three workspace packages.
- `pnpm typecheck`: passed in all three workspace packages.
- Web tests: **850 passed across 82 files**. The focused retrieval suite is
  included in that run.
- `node --test scripts/workspace-sample.test.mjs`: **3 passed**.
- `pnpm build`: passed. Vite reports an ineffective dynamic import for the
  existing watermark native-image module and a main bundle above its 700 kB
  warning threshold; the build still completes successfully.
- `pnpm format:check` and `git diff --check`: passed.
- `scripts/verify-phase6b.mjs`: passed all 19 recorded scenarios in Chromium.
  It covered exact and keyword search, adversarial document text, Unicode,
  committed form provenance, reorder/delete/add/duplicate citations, pending
  redaction exclusion for source and form text, cancellation, query
  replacement, Start Over, and 390/360 px layouts. The run reported zero
  browser errors, zero cross-origin requests, zero document-content requests,
  unchanged browser storage snapshots, and remote generation disabled.

Measured synthetic browser results from this host:

| Fixture                                   | Cold index and search | Warm search |       Indexed pages | Text characters | Chunks |
| ----------------------------------------- | --------------------: | ----------: | ------------------: | --------------: | -----: |
| 5-page mixed text/image PDF               |                 54 ms |      108 ms |        4 searchable |             863 |      7 |
| 100-page text PDF                         |                933 ms |       84 ms |                 100 |           3,884 |    100 |
| 300-page text PDF                         |              2,027 ms |      128 ms |                 300 |          12,084 |    300 |
| Two source PDFs with a duplicate addition |                137 ms |         n/a | 5 unique searchable |             726 |      8 |

The 5-page fixture also indexed one committed form passage. Start Over during
an active 300-page index left the replacement session with zero indexed source
pages, form passages, characters, or chunks. Chromium’s
`performance.memory.usedJSHeapSize` exposed the same coarse 68,000,000-byte
reading after the 100- and 300-page runs; this API did not isolate index memory
and is not treated as a per-index measurement. The reliable index-size
measurements are the bounded character and chunk counts above. Timings include
PDF.js loading and local extraction/search; the synthetic PDFs are small text
fixtures rather than representative large production files.

The complete Windows `pnpm test` command failed in API native suites: **96
failed, 102 passed, 8 skipped out of 206 API tests**. The exact-head Linux
quality job subsequently passed the API suite (**206 passed**), web suite
(**850 passed**), workspace sampler (**3 passed**), lint, typecheck, build,
format check, and diff check. The host has no
`qpdf`, Ghostscript, `ocrmypdf`, Tesseract, LibreOffice/`soffice`, or Docker
binary; several native-tool invocations return Windows command-not-found code 9009. Exact-head Linux CI remains required for the Phase 6B browser verifier
after the readiness-wait fix and merge eligibility.

The 390- and 360-pixel screenshots after scrolling to citations are saved
outside the repository in
`C:\temp\KagazPhase6B\phase6b\phase6b-assistant-mobile-390-results.png` and
`C:\temp\KagazPhase6B\phase6b\phase6b-assistant-mobile-360-results.png`. The
mobile scroll-into-view assertion passed at both widths. The exact-head Linux
job also passed the previous Phase 4–6A native/container and browser steps;
the Phase 6B Linux browser step must pass after the test-readiness correction.
Merge, final `main` SHA, and production deployment verification remain
pending. Do not mark this phase PASS until those checks finish and the
production build is verified.

## Git and release checkpoint

- Branch: `codex/phase-6b-document-retrieval`
- Starting SHA: `b2e157b9ce6dab18a76ac2757786b1b0f64ee637`
- Phase 6B implementation commit: `9c6af6be37716c1ec924385af7c749afe36a8f79`
- Pull request: https://github.com/AtharvaisOp/Kagaz/pull/13
- Latest exact-head GitHub Actions run 99: quality and Phase 4–6A checks passed;
  Phase 6B verifier exposed the page-preview readiness race described above
- Follow-up verifier fix: local 19-scenario browser run passed; push and CI
  rerun pending
- Final `main` SHA: pending
- Production deployment SHA: pending

## Next action

Commit and push the verifier readiness fix with this checkpoint, then wait for
CI on the new exact PR head. Merge only after exact-head CI and repository
policy allow. Verify the resulting `main` SHA, production deployment, and
assistant behavior on the production build. Update this checkpoint with exact
Git/CI/deployment evidence.
