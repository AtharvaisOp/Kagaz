# Phase 5E — accessibility and responsive polish

## Scope

Focused fixes based on browser inspection of the existing editor. The established dark surfaces, orange actions, cyan focus accents, Inter and JetBrains Mono typography, and current component layouts remain in place.

## Changes

- The mobile page manager now exposes a named modal dialog, moves focus to its close control, traps Tab and Shift+Tab, closes with Escape, and returns focus to the Pages trigger.
- The Pages trigger and page-manager close control now stay hidden outside the mobile breakpoint. Their base button styles previously overrode `display: none`.
- Compress PDF and OCR PDF keep their visible labels on narrow screens.
- The viewer toolbar wraps at tablet widths so its actions do not clip.
- The annotation summary toggle and page action buttons show a cyan keyboard focus ring.
- The viewer toolbar uses a named group because it does not implement the arrow-key navigation required by the ARIA toolbar pattern.
- `scripts/verify-phase5e.mjs` checks 1440, 768, 390 and 360 px layouts at DPR 2, horizontal overflow, visible toolbar controls, visible mobile labels, keyboard zoom, focus styling, and mobile dialog keyboard behavior. It saves screenshots and a JSON report to an external artifact directory.

## Design and motion

Read `design.md` and the gptTaste skill before editing UI. The implementation follows the existing Kagaz surface, color, typography and control tokens. The skill's interaction guidance informed keyboard focus and restrained feedback. Its unrelated landing-page, font replacement and GSAP requirements conflict with this focused editor task and the repository rule that `design.md` controls the visual system; no redesign or new animation dependency was introduced. Existing reduced-motion rules remain active.

## Validation

- `pnpm install --frozen-lockfile` — passed with pnpm 12.3.4.
- `pnpm lint` — passed.
- `pnpm typecheck` — passed.
- `pnpm --filter @kagaz/web test` — 77 files, 802 tests passed.
- `pnpm build` — passed; existing dynamic-import and large-chunk warnings remain.
- `pnpm format:check` — passed.
- `node --test scripts/workspace-sample.test.mjs` — 3/3 passed.
- `node scripts/verify-phase3f.mjs` — passed.
- `node scripts/verify-phase3g.mjs` — passed, including 390×844 and 360×800 mobile flows.
- `node scripts/verify-phase3g-lifecycle.mjs` — passed.
- `node scripts/verify-phase5e.mjs` — passed in Chromium 151 at DPR 2 for all four requested widths; no page errors or horizontal document overflow.
- `git diff --check` — passed.

Artifacts were written to `%LOCALAPPDATA%\Kagaz\phase5e-verification-20261017` and are intentionally outside the repository.

## Limits

This is a focused accessibility and responsiveness pass, not a full screen-reader certification. The public production alias still returns HTTP 429 Security Checkpoint to anonymous requests, so anonymous production PDF verification remains blocked.
