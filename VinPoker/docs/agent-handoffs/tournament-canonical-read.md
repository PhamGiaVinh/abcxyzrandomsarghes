# Canonical tournament table read repair (in progress)

Baseline: origin/main 1ec657802ec66ca53b4764f503d677f7144dcc8b.
One writer in this worktree. No production changes, commit or PR yet.

## Reproduction and change

Actual TournamentConfigPage render with Floor-created canonical-only table failed
at table_id.slice because legacy table_id is NULL. Legacy-only render passed.
Both tournament readers now project logical ID, legacy and canonical physical ID,
session and status, with separate explicitly disambiguated FK joins. They do not
overwrite the legacy ID or substitute physical ID for session.
Card labels use the matching physical relation and logical row key; contradictory
aliases or wrong joined identity render the existing translated repair state.
DTO now acknowledges nullable legacy table_id; canonical fields remain optional
for old fixtures/consumers pending full migration.

Initial query + render regression suite: 7 PASS. Two additional missing-identity
and foreign-join cases were added afterward and require final rerun.
Full application typecheck session81223 terminated with TS2307: installed shared
dependencies lack @google/genai (two existing Voice imports). No typecheck PASS.
Do not install into the shared node_modules junction. Use clean CI dependencies.
The later focused run passed16 tests, including both reproduced Swing cases.
Additional adversarial matcher cases require final rerun after their additions.
Final matcher tests5/5PASS (including no-match/ambiguous mapping preserving server
due time); targeted ESLint PASS. Existing Ops CI now explicitly includes this
package's four suites and path triggers, retaining full tsc/build and all prior
tests. No required checks, artifact handling or environment gate removed.

Fresh live resolver metadata confirms backend priority2 still uses legacy
table_id and tournament.status='active', LIMIT1 without session/status fencing.
Exact body MD5 remains672141dd29dfb133ee4b5012f5049956, duration helper
25b32a52b0365e65ae244011d8b97a3e. Its hardcoded fallback30/25/28 is not a
license to change business defaults: both backend canonical resolution and UI
nominal-duration consistency require a separately tested repair in this campaign.

## Not repaired / release dependencies

SQL-scope proof candidate added to existing dealer_rotation_plan_diff.sql: snapshot
full JSONB of one real predicted table2 row, run empty partial plan scoped to
table3, compare full table2 fingerprint unchanged. Actual existing SQL function
migration executes on dedicated CI PG17 minimal schema; bootstrap pins exact DB,
postgres actor, loopback, PG17 and empty schema before DDL. No production schema
or historical migration modified. CI prints tested pg_get_functiondef MD5 for
comparison to live cf817a62dfa1c91e109ae3a70dc8c1fe; equality not yet proven.
Readonly reviewer approved narrow test logic; this is NOT current-schema triggers,
RLS, HTTP or concurrency proof. Local C drive measured0free; WSL swap creation
reported insufficient disk. No backup/data deletion or retry/build duplication;
use existing isolated CI database service. SQL test has not run yet.

Latest candidate supersedes batch-abort design: invalid mappings return explicit
rejectedTables, main records table-scoped errors and filters assignments AND
schedules before writes, excludes rejected current/preassigned attendance from
supply, scopes upsert p_table_ids to valid tables, and announces valid assignments
only. Genuine query errors/non-array responses abort the tick before writes.
Emergency invalid mapping returns before cancel/clear. Final actualsource8PASS,
Deno check --frozen PASS, targeted ESLint/diffPASS. Reviewer caught and then
confirmed closure of persist superseding quarantined schedules at source level.
No new scoped P0/P1 seen; no deployment qualification. Required remaining proof:
actual DB predicted-B fingerprint unchanged, real PostgREST relationship/RLS,
session-change versus canonical commit, exact newhead CI. No default/rest/Auto
policy or migrations13–28 changed. Older batch-abort notes below are history.

Backend candidate (uncommitted, NOT deploy-qualified): fetchTournamentInfo now
uses explicit club + assignment sessions, verifies active exact table_sessions
and canonical tournament linkage, allows verified cash/vip no tournament, and
throws coded errors on unavailable/ambiguous/invalid mappings. Both assignment
projections and callsites updated. Actual-source desired-behavior4testsPASS,
targeted ESLint/diffPASS. Reviewer asked to challenge batch abort vs quarantine
and partial side effects before any commit/release; real PostgREST/RLS, Deno
typecheck and whole-pass integration remain required. Earlier3diagnosticPASS
described baseline defects, not this candidate's final behavior.
Readonly review found P1 validation placement after mutations. Moved mapping
validation immediately after main read snapshot and before reconcile/OT/rest;
emergency path now validates active assignment before cancel slots/clear fields.
Actual main-entrypoint transport test added for invalid mapping -> coded error
and zero reconciliation/OT/RPC calls. Final session86279: all5testsPASS.
Emergency entrypoint transport coverage now PASS: invalid/missing mappings or
session/tournament dependency errors -> coded detail and zero cancel/clear RPCs.
Final actualsource suite6/6PASS, ESLintPASS. Deno check --frozen actualPassR module
PASS (initial --no-remote failed only because pinned2.106.2 was not cached; not
a source diagnostic). No lockfile change. Readonly placement followup requested.
Current-schema query execution, full pass overlap/atomicity and per-table
quarantine/starvation handling remain open; do not deploy batch-abort candidate.

Actual PassR reader diagnostic `tests/dealerSwing/passRTournamentRead.repro.test.ts`
executes its extracted, TypeScript-transpiled source with a predicate-respecting
transport fixture. Three diagnostic tests PASS means BUGS STILL EXIST: canonical
row missed, closed old link overwrites current by row order, query error silently
becomes empty map. Initial URL fixture failed before executing any test; corrected
explicit project-root file resolution and reran3PASS. Not a runtime PostgreSQL,
real Edge invocation or repaired-behavior acceptance test. Backend repair must
replace these diagnostics with desired-behavior assertions, preserve exact club,
assignment session, and distinguish mapping absence from dependency failure.

- Config create/update still execute unsafe independent writes (see PR1563
  investigation). Editing canonical links must not silently drop/recreate them.
- Assigned-table counts/picker/edit selection and backend Swing readers still use legacy
  identity. Migrate using exact active session and reject ambiguous links before
  calling the overall feature complete. This card change is not that repair.
- Both UI timeline/card config readers now share an exact-session matcher. It
  rejects closed/contradictory/cross-club/duplicate mappings and retains legacy
  metadata only without session inference. No timing default or due-time changed.
- Live get_effective_swing_config fallback30/25/28 differs from frontend45/5/2
  and another UI path30; trace actual priority/writers before changing policy.
- PassR fetchTournamentInfo uses legacy table_id without status/session; needs
  critical review and runtime tests before changing rotation metadata.
- No migration13–28 modification, flag/Auto change, write-path change or release.
- Full typecheck/build, final focused tests, independent critical review and
  current-contract/browser verification remain required.
