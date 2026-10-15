# Atomic tournament configuration save — candidate88

Scope: replace configuration-form parent/link multi-request writes with one actor-bound transaction using existing canonical Floor open/close RPCs. Preserve logical table/session/history IDs; no money/blind/payroll policy changes.

Worktree: D:\wt\vinpoker-tournament-save-atomic. Based on qualified PR1564; PR1563 RLS boundary remains independent. Do not merge these stacks twice blindly.

Migration88 SHA256 LF: 292731d050964b90c6b3bb878de1ca636fce0e16756d3944712d3da28d86c8f5. Source/live collision query >=88 returned empty on2026-10-15; recheck before release. New RPCs8arg save and2arg receipt require expected actor, derive auth.uid, exact club authority, stable receipt, timestamp/table CAS. SQL child rejection raises and rolls back outer transaction. Current-schema26 required for unique multitable labels.

Evidence:
- Isolated PG17 currentSchema runtime PASS: create2tables, normalized replay, payload conflict, changed actor, crossclub, metadata CAS, history identity preservation, child open/close rollback and final receipt failure rollback.
- Actual two-authorized-actor lock overlap PASS: second timestamp stale after first commits, no loser receipt, same-key replay identical.
- Helper/dialog regressions include doubleclick RED then ref-lock GREEN, unknown receipt after reload, scoped journal, late success after unmount, bounded hung requests, explicit PostgreSQL rollback vs transport unknown, receipt permission revoked after possible commit then restored.
- Independent readonly review found both error-classification issues; fixed with regressions. Reviewer did not rerun tests; final correction rereview remains desirable.
- Migration control/catalog/static promotion and workflow YAML parse PASS. Operations CI includes exact88 runtime after26.
- Full local tsc-b FAILED TS2307 missing @google/genai in shared dependency junction; package/lock already pin2.19.0. No install into shared junction. Need clean CI full typecheck/build, not waive failures.

NOT DONE: actual concurrent config vs canonical open/close, full clean dependency typecheck/build, browser375px, further blind-level draft flow, final CI, release manifest/approval, DB/hostname/flags and full tour UAT. No live apply/deploy. Daybreak/Auto unchanged.

Recovery journal uses same-tab sessionStorage by actor/club/tournament and persists before send. Unknown result only reads actor-bound receipt, no new UUID. Confirmed SQL failures may release journal; failed receipt GET never proves original mutation failed. No DB ledger/history cleanup performed.
