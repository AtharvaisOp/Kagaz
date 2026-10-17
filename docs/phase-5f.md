# Phase 5F — final production-readiness audit

## Status

**PARTIAL.** The scoped engineering release passed exact-head PR CI and exact merged-main CI. The production deployment for main SHA `af3b000cb8d7f37b37ad85891720ef5914cd2cfc` is `READY` and the public alias is bound to it. Anonymous production PDF export could not be verified: the public alias returned HTTP 429, the immutable deployment redirected a browser to Vercel login, and the connected Vercel fetch integration returned 403 because its account could not access the project. No authenticated bypass or protection setting was changed.

## Audited release surface

The exact merged-main workflow [Run 82](https://github.com/AtharvaisOp/Kagaz/actions/runs/39018731659) passed at `af3b000cb8d7f37b37ad85891720ef5914cd2cfc`. Its production-container job exercised office conversion, output integrity and isolation; native-tool limits, container cleanup, scaling, cancellation and shutdown; editor and real container integration; redaction removal; watermarking on redacted pages; Unicode embedding, extraction, rendering and redaction; startup diagnostics; and cleanup.

Run 82's quality job passed frozen dependency installation, lint, typecheck, tests, build, formatting and diff checks. Test totals were 802 web tests across 77 files, 206 API tests across 11 files, and 3 workspace sampler tests. Phase 5E's browser checks additionally covered 1440, 768, 390 and 360 px layouts at DPR 2, keyboard interaction and mobile dialog focus behavior (details in [phase-5e.md](phase-5e.md)).

Previously released gates remain recorded in the stage reports: image/signature hardening in [PR #6](https://github.com/AtharvaisOp/Kagaz/pull/6), Phase 5D performance baseline in [PR #7](https://github.com/AtharvaisOp/Kagaz/pull/7) and Phase 5E in [PR #8](https://github.com/AtharvaisOp/Kagaz/pull/8). Phase 5D measured rendering, export, retained resources and reset behavior; it found no measured reason to replace the bounded rendering/export subsystems. See [phase-5d.md](phase-5d.md) for host-specific readings and measurement limits.

## Security and reliability findings

- Browser-local PDF editing and export remain the default. Compression, OCR and Office conversion are explicit server submissions; no account, cloud collaboration, AI or persistent PDF storage was added.
- Malformed image annotation/signature input is bounded and rejected safely; transparency, JPEG appearance, aspect ratio, asset lifecycle and Undo/Redo have focused regression coverage.
- Redaction remains rasterized at 144 DPI with pixel sanitization, bounded resources and fail-closed checks for unsafe retained source resources. CI independently checks that redacted content is removed.
- PDF.js worker/canvas cleanup, large-document behavior, repeated exports and export snapshots have Phase 5D measurements and regressions. Native processing remains constrained by validated inputs, resource budgets, temporary-directory cleanup, cancellation and shutdown checks.
- The shipped custom-font scope is Latin, accented/Extended Latin, Greek, Cyrillic and supported NFC-composable accents. Hindi/Marathi Devanagari, RTL and other unverified complex scripts are visibly unsupported.
- Visual signatures are marks and do not create cryptographic PDF signatures. Unsupported signed PDFs and JavaScript/action structures remain rejected as documented in the earlier stage reports.

## Manual and production checks

- Local Phase 5E browser matrix passed in Chromium 151 with DPR 2 at 1440, 768, 390 and 360 px. No page errors or horizontal document overflow were observed; mobile dialog keyboard trapping, Escape close, focus return and visible focus styling passed.
- Vercel deployment `dpl_7PgGo2Rah4Lx9eANhYnKmsbLRX7C` was `READY` for the exact main SHA and exposed alias `kagaz-personal.vercel.app`.
- Anonymous browser-level PDF upload/export on the production alias: **not verified**, blocked by the 429/login protection response. Vercel's authenticated fetch returned 403 (`read_protection_bypass`) because the connected account could not access the deployment. This is an access limitation, not evidence of an application regression.
- No claim is made that a PDF was downloaded independently from the protected live deployment. The CI browser verifiers created and independently inspected their own output artifacts.

## Remaining limitations

- Full Phase 5C remains partial because complex-script shaping and extraction are not shipped.
- Public anonymous production PDF verification requires the production alias to allow anonymous access or a properly authorized deployment inspection path. Until then, release evidence is exact-SHA CI plus Vercel deployment readiness.
- Accessibility work was a focused keyboard/responsive pass, not a formal screen-reader certification.
