# Payout entrypoints and public results — 2026-11-03

Branch: `codex/payout-results-online`. Critical release pending owner approval of the final SHA.

- Adds Cashier → Trả thưởng giải, scoped to assigned clubs and registration-closed tournaments; changing tournament remounts the existing payment-intent journal and checklist.
- Prepares `prizePayoutTracking=true` in source. Production is unchanged until the reviewed frontend is released.
- Adds Floor → Trả thưởng links and the existing public server snapshot; Ops uses its scoped client and never imports the legacy money/auth shell.
- Public prize tab is labelled Giải thưởng/Prizes and displays a champion only for a fresh, official single first-place result. Champion label uses all six locales.
- Bust/finalization rules and the authoritative money writers are unchanged. A bust is not a payment. Official results must exist before payment recording is available.
- No migration, Edge deployment, notification, production payment, or production result repair is included.

Evidence: 56 component/intent tests; payout-results and Ops Floor/Cashier typechecks; Ops import and money boundaries; local PostgreSQL 17 native rollback test `VinPoker/tests/cashier/payoutResultsActivation.rollback.local.sql` (stale token, correct recipient/amount, exact-key retry, receipt recovery, conflicting payload, already-paid, unrelated actor, ledger count/sum).

Browser: read-only production visit verified `/live/12ea401a-9790-4c3f-8aed-818cd1d5eddd?tab=prizes` shows TEST UAT 01, rank 1, 4,000,000. Local real-component fixture DOM shows cashier checklist/button and Floor champion/results; CDP screenshot/input timed out, so visual screenshot and browser-click QA remain unverified. Full-app typecheck exhausted the default heap; scoped checks passed. Build uses `GOMAXPROCS=2`, `UV_THREADPOOL_SIZE=1`, `node --max-old-space-size=3072 node_modules/vite/bin/vite.js build` on the 8GB host.

Release scope: frontend only to the project serving vinpoker.vercel.app; activate the existing payout flag. Read-only production smoke test, owner performs actual payment acknowledgement. Rollback by reverting this PR/frontend, preserving all ledger/receipts. Do not toggle unrelated flags.
