# Phase 6B — local document retrieval

## Phase status

**PASS — merged, CI green, and production verified.** Work started from
`main` commit `b2e157b9ce6dab18a76ac2757786b1b0f64ee637` on branch
`codex/phase-6b-document-retrieval`. PR #13 was merged with squash commit
`742b5e1dab480f3861e4985bea5346bc8c8ae096`; the final code commit on the PR
branch was `e9313d223b2b0b88c7b3e7cc5c032c4c5a315176`. Exact-head CI run 101
passed on the branch and main push run 102 passed on the merge commit. Vercel
production deployment `dpl_CJghD68CxVY4yg796UkiXub6xqP5` is READY from the same
main SHA and owns the `kagaz-personal.vercel.app` alias. The production
Chromium verifier passed all 19 scenarios.

Runs 99 and 100 exposed the same test readiness race: selecting page 4 updated
workspace selection before PDF.js finished rendering its lazy preview and
registering redaction geometry. The final verifier uses reduced motion, waits
for page 4's ready canvas, verifies its selected-page label, and waits for the
specific enabled redaction control. The updated verifier passed locally, on
exact branch-head run 101, on main run 102, and in the production browser.
Initial inspection found a clean starting checkout and no open pull request for
this work. Use `npx --yes pnpm@12.3.4` on this host; its global pnpm shim is
11.25.0.

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

## Design and accessibility

`design.md` remains the visual authority. Ask PDF extends the existing assistant
dialog and retains Kagaz's dark surfaces, orange primary action, cyan focus
state, and existing typography. The gptTaste skill was applied to interaction
polish without changing the product's visual system. The dialog remains
keyboard-operable, restores focus to its trigger on close, announces search
progress and results, and respects `prefers-reduced-motion`. Browser checks
passed at 390 px and 360 px; production screenshots are listed below.

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
- Exact-head Linux CI run 101 passed on branch commit
  `e9313d223b2b0b88c7b3e7cc5c032c4c5a315176`; main push run 102 passed on
  `742b5e1dab480f3861e4985bea5346bc8c8ae096`. Each run passed 850 web tests
  across 82 files, 206 API tests across 11 files, and 3 workspace sampler
  tests, followed by all Phase 4/5/6A/6B native, container, and browser checks.
  Run 102: https://github.com/AtharvaisOp/Kagaz/actions/runs/39104213099
- The production run of the same verifier passed all 19 scenarios on
  `https://kagaz-personal.vercel.app`. It observed zero browser errors, zero
  cross-origin requests, zero requests containing document content, unchanged
  browser storage, and disabled remote generation. The fixture PDFs were
  supplied through local file inputs; search did not upload them.

Measured synthetic browser results from this host:

| Fixture                                   | Cold index and search | Warm search |       Indexed pages | Text characters | Chunks |
| ----------------------------------------- | --------------------: | ----------: | ------------------: | --------------: | -----: |
| 5-page mixed text/image PDF               |                 39 ms |       33 ms |        4 searchable |             863 |      7 |
| 100-page text PDF                         |                233 ms |       36 ms |                 100 |           3,884 |    100 |
| 300-page text PDF                         |                476 ms |       64 ms |                 300 |          12,084 |    300 |
| Two source PDFs with a duplicate addition |                 45 ms |         n/a | 5 unique searchable |             726 |      8 |

The 5-page fixture also indexed one committed form passage. Start Over during
an active 300-page index left the replacement session with zero indexed source
pages, form passages, characters, or chunks. Chromium’s
`performance.memory.usedJSHeapSize` exposed the same coarse 76,600,000-byte
reading after the 100- and 300-page runs; this API did not isolate index memory
and is not treated as a per-index measurement. The reliable index-size
measurements are the bounded character and chunk counts above. Timings include
PDF.js loading and local extraction/search; the synthetic PDFs are small text
fixtures rather than representative large production files.

The production Chromium run on this host measured 36 ms for 5-page cold
index/search and 37 ms warm; 119 ms cold and 41 ms warm for 100 pages; and
322 ms cold and 62 ms warm for 300 pages. The duplicate-source fixture took
43 ms. Its `performance.memory` reading was 21,700,000 bytes after both the
100- and 300-page runs; this is a coarse browser heap value, not an isolated
index-memory measurement. The 300-page fixture produced 12,084 indexed
characters and 300 chunks. These synthetic PDFs do not represent scanned or
complex-layout documents.

The complete Windows `pnpm test` command failed in API native suites: **96
failed, 102 passed, 8 skipped out of 206 API tests**. The exact-head Linux
quality job subsequently passed the API suite (**206 passed**), web suite
(**850 passed**), workspace sampler (**3 passed**), lint, typecheck, build,
format check, and diff check. The host has no
`qpdf`, Ghostscript, `ocrmypdf`, Tesseract, LibreOffice/`soffice`, or Docker
binary; several native-tool invocations return Windows command-not-found code 9009. The authoritative Linux runs passed the API suite and every native,
container, and browser regression.

The 390-, 360-pixel, and desktop production screenshots after navigating to
citations are saved outside the repository in
`C:\temp\KagazPhase6B\phase6b\phase6b-assistant-mobile-390-results.png`,
`C:\temp\KagazPhase6B\phase6b\phase6b-assistant-mobile-360-results.png`, and
`C:\temp\KagazPhase6B\phase6b\phase6b-assistant-desktop.png`. Citation
scrolling and keyboard search passed at both mobile widths.

## Git and release checkpoint

- Branch: `codex/phase-6b-document-retrieval`
- Starting SHA: `b2e157b9ce6dab18a76ac2757786b1b0f64ee637`
- Phase 6B implementation commit: `9c6af6be37716c1ec924385af7c749afe36a8f79`
- Pull request: https://github.com/AtharvaisOp/Kagaz/pull/13 (merged)
- Final PR branch head: `e9313d223b2b0b88c7b3e7cc5c032c4c5a315176`
- Merged `main` SHA: `742b5e1dab480f3861e4985bea5346bc8c8ae096`
- CI: run 101 passed on the exact PR head; run 102 passed on merged `main`
- Production deployment: `dpl_CJghD68CxVY4yg796UkiXub6xqP5`, READY from the
  merged `main` SHA; alias `https://kagaz-personal.vercel.app`
- Production browser verification: 19 scenarios passed; no document-content
  requests or cross-origin requests
- Phase 6C handoff: authenticated, explicitly consented grounded generation
  with quotas, spending controls, context review, and prompt-injection defenses

## Next action

Phase 6B is complete. Phase 6C should reuse the typed passage IDs and citations
while separately implementing authenticated model access, explicit context
consent, usage and spending limits, grounded answers, and prompt-injection
resilience. The retrieval-only path must remain useful when no model is
configured.
