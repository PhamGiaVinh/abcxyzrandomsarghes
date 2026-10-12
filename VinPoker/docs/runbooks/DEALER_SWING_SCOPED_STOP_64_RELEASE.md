# Scoped Dealer Swing OFF — migration64

Target: `orlesggcjamwuknxwcpk`; web: `https://vinpoker.vercel.app/dealer-swing`.
Canary only Quads / vbacker. Daybreak stays OFF; legacy CenterPoint Auto stays OFF.

## Exact scope

Migration: `20270128000064_dealer_swing_scoped_stop_v1.sql`.
Normalized SQL SHA256: `043a0ab740c5ec489b049ee1b95f41257eca5c4b5194e417242340c486ffec17`.
New endpoint: `public.operator_stop_dealer_swing_v1(uuid,uuid,uuid)`.
Only authenticated actor with exact scoped Dealer Control, club ownership or trusted
Super Admin can explicitly set `auto_swing_enabled=false`. No generic settings grant,
ON operation, settings initialization, dealer release, session close, notification or
rest/payroll policy change. Manual assignment policy remains unchanged.

## Release prerequisites — not replaced by owner approval

- Exact source SHA and required CI verified, including current-schema runtime.
- Read-only critical review and local attack/overlap suites pass.
- Fresh restore-verified private recovery point and source provenance qualified under
  CONTROLLED_DB_APPLY. A schema-only artifact is **not** a data recovery backup.
- Existing baseline artifact expiry resolved without changing its semantic hash or
  bypassing the protected human environment. No agent self-approval.
- Existing migration ledger version/name/hash collision guard passes.
- `dealer-stop-64-release-plan.mjs` preflight observes exact reviewed dependencies,
  no same-name RPC overload, no existing receipt namespace or migration64 record.

## Apply order and verification

1. Use reviewed protected transport and existing owner/recovery/connection checks.
   The release-plan module intentionally contains no credentials or live transport.
2. Apply only its pinned `atomicSql()` package: new function/ACL and exact migration
   ledger receipt commit in one transaction. Preserve historical migrations13–28.
3. Verify exact ledger receipt and `postcheckSql()` function body/owner/ACL/search
   path/timeout/dependency checks. Version equality alone is insufficient.
4. On unknown commit outcome, inspect the exact receipt once. Stop; do not automatically
   replay, repair migration history or proceed to frontend on an unverified outcome.
5. Deploy the reviewed frontend through existing CI and protected release workflow.
   No Edge change or feature flag change is needed for this package.
6. Confirm exact artifact SHA serves the hostname, then authenticated Quads UI test:
   OFF -> Dừng -> confirmed OFF; repeated click cannot turn ON or assign dealer.
   A TEST-only ON -> OFF case requires the canary's independently qualified quiet and
   isolated operational state; do not enable legacy CenterPoint to test this.
7. Verify settings flag, immutable Stop receipt and unchanged sessions/assignments;
   test lost response/same key, account/club switch and error shown inline.

Receipt and fresh current state have different meanings. Old receipt OFF/current ON
must warn and require another explicit click with a new request key. Retain the last
settled journal ID so a sibling widget's older reply cannot overwrite newer state.

## Rollback

Restore the previous verified frontend artifact first. If needed, revoke the new RPC
using a reviewed forward migration. Keep the settings OFF and retain receipts/audit.
Never enable Auto or delete historical receipts as rollback; never grant owner or
broaden club_settings RLS to make the old upsert pass.

## Evidence boundaries

Minimal fixtures prove lock/receipt primitives. The exact sanitized full-schema local
PG17 suite proves real helper/table/RLS compatibility for the retained baseline, not
fresh production state, scheduler execution, protected CI or actual browser UAT.
Every layer remains separate: source, tests, migration live, frontend and Quads UAT.
