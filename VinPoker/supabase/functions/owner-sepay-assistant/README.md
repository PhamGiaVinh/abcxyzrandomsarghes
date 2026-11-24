# Owner SePay assistant — release preparation

Owner UI: `Tài chính & Đối soát`, in both the legacy club-finance page and Ops Finance.
This is a read-only banking assistant, not an accounting, payout or reconciliation writer.

## Data and AI boundary

- Authenticate the user, verify current club ownership with the existing `is_club_owner` helper,
  and obtain the club's existing active SePay configuration. No client bank/account/token override.
- A service-only durable admission RPC reserves each request once. Global and actor/club limits
  serialize admission; duplicate request IDs are rejected, not re-executed.
- Gemini translates only the owner's question and current UTC+7 date into an allowlisted query.
  Bank rows, balances, account numbers and SePay credentials are never included in its context.
- SePay API v2 GETs read the exact configured active account. Fixed host, no redirects/writes.
  Monetary values are integer VND; totals come from validated rows, never model output.
- Pagination inconsistencies, changing totals, foreign accounts, duplicates and malformed money
  fail closed. A bounded 1,000-row read that is incomplete returns no financial totals.
- Revalidate ownership and configuration before releasing data. Responses are no-store; the UI
  clears/aborts on actor, club or session change and does not poll or automatically retry.
- API offset pagination is fetched evidence, not an atomic bank snapshot or audited settlement.
  Webhook status describes the provider's transaction marker, not VBacker ingestion/ledger proof.

Financial answer sentences are constrained to exact server-owned semantic templates. Gemini
interprets the question/date/search and chooses a phrasing; it does not author unrestricted
financial conclusions. The server fills verified figures and adds filtered-query scope labels.
This constraint prevents swapping incoming/outgoing placeholders or fabricating conclusions.

The live observation feed uses candidate migration 347, an owner-authenticated read of the latest
50 SePay rows already assigned to the club in VBacker. It polls every 10 seconds while visible,
coalesces overlapping reads, fences late actor/club/session responses and clears data on error.
Only newly seen/changed rows flash once for 1.2 seconds; reduced-motion disables the animation.
No Gemini calls occur for feed refresh. Ingestion/webhook/verification latency still applies;
unassigned transfers are not disclosed or represented as missing bank money. Verification markers
are distinct from settlement completion. This RPC/index is NOT natively qualified or deployed.

The personal SePay MCP OAuth connection in Codex is not reused by the website. The web feature
uses existing per-club Vault API credentials and official SePay API reads. No MCP token copying.

## Activation (not performed)

Critical release requires isolated native DB privilege/concurrency/retry qualification, current
production contract/config verification, required CI and exact final release approval.
The new migration is a candidate; catalog promotion has NOT been approved or performed.
Do not bypass the catalog allowlist or run a production migration push.

After those gates, the release package must bind:

- Candidate migration `20270128000346_owner_sepay_assistant_limits.sql` (verify live version free).
- Edge function `owner-sepay-assistant`, JWT verification enabled plus handler authentication.
- Dedicated `OWNER_SEPAY_GEMINI_API_KEY` from a project with billing disabled, an explicit
  available free-tier `OWNER_SEPAY_GEMINI_MODEL`, and independently checked billing status.
  `OWNER_SEPAY_GEMINI_BILLING_DISABLED_CONFIRMED=true` records an attestation; it does not
  disable Google billing. Never enable billing, add credits or reuse an unverified paid key.
- `OWNER_SEPAY_ASSISTANT_ENABLED=true` only after successful deployment/config verification.
- Frontend `VITE_OWNER_SEPAY_ASSISTANT=true` only for the reviewed release.

Missing configuration stays off; Gemini 429 is reported as exhausted free quota. No fallback,
automatic provider retry or paid service is configured. Questions themselves go to Gemini;
the UI warns not to enter private names/account details. No question/answer storage is added.

## Current verification and limits

HTTP tests use synthetic transports; they are not hosted Edge or PostgreSQL qualification.
The visual fixture at `/tests/owner-sepay-assistant/preview.html` is a local development input,
not a production build entry. It displays clearly labelled synthetic data only.

Per-instance SePay requests are spaced 350 ms. Concurrent questions or the existing reconciler
can still share a provider token and exceed its rate limit. SePay 429 is surfaced explicitly;
there is no automatic retry and no claim of shared-token concurrency capacity.

Rollback: disable the Edge and UI flags, retain source banking/payment data unchanged. Any DB
rollback is a separate reviewed operation; do not delete financial records or restore a ledger.
