# Incremental public HUD qualification

This directory deliberately distinguishes unit contracts, native PostgreSQL
runtime evidence, and a real local Supabase transport/load run. None of these
is evidence that the current production subscription permits 1,000 sockets.

## Execution

Run the `Public HUD incremental PostgreSQL` workflow on the reviewed branch.
`real_stack=smoke` starts 10 viewers against 100 historical hands for two
30-second felt scenarios plus a 30-second grid scenario. `real_stack=qualification` starts 1,000 independent SDK
WebSocket connections against 1,000,000 historical hands per player for two
30-minute watched-felt scenarios (one tournament, then twenty tournaments), plus
a supplementary 30-second overview-grid regression at the same viewer count
across twenty tournaments. The short grid regression is not a 30-minute grid
capacity claim. Each viewer
subscribes to its tournament and the content-free HUD revocation channel.
Initial admission is capped at 50 new viewers/second, with all initial requests
still included in HTTP/error results. Only after all target viewers have joined
does the full 30-minute hold start. The mass reconnect remains simultaneous;
this ramp does not reduce concurrent viewers, duration, source rate or grading.

The isolated runner starts PostgreSQL, pg_cron, pg_net, PostgREST, Kong, Auth,
Realtime and actual Edge entrypoints. It generates disposable local secrets;
no repository/production credentials are passed. Only that disposable local
Realtime tenant is configured for 2,000 connections. Production is untouched.
The self-hosted Realtime image re-seeds that tenant on boot, so the harness
configures the running tenant after each start/reconnect through its actual
`Realtime.Api` context and checks the returned limit before admitting load.
Do not upload CLI status, Edge serve logs or local environment files: they
contain the disposable credentials. The workflow uploads sanitized evidence.

The real source fixture writes six separate transactions per hand at one step
per second per active tournament. The actual cron-dispatched workers process
them. Restarting the local Realtime container forces all viewer sockets to
reconnect. Anonymous summary/history requests use actual HTTP Edge functions;
table reads use PostgREST. The test creates no browser windows.

The watched-felt workload loads canonical current hand on table changes. The
hidden hub catalog is read initially, on periodic/access verification and when
the viewer returns to the overview, rather than on every hidden hand update.
While watching a felt, the small header table count can therefore lag until
the next healthy verification (27–33 seconds); the visible felt remains live.
Initial/verification/visibility requests also read snapshot ranking/payout and
the unchanged canonical clock/clock-summary RPCs. Every eligible source write
must reach every visible felt; the separate overview scenario requests actual
visible table details and checks every source write against snapshot generation
and publication time for every grid viewer. Both visible paths retain p95 <=3s,
zero missed/pending deliveries, and minimum samples per viewer. A
60-second HUD reopen is explicitly simulated user activity, not HUD polling.
Earlier always-reloading-hidden-catalog failures remain retained. The reduced
hidden work is implemented/tested in the product, not only in the load driver.
Delivery attribution retains actual observation time if a read finishes before
the writer HTTP acknowledgment, but requires exact hand/generation evidence.
Deferred generations additionally need a snapshot request after commit ack,
an advanced generation and a current projection; rounded timestamps alone are
insufficient. Coalesced reads may finish within the bounded 10-second tail,
without dropping late/missing samples from the latency/error denominator.

The local runtime records an explicit official supervision policy (`per_worker`
or `per_request`, default `per_worker`) and pool per function. The bounded diagnostic settings are 8, 16 or 64 (default 16);
pin one setting before running both full qualification scenarios. Earlier
64-worker failures are retained. This tunes isolated two-core resource use,
not application workload or hosted quotas. The exact CLI-generated gateway, 256MB per worker,
CPU soft/hard 1000/2000ms, wall/HTTP limits, secrets and bind mounts are retained.
The runtime image is pinned to stable `v1.77.9` at OCI index digest
`sha256:6b850a2ccf0bf50ecac9accff8098095cd191c389c2a53c59b857aa0f53a8343`.
It includes the upstream worker-pool notification fix:
https://github.com/supabase/edge-runtime/pull/763. The CLI stays on 2.101.0;
before/after image IDs are recorded, while gateway code, environment, mounts
and configured resource/time caps are verified unchanged (apart from the
explicit policy/pool options). Earlier v1.73.13 failures remain retained.
No production setting changes. Neither isolated policy proves the topology or
capacity of the hosted service:
https://supabase.com/docs/guides/functions/limits and
https://github.com/supabase/edge-runtime/blob/v1.73.13/crates/base/src/worker/supervisor/strategy_per_request.rs.
The original `per_worker` probe failures are retained: cumulative worker CPU
retirement caused `WorkerAlreadyRetired`/HTTP500 under concurrent HUD reads.
In `per_worker`, pool size bounds worker count, not concurrent HTTP requests;
the same numeric CPU caps are cumulative per worker rather than per request.
The v1.77.9 `per_request` 1,000-viewer probe 41741167295 also failed during
global withdrawal/revalidation, despite all initial HUD reads succeeding. Its
request backlog remained while PostgreSQL was largely idle. The policy comparison
tests worker reuse/retirement and cancellation handling with unchanged caps;
it does not relax timeout, latency, recovery or error acceptance gates.
The first v1.77.9 `per_worker` probe 41742090760 also failed under the global
revalidation burst. The UI and matching harness now spread permission/reconnect
HUD rechecks over 250–10,250ms, while clearing revoked data synchronously.
Initial user opens remain immediate; table delivery and every acceptance gate
are unchanged. This bounded access recheck delay is distinct from the 5-second
server projection freshness target and adds no HUD polling.
Probe 41743073089 restored all 1,000 HUDs after withdrawal, but the simultaneous
reconnect still failed (904 final verified HUDs, API p95 2.62s, table p95 6.09s).
The shared tournament coordinator now verifies table access immediately on
reconnect and spreads clock/ranking/payout verification over 250–10,250ms.
Actual component-change broadcasts remain immediate; initial reads, background
pause, healthy/offline polling and all latency/error/recovery gates remain.
The real harness performs the same extra current-hand read when deferred
metadata invokes the existing full-page reader. It does not omit that work.
An explicit revoked current-hand response now clears an already displayed live
or replay hand, including when the withdrawal broadcast was missed. It is not
treated as a transient transport failure. The replay-loading regression covers
that previously loaded-frame path; malformed/failed transport retains its
existing separate recovery behavior.
Independent review additionally checks mixed responses: a successful table
denial wins over an unrelated failed summary. Reconnect advances local component
epochs, aborts owned pre-disconnect reads, and includes epochs in in-flight share
keys. Both current-hand and hub tests hold an old public response until after a
fresh revoked response, then prove the old response cannot restore the frame.
The HTTP harness likewise cancels/fences its old table/snapshot reads on rejoin;
intentional cancellation is accounted separately and never credited as delivery.
The public HUD response includes a duration-only `Server-Timing` header. The
load report compares in-handler duration with proxy/HTTP timings, including
error responses. One anonymous direct-summary observer per process runs every
5 seconds to distinguish PostgREST/database delay from Edge queueing. It uses
the same prepared RPC and is diagnostic instrumentation, not per-viewer HUD
polling or an alternate path used for acceptance.
Repeated same-HUD permission events now clear/invalidate immediately but share
one active read and at most one queued recheck. An invalidated active response
cannot commit; it drains before the queued fresh read. Scope closure/change
still physically aborts its request. A focused regression holds the old result
through repeated revocations and proves exactly one fresh recheck replaces it.
The load driver mirrors this serialization; stale results are not credited,
and HTTP timeouts/errors still fail the existing acceptance gates.
`runtime-policy.json` records the image and before/after gateway hashes. These
are explicit isolated fixture settings, never evidence of a hosted quota.

The HUD displays the prepared total of verified public prize results. Cashier's
confirmed-payment component remains on the player profile with its existing
payment/publication rules; HUD opening does not invoke that lifetime financial
reader. New HUD windows read summary and history in parallel. Reconnect checks
summary access only and preserves the frozen object if the access scope did not
change. Known invalidation clears it before waiting for replacement history.
After an explicit revocation, summary permission/readiness is checked first;
warming or withdrawn scopes do not start a replacement-history request.
The load driver mirrors the component's per-window supersession/abort and
coalesced access verification. Only intentional caller aborts are classified
as cancellation; the independent timeout remains an error. Reports retain
launched/completed/cancelled requests, phase, request bytes and successful
response bytes. Cancellation never counts as recovery: every viewer must
complete its final current HUD epoch and verify its reconnected access channel,
with all pending requests/timers drained. The Edge RPC adapter propagates the
request-local signal while keeping its independent five-second timeout and
fixed anonymous credentials. One caller cannot cancel another.
The current driver sends these distinct HTTP POSTs through native Node HTTP
keepalive to reduce generator CPU/stream overhead on the shared test machine.
Its explicit pool allows 6,000 sockets and 1,000 idle sockets; actual active,
idle and queued counts are recorded. Both transports in the local diagnostic
comparison request identity encoding and parse the complete JSON body. Native
HTTP uses identity encoding in the load too. Its independent launch-to-parse
10-second deadline includes socket queueing and body receipt; truncated bodies
fail. `generator-transport.json` compares the two generators on a fixed local
echo workload and is not application-capacity evidence. Prior fetch-based
failures remain retained; application read/latency/recovery targets are intact.

## Evidence and limits

- `seed.json`: machine/PG version, disk footprint and source writer p95 before
  and after migrations, using 200 separate committed PostgreSQL transactions
  after warmup. Synthetic benchmark hands are removed and their derived jobs
  processed before certifying the large read fixture.
  This is a fixture writer, not the authenticated Floor HTTP write path.
- `native-read.json`: summary read timings and PostgreSQL access counters/query
  plans at the configured historical volume. SQL timing is not HTTP timing.
- `http-ws.json`: HTTP p95, healthy Broadcast-to-table-read p95, server hand
  projection completion latency and reconnect counts, separately per scenario.
- `container-resources.jsonl`: final container resource sample, not peak memory.
- `resource-samples.jsonl`, `pg-pressure.jsonl`, `edge-runtime.jsonl`: periodic
  container, database wait/lock and runtime worker counters. Five-second samples
  do not guarantee capturing a short resource peak. Diagnostic header timings
  exclude response-body parsing; acceptance HTTP timings include it.

The large seed is explicitly a **prebuilt derived read fixture**. Counters come
from the actual classifiers, but historical rows are populated in bulk. It
does not measure a million-job backfill or prove backfill throughput. Native
runtime tests separately execute real checkpointed backfill, edits, retries,
leases, concurrent jobs, settlement re-verification and visibility withdrawal.
Do not label a smoke run or this bulk seed a completed scale acceptance.

No Redis, paid Supabase project or plan change is required. Qualification uses
the existing GitHub runner and typically needs roughly 75–100 runner minutes,
including setup and two 30-minute scenarios. Account included-minute balance
and overage charges must be read from billing; unavailable billing information
must not be reported as a verified zero cost. Production Realtime capacity is
a separate quota/configuration gate.

## Release gate

The ten migrations `20261104001500` through `20261104002400` are promoted
to the active source catalog; this does not apply them to production.
Prepare one exact SHA/migration hash package after checks and independent
review. Applying them, deploying the three Edge functions, provisioning the
dedicated worker secret, scheduling dispatch and enabling reads require the
owner's exact critical-release approval under AGENTS.md/SHIP_AND_TEST.md.

Before apply, verify a fresh restorable private recovery point and snapshot start
time, catalog guard, exact live ledger and captured function/trigger hashes.
Record the existing `public-spectator-v2-dispatch` schedule/command/active state,
then pause it and allow its in-flight requests to finish **before migration 019**.
The HUD switches do not pause the existing spectator pipeline. Apply only the
ten exact manifest entries, each SQL and new ledger receipt atomically; stop
on any partial or unconfirmed apply, with no automatic resume. The reviewed
`scripts/ops/tracker-hud-20261104-release.mjs` is disabled without exact package
confirmation, clean approved SHA, private recovery receipt and paused cron.
Do not use a normal db push if its dry-run includes unrelated migrations.

Migration 022 wraps two exact existing public SQL reader expressions in
PL/pgSQL so PostgreSQL can reuse plans per backend. It does not cache results:
scope, visibility, void/session gates and source values are evaluated on every
call. Native tests compare public JSON and owner/ACL/OID before and after,
warm plans before withdrawal/edit/void/session changes, and verify exact
definition recovery. Native timing is not HTTP or 1,000-viewer acceptance.
The private captured definitions are inaccessible to browser/service roles.
`tests/publicHud/read-plans.forward-rollback.sql` is a recovery template for a
new reviewed/versioned controlled migration if needed; default HUD rollback
can retain the transparent plan wrappers.

Migration 023 applies the same guarded plan-only reuse to the measured private
participation helper used by the public clock summary. Its exact canonical
definition and display dependency are pinned; its private ACL stays unchanged.
The scale fixture includes all four exact production clock/participation/display
reader definitions instead of the older pre-display participation body. Native
tests compare participation JSON for display changes, waiting, busted, bagged
and finished entries; the actual anonymous/authenticated clock caller observes
new stack/count values, the other tour and withdrawal after warming both plans.
The public clock-summary CTE materializes that STABLE participation value once
per tournament within the request snapshot, instead of repeating it for each
selected counter. It keeps its SQL language, result shape, OID, owner and ACL.
The recovery template restores all four captured reader definitions.

Install observers with reads/worker off; deploy the matching spectator and HUD
workers before resuming the spectator cron. Verify the exact production
`app.supabase_url` and Vault/Edge `PUBLIC_HUD_WORKER_SECRET` match; provision the
new `public-hud-projection-v1-dispatch` job at `1 second`. Enable HUD processing
and verify an actual dispatch request ID and bounded queued-job completion.
Run checkpointed backfill concurrently with live job capture; shadow-check
counters/winnings against both classifiers; certify complete coverage before
enabling prepared reads and deploying the matching public API/frontend.
Never enable prepared reads on an uncertified backfill. The API can report
explicit preparation during activation; never use lifetime scans as fallback.

Algorithm v1 is immutable. A future classifier version requires a separate
private schema/worker and independent shadow coverage before cutover, retaining
the prior version. Do not overwrite v1 counters with a new algorithm.

The default controlled rollback uses the two scripts
`scripts/ops/tracker-hud-20261104-rollback-read.sql` and `...-rollback-stop.sql`.
Phase 1 atomically disables prepared reads, invalidates backfill certification
and queues committed global revocation. Flush/observe that event while the
matching spectator pipeline still works. Phase 2 stops only the HUD worker/cron
and explicitly disables its four source observer triggers and withdrawal hook;
private source/contribution/audit evidence is retained. Keep the matched compact
spectator RPC/worker/frontend pipeline running and the bounded HUD adapter in
explicit warming state. Never restore lifetime scans or certify the old
checkpoint after observers have been disabled. Reactivation needs reviewed full
reconciliation of source and prior contribution IDs, including deleted sources.

If the spectator generation change itself needs reversal, prepare a separate
controlled rollback migration restoring all captured spectator functions,
current-hand function AND tournament trigger, pause its dispatcher and deploy
the matching old worker, invalidate/rebuild publications, and resolve deferred
generations before resuming. Do not mix generations or treat that larger
reversal as implicit in the default HUD-disable rollback.

Migration024 keeps every source visibility/membership/completion/void/hard-block check before LIMIT51, but correlates those gates to the ordered contribution index. This avoids a full-tour semi-join and sort before pagination. The checked proof/seed CTE is materialized once. Exact first/next/null-cursor JSON, source exclusions, invalid prefixes, all-invalid history and reader ACL/OID are compared with018 on native PostgreSQL. Dense valid history uses page-sized source reads; an invalid prefix can still require more candidate checks. No bounded-cost claim is made for arbitrarily many invalid contributions. The default read-disable rollback also disables this reader; retaining the transparent024 query optimization does not require source changes.

The measured committed writer baseline/candidate samples are retained in every HTTP report. A write-overhead result above10% no longer prevents collecting the transport scenarios, but the unchanged final <=10% assertion still fails qualification and the job. This moves that gate to final grading; it does not turn a failed overhead result into a pass. Earlier fail-fast runs remain retained.

The synthetic six-step source writer now uses a private, transactional intent receipt per logical step. A retry after an unknown HTTP result returns the original committed hand/event timestamp/generation and cannot append a duplicate action or open an orphan hand. Every transport error still counts as a qualification failure. Native PostgreSQL tests execute concurrent duplicate opens, committed response replay, completion retry, conflicting scope, rolled-back failed intents and receipt/execute denials. The writer advances its logical step after a known committed acknowledgement independently of delivery checks. A future-dated delivery observation remains uncredited and increments a mandatory failing counter; it does not stall and replay the source operation. Earlier non-idempotent fixture failures remain retained and are not reclassified as passes.

Isolated stack database image is pinned to official ghcr.io/supabase/postgres:17.6.1.155@sha256:3866d94d8426927e8db3f1c5d790752292bfbe27b5f1f46e199ae1b7d3c1710b via CLI's .temp/postgres-version input. Default17.6.1.106 crashed with SIGSEGV on denied EXECUTE in runs41825823456/41826618886/41825833665 before viewer load. This matches https://github.com/supabase/supautils/issues/214 (maintainer: fixed image17.6.1.155+). ACL/runtime denial tests remain unchanged; no hint hook, RLS or permissions disabled. Database version/supautils and exact container image are recorded. No production DB image/version change. These failed runs do not qualify capacity.

Watched-felt generator now bundles/imports the production PublicSnapshotCoordinator with the same1000ms minimum start interval as TournamentLiveView. Earlier harness coalesced only overlapping HTTP and could send dirty/published/verify reads inside one second; retained earlier results represent that unthrottled request model. Every observed source-write expectation,1000viewer/full1800s requirements,>=90%source cadence, zero-error/missed/pending gates and <=3s measured delivery remain unchanged. Actual refresh promises are tracked; final drain also requires each coordinator pending flag and active read to be clear before stop/grading. The report records source/minIntervalMs/pendingAtGrading. This models real request coalescing; it is not a capacity PASS or permission/freshness bypass.

HUD summary display now loads independently of tour history: a successful summary freezes/displays immediately; first history starts afterward with its own scoped controller. Ordinary history failures preserve statistics and offer manual retry; definitive history access denial clears statistics. Reconnect summary checks preserve both frozen counters and their history identity unless access changed. The HTTP/WS generator follows this product flow, tracks independent history promises, and still requires every viewer's current history snapshot and zero history errors/pending work at acceptance/restoration. No history failure is reclassified as success; summary p95 remains HTTP summary latency, not a substituted local/display metric.

Controlled connection-pool diagnostic: workflow rest_pool defaults10 and allows20 only in the disposable local Docker stack. CLI2.101 uses PostgREST14.10 without a pool env override (documented default10). The helper checks the disposable database marker and captured container identity/network, parses actual --dump-config, and for20 recreates only that container with one PGRST_DB_POOL environment delta. Image ID, all other environment values, entrypoint/cmd and HostConfig must remain identical; sanitized pool/image evidence is uploaded. No database max_connections, timeout, worker CPU/memory/wall limit, grants/RLS, source rate, viewer count or grading threshold changes. A20 result is conditional isolated configuration evidence, not proof of hosted pool settings or approval to change production. Source: https://docs.postgrest.org/en/v14/references/configuration.html#db-pool .

SQL load profiling installs only the existing pg_stat_statements extension/view interface inside the disposable marked database, without resetting statistics or changing tracking/plan/timeout settings. It records a baseline and five-second cumulative counters for a fixed RPC-name allowlist: calls, total execution/planning milliseconds, returned rows and shared blocks. SQL text, parameters, user identities and secrets are never selected into evidence; private profile view grants are revoked. Baseline/end differences distinguish in-database work from HTTP/Edge/pool wait; sequential native timings alone do not prove concurrent performance. Observation cost remains inside the unchanged acceptance test.
