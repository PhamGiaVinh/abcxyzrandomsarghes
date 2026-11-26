# Legacy Cashier — current club scope and history export authority

Mode: CRITICAL, authorization/read/export lifecycle. Base `23617d3ead5651c823b14db26226b54077da44be`. Separate from K01 PR1687, invitation-list PR1819 and Ops provider PR1820. Those candidates remain frozen at their own verified versions; no automatic merge/deploy is authorized here.

## Required behavior

The legacy `/cashier` page must stop displaying a revoked club and its child workspace while keeping other valid club access usable. Ownership changes must withdraw owner-only rollout controls even if cashier membership IDs stay unchanged. A cached global Admin flag is not current authority. An unknown membership/admin/metadata read must close the old workspace and offer retry, never report a successful empty assignment.

Two exports inside Staking — History and Refund History — contain private club/player/event/financial data. Each must read only the verified club set, discard late data after actor/session/club change, and recheck current server authority immediately before synchronous file delivery. Cached A+B data must never export A after A is revoked; valid B rows remain exportable. Empty IDs are not a global-read shortcut.

## Source changes

- `useCashierClubScope` reads caller-bound `cashier_club_ids` plus the existing strict `get_my_ops_global_capability` contract, then resolves club names/ownership within those exact IDs. It publishes one atomic snapshot, polls quietly every five seconds, bounds observations, aborts/discards disposed reads and retains unchanged state. Newly known membership/admin changes invalidate the old workspace before metadata finishes. The global capability RPC is an explicit existing-backend release dependency and must be checked on the actual target before production.
- The root uses fresh authority instead of cached Auth role/owner lookups. An actor/session/admin/club/owner boundary change disposes the old main content. Unchanged authority keeps the existing workspace mounted. Pending durable money intents remain owned by their existing journal implementation; no journal-clearing or money writer change is introduced.
- `useCashierStakingHistory` serves the two real history consumers. It fences main/profile reads and cached rows by actor/session/club/revision, rejects foreign-club rows, and exposes explicit read errors. Export is single-flight, captures a snapshot, rereads authority and intersects each row with both the original read scope and the latest server club IDs. It checks current context once more immediately before the existing synchronous Excel writer. If only B remains, it exports B and explains that the permission set changed. Unknown/no valid authority does not download a file.

## Evidence and remaining verification

Private evidence directory: `D:/Quy-trinh-hud-scale-evidence/cashier-live-scope-20261127/`.

- Original parent RED: four failures, fourteen passes. An additional early-membership/slow-metadata case reproduced a candidate gap before correction.
- Original History/Refund History code, with only named exports exposed for the test seam: sixteen failures; candidate restored in finally. No business behavior was changed in the baseline reproduction.
- Current focused provider/history/staking outcome suite: one hundred passes. These tests use mocked API/Auth boundaries; the history tests spy on the actual Excel delivery seam rather than creating real files.
- Independent source review passed. Full typecheck/build, actual Auth/API/DB/browser club withdrawal, ownership withdrawal, file contents and real network cancellation still need their own evidence. Do not call this a production or full E07 result from component tests alone.

## Scope and release

No DB migration, RLS, privileged RPC, Edge writer, money calculation, feature flag or ownership constraint changes. Existing `cashier_club_ids` includes all clubs for a current super-admin, so explicit club filtering retains its scoped records without interpreting empty IDs as global. The separate Ops provider candidate does not repair this root page by itself.

Exports/Realtime and cached state inside other children still require their own applicable checks. A parent remount is not a substitute for server permission checks or a proof of all subscription delivery behavior. Full E05/E07 workload and hosted production qualification remain open.

Keep a Draft PR until source/runtime checks and controlled critical-release approval identify the exact SHA and smoke scope. Confirm target RPC contracts and project connection access first. Frontend rollback restores the previous cache/export behavior and must not replay financial actions or undo durable receipts. Keep all failed/passing TEST fixtures and journals for diagnosis. No production apply/deploy/flag action is part of this patch.
