# Kagaz — Repository Agent Instructions

## 1. Project Identity

**Kagaz** is a portfolio-grade, browser-first PDF editing web application.

The long-term product is a modern PDF editor capable of viewing, merging, splitting, reordering, annotating, signing, filling forms, compressing, OCR, converting, redacting, watermarking, and related PDF workflows.

This is not intended to become a tutorial clone or a collection of disconnected demos. Treat it as a production-minded full-stack portfolio project with strong architecture, engineering hygiene, UX quality, deployment readiness, and defensible technical decisions.

Repository:

`https://github.com/AtharvaisOp/Kagaz.git`

---

# 2. Core Architectural Principle

Kagaz uses a **hybrid architecture**.

The default rule is:

> If an operation can reasonably and securely be performed in the browser, keep it in the browser.

Client-side operations will eventually include:

* PDF rendering
* merge
* split
* reorder
* rotate
* page deletion
* annotations
* form filling
* signatures
* annotation flattening
* related lightweight transformations

Backend processing is reserved for operations that genuinely benefit from or require native/server-side tooling, such as:

* Ghostscript
* qpdf
* Tesseract OCR
* LibreOffice headless
* future long-running jobs

Do not introduce server dependencies for operations intended to remain client-side.

Do not upload user PDFs to the backend merely because doing so is easier to implement.

Privacy and local-first processing are architectural features of Kagaz.

---

# 3. Intended Repository Structure

Use the following monorepo direction unless an explicitly approved later phase changes it:

```text
Kagaz/
├─ apps/
│  ├─ web/                  # React + Vite + TypeScript frontend
│  └─ api/                  # Node.js + Express + TypeScript backend
│
├─ packages/
│  └─ shared-types/         # Shared TypeScript contracts/types
│
├─ .github/
│  └─ workflows/
│
├─ design.md
├─ AGENTS.md
├─ package.json
├─ pnpm-workspace.yaml
├─ turbo.json
└─ ...
```

Use:

* pnpm workspaces
* Turborepo
* TypeScript
* React + Vite for the frontend
* Tailwind CSS for styling
* Node.js + Express for the API

Future PDF libraries include PDF.js, pdf-lib, and an annotation canvas library, but do not install or implement future-phase dependencies prematurely without a concrete current use.

---

# 4. Mandatory Design Protocol

`design.md` is the **authoritative visual specification for Kagaz**.

Before creating, redesigning, or substantially modifying any user-facing UI:

1. Read `design.md` completely.
2. Understand its visual hierarchy, typography, spacing, color system, surfaces, borders, component style, layout philosophy, responsiveness, and interaction language.
3. Follow `design.md` rather than inventing a separate design system.
4. Use the **gptTaste skill** when implementing or refining UI.

### Relationship between design.md and gptTaste

They have different jobs:

* `design.md` controls the overall visual language and product design.
* `gptTaste` should enhance execution quality, especially:

  * motion
  * microinteractions
  * hover/focus behavior
  * transitions
  * loading states
  * entrance/exit behavior
  * tactile interaction feedback
  * subtle polish
  * perceived responsiveness

If `gptTaste` proposes something that conflicts with `design.md`, **design.md wins**.

Do not use gptTaste as permission to redesign the product.

Animations must serve usability and polish rather than showing off.

Respect `prefers-reduced-motion`.

Do not add excessive animation to repetitive actions, scrolling, PDF page rendering, or controls where motion becomes distracting.

### Hard requirement

Whenever a phase contains UI work, invoking/using the gptTaste skill is required.

If the skill genuinely cannot be invoked in the current environment, do not pretend that it was used. Continue using `design.md` as the authority and explicitly document the skill failure in the final report.

---

# 5. Implementation Philosophy

Prefer:

* simple architecture
* explicit code
* strong TypeScript typing
* small focused modules
* clear component boundaries
* meaningful naming
* predictable state management
* accessible HTML
* maintainable CSS/Tailwind usage
* reusable primitives where reuse is real
* good loading/error/empty states

Avoid:

* speculative abstractions
* giant components
* unnecessary state libraries
* unnecessary UI libraries
* unnecessary backend calls
* premature optimization
* premature microservices
* dependency duplication
* package-installation sprawl
* `any` as an escape hatch
* hidden failures
* placeholder production logic
* hardcoded environment-specific URLs

Do not create architecture merely because it sounds impressive in a README.

Every abstraction should solve an actual problem.

---

# 6. TypeScript Rules

Use strict TypeScript.

Prefer:

* explicit domain types
* discriminated unions where useful
* typed API contracts
* typed component props
* typed utility boundaries

Avoid `any`.

If an external library forces an unsafe boundary, isolate it to the smallest practical area and document why.

Shared frontend/backend contracts belong in `packages/shared-types` when they genuinely need to be consumed by both applications.

Do not turn `shared-types` into a miscellaneous dumping ground.

---

# 7. Frontend Rules

The frontend lives in `apps/web`.

General requirements:

* React
* Vite
* TypeScript
* Tailwind CSS
* accessible semantic HTML
* keyboard-accessible interactive controls
* visible focus states
* responsive behavior
* useful error states
* no backend dependency for client-only PDF workflows

Use React state as the default.

Do not add Redux/Zustand/etc. until application complexity actually justifies it.

Keep PDF-specific logic outside presentation components where practical.

---

# 8. PDF Handling Rules

PDFs may be large and expensive to render.

Do not assume every PDF is a five-page demo file.

When working with PDF.js:

* configure the PDF.js worker properly
* do not depend on a random external worker CDN
* avoid rendering every page unnecessarily when documents become large
* account for device pixel ratio appropriately
* clean up object URLs/resources
* cancel stale render tasks where relevant
* avoid memory leaks when switching files
* handle corrupt/unsupported PDFs gracefully
* separate rendering scale from CSS display sizing appropriately

Future optimization should favor lazy/viewport-aware page rendering.

Never silently upload a PDF to the backend for a client-side feature.

---

# 9. Backend Rules

The backend lives in `apps/api`.

Use:

* Node.js
* Express
* TypeScript
* environment variables
* explicit validation
* structured error handling

The server must listen on `process.env.PORT` where required by hosting environments.

Do not hardcode production frontend origins.

CORS behavior must be configurable.

When native PDF-processing binaries are added in later phases:

* never interpolate untrusted strings into shell commands
* validate inputs
* constrain file paths
* use safe process execution APIs
* enforce resource limits where practical
* clean temporary files
* treat uploaded PDFs as untrusted data

Heavy processing is not part of early phases unless explicitly requested.

---

# 10. Dependency Discipline

Before adding a dependency, determine whether:

1. the platform already provides the capability,
2. the repository already has a suitable dependency,
3. a small amount of application code is sufficient.

Use mature, actively maintained packages.

Avoid installing multiple libraries for the same job.

Do not install future-phase packages simply because they appear in the roadmap.

Lock dependency versions through the pnpm lockfile.

---

# 11. Accessibility

Accessibility is part of implementation quality, not a future cleanup phase.

At minimum:

* use semantic elements
* labels for form controls
* keyboard navigation
* visible focus indicators
* reasonable contrast
* appropriate ARIA only where native semantics are insufficient
* accessible loading/error messaging
* reduced-motion support

---

# 12. Performance

Avoid obvious performance traps.

Especially for PDF rendering:

* avoid unnecessary rerenders
* avoid storing huge duplicated buffers in React state
* release obsolete resources
* avoid rendering pages that are nowhere near the viewport when practical
* avoid performing expensive work directly in render functions

Do not over-optimize before profiling, but do not knowingly implement pathological behavior either.

---

# 13. Environment Variables

Never commit credentials or secrets.

For every required variable:

* provide `.env.example`
* document what it controls
* provide safe local defaults where appropriate

Production URLs must be configurable.

---

# 14. Git Rules

You are authorized to modify the repository and create commits.

Repository:

`https://github.com/AtharvaisOp/Kagaz.git`

Default branch:

`main`

Before working:

* inspect `git status`
* inspect the current branch
* inspect configured remotes
* inspect existing files before replacing anything

Never discard user changes.

Never run destructive resets against user work.

Never force-push unless explicitly instructed in a future task.

Use meaningful commit messages.

For phase-sized work, prefer a clean final commit such as:

```text
feat: establish phase 0 foundations
```

Push completed, verified work to `origin/main` when authentication and repository permissions allow it.

If pushing fails, preserve the local commit and report the exact reason.

---

# 15. Scope Discipline

Work only on the requested phase.

The roadmap exists to prevent every task from turning into a six-month rewrite.

Do not silently implement features assigned to later phases.

Examples:

If working on Phase 0:

Do not implement:

* PDF merge
* PDF split
* reorder/delete/rotate
* annotation tools
* forms
* signatures
* OCR
* compression
* conversion
* accounts
* Supabase
* collaboration
* AI features

Architecture may prepare clean extension points for them, but the functionality itself should wait.

---

# 16. Quality Gate

Before declaring a coding phase complete, run the relevant repository-level verification commands.

At minimum where configured:

```bash
pnpm lint
pnpm typecheck
pnpm build
```

Run additional useful checks appropriate to the work.

Do not claim a command passed unless it actually passed.

Fix failures caused by your changes.

If a failure genuinely cannot be fixed because of an external dependency or unavailable service, document it precisely.

Warnings that indicate real bugs should not be ignored just because the process exits with code 0.

---

# 17. Visual Verification

After UI changes:

* verify the UI against `design.md`
* verify major responsive layouts
* verify interactive states
* verify keyboard interaction where relevant
* verify loading/error/empty states
* verify motion from gptTaste is restrained and useful

If a browser/preview capability is available, use it.

Do not claim visual verification if no browser or preview was actually available.

---

# 18. Documentation

Documentation should explain decisions, not merely restate filenames.

Keep the README useful for:

* recruiters
* developers
* deployment
* local setup

When architectural decisions are non-obvious, explain the reasoning.

Avoid inflated claims such as "production-ready" unless the implementation genuinely supports them.

---

# 19. Phase Completion Report

At the end of every major phase, provide a structured report containing:

## Phase status

PASS / PARTIAL / BLOCKED

## Implemented

Concrete functionality completed.

## Architecture decisions

Important choices and why they were made.

## Files changed

Important files/directories created or modified.

## Design compliance

How `design.md` was followed.

Whether gptTaste was successfully used and where its recommendations affected implementation.

## Validation performed

List each command/check and its actual result.

## Manual verification

Anything manually tested, including PDF behavior and visual verification.

## Git

* branch
* commit hash
* commit message
* push status

## Deployment

Any deployment configuration added plus exact remaining manual steps.

## Deviations

Anything requested but not completed, with the precise reason.

## Known limitations / technical debt

Real remaining concerns only.

## Phase checklist

Repeat every acceptance criterion and mark it:

* [x] complete
* [ ] incomplete

## Notes for the next agent / phase

Important implementation details another agent must understand before modifying the code.

Do not end with a vague statement such as "everything is done."

The report must contain enough information for another engineer to review the work without guessing.