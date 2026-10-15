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
