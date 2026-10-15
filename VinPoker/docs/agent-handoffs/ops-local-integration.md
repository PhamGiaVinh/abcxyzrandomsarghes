# Operations local integration —16/10/2026, NOT RELEASED

Owner currently requests local code/tests/commits only, no push/CI dispatch/deploy/Docker. This local integration does not authorize any production migration, grant, Edge or flag change. Daybreak/Auto unchanged. Master G0–G9 acceptance remains the full actual tour, not this tree.

Worktree D:\wt\vinpoker-ops-local-integration, branch codex/ops-local-integration, baseline origin/main ed3db6ac600710e95fe4408c475941916c23ab19. Separate from original owned branches; merge commits preserve their lineage. No changes to other writers or main. No node_modules install or Docker launched here.

## Integrated source inputs

| Package | Exact source | What is actually included |
|---|---|---|
| History local | bb40c5e87ee7fd15a6ee2e4839d9e58f7ad80898 | reject/deadline/coalescing/scope/cursor fixes and local tests |
| Swing config local | f32aad194e1b0a69c50afeafb6ffa0b85848e77e | scoped config reads and unverified operational UI guard; expanded UI test still memory-blocked |
| Owner-authorized release |4fc8a18b89c5c7c9d9543bd5349bd2d363ce4765 | shared deploy workflow replaces native reviewer capability with owner dispatch on main; no blanket historical apply change |
| Payroll82/83 |f3d844cb306ee9166c981692071fc1c5053dd012 | includes ancestor27914f893b2e90b930dd916935ba0e6522e1e7f5; read authority and return type, not wage calculation |
| Profiles84 |b3bb4c0d64ac025a27790bce252c8b8c6d6ae7eb | public-profile compatibility UI plus grant migration; UI compatibility must ship before reducing grants |
| Cashier85 |07207fd130c5184b06eb03090a8b43e6643a1591 | actor-bound club helper |
| Tenant86 |1fa4bb6cb2855501d64f73b63a6b6b312c137874 | tournament-table tenant write guard; not atomic create91 |
| Cashier lookup |4acb51459025ca64deb0291aa961239570ce5efe | UI/Edge scope/error fix plus explicit deployment contract/selection |
| Dealer next/close80/81 |1f6c04e6a3d68212ee79ba91d7bb8a0422cdcc03 | manual next intent/forecast UI+RPC;78/79 source already baseline,79/81 release remains atomic |
| Dealer persist87/canonical read |56c30902f8de5384e1460e13857a4f7adea4bafb | exact-session DB commit fence, scoped canonical inventory and planner; not3 real rotations/40Edge |
| Tournament config88 |da0587e7d042b91325e9f62733a7cd252d4df5bd | atomic save with receipt, preserve canonical read and87 planner changes |
| Clock readiness89 |c0bc03c98d71b8e6da7d7a5c51de7870fda13722 | clock start/readiness plus qualified isolated apply tooling; no live apply |
| Public clock90 |c4f3e3a0b7d31e512427b644d85ad5fc28c1f27f | public projection prerequisite, not settlement worker proof |
| Public clock consumer |3ed5f7a9bbabad45715bae0bde659a33166099f6 | truthful read states |
| Felt RPC receiver |8439633a2ca4df203bb2b873f31353c98cdb3c51 | receiver-bound Supabase RPC invocation |
| Tracker lineage |ab797730f997fdec3fa22479b0d4f1dabe659284 | read integrity and canonical unknown-result recovery |
| Atomic create91 |e5e3cc9fa871e818dec99fc20a8693fee794a923 | parent+levels transaction and original request recovery |
| Gallery reorder92 |d2c6b83c861d002b87d448df7e0a35031f44dafa | atomic gallery permutation, receipt and scoped unknown response recovery |

## Conflict resolution and verification

Catalog conflicts combined distinct82/83/84/85/86 entries with original hashes unchanged. Current-schema workflow conflict combined both payroll82/83 and tournament86 triggers. No historical SQL edited. Shared production workflow auto-merged Cashier selection with the owner-only guard; verify no hunk lost before release.

Actual integration checks: migration catalog PASS; migration control PASS10reservations; diff --check PASS. git diff --exit-code against each original branch confirms exact82–86 SQL files unchanged. Integrated policy/deployment-plan Node run25736 terminalSUCCESS:56PASS/1SKIP,~80seconds; actual assertions include Cashier explicit critical selection/ACL and owner-only release plus retained receipt/source contracts. Private supplied recovery fixture remainsSKIP, notPASS. No active test process left and no reason to rerun unchangedbytes. These checks do NOT prove production DB parity or runtime compatibility of the whole stack. Plan suite creates small disposable git fixtures, not production changes. C drive free only~59MB at read; avoid new caches/downloads/backups there.

Original evidence remains scoped: History23mock/parser testsPASS; Swing finalhook16PASS, expandedUI7cases hitheapOOM; ownerpolicy32PASS/1SKIP beforeintegration; originalsecurity PG runtime belongs to prior qualified source, not a fresh integrated DB test. No full typecheck/build/browser/DB runtime run in this integration under current RAM/Docker limits. Do not report SOURCE_QUALIFIED or ACCEPTED for the integrated candidate.

## Still outside this tree / next order

Dealer integration phase2 completed locally through merge1816da6ebbf3a8123e468502a0aed19c24b16ded. Resolved catalog addition conflicts by preserving80/81/87 plus82–86; Ops CI test list conflict kept both baseline UI tests and canonical/session tests. Source check confirms configsLoading/configsError/Retry config refetch survived merges. Exact SQL80/81/87 unchanged versus source branches. Catalog/control/diff checks PASS. Actual25Node protected-transport/atomic-plan tests PASS (not PostgreSQL execution); actual13Vitest next-intent/table-session tests PASS. Original56policy/plan tests above belong to phase1, not a fresh qualification of this larger candidate. No build/type/DB/browser/live rotation proof. Existing apply workflows still require native reviewer; owner approved removal, but scoped followup remains before private release.

- Dealer78–81/87 now present, but isolated DB interleavings and actual3rest15 rotations/40Edge not rerun on integrated stack. Preserve rest15 and exact-session fences; do not infer backend safety from config UI guard.
Phase3 now integrated through mergec4a0e39ff7bbe8e12128e24f7e6d2f9d8924ad7c. All8inputs above merged locally, resolving additive catalog/CI tests/triggers and preserving88before89 runtime preparation. E2E fixture keeps both create and schedule surfaces; schedule retains required AuthProvider. E2E spec keeps two separate complete width loops. Six locales combine createAtomic and admin.scheduleReorder/scheduleUpload without duplicate top-level admin keys; legacy disclosure retained. Both89/92 Floor contract triggers/actionlint/transport test steps retained. Workflow YAML parse and E2E syntax-only transpile PASS, not typecheck/browser. Catalog/control PASS, exactSQL88–92 unchanged. Actual38Node transport/plan tests PASS and43Vitest tests across6lightweight config/create/readiness/lineage/outcome files PASS. No current process left.

- These source packages are now present, but full typecheck/build/browser/DB runtime and complete dependency audit still pending. Current owner waiver of native reviewer must be scoped into relevant apply workflows; existing tests still assert that old requirement, so theirPASS does not mean private release unblocked. No indiscriminate removal of other controls.
- History worker/Voice/TV actual runtime/provider/anonymous multflight and legacy-data evidence remain missing; no synthetic verified outcome, copied current-seat identity, broad backfill or fabricated blind levels.
- Remaining F1–F9 only close with required evidence. GTO/upload/disclosure merged baseline is not new live proof. Public history needs_attention is not provided by its current public projection; investigate actual intended authorized consumer before designing a contract change.
- When memory allows, run final Swing UI once; full typecheck/build and actual integrated runtime before release. Do not rerun known identical tests just for counters. Continue light source integration/audit meanwhile.

After quotas/resources and owner release scope are ready, run required checks on ONE final candidate, then compatibility-ordered DB/Edge/frontend/flags and actual web/RPC/DB tour. Do not push this accumulated tree unreviewed or merge into main automatically. No claim that a local merge equals completion.
