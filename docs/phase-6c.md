# Phase 6C — Google authentication and grounded Groq chat

## Durable checkpoint

Updated: 2026-10-19 (Asia/Kolkata). Status: **PARTIAL — Groq Free Plan mode is explicitly gated with a $0 application budget. Exact-head Run 112 passed all three CI jobs on code commit `70b41963dc703b016b60112781d61324d0791c62`. Live AI remains disabled pending owner verification of the Groq organization plan and production Firebase runtime checks.**

- Started from clean `main` / `origin/main` at
  `f252998ff2ffce209d28b8073b19b633bbac0e48`.
- Working branch: `codex/phase-6c-firebase-groq-chat`; this Free Plan change is not yet committed.
- Existing PR [#14](https://github.com/AtharvaisOp/Kagaz/pull/14) is open and draft.
- Read repository instructions, visual specification, README and Phase 6A/6B
  reports; retained existing retrieval and the sole approval-gated editor executor.
- Firebase access is active for the owner-approved project `kagaz-b4bf7`
  (ACTIVE; project number `522665274370`). The project has one active Web App,
  `1:522665274370:web:54fb91a58ee9de2b924b1b`. Google is the only enabled
  sign-in provider. Authorized domains include `localhost`,
  `kagaz-b4bf7.firebaseapp.com`, `kagaz-b4bf7.web.app`, and
  `kagaz-personal.vercel.app` from the previous Auth inspection; the current
  Firebase connector does not expose an Auth-provider/domain read operation.
- The default Firestore database is Standard Native in `asia-south1` and currently
  reports free-tier status. Firebase reports billing is not enabled. Deployed
  Firestore rules deny all client reads and writes; the local reviewed rules match.
- The last successful Vercel environment inspection found the production Firebase
  Web App values and `VITE_API_URL=https://kagaz-api.onrender.com` correctly set.
  This continuation could list the `kagaz` Vercel project, but project/environment
  reads returned 404 and deployment listing returned 403. No Vercel settings were
  changed; current production deployment state could not be refreshed.
- Render accepted a merge-only environment update for
  `FIREBASE_PROJECT_ID=kagaz-b4bf7`,
  `GOOGLE_APPLICATION_CREDENTIALS=/etc/secrets/kagaz-b4bf7-firebase-adminsdk-fbsvc-d559585578.json`,
  both assistant activation flags set to `false`, and
  `ASSISTANT_DAILY_BUDGET_USD=0`. The Secret File basename was supplied by the
  owner; its contents were never read. Deployment `dep-dbatngajnfac7393ugtg`
  is live on baseline `main` (`f252998...`) and `/health` returned HTTP 200.
  This deployment does not contain Phase 6C, so Firebase Admin authentication and
  Firestore ledger access have not been exercised through the backend.
- The owner reports the replacement Groq key is configured securely on Render
  and confirms the fixed `openai/gpt-oss-20b` model is allowed. No provider request
  was made. Groq data controls and account Free Plan status remain
  unverified. The application budget is zero and live generation is disabled.

## Current product and spending policy

The owner has changed the product requirement: **Kagaz AI Chat is Groq Free Plan
only, and the maximum acceptable provider spend is $0.** The earlier proposed
$3/day paid budget is cancelled. Do not treat it as approved or enable paid
inference. Keep `ASSISTANT_ENABLED=false`, `ASSISTANT_BUDGET_CONFIRMED=false`,
`ASSISTANT_DAILY_BUDGET_USD=0`, and `ASSISTANT_FREE_PLAN_CONFIRMED=false` until
the owner verifies the Groq organization is still on the Free Plan and separately
authorizes activation. An API key does not identify an organization tier.

The current Free Plan mode requires explicit `ASSISTANT_PROVIDER_MODE=groq-free`
and `ASSISTANT_FREE_PLAN_CONFIRMED=true`, a zero-dollar budget, and all existing
Firebase/provider checks. If Groq plan status cannot be confirmed, leave
generation disabled. Any organization plan change requires clearing the
confirmation before another deployment. Paid mode remains only as a separately
guarded future configuration path; it is not part of Kagaz's product policy.

Groq's published [Free Plan rate table](https://console.groq.com/docs/rate-limits)
lists `openai/gpt-oss-20b` at 30 requests/minute, 1,000 requests/day, 8,000
tokens/minute and 200,000 tokens/day. Kagaz applies shared Firestore caps well
below those limits: 5 requests/minute, 100 requests/day, 6,000 tokens/minute and
20,000 tokens/day, with a 6,000-token maximum reservation per request. Actual
organization limits can differ; verify them in Groq Console. Free mode never
switches models, uses a paid fallback, upgrades a subscription, or enables
payment. Provider 429 responses stop the request and show that the shared Free
Plan allowance is temporarily unavailable.

## Architecture decisions

Local editing and Ask PDF remain anonymous and browser-local. AI Chat extends the
existing assistant dialog and requires verified Firebase Google authentication.
Every answer is a separate reviewed question plus at most five selected passages
and 8,000 passage characters. No automatic chat-history replay is planned.

Firestore transactions, rather than process-local counters, reserve each attempt
and a conservative maximum token count before Groq is called. Questions, passages,
answers, PDF bytes and filenames must never enter the ledger or logs. UTC day keys
govern five per-user attempts and the shared Free Plan limits; persistent request
identities and a cross-day user lock prevent midnight replay.

The required gptTaste skill was read and applied to focus, tactile feedback and
restrained loading transitions. Its landing-page structure, random typography and
scroll animation directives conflict with this editor and `design.md`; the
repository's explicit precedence preserves Inter/JetBrains Mono, dark surfaces,
orange actions and cyan focus. Reduced motion remains respected.

## Provider investigation

Groq's [production model catalog](https://console.groq.com/docs/models) lists
`openai/gpt-oss-20b` and `openai/gpt-oss-120b`, both with 131,072-token context.
The catalog also displays paid-tier input/output prices; they are not a Kagaz
spend authorization. GPT-OSS 20B is listed in the Free Plan rate table and
supports
[strict structured JSON output](https://console.groq.com/docs/structured-outputs).
The fixed model remains `openai/gpt-oss-20b`; actual grounding quality still
requires an explicitly bounded live evaluation.

[Groq's spending limits](https://console.groq.com/docs/spend-limits) are not used
to authorize Kagaz Free Plan calls. The organization's current plan has not been
verified in Groq Console; Free Plan mode remains disabled until the owner confirms
it. Kagaz does not enable billing, upgrade a plan, or add a payment method.

| Production model      | Listed approximate output rate | Strict schema | Decision                                                |
| --------------------- | ------------------------------ | ------------- | ------------------------------------------------------- |
| `openai/gpt-oss-20b`  | 1,000 tokens/sec               | Supported     | Fixed model; included in the documented Free Plan table |
| `openai/gpt-oss-120b` | 500 tokens/sec                 | Supported     | No fallback or alternate model is configured            |

Both models have more context capacity than this feature needs. The published
[rate limits](https://console.groq.com/docs/rate-limits) are a generic reference;
the owner must verify the actual account's Free Plan and limits in Console. The browser has
no model selector. The minimal backend `fetch` integration uses Groq's documented
OpenAI-compatible completions endpoint, strict JSON schema and no tools/streaming.
This avoids another SDK and its automatic retry behavior. Each approved request
makes at most one provider call, with a 25-second deadline and 1,024 output tokens.

## Implemented functionality and important files

- `apps/web/src/features/pdf-assistant/chat/`: modular Firebase auth/session
  restoration, Google popup and explicit redirect fallback, server usage, context
  review, single-request consent, answer validation and current-page citations.
- Existing `AssistantDialog.tsx` has Edit PDF, Ask PDF and AI Chat modes. Existing
  retrieval exposes a local-only freshness revision that includes page structure,
  committed forms, blocked source keys, results and index generation.
- `packages/shared-types/src/index.ts`: narrow request, answer, usage and error
  contracts consumed by both apps. Original context-sharing types are reused.
- `apps/api/src/assistant/`: Firebase verification, strict JSON validation,
  transactional ledger, provider boundary, service and Express routes. Existing
  heavy-tool routes retain their independent multipart parser and behavior.
- `firestore.rules` denies all browser reads and writes, including authenticated
  users. Only the API's Admin SDK service account uses quota data through IAM.
- `firebase.json`, the Phase 6C verification scripts and the additional Linux CI
  job configure isolated local emulators, never a guessed production project.
- Environment examples document safe disabled defaults; dependencies are pinned
  through the workspace lockfile. Firebase CLI is a development-only emulator
  dependency; no Groq SDK is required.

## Authentication and API security

The frontend observes Firebase SDK token state; an application boolean is not
the security boundary. Every usage or answer request independently verifies a
bearer ID token with Firebase Admin `verifyIdToken(token, true)`. This checks
expiry, revocation and disabled accounts. Expected project audience/issuer,
`google.com` sign-in provider and verified Google email are required. The server
derives UID from the verified token and rejects extra client identity fields.

Routes are `GET /assistant/usage` and `POST /assistant/answer`. They are HTTPS-only
outside explicit nonproduction loopback development. Render's own environment
flag permits its TLS-terminating ingress's exact HTTPS header; generic global
Express proxy trust is not enabled. CORS restricts origins and is not treated as
authentication. Answers require uncompressed JSON, a 64 KiB body ceiling, a UUID
request ID, consent no older than five minutes (30 seconds of forward clock
tolerance), a 400-character question, one to five unique passages and 8,000 total
passage characters. Unknown fields and mismatched citation metadata are rejected.
The response has `Cache-Control: no-store`; logs contain no bearer token, prompt,
provider key or document text.

The API never receives a whole PDF through the AI route. It cannot independently
prove that client-supplied text came from an unredacted local page. The browser's
retrieval/redaction checks enforce that boundary for the Kagaz UI; backend
authentication, bounds and costs remain authoritative against arbitrary clients.
Google login limits one UID, not one human. App Check was considered as additional
abuse protection and is not implemented or claimed. Multiple-account abuse and
Firebase operational costs remain concerns separate from the $0 provider-spend
policy.

## Precise quota and Free Plan lifecycle

Every account keeps the existing five-attempt UTC-day limit, two-start rolling
minute limit, one active generation lease, and permanent request tombstone.
Free Plan mode adds application-wide Firestore caps: 5 requests/minute, 100
requests/day, 6,000 reserved/used tokens/minute and 20,000 tokens/day. Each
request is limited to a 6,000-token reservation. The provider computes a safe
upper bound from the UTF-8 request body, framing allowance and maximum output;
oversized selections fail before a provider request.

Firestore stores only these records:

| Collection           | Data                                                                                     | Purpose                                           |
| -------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `assistantUsers`     | SHA-256 UID key, active request/day/expiry, last two attempt times                       | Cross-day concurrency and rolling burst control   |
| `assistantUserDays`  | UID hash + UTC day, integer attempts                                                     | Five attempts per UID/day                         |
| `assistantBudgets`   | UTC day, reserved/spent microdollars                                                     | Existing paid-mode guard; Free Plan stays at zero |
| `assistantFreeUsage` | UTC day, request count, reserved/used tokens, recent hashed event IDs and token ceilings | Shared RPM/RPD/TPM/TPD enforcement                |
| `assistantRequests`  | UID hash + request UUID, day/state/expiry, reserved/charged amounts and token ceiling    | Permanent replay tombstone and reconciliation     |

All writes include a Firestore server timestamp. Trusted API UTC clocks derive
day keys; clients cannot supply day, counters, prices or allowance. Keep backend
instance clocks synchronized. Request tombstones intentionally have no TTL:
deleting them without a replacement replay policy could allow old identities to
be reused. There are no questions, passage bodies, filenames, answers or chats in
these documents.

1. Verify authentication, schema and per-request reviewed consent.
2. A Firestore transaction reads the user, daily allowance, global Free Plan
   counters and request tombstone. It rejects replay, an active lease, five
   consumed attempts, two starts in a rolling minute, or a shared request/token
   cap. It reserves one attempt, one shared request slot, the maximum token
   ceiling and a 120-second user lease atomically.
3. A second transaction marks dispatch. It refuses an expired reservation or one
   that crossed UTC midnight. No provider request occurs inside a transaction.
4. The service calls Groq once. Known token usage replaces the conservative token
   ceiling; missing or over-limit usage and uncertain failures consume the full
   reservation. A provider HTTP 429 is not retried, does not switch providers or
   models, and may conservatively consume the shared app allowance.
5. A request cancelled before dispatch releases its shared reservation and daily
   user attempt. Once dispatched, unknown usage keeps the maximum reserved tokens
   and the user lease until expiry. A confirmed no-billing rejection releases
   tokens while retaining the shared request-start count if it reached Groq.
6. Expired unresolved reservations remain charged at their maximum against their
   original UTC day. Late results never revive expired requests. Persistent
   cross-day UID locks and replay records prevent midnight reuse; new day counters
   start fresh.

Firestore failure before reservation or dispatch prevents provider access. Failure
after dispatch leaves the reservation conservative and returns an accurate
message that the attempt may count. Disconnect/cancellation cannot
retract shared excerpts or guarantee Groq stops remotely. The finite lease bounds
stuck local work, rather than proving provider-side computation has stopped.

The production target is **Free Plan only with `ASSISTANT_DAILY_BUDGET_USD=0`**.
Activation requires `ASSISTANT_PROVIDER_MODE=groq-free`, explicit owner-set
`ASSISTANT_FREE_PLAN_CONFIRMED=true`, and `ASSISTANT_ENABLED=true`; paid budget
confirmation must remain false. The owner has not yet confirmed the current
organization tier in Groq Console, so production generation remains disabled.
The guarded `groq-paid` path preserves the existing positive-budget/reservation
safeguards for a hypothetical future deployment, but is not authorized for this
product. Free Plan eligibility is an external account setting; clear the
confirmation before any tier change. Free-mode limits are shared across Kagaz
instances, but other applications using the same Groq organization can consume
its separate provider allowance. Firestore costs are separate from provider spend.

## Consent, grounding, privacy and design

The review displays the exact trimmed question and bounded selected excerpts,
with their stable passage IDs/current page references available as JSON. The
final approval compares that context again after token refresh. Consent never
silently applies to the next question. A new query, index generation, committed
form revision, pending redaction, page edit, sign-out or Start Over invalidates
private review/answer state. Original PDF bytes and unselected content are never
sent by this path. Cached protected text remains subject to Phase 6B exclusion.

Groq returns plain text with approved passage IDs only. Both boundaries validate
status, answer size, citation ownership and refusal/insufficient-evidence shape.
The browser resolves display page numbers from current workspace identities;
React renders generated text without HTML execution. Document instructions have
no route to tools, shell, editor commands or mutations. Phase 6A remains the sole
approval-gated assistant mutation mechanism.

The seven-page synthetic contract PDF and nine labelled grounding cases cover
summaries, licensing, comparisons, deadlines, payment, conflicts, missing evidence,
prompt injection and refused actions. Semantic tests reject deliberately wrong
answers even when citations are valid. These deterministic mock/oracle checks do
not establish live model answer quality. Valid citation IDs alone do not prove
semantic truth, and answers explicitly cover only the approved excerpts.

Kagaz persists no transcript. Firebase may persist authentication session state.
[Groq's data policy](https://console.groq.com/docs/your-data) describes temporary
reliability/abuse logging and optional zero-data-retention controls. The owner's
provider data controls have not been inspected; no claim is made that Groq never
retains approved text. Model and provider console settings require review before
public activation.

The UI follows `design.md` and uses the required gptTaste guidance for focus,
feedback and restrained motion. It uses semantic fieldsets and labels, explicit
sharing approval, live loading/error messages, disabled unavailable actions,
current account identity, server allowance and a local-time rendering of midnight
UTC reset. Redirect sign-in warns that browser-local PDFs must be reopened;
only a return-to-AI-tab marker is stored, never PDF content or a question.

## Deployment configuration and exact remaining steps

The approved Firebase project and hosting targets were inspected on 2026-10-19.
Firebase has one active Web App, Google was the only enabled sign-in provider in
the previous Auth inspection, and the production domain was authorized. Its
default Firestore database is Standard Native in `asia-south1`, reports free-tier
status, and has deny-all client rules deployed. Firebase reports Cloud Billing is
not enabled. An IAM policy read failed with HTTP 500, so the Render service
account's actual project roles remain unverified.

The last successful Vercel environment inspection found all four
`VITE_FIREBASE_*` values matching the registered Web App and preserved
`VITE_API_URL=https://kagaz-api.onrender.com`. This continuation listed the
`kagaz` project but project/environment reads returned 404 and deployment listing
returned 403. No Vercel setting was changed, and the current deployment remains
unverified. The Phase 6C UI has not been confirmed on production.

Render's existing `kagaz-api` Docker service remains in Singapore, using
`apps/api/Dockerfile` and `/health`. A merge-only environment update set
`FIREBASE_PROJECT_ID=kagaz-b4bf7`,
`GOOGLE_APPLICATION_CREDENTIALS` to the owner-supplied `/etc/secrets/` path,
both assistant flags to disabled, and the daily budget to zero. Deployment
`dep-dbatngajnfac7393ugtg` is live on baseline `main`
(`f252998ff2ffce209d28b8073b19b633bbac0e48`); `/health` returned HTTP 200 at
2026-10-19 08:59 UTC. The connected Render API does not expose environment entries.
The owner reports a replacement `GROQ_API_KEY` is configured securely in Render;
its value was never read or changed here. The current baseline deployment does
not initialize the Phase 6C Firebase Admin service.

Owner-dependent sequence:

1. In Render's secure dashboard, verify the Firebase Admin credential is configured
   as `FIREBASE_SERVICE_ACCOUNT_JSON` or supported ADC and has only the required
   Auth-verification/Firestore permissions. Do not paste the credential in chat.
   The connector cannot inspect this entry and the project IAM read returned HTTP 500.
2. The registered Web App and production Vercel Firebase values already match;
   the production API origin is correct. Confirm the owner-controlled settings
   remain in place through the next production build.
3. The owner reports a replacement `GROQ_API_KEY` is set directly in Render. In
   Groq Console, confirm the organization remains on the Free Plan,
   `openai/gpt-oss-20b` is available within that plan, and review the provider
   data controls. Do not use the compromised key, configure payment or upgrade.
   An API key does not prove the account tier.
4. Keep `ASSISTANT_ENABLED=false`,
   `ASSISTANT_PROVIDER_MODE=disabled`,
   `ASSISTANT_FREE_PLAN_CONFIRMED=false`,
   `ASSISTANT_BUDGET_CONFIRMED=false`, and
   `ASSISTANT_DAILY_BUDGET_USD=0` until the owner confirms Free Plan status and
   Firebase, credential, quota and privacy gates pass. Firestore operating cost
   is separate from provider spend.
5. Do not make a live Groq request until the owner confirms the organization is
   still Free and separately authorizes one bounded synthetic-passage test. Then
   verify citation grounding, Firestore quota counters, no PDF upload or transcript
   persistence, sign-out, and anonymous editing/search.
6. Require green exact-head/main CI and verified production deployment before
   declaring live Phase 6C complete. Keep live disabled if any gate fails.

## Validation performed

Routine verification uses Auth/Firestore emulators and deterministic Groq
responses; it never requires the supplied key or paid calls. This Windows host
has Node 22.17.1, Java 22.0.1 and a pnpm 11.25.0 global shim. Commands use the
declared pnpm 12.3.4 through `npx --yes pnpm@12.3.4` or its installed native
executable. The latter's directory must precede the global shim on PATH for Turbo.

| Command/check                                        | Actual result so far                                                                                                                                        |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile`                     | PASS after dependency installation                                                                                                                          |
| `npx --yes pnpm@12.3.4 lint`                         | PASS in all three packages                                                                                                                                  |
| `npx --yes pnpm@12.3.4 typecheck`                    | PASS in all three packages                                                                                                                                  |
| `npx --yes pnpm@12.3.4 build`                        | PASS in all three packages; existing Vite chunk/dynamic-import warnings remain                                                                              |
| Focused Free Plan/auth/ledger/service/Groq API tests | 133 passed across four files                                                                                                                                |
| Focused web AI Chat tests                            | 16 passed                                                                                                                                                   |
| Full web suite                                       | 881 passed across 85 files                                                                                                                                  |
| `node --test scripts/workspace-sample.test.mjs`      | 3 passed                                                                                                                                                    |
| Full Windows `pnpm test`                             | FAIL: existing native suites need unavailable tools; API 96 failed, 237 passed, 18 skipped at that checkpoint (351 tests, including then-10 emulator cases) |
| Firestore/Auth ledger emulator suite                 | PASS: 13 tests, including the new shared Free Plan cap across Firestore-backed instances                                                                    |
| `scripts/verify-phase6c.mjs`                         | PASS: 17 browser scenarios, zero page errors, five deterministic mock answer requests                                                                       |
| `pnpm format:check`                                  | PASS                                                                                                                                                        |
| `git diff --check`                                   | PASS                                                                                                                                                        |
| Exact-head GitHub Actions run 111 (`7ebfaf4`)        | PASS: quality, production-container, Firebase-assistant                                                                                                     |
| Exact-head GitHub Actions run 112 (`70b4196`)        | PASS: quality, production-container, Firebase-assistant on the Free Plan code head                                                                          |
| Exact-head GitHub Actions run 108 (`31696c9`)        | PASS: quality, production-container, Firebase-assistant                                                                                                     |
| Exact-head GitHub Actions run 109 (`c1222f2`)        | PASS: quality, production-container, Firebase-assistant                                                                                                     |
| Live Groq / production Google sign-in                | NOT RUN; production UI is still baseline and all provider requests remain disabled                                                                          |

The final emulator/browser runner passed twice, including after a mobile checkbox
spacing correction. It tests actual Google popup flow against the Auth emulator,
server token verification, exact reviewed versus transmitted JSON, no automatic
send on login, disabled service state, citation navigation and cancellation after
the mock provider has actually dispatched. Deferred token refresh followed by
external sign-out and same-UID reauthentication sends no stale request. In-flight
sign-out, Start Over and redaction never restore an old answer or protected text.
Network and browser-storage checks detect PDF bytes, unselected content and
transcript persistence. These are emulator/mock results, not live Groq evidence.

Exact-head Linux run **106** passed all three jobs on
`ef390b152cea07590b4021f1b9881c1d835ba68f`. Quality passed **881 web tests**,
**341 API tests**, and **3 workspace sampler tests**, along with install, lint,
typecheck, build, formatting and diff checks. The 12 emulator-only API tests are
excluded from the ordinary API test command and passed in the Firebase job; that
job also passed all **17 Phase 6C browser scenarios**. The production-container
job passed its container, resource, Phase 4/5 and Phase 6A/6B regression checks.
Run 106 is the final implementation-head CI evidence; its three job records are
available at [GitHub Actions run 106](https://github.com/AtharvaisOp/Kagaz/actions/runs/39156337701).
The later documentation checkpoint at branch head
`d9ade0187aee2d563f9247fedea758284144664b` was also verified by exact-head Linux
run **107**; quality, production-container and Firebase-assistant all passed. Its
three job records are available at [GitHub Actions run 107](https://github.com/AtharvaisOp/Kagaz/actions/runs/39203428122).
Run 108 on exact branch head `31696c9747a848c77caa7fbd0fdff3a2503b649d` later
completed successfully across all three jobs; see
[GitHub Actions run 108](https://github.com/AtharvaisOp/Kagaz/actions/runs/39207672059).
Run 109 completed successfully across quality, Firebase-assistant and
production-container on exact branch head
`c1222f2c77e30406e8668caa168196d2ed84b565`. Its job records are available at
[GitHub Actions run 109](https://github.com/AtharvaisOp/Kagaz/actions/runs/39209631388).
The corrected local `emulators:exec` runner also passed with 12 emulator tests,
17 browser scenarios and zero errors; artifacts are under
`C:\temp\KagazPhase6CPopupFix\phase6c`. Its emulators and test servers shut down
cleanly after the run.

The unchanged Phase 6A browser verifier passed 12 recorded checks and the unchanged
Phase 6B verifier passed 19 scenarios against an isolated no-Firebase Vite server.
Both reported zero page errors and document/non-GET requests; Phase 6B additionally
confirmed unchanged storage, duplicate-source redaction exclusion, committed
forms, Unicode, 300-page retrieval, citation remapping and mobile behavior.

Artifacts are outside the repository:

- `C:\temp\KagazPhase6C\phase6c\report.json`
- `C:\temp\KagazPhase6C\phase6c\ai-chat-review-360.png`
- `C:\temp\KagazPhase6C\phase6c\ai-chat-answer-1440.png`
- `C:\temp\KagazPhase6C-Regressions\phase6a-report.json`
- `C:\temp\KagazPhase6C-Regressions\phase6b\phase6b-verification.json`

## Manual visual verification

Actual Chromium 151.0.7922.34 screenshots were inspected at desktop and mobile
widths. Reviewed question, passages, privacy disclosure and orange sharing control
are legible at 360 px, with visible cyan keyboard focus. Authenticated answer and
page citation remain readable. The automated browser suite also checks 1,440,
768, 390 and 360 px for overflow, keyboard modal wrap and reduced motion. A CSS
specificity issue from inherited dialog labels was fixed so passage checkboxes
retain an intentional text gap. Existing 6A/6B browser regressions remain green.

No real PDF was sent to Groq. Synthetic PDF fixtures exercised local extraction,
explicit excerpt sharing to the local mock server, citations and redaction.

The 96 Windows native failures reproduce the documented Phase 6B baseline:
Python/native PDF inspection, Ghostscript, qpdf, OCRmyPDF/Tesseract and Linux
LibreOffice tooling are not available in this environment. Tests remain enabled;
Linux CI installs and executes their dependencies. Turbo stops after that API
failure, so the complete web suite was run separately and passed.

Build warnings are the inherited ineffective dynamic import of `nativeImage.ts`
and large frontend chunks. Firebase auth increases bundle content; the AI path
does not initialize a Firebase session for anonymous Edit PDF/Ask PDF use. No
warning is treated as evidence of a broken PDF or suppressed to fake a pass.

The final frozen install also required stopping the running Windows emulator to
release a native dependency file lock. Reinstallation then passed, followed by
fresh successful lint, typecheck, build, formatting, 881 web and 135 new API tests.
No generated dependencies or host-specific paths are committed.

The Java 22 Windows runtime initially could not create its AF_UNIX selector socket
under its default temporary path. Setting `JAVA_TOOL_OPTIONS` to
`-Djdk.net.unixdomain.tmpdir=C:\temp\kagaz-java` after creating that short directory
started the actual Firestore emulator successfully. Linux CI uses Java 21 and
does not need this host-specific setting. A repeated emulator run initially reused
fixed-day budget fixtures; the suite now clears only its guarded loopback demo
project before testing. Neither incident is represented as a passing run.

## Git and release checkpoint

- Branch: `codex/phase-6c-firebase-groq-chat`.
- Base: `f252998ff2ffce209d28b8073b19b633bbac0e48`.
- Implementation commit: `9c0f6703f1dfaf4efca570e78209e86f744d9471`
  (`feat: add Firebase-gated Groq PDF chat`), pushed to origin.
- Draft PR: [#14](https://github.com/AtharvaisOp/Kagaz/pull/14), attached to this chat.
- Initial Linux CI run 104 failed at dependency installation because the CLI's
  optional Linux `re2` build needed an explicit pnpm policy. It is now explicitly
  disabled: it is a hosting accelerator unused by these emulators. No application
  check ran in that failed job. Run 106 later passed the corrected policy and
  implementation head.
- Follow-up commits: `85c7982113dab9176a23b3f90efac61d4fd3a379`
  (`fix: declare optional Firebase CLI build policy`) and
  `ef390b152cea07590b4021f1b9881c1d835ba68f`
  (`test: wait for Firebase popup readiness`). The latter is the exact head
  verified by successful run 106.
- Verified checkpoint commit: `d9ade0187aee2d563f9247fedea758284144664b`
  (`docs: record Phase 6C CI and release blockers`), verified by successful
  exact-head run 107. This checkpoint records the current unresolved production
  access and credential-rotation gates.
- Run 109's exact tested branch head: `c1222f2c77e30406e8668caa168196d2ed84b565`
  (`docs: refresh Phase 6C production checkpoint`), verified successfully across
  all three jobs. This documentation-only checkpoint records its result; PR #14
  remains open, draft and mergeable.
- Run 110 verified exact branch head `f4ff676e19f4ae53670bf8078bfee6fbeabe27df`
  successfully across Quality, Production-container and Firebase-assistant.
  The working tree was clean before this continuation's documentation update.
- Run 111 passed Quality, Production-container and Firebase-assistant on exact
  head `7ebfaf439687edd415cd93cca8660dd3c04f0910`; see
  [GitHub Actions run 111](https://github.com/AtharvaisOp/Kagaz/actions/runs/39227167519).
  It predates the Free Plan changes; Run 112 below verifies those changes.
- Free Plan implementation commit `70b41963dc703b016b60112781d61324d0791c62`
  (`feat: enforce Groq Free Plan quotas`) passed exact-head GitHub Actions run
  **112** across Quality, Production-container and Firebase-assistant; see
  [GitHub Actions run 112](https://github.com/AtharvaisOp/Kagaz/actions/runs/39231574092).
- Merge and Phase 6C production deployment: not performed. The existing Render
  deployment is healthy but still runs baseline `main`; the Admin credential path
  is configured, while an authenticated Admin/Firestore runtime check remains.
- No credentials are tracked or put into the Vite bundle. The compromised local
  Groq key entry has been cleared; the owner reports a replacement key is set on
  Render, but its presence cannot be verified through the connected API. Both
  activation flags are false and the daily budget remains zero.

## Deviations and known limitations

- Firebase access now reaches the approved project, and Google-only provider,
  production/local authorized domains, Web App, default Firestore, and deployed
  deny-client rules are verified. Firebase reports billing disabled and Firestore
  free tier. Project IAM inspection returned HTTP 500. The owner-supplied Render
  Secret File path is configured, but the Phase 6C runtime has not consumed it yet.
- The owner directed that provider spending stay at $0. Render has
  `ASSISTANT_ENABLED=false`, `ASSISTANT_BUDGET_CONFIRMED=false`, and
  `ASSISTANT_DAILY_BUDGET_USD=0`. The earlier paid-budget proposal is cancelled.
- The owner reports the compromised Groq key was replaced directly in Render and
  confirms the fixed model is allowed. Render's connected API does not expose
  environment entries. The Secret File basename was provided by the owner and its
  path was configured; its contents were never read. No provider request was made.
- The Render deployment is still baseline `main`, so production Google
  ID-token verification and Firestore usage-ledger access are unverified. After
  Phase 6C is deployed, a signed-in Google session can exercise
  `GET /assistant/usage` without contacting Groq. Project IAM permissions, Groq
  account Free Plan status and data controls remain unverified.
- Current Vercel project listing works, but project/environment reads return 404
  and deployment listing returns 403. Previously inspected production Firebase
  settings are unchanged by this continuation; current Vercel readiness is unknown.
- Structured citations and adversarial mocks do not prove live semantic accuracy.
- Remote cancellation is best-effort. Unknown billing retains the attempt,
  reserves/charges conservatively and holds the active lease until expiry.
- Permanent idempotency tombstones grow metadata storage. A future retention
  change needs a replay-safe design; do not add a simple TTL.
- Stateless answers use only selected excerpts, not a whole-document guarantee.
  Redirect login requires reopening browser-local PDFs. Complex reading order,
  image-only PDFs and existing local retrieval limits remain unchanged.
- Public multi-account abuse and Firebase operational costs are outside the
  Groq application budget. App Check remains potential defense in depth.

## Phase acceptance checklist

- [x] Resume verified Phase 6B checkout and audit remote/working tree/open PRs.
- [x] Use requested phase branch and preserve existing architecture/retrieval.
- [x] Read visual/security/phase specifications and use gptTaste under design.md.
- [x] Modular Google-only Firebase sign-in, observed sessions, token refresh,
      account display, sign-out, popup errors and explicit mobile redirect option.
- [x] Anonymous editor and local Ask PDF remain available.
- [x] AI interface requires verified SDK auth and backend ID-token verification.
- [x] No automatic question or passage send after login.
- [x] Authenticated answer/usage routes derive UID server-side; project/provider,
      expiry/revocation, HTTPS, body/content-type and strict schemas enforced.
- [x] Backend-only Groq credential, fixed verified production model and pricing
      comparison; bounded tokens, deadline, output and no uncontrolled retries.
- [x] Provider error handling for 401, 429, 5xx, timeout, cancellation and malformed
      output, including strict schema and independent citation validation.
- [x] Real shared Firestore transaction authority before provider access.
- [x] Five attempts per UTC day, two per rolling minute and one active UID lease.
- [x] Firestore-enforced global Groq Free Plan request/token limits with
      reservation and actual-use reconciliation; paid monetary safeguards remain
      separate and guarded for any hypothetical future deployment.
- [x] Unknown token usage is charged at the reserved ceiling; only a confirmed
      pre-dispatch cancellation releases the shared request/token reservation.
- [x] Persistent replay prevention, expiry handling and midnight isolation.
- [x] Explicit exact-context review on every request; five passages/8,000 passage
      characters/400 question characters; no whole PDF, unselected text or history.
- [x] Freshness checks for pages, form state, redactions, retrieval and auth epoch.
- [x] Concise grounded answers, insufficient/refused states, valid passage
      citations and current workspace page mapping.
- [x] Known-answer PDF fixtures and semantic/adversarial mock evaluation.
- [x] Untrusted excerpts cannot invoke tools, commands or editor mutations.
- [x] No transcript/document contents in ledger, browser storage or logs.
- [x] Deny-client Firestore rules and documented server/browser redaction boundary.
- [x] Server usage display, UTC/local reset, unavailable/loading/cancel/error states.
- [x] Emulator/mock verification script and Linux CI integration without paid keys.
- [x] Final expanded emulator and automated browser suite green.
- [ ] Final formatting and exact-head authoritative Linux CI green for this Free
      Plan change (previous Phase 6C checks passed through Run 111 on `7ebfaf4`).
- [x] Groq Free Plan mode requires explicit owner confirmation and a $0
      application budget; the model remains fixed and has no paid fallback.
- [x] Approved Firebase project, Web App, Google-only provider, authorized domains,
      Firestore database, billing state and deployed deny-client rules inspected.
- [x] `GOOGLE_APPLICATION_CREDENTIALS` points to the owner-supplied Render Secret
      File path; the service is still on baseline code, so runtime use is pending.
- [ ] Render service-account identity and least-privilege project IAM verified
      (Firebase IAM read returned HTTP 500; no role changes were made).
- [x] Production Vercel Firebase configuration matches the approved Web App and
      preserves the API origin.
- [x] Render project ID is set to the approved project; assistant enable and paid
      budget flags are false and the configured dollar budget is zero.
- [ ] Owner confirms the Groq organization remains on the Free Plan in Console;
      activation remains disabled without that account-tier check.
- [x] Shared application caps are below Groq's published Free Plan limits:
      5 RPM/100 RPD/6,000 TPM/20,000 TPD with 6,000 reserved tokens/request.
- [ ] Real production Google sign-in, ID-token verification and quota controls.
- [ ] Groq Free Plan account tier and data controls confirmed by the owner.
- [ ] One synthetic-passage live request only after separate owner authorization.
- [ ] Authenticated production `GET /assistant/usage` confirms Firebase Admin
      token verification and Firestore access without a Groq request.
- [ ] Exact-final-main CI green and Vercel/Render Phase 6C deployments verified.

## Next release gate

The reviewed implementation remains on the phase branch and PR #14 stays draft.
Firebase access is active for `kagaz-b4bf7`; no further authentication retry is
needed. Render now points `GOOGLE_APPLICATION_CREDENTIALS` at the Secret File path
provided by the owner, but only the baseline service is deployed. To verify Admin
token verification and Firestore access without spend, deploy the disabled Phase
6C code and sign in with Google once so the UI can request `/assistant/usage`.
That owner-authenticated action requires no Groq call; do not paste a token or
credential into chat. Do not add IAM roles unless a concrete permission failure
is observed. The owner reports `openai/gpt-oss-20b` is allowed, but has not yet
confirmed the Groq organization remains on the Free Plan or reviewed its data
controls in Console. The live service is still on baseline `main`; the new Free
Plan environment mode has not been configured or deployed.

Keep `ASSISTANT_ENABLED=false`, `ASSISTANT_PROVIDER_MODE=disabled`,
`ASSISTANT_FREE_PLAN_CONFIRMED=false`, `ASSISTANT_BUDGET_CONFIRMED=false`, and
`ASSISTANT_DAILY_BUDGET_USD=0` until the account tier is verified and the Firebase,
quota and privacy checks pass. No live Groq request is authorized yet. No payment
method, paid plan, or Phase 6D work is included.

Keep Phase 6A's executor as the sole assistant mutation path. The chat answer type
cannot carry commands. Preserve the context-sharing contract, session epoch and
post-token-refresh review checks. Never replace Firestore authority with in-memory
counters, call Groq inside a transaction, add silent retries, delete replay
tombstones casually, upload PDFs for AI, or persist conversations without a new
explicit product/privacy decision.
