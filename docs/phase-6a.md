# Phase 6A — local PDF assistant

## Durable checkpoint

Updated: 2026-10-17

Status: implementation and real-browser verification pass locally. Pull request,
exact-head CI, merge, and production verification remain pending.

### Starting state

- Repository: https://github.com/AtharvaisOp/Kagaz.git
- Requested and actual starting SHA: `acb79f6441e36557bc8680e5e232c561524f3431`
- Starting branch: `codex/final-status-checkpoint`
- Starting worktree: clean
- Remote: `origin https://github.com/AtharvaisOp/Kagaz.git`
- Open-PR audit through GitHub integration: no open PRs.
- `docs/project-completion-status.md` describes main as
  `4bfe0cf02010cdc02880b3140121c7bd1e9fc3a6`, while the checked-out requested
  baseline is `acb79f6441e36557bc8680e5e232c561524f3431`. Work is based on the
  actual clean checkout and task-specified baseline.
- Working branch: `codex/phase-6a-ai-assistant`.

### Investigation and architecture decisions

- Read `AGENTS.md`, `design.md`, `README.md`, `docs/phase-5f.md`, and
  `docs/project-completion-status.md` before implementation.
- Audited App, PdfViewer, workspace reducer/controller, navigation, annotation
  validation/controller, watermark validation/controller, editor history, and
  export pipeline. Existing page operations are not part of unified Undo/Redo;
  annotations and watermarks are.
- gptTaste was read and used for restrained focus, loading, and feedback polish.
  Its landing-page/AIDA/bento/GSAP guidance conflicts with this editor dialog
  and `design.md`; `design.md` remained authoritative. Dialog motion respects
  reduced-motion preferences.
- One approved command is one editor mutation. Multi-page rotation is atomic in
  the existing workspace reducer. Existing export and history controllers are
  used; there is no second export path.

### Implemented commands

- Navigate to a numbered page.
- Rotate one or up to 10 numbered pages 90 degrees clockwise or
  counterclockwise.
- Move one numbered page to a named or numbered position, including moving the
  last page to the beginning.
- Delete one page, only after a separate explicit confirmation checkbox.
- Add or update a text watermark on every page. Existing text style is retained
  when editing; replacing an image watermark is clearly identified.
- Remove an existing committed watermark.
- Add a centered text note to one numbered page.

The offline parser supports a deliberately small English command grammar. Text
is limited to printable ASCII in this phase. Unsupported and ambiguous requests
produce a fixed explanation instead of an operation.

### Safety, freshness, privacy, and history

- Operations are strict discriminated unions and are independently validated at
  runtime. Extra keys, unknown operations, invalid page IDs, duplicate or
  excessive rotation targets, unsafe text, invalid positions, final-page
  deletion, and absent-watermark removal are rejected.
- Human page numbers resolve to stable `WorkspacePageId` values. The local
  freshness revision covers page identity/source/order/rotation and watermark
  configuration and is checked at planning and approval/execution boundaries.
  Start Over unmounts the dialog and invalidates its old proposal.
- Apply uses a synchronous lock against repeated clicks. Watermark work can be
  cancelled through its controller generation; unsupported actions never reach
  a controller.
- Page select/reorder/rotate/delete are explicitly identified as outside the
  current Undo/Redo timeline. Watermark and annotation changes use existing
  unified history. Existing-watermark edit and Undo were exercised in browser.
- Browser PDF bytes, extracted text, filenames, annotations, and source IDs are
  not sent to any planner. Planner context is limited to numeric page count,
  current page/rotation, watermark presence/kind, and static capabilities.
  Prompt-injection strings in user input and local document/watermark metadata
  are covered by tests.
- Remote planning has a narrow mockable structured-response adapter, exact-key
  parsing, independent validation, cancellation, a 15-second timeout, and
  sanitized errors. No live provider, credentials, public proxy, or remote UI
  path is configured. The assistant clearly says remote AI is unavailable until
  authenticated usage limits are configured. Offline command parsing is not
  presented as a live LLM.

### Files changed

- Added `apps/web/src/features/pdf-assistant/` for operation types, snapshots,
  local interpretation, runtime validation, mockable planner, deterministic
  execution, dialog UI, and focused tests.
- Integrated the assistant button/dialog through `App`, `PdfViewer`, and
  `ViewerToolbar`.
- Added atomic multi-page rotation to the existing workspace model and
  operation-result booleans to workspace/navigation/annotation/watermark
  controller boundaries.
- Added assistant styling in `apps/web/src/styles.css` and dialog focus support
  in `PdfToolDialog`.
- Added `scripts/verify-phase6a.mjs`, `docs/phase-6a.md`, and README scope/privacy
  notes.

### Verification completed

- `pnpm install --frozen-lockfile`: passed with pnpm 12.3.4. The default
  workspace `pnpm` shim is 11.25.0; root Turbo commands were run with the
  installed pnpm 12.3.4 native binary because pnpm 11 cannot resolve the
  repository's declared package-manager binary.
- `pnpm lint`: passed, 3 workspace packages.
- `pnpm typecheck`: passed, 3 workspace packages.
- Web suite: 817 tests passed across 78 files.
- `node --test scripts/workspace-sample.test.mjs`: 3 passed, 0 failed.
- `pnpm build`: passed for shared-types, API, and web. Vite reported the
  existing large-chunk warning (>700 kB) and an ineffective dynamic-import
  warning for `nativeImage.ts`.
- `pnpm format:check`: passed.
- `git diff --check`: passed.
- Full `pnpm test`: not green on this Windows host. The web suite passed; 96 API
  native PDF inspector tests failed because the default `python3` resolves to
  the Microsoft Store execution alias and this host lacks CI's Python PDF
  packages/native tools. The output reported 102 API tests passing and 8
  skipped. CI installs these Linux packages before running the suite. Exact-head
  CI remains required before merge.
- `scripts/verify-phase6a.mjs` passed in Chromium `151.0.7922.34` with a locally
  generated five-page PDF. It independently inspected downloaded PDF outputs
  using pdf-lib and PDF.js. Verified: preview without mutation; single rotation
  after duplicate Apply; selected page; watermark create/edit/remove and Undo;
  centered note text in export; reorder; deletion confirmation and page removal;
  cancellation; stale proposal rejection after Start Over; no browser errors or
  non-GET requests; dialog layout/keyboard focus at 1440, 768, 390, and 360 px;
  reduced motion at mobile widths.
- Browser artifacts and report are outside the repository under
  `C:\Users\athar\AppData\Local\Temp\kagaz-phase6a`.

### Remaining release work

1. Review the complete diff and final docs.
2. Commit and push this branch, then open a reviewable PR.
3. Verify exact-head GitHub Actions, including native/container/browser gates.
4. Merge only after all required checks pass and repository permissions allow.
5. Verify final main SHA, Actions, Vercel READY deployment, and shipped
   assistant. Confirm production local-command editing/export and lack of
   unintended network uploads. No live remote model should be claimed.

### Phase 6B handoff

Keep the command schema and executor as the sole mutation path. Document-aware
retrieval, local PDF text extraction, citations, and any controlled context
sharing belong in Phase 6B and must preserve approval-before-execution and the
browser-local default.
