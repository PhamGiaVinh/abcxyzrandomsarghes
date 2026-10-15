# Public clock read failure states

Actual anonymous canary/clock page observed stuck “Đang đồng bộ đồng hồ...” while live catalog lacked both get_public_tournament_clock_summary and get_public_tournament_results. Console capture had no error; absence of RPCs and unbounded/reject-uncaught component are separate evidence, not proof of exact network timing.

Candidate adds10s bounded observations, catch/unavailable with manual retry, per-effect inFlight gate, stop polling after failures and skip hidden/offline polls. Tournament-keyed component and matching responseID prevent stale or wrong-scope clock display. Results failure explicitly unavailable, not confirmed empty. No fallback to private data, grants or backend writes.

Five component tests PASS locally: reject/retry, hung read bounded/no repeated failure polling, late old-tour response, mismatched response ID, payout unavailable. Existing Operations workflow includes tests/full typecheck/build. Clean dependency CI and browser375px/error/retry still required.

This does NOT supply missing public RPCs. G6 public contract must be reviewed from historical source and promoted as new forward migration if approved; never replay archive or open private tables to anonymous. No production deployment. Other dirty clock-read-scope worktree1501 preserved.
