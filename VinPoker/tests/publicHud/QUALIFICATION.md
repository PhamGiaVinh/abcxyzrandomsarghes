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
Do not upload CLI status, Edge serve logs or local environment files: they
contain the disposable credentials. The workflow uploads sanitized evidence.

The real source fixture writes six separate transactions per hand at one step
per second per active tournament. The actual cron-dispatched workers process
them. Restarting the local Realtime container forces all viewer sockets to
reconnect. Anonymous summary/history requests use actual HTTP Edge functions;
table reads use PostgREST. The test creates no browser windows.

## Evidence and limits

- `seed.json`: machine/PG version, disk footprint and source writer p95 before
  and after migrations, using 200 separate PostgreSQL transactions after warmup.
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

These are pending migrations `20261104001500` through `20261104002100`.
Prepare one exact SHA/migration hash package after checks and independent
review. Applying them, deploying the three Edge functions, provisioning the
dedicated worker secret, scheduling dispatch and enabling reads require the
owner's exact critical-release approval under AGENTS.md/SHIP_AND_TEST.md.

Activation order: install observers with reads/worker off; provision workers;
enable processing; run bounded checkpointed historical backfill concurrently
with live job capture; shadow-check counters/winnings against both classifiers;
certify complete coverage; then enable prepared reads and deploy the matching
frontend. Never enable prepared reads on an uncertified backfill.

Algorithm v1 is immutable. A future classifier version requires a separate
private schema/worker and independent shadow coverage before cutover, retaining
the prior version. Do not overwrite v1 counters with a new algorithm.

Rollback disables the new read/worker switches and cron schedules first,
restores the reviewed previous spectator worker/frontend revision and captured
spectator function definitions as a controlled migration. Keep the bounded
public HUD compatibility adapter; never restore its lifetime raw-scan endpoint.
Retain all source and audit
rows and derived evidence for diagnosis. A disabled/unprepared read is explicit
unavailable/warming; it must never silently scan lifetime raw history.
