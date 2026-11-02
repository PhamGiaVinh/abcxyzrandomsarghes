# Swing config read integrity — local WIP verification,16/10/2026

Owner mode: local source/tests/commits only. No push, CI dispatch, Docker, production changes or Auto activation. Owned worktree D:\wt\vinpoker-swing-config-read-local, branch codex/swing-config-read-local, baseline origin/main ed3db6ac600710e95fe4408c475941916c23ab19. Shared read-use node_modules junction: never install/ci into it.

## Defects and scope

useSwingConfigs ignored errors and used data??[]; an old club request could overwrite a newer club snapshot. DealerSwingTab did not include config loading/error in its operational read guard, so fallback timing and controls could be displayed without verified configuration. This affects client read integrity, not a proven backend assignment bypass.

Reused existing useRealtimeQuery actor/club/lifetime/generation and last-good/error handling. Zero realtime table list now explicitly means one-shot read: initial/manual refetch only, no new channel or poll. Existing realtime readers retain existing subscriptions/fallback behavior. UI blocks operational rendering while config loads or errors, keeps emergency OFF, and includes config refetch in Retry. No backend/SQL/policy/rest15/wage/rounding changes. No new visual design/translation strings.

## Evidence and limits

Baseline:17 pre-existing tests PASS,3 new regressions FAIL: ignored config error, late old-club overwrite, operational config controls still rendered on config failure. Candidate initial combined run20PASS (14 hook +6 UI); product hook/UI bytes have not changed since that pass. Subsequent additions strengthen actor/logout/on-demand/no-poll and UI loading/retry tests.

Final hook file alone16PASS, including all pre-existing scoped realtime reader cases and4 config cases. Final combined run exited1 without a full report, not PASS. Final UI file alone then failed with FATAL ERROR: Committing semi space failed / JavaScript heap out of memory. Stop rerunning under the same resource condition. The two added UI assertions (Retry and loading gate) have NOT been successfully executed on final test bytes. Earlier6UI cases cover the unchanged product implementation, not completion of the expanded suite.

Four changed TS/TSX files transpile diagnostic check PASS, syntax ONLY, not full typecheck. git diff --check PASS. Full typecheck/build/browser/DB runtime NOT RUN. Keep package local and verification-partial; do not mark SOURCE_QUALIFIED/ACCEPTED or release until final UI7tests and required integration/type/build checks pass.

Read failures are caught by existing helper; never-settling config reads still have no newly introduced deadline. Other legacy readers (metrics/special dates/break policy) were observed but not changed in this patch; audit their callers separately before expanding scope. Actual3rotations/40Edge and production integration remain pending.

Next, when memory is actually available, run UI file alone once:

```powershell
node node_modules/vitest/vitest.mjs run src/components/cashier/DealerSwingTab.readState.test.tsx --maxWorkers 1 --reporter verbose
```

Do not kill foreign session processes or start Docker to force this through. Preserve both local history commits in their separate owned worktree; this branch intentionally does not include them.
