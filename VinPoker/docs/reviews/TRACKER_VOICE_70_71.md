# Voice delegated card and Finish authority package

Status: SOURCE_PREPARED / LOCAL_RUNTIME_QUALIFIED. Not production-applied or UAT complete.
Baseline: origin/main `9d0b1e9abef4306cb889e7b8f92bfe080466c098`.

## Reproduced seams

- Floor-only + Telegram-only Dealer: Voice gate/register succeeds; board/hole core rejects `actor_not_allowed`.
- Old board proposal accepted after assignment change or epoch change followed by fresh config re-enable.
- Owner + Telegram-only Dealer: Finish core rejects `voice_dealer_assignment_required`. Reproduced on untouched baseline as well as70.

70 shares canonical card validation between unchanged public invoker/manual policy and server-delegated Voice policy. Direct authenticated delegation is denied before hand reads. No Tracker grants or private-schema USAGE grants. Existing public ABI/defaults/ACL remain unchanged. Board root assignment is rechecked; server state hash includes session/epoch/active assignment.

71 changes only record_hand's service-Voice authority to exact assignment context and modern hand/session lineage. Manual authority and all card/entry/seat/chip/conservation logic remain intact. Apply order70 then71;71-before70 fails closed.

## Exact source

| Migration | SHA256 |
|---|---|
|70|`5a25a790d88f06969a13ad3a801998869b260f8fb69e71cbb08691e922c9aea2`|
|71|`1a747f345d56b6ff4b5c13186dd5e98f9db384e918659808b638e39be6203993`|

Both source files received scoped independent read-only review. Catalog manifest records these exact hashes; guard code unchanged. No historical migration13–28 edits.

## Actual local proof

- Fresh PostgreSQL17 clones:70/71 apply definition and authority metadata postchecks; wrong order rejected.
- Existing cardBatchIntegrity.currentSchema.mjs: Floor/Owner board/hole receipts, retry/conflict, redaction, root/receipt fault rollback, direct delegation/RLS zero-write.
- Existing action/register slice: Floor action, retry, cross-actor, payload/provider replay conflict.
- Canonical start -> Owner board/hole -> authenticated Floor takeover -> Floor Finish: completion/one receipt/retry/fault rollback.
- Real two-connection assignment lifecycle/Voice overlap in both orders. Actual blocker PID observed; stale proposal zero-write or valid prior-assignment receipt followed by one active new assignment.
- Existing harness additionally runs epoch increment with fresh config re-enabled and Floor membership revocation after root registration; both reject old proposal with no cards/child receipt and rollback on the exact70/71 clone.
- Compensation71 then70 rehearsed on separate clone; original normalized bodies/metadata restored, helpers removed. No data rewind.
- Protected release runner reuses existing actor/target/SHA/recovery gates and human environment. Seven unit safety tests pass. Actual PostgreSQL17 receipt-failure rollback, wrong-order denial,70 commit,71-body-failure rollback preserving70,71 commit and replay denial pass on an owned empty clone. Synthetic ledger69 source is fixture-only protocol qualification, not proof issuance69 was applied to that clone. Two initial fault-injection adapter errors were corrected before this PASS; no production writes.

Older retained clone missed deployed identity28 dependencies. Canonical-start RED from that stale trigger is not a production bug. Local qualification copies only exact current start/blind definitions into an empty owned clone, pins digests and checks enabled trigger; existing historical source is not edited or replayed live. Hand.table_id is logical/FK-bound to tournament_tables, not the physical table.

## Reproduction and CI

Use only owned localhost PostgreSQL17 and the exact DB names guarded by the existing harness. Set PGHOST/PGPORT/PGUSER/PGDATABASE explicitly. On Windows, set VINPOKER_TEST_WSL_DISTRO to the owned test distro; this transport does not loosen server/DB guards.

Existing Operations current-schema workflow now clones its exact recovered card56 baseline, applies70/71 and current identity dependencies, runs these source suites/actual overlap, and rehearses compensation. Initial committed package CI is running; lifecycle negative additions require CI on their new head. Integrated baseline download returned HTTP502 on its first attempt and passed on the same-source retry; no artifact/digest check was bypassed.

## Remaining release and campaign proof

- CI on exact committed source and independent final diff review; more tenant/session/stale negatives.
- Canonical operator_perform_swing/Edge overlap and browser canary, not only assignment SQL lifecycle overlap.
- Fresh verified recovery point, exact live preflight/grants/dependency ledger and protected apply receipts/postchecks.
- Actual browser Voice/provider receipt, session/reconnect and broader tournament journey. No local PASS is live/UAT proof.
- Direct Dealer manual hole call fails RLS on both baseline and candidate; tracked separately, never silenced with a role grant or a fake full Dealer suite PASS.

Rollback sources must be promoted into NEW reviewed compensating catalog versions,71 then70; restore callers before disabling helpers. They are not directly authorized production migration files.

The protected package commits TWO separate transactions, not one all-or-nothing package. If71 fails after70 committed, report70 live/71 absent or unknown explicitly. Fresh package preflight deliberately refuses replay. Inspect exact receipts/objects first, then use reviewed new compensation or a separately reviewed exact71 resume; never redispatch the entire package or mark70/71 complete from the70 receipt alone.

Daybreak OFF; CenterPoint legacy Auto OFF; no rest/payroll/OT/payout/rounding, role membership, notification or operational data changes in this package.
