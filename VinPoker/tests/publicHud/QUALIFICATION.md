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

The seven migrations `20261104001500` through `20261104002100` are promoted
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
seven exact manifest entries, each SQL and new ledger receipt atomically; stop
on any partial or unconfirmed apply, with no automatic resume. The reviewed
`scripts/ops/tracker-hud-20261104-release.mjs` is disabled without exact package
confirmation, clean approved SHA, private recovery receipt and paused cron.
Do not use a normal db push if its dry-run includes unrelated migrations.

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
