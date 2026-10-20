# Checkpoint C — AI response failure diagnosis

Status: PARTIAL — the historical failure's exact cause is still unverified.
Investigation completed without a new Groq request or production change. No
runtime code was changed because the available evidence identifies no defect.

## Incident and preserved checkpoint

Main is `6413d39c7d56db2bd366cd512c4d74e047dd81ea`, containing PR #16's
privacy-safe diagnostics. The previously authorized single synthetic request
returned `provider-unavailable`; its allowance changed from five to four. That
change proves attempt accounting, not provider receipt, billing, answer generation
or a Firestore failure. The owner reports main Run 121 passed.

Read all of `docs/phase-6c.md`, including its local post-diagnostic follow-up.
The pre-existing uncommitted addition is preserved verbatim and is not staged in
any checkpoint. Phase 6C, the sole Phase 6A mutation executor, local retrieval,
authentication, consent, quotas and all provider settings remain unchanged. No
Phase 6D work was started.

## Production metadata inspected

After the owner selected Render's My Workspace, the service list identified
`kagaz-api` by its exact GitHub repository. Its current deployment is
`dep-dbbheinlk1mc73dpd130`, live on main SHA `6413d39`, finished
2026-10-20T07:26:16Z. No deploy or environment mutation was requested.

For 2026-10-19T00:00:00Z through 2026-10-20T08:35:00Z:

- The application-log query restricted to the known fixed diagnostic prefix
  `Assistant request failure.` returned zero records, hasMore=false.
- A status-code-label query restricted to `/assistant/answer` returned null.

No request payload, identity, IP address, filename, token, provider error body,
document content or native dump was retrieved or recorded. These empty queries
cannot establish that the original request was never sent; the original attempt
predates the diagnostic deployment and missing logs cannot be backfilled. No
Groq account-side status record is available to this investigation.

Production's previously confirmed disabled configuration is preserved:
`ASSISTANT_ENABLED=false`, `ASSISTANT_PROVIDER_MODE=disabled`, both Free Plan and
paid budget confirmations false, and `ASSISTANT_DAILY_BUDGET_USD=0`. Render's read
tool does not expose environment values, so this investigation did not independently
re-read them or inspect any secret. It made zero Groq API requests, no authenticated
production answer request, and no quota edits.

## Official protocol comparison — 2026-10-20

Compared the actual adapter request with Groq's official
[Chat Completions reference](https://console.groq.com/docs/api-reference) and
[OpenAI compatibility guidance](https://console.groq.com/docs/openai): the fixed
endpoint, n=1, nonstreamed messages and max_completion_tokens are documented.
The adapter does not send unsupported logprobs, logit_bias, top_logprobs or named
message fields. Temperature zero is documented as internally normalized by Groq.

The official [Structured Outputs page](https://console.groq.com/docs/structured-outputs)
lists `openai/gpt-oss-20b` with strict JSON Schema support; Kagaz's schema uses
required fields and additionalProperties=false, and sends no tools or streaming.
[Reasoning guidance](https://console.groq.com/docs/reasoning) documents low effort
and include_reasoning=false for GPT-OSS. The mutually exclusive reasoning_format
field is absent. [Service tiers](https://console.groq.com/docs/service-tiers)
documents on_demand as the default; no auto/performance/flex fallback is requested.
The [model reference](https://console.groq.com/docs/model/openai/gpt-oss-20b)
lists a maximum output above Kagaz's fixed 1,024-token ceiling. This comparison
does not prove account permission, transport health or successful generation.

No protocol incompatibility is established. Increasing token limits, changing the
model/schema, disabling validation, adding retries or changing spend policy would
be speculative. None was done.

## Mock reproductions and diagnostic interpretation

| Reproduced condition                                            | Client result                 | Privacy-safe diagnostic                                                                                              |
| --------------------------------------------------------------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Provider HTTP 400/500/503                                       | provider-unavailable          | provider-http-response / provider-http-error; numeric status, responseReceived=true.                                 |
| Fetch/network exception                                         | provider-unavailable          | provider-fetch / transport-error; no received status.                                                                |
| HTTP 401                                                        | provider-unauthorized         | provider-auth; explicitly unbilled rejection.                                                                        |
| HTTP 429                                                        | provider-rate-limited         | provider-rate-limit; no retry/fallback, conservative usage.                                                          |
| Malformed/truncated or tool-bearing output                      | provider-invalid-response     | response-read or response-validation / invalid-response. Normally a distinct client code from the reported incident. |
| Timeout/cancellation                                            | provider-timeout or cancelled | Bounded stage/category/duration, including stalled body cancellation.                                                |
| Generated answer followed by typed Firestore settlement failure | quota-unavailable             | quota-settlement / quota-error; responseReceived=true; no answer released.                                           |
| Generated answer followed by unexpected usage-read exception    | provider-unavailable          | quota-usage-read / unexpected-error; responseReceived=true.                                                          |

The last path proves that the public label is not sufficient to attribute the
historical incident to Groq. Normal Firestore transport/transaction errors are
wrapped by `AssistantLedger.transaction` into quota-unavailable, so a typed quota
failure should not automatically be blamed for the observed provider label.
The unexpected usage-read test intentionally exercises the service's generic
exception path; it is not evidence that production encountered that exception.

The provider emits only constructed fixed labels, validated status, response flag
and bounded duration. Post-provider diagnostics distinguish settlement from the
subsequent usage read. Provider bodies, user data and exception text remain
excluded. Generation occurs once after transactional admission, outside every
Firestore transaction. Unknown usage remains conservatively reserved; confirmed
usage reconciles tokens at zero dollars in Free Plan mode. A failed settlement
does not release a possibly consumed attempt or display an unconfirmed result.

## Validation, changes and limitations

- Existing Groq/service/ledger mock suites: 111 passed across three files.
- Existing auth/configuration tests in `auth.test.ts`: 24 passed.
- Total: 135 deterministic offline tests. Every provider request is mocked; none
  uses a real credential or reaches Groq. No extra test implementation was needed
  because PR #16 already reproduces the relevant paths and checks log privacy.
- Two mistyped config test paths matched no tests; they are not passing checks.
  The correct auth/config suite above was subsequently located and passed.
- Only this report is added by checkpoint C. There is no UI change requiring a
  new visual pass, no runtime release and no need to alter Phase 6C engineering.
- No live answer is verified. The exact historical HTTP status/transport outcome,
  provider receipt/token usage and account-side record remain unavailable.

## Acceptance checklist and next actions

- [x] Preserve Phase 6C and uncommitted incident notes; read the full checkpoint.
- [x] Inspect deployed diagnostics and available Render failure metadata safely.
- [x] Compare the actual protocol with official documentation.
- [x] Investigate HTTP, transport, validation and post-generation quota failures.
- [x] Reproduce suspected paths with existing mocks and log-category assertions.
- [x] Avoid speculative runtime changes and every additional Groq request.
- [x] Preserve disabled generation, zero spending, fixed GPT-OSS 20B, transactional
      quotas, exact-passage consent and no paid fallback.
- [ ] Establish the original failure's exact cause; needs an existing account-side
      status record or actionable failure metadata, not another speculative retry.
- [ ] Verify a live validated answer; requires fresh, separate owner authorization
      and is explicitly outside this checkpoint.

Review existing Groq Console status-only metadata if the owner can make it
available. Do not send a test request to obtain metadata. Before any separately
authorized future synthetic test, retain the current diagnosis instrumentation,
exact reviewed-passage consent and zero-spend policy, and keep generation disabled
until that authorization. Do not change IAM, read keys, reset quotas, enable paid
mode or claim that AI Chat works based on mocks.
