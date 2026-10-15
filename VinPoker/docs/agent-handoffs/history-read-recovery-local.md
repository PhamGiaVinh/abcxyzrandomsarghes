# Table history read recovery — local only,16/10/2026

Owner switched work to local source/tests until hosted CI resources recover. Do not push, deploy, apply DB, start Docker or enable flags from this handoff.

Owned worktree: D:\wt\vinpoker-history-read-recovery, branch codex/history-read-recovery-local, baseline origin/main ed3db6ac600710e95fe4408c475941916c23ab19. No writer changes borrowed. node_modules is a read-use junction to existing dependencies: never install/ci through it.

## Reproduced

TableHistoryPanel did not catch a rejected RPC promise: TypeError left initial loading forever and an unhandled rejection. Two focus events during an unresolved read started three requests. Baseline targeted test run:3 original tests PASS,2 new regressions FAIL,1 unhandled rejection. These failures prove the bug, not the fix.

## Change

Catch read exceptions, release loading in finally, retain last-good rows only for the existing table context. One in-flight read per context, focus/poll refreshes coalesce into one trailing refresh rather than canceling pagination. Existing request generation is checked after every awaited page; stale old-context completion cannot clear the new context's fence. Access revocation discards queued refresh. No DB contract, server authority, proof/revision calculation, write path, timer cadence or visual design changed.

## Verification

- Actual local Vitest:8 component tests +6 parser tests PASS, one worker. Includes reject→recover, focus burst→one trailing refresh, stale old-table rejection, revocation and stale same-table preservation; existing blind/net rendering and pagination tests retained. API mocked, not live proof.
- TypeScript transpile diagnostics for both TSX files PASS: syntax only, not project typecheck.
- git diff --check PASS.
- Full typecheck/build/browser/DB runtime NOT RUN. Machine read showed only431184KB free physical RAM of7730500KB; do not launch heavy parallel builds. No Docker/CI/push/production mutation used. No claim feature live or G6/master accepted.

Rerun affected tests only when source/dependency changes; final full typecheck/build and actual browser/RPC/DB validation remain before release. Same-context indefinitely unresolved requests still rely on the underlying transport timeout: this patch proves rejection recovery, not a new network deadline. Consider a bounded read only if reproduced or covered by the next scoped acceptance test; do not retrofit mutation timeout semantics into this public reader.

Local test command from VinPoker:

```powershell
node node_modules/vitest/vitest.mjs run src/components/cashier/tournament-live/viewer-hub/TableHistoryPanel.test.tsx src/components/cashier/tournament-live/viewer-hub/publicTableHistory.test.ts --maxWorkers 1
```
