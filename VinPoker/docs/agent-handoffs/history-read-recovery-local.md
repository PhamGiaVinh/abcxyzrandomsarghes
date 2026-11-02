# Table history read recovery — local only,16/10/2026

Owner switched work to local source/tests until hosted CI resources recover. Do not push, deploy, apply DB, start Docker or enable flags from this handoff.

Owned worktree: D:\wt\vinpoker-history-read-recovery, branch codex/history-read-recovery-local, baseline origin/main ed3db6ac600710e95fe4408c475941916c23ab19. No writer changes borrowed. node_modules is a read-use junction to existing dependencies: never install/ci through it.

## Reproduced

TableHistoryPanel did not catch a rejected RPC promise: TypeError left initial loading forever and an unhandled rejection. Two focus events during an unresolved read started three requests. Baseline targeted test run:3 original tests PASS,2 new regressions FAIL,1 unhandled rejection. These failures prove the bug, not the fix.

## Change

Catch read exceptions, release loading in finally, retain last-good rows only for the existing table context. One in-flight read per context, focus/poll refreshes coalesce into one trailing refresh rather than canceling pagination. Existing request generation is checked after every awaited page; stale old-context completion cannot clear the new context's fence. Access revocation discards queued refresh. No DB contract, server authority, proof/revision calculation, write path, timer cadence or visual design changed.

## Verification

- Actual latest local Vitest:11 component tests +12 parser tests PASS, one worker. Includes reject→recover, focus burst→one trailing refresh, stale old-table rejection, revocation and stale same-table preservation; existing blind/net rendering and pagination tests retained. Fake-clock tests prove unresolved read timeout, discarded queued immediate retry, late response after recovery ignored and timer cleanup on unmount. API mocked, not live proof.
- TypeScript transpile diagnostics for both TSX files PASS: syntax only, not project typecheck.
- git diff --check PASS.
- Full typecheck/build/browser/DB runtime NOT RUN. Machine read showed only431184KB free physical RAM of7730500KB; do not launch heavy parallel builds. No Docker/CI/push/production mutation used. No claim feature live or G6/master accepted.

Second local pass reproduced an indefinitely pending read with fake time:8 existing component tests PASS/1 new bounded-read regression FAIL. Added a20second deadline for the complete load, shared across its pages, not20seconds per page. A deadline failure discards queued focus/poll refresh instead of immediately auto-retrying; the next explicit focus or existing poll can recover. The race prevents late application, not cancellation of the underlying HTTP transport. Scope cleanup clears the deadline timer; generation fencing remains. This is a read-only deadline, not mutation retry/receipt semantics. Final16testsPASS. Rerun affected tests only when source/dependency changes; full typecheck/build and actual browser/RPC/DB validation remain before release.

Third local pass: parser treated missing/primitive/array nextCursor as null, falsely confirming end-of-history. Read canonical migration06 history RPC: public success always returns explicit nextCursor null or tuple; revoked payload is separate. Added5 malformed cases, baseline7PASS/5FAIL, then one guard rejecting a non-null non-object cursor. Explicitnull positive retained. Component test proves malformed refresh preserves loaded hand and pagination with error rather than empty. Final23testsPASS. No SQL/RPC change or live parity claim. Public RPC currently projects pending/verified only; needs_attention distinction remains a backend/consumer contract gap to investigate, not implemented by inventing a frontend status or exposing private queue errors.

Local test command from VinPoker:

```powershell
node node_modules/vitest/vitest.mjs run src/components/cashier/tournament-live/viewer-hub/TableHistoryPanel.test.tsx src/components/cashier/tournament-live/viewer-hub/publicTableHistory.test.ts --maxWorkers 1
```
