# Clock start readiness89

F2 narrow forward fix: floor_start_tournament_clock could start with current_level1 and zero level rows. Default NULL pointer was already rejected. No current affected unstarted production rows found by read-only count2026-10-15; this is preventative hardening, not a live-write incident reproduction.

Candidate89 CLI-created then reserved after source/live>=89 collision check. Requires exact prosrcMD55f07aa9dbbc79303ff539643e5193934 (live/local verified). Preserves signature, ACL, existing authority/status/audit and blind policy; locks matching same-tour selected level FOR SHARE before clock update. No fabricated blind, rewritten clock/audit, historical migration edit or production apply.

Local owned PG17 only127.0.0.1:55441/vinpoker_ops_checkin:
- Baseline RED orphan_level_started; candidate GREEN.
- Null/empty denial, outsider denial, valid first-level start, one audit and repeat denial PASS.
- Actual observer-confirmed overlap delete→start rejects missing level, start→delete blocks until clock commit (delete rolled back) PASS.
- Direct DELETE is fault injection, not browser blind-editor authority proof. Later deletion after clock commit remains separate policy and is not claimed impossible.
- Source migration control/catalog/static promotion PASS. Runtime wired into existing Operations workflow.

Still required: readonly review, exact CI, release plan/recovery/postcheck/critical approval and production smoke. This does not make the separate TournamentManagerShared parent+blind creation atomic or decide a new draft policy. Keep F2 open until that workflow is explicitly resolved.
