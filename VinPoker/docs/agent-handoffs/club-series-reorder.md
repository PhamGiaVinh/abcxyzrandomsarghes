# Club series gallery reorder — forward candidate92

Status: WIP/Draft candidate, NOT LIVE. No production DB/Edge/frontend/flag change.

## Defect and boundary

MediaClubSchedules previously committed one position UPDATE per image via Promise.all, ignored returned errors and optimistically kept the new UI order. Actual component baseline: positive1 PASS, rejected write and partial swap2 FAIL. Actual owned PG17 baseline: separate authenticated transactions with second request fault leave both positions0; diagnostic PASS means reproduced, not repaired.

Candidate uses one server transaction with exact owner/super-admin authority, expected actor, full membership/position snapshot CAS and request/payload receipt. One UPDATE plus receipt is atomic. Receipt getter is read-only and actor/club/payload-bound. A short table lock serializes gallery writes including insert/delete phantoms; this intentionally serializes admin gallery writes across clubs, not operational tables. lock_timeout3s; verify real contention/performance before acceptance.

Authenticated direct position UPDATE is revoked (table and column privilege), while existing non-position column UPDATE remains behind unchanged RLS. UI must use the new RPC after DB92, not legacy fallback. Public gallery SELECT and Storage objects are unchanged. Owner approval must cover both DB grant change and consumer rollout. Stale browser tabs may receive a permission error until refreshed.

## Client

One RPC, synchronous click guard, no optimistic positions. Persist actor-keyed session journal before dispatch. Transport unknown reads exact receipt once, never replays writer. Pending request survives remount and only exposes receipt-check action; upload/delete/reorder blocked while unresolved. Account generation fences late response even across A→B→A. Success must match actor/club/request/order. Known PostgreSQL rejection clears intent; unknown retains it. No new dependency.

## Evidence and limits

-17 Vitest tests PASS:6 boundary,6 component,5 existing upload.
- Actual local Chromium375/1280 PASS with real SDK/AuthProvider and mocked loopback backend: writer returns503 after simulated commit, exact receipt read recovers once, same payload/key/actor, canonical gallery order readback, cleared journal, no unexpected writes/page errors/horizontal overflow. Profile mapping mock checks exact existing actor/payload. This is not production or real DB browser proof. Test rerun after stricter mock assertions also2PASS.
- Owned transactional PG17 PASS: update fault and receipt fault rollback, owner/super-admin positive, cross-club/outsider negative, receipt replay/readback/payload conflict, stale snapshot denial, direct legacy position denial, caption compatibility, anon/service execute denial.
- Actual two-connection blocking PASS: same key one receipt; different-key stale snapshot; concurrent INSERT membership fence. Not exhaustive delete/ownership/lock-timeout permutations or production proof.
- Local source at this handoff has final catalog hash and CI wiring; exact final CI/typecheck/build/browser/review still pending. No deployment implied.

## Tests and targets

From VinPoker: `node node_modules/vitest/vitest.mjs run src/lib/seriesReorder.test.ts src/components/admin/MediaClubSchedules.reorder.test.tsx src/components/admin/MediaClubSchedules.uploadOutcome.test.tsx`.

PG scripts under tests/clubSchedules guard loopback127.0.0.1:55441/PG17/postgres and exact owned databases. `vinpoker_ops_series_reorder` already has committed baseline diagnostic fixtures and candidate92, transactional regression can repeat because ROLLBACK. `vinpoker_ops_series_reorder_overlap` has committed concurrency fixtures: do NOT rerun as fresh. CI creates fresh clones before baseline diagnostic→apply92→transaction tests→new overlap clone. Never run these scripts on production.

Migration LF SHA256: `fdd9624de2d86252dff8472ba66a40fc55648f85cf297028633d0a3068100f54`. CLI-generated file was renamed into forward92 after bounded catalog/local-ref/live checks; promotion/catalog checks must stay green and final live collision check remains required. No historical migration edits/replay.

## Remaining

Complete final exact-SHA typecheck/build and CI/runtime markers; local fulltsc failed only2 existing missing@google/genai diagnostics. Independent critical review atdec92 found no concrete scoped finding, inspected not rerun; later deltas are responsive fixture/tests/CI paths/docs only, product/SQL unchanged. Prepare exact release manifest/runner, fresh restore-proven recovery and owner scope. GitHub artifact quota/private environment reviewer capability currently prevent campaign release; no bypass. Immutable schedule publication provenance/version/approval remains a separate F8 gap; this fix does not fabricate it or close all G0–G9.
