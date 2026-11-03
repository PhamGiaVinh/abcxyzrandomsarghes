# Incremental public HUD qualification

This directory deliberately distinguishes unit contracts, native PostgreSQL
runtime evidence, and a real local Supabase transport/load run. None of these
is evidence that the current production subscription permits 1,000 sockets.

## Execution

Run the `Public HUD incremental PostgreSQL` workflow on the reviewed branch.
`real_stack=smoke` starts 10 viewers against 100 historical hands for two
30-second scenarios. `real_stack=qualification` starts 1,000 independent SDK
WebSocket connections against 1,000,000 historical hands per player for two
30-minute scenarios (one tournament, then twenty tournaments). Each viewer
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

The watched-felt workload includes both independent readers: canonical current
hand and hub viewer snapshot (`tables`, catalog-only while watching a felt).
Initial/verification/visibility requests also read snapshot ranking/payout and
the unchanged canonical clock/clock-summary RPCs. Snapshot generations and
publication time must cover every eligible source write for every viewer;
snapshot p95 has the same 3-second threshold as the current-hand view. A
60-second HUD reopen is explicitly simulated user activity, not HUD polling.
Older current-hand-only probes are diagnostic transport evidence, not full-page
qualification.
Delivery attribution retains actual observation time if a read finishes before
the writer HTTP acknowledgment, but requires exact hand/generation evidence.
Deferred generations additionally need a snapshot request after commit ack,
an advanced generation and a current projection; rounded timestamps alone are
insufficient. Coalesced reads may finish within the bounded 10-second tail,
without dropping late/missing samples from the latency/error denominator.

The pinned local runtime uses `per_request` supervision and at most 64 reusable
workers per function. The CLI-generated gateway, image, 256MB per worker,
CPU soft/hard 1000/2000ms, wall/HTTP limits, secrets and bind mounts are retained.
Only policy and pool parallelism change; no production setting changes. This
matches per-request CPU accounting, not the topology of the hosted service:
https://supabase.com/docs/guides/functions/limits and
https://github.com/supabase/edge-runtime/blob/v1.73.13/crates/base/src/worker/supervisor/strategy_per_request.rs.
The original `per_worker` probe failures are retained: cumulative worker CPU
retirement caused `WorkerAlreadyRetired`/HTTP500 under concurrent HUD reads.
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

The nine migrations `20261104001500` through `20261104002300` are promoted
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
nine exact manifest entries, each SQL and new ledger receipt atomically; stop
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
