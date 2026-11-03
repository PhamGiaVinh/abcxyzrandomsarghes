import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {initialize,sql,jsonSql,sqlAsync,service} from './nativeDb.mjs';
if(process.argv.includes('--initialize'))initialize();
sql(readFileSync('tests/publicHud/spectator-generation.fixture.sql','utf8'));
sql(readFileSync('supabase/pending-migrations/20261104001900_public_spectator_compact_generations.sql','utf8'));
sql(readFileSync('supabase/pending-migrations/20261104002100_public_current_hand_bounded.sql','utf8'));
const tour='10000000-0000-4000-8000-000000000001',lease='40000000-0000-4000-8000-000000000001';
sql(`INSERT INTO public.tournaments(id) VALUES('${tour}');
  SELECT spectator_projection_v2.mark_dirty('${tour}','tables','legacy-hand-'||n,'hand-'||n) FROM generate_series(1,1000) n;`);
assert.equal(sql(`SELECT count(*) FROM spectator_projection_v2.work_groups WHERE component='tables';`),'1');
assert.equal(sql(`SELECT jsonb_array_length(dirty_ids) FROM spectator_projection_v2.work_groups WHERE component='tables';`),'1');
assert.equal(sql(`SELECT count(*) FROM spectator_projection_v2.entity_markers WHERE component='tables';`),'1');
const claim=()=>sql(`UPDATE spectator_projection_v2.work_groups SET fencing_token='${lease}',claimed_until=clock_timestamp()+interval '15 seconds' WHERE tournament_id='${tour}' AND component='tables';`);
// Use exact JSON literal, avoiding any source data interpolation in SQL.
const commit=vector=>jsonSql(`${service} SELECT to_jsonb(public.publish_public_spectator_projection_v2('${tour}','tables','component','${lease}','${JSON.stringify(vector)}','{"items":[],"removed":[]}'::jsonb));`);
assert.equal(sql(`SELECT source_revision FROM spectator_projection_v2.entity_markers WHERE component='tables';`),'1');
claim();assert.equal(commit({generation:'0'}),false);
claim();assert.equal(commit({generation:'1'}),true);
assert.equal(sql('SELECT count(*) FROM realtime.fixture_messages;'),'0');
assert.equal(sql(`SELECT count(*) FROM spectator_projection_v2.broadcast_pending_v1 WHERE tournament_id='${tour}';`),'2');
assert.equal(jsonSql(`${service} SELECT to_jsonb(public.flush_public_spectator_broadcast_v2(100));`),1);
const message=jsonSql("SELECT payload FROM realtime.fixture_messages WHERE event='changed';");
assert.deepEqual(message.components,['tables','visibility']);assert.equal(message.tournamentId,tour);
assert.equal(jsonSql(`${service} SELECT to_jsonb(public.flush_public_spectator_broadcast_v2(100));`),0);
assert.equal(sql("SELECT count(*) FROM realtime.fixture_messages WHERE event='revoked' AND topic='public:player-hud-access-v1';"),'1');
sql(`INSERT INTO spectator_projection_v2.broadcast_pending_v1(tournament_id,component,revision,source_txid)
 SELECT '${tour}','tables',n::text,(1000000000+n)::text::xid8 FROM generate_series(1,1100) n;`);
assert.equal(jsonSql(`${service} SELECT to_jsonb(public.flush_public_spectator_broadcast_v2(1));`),1);
assert.equal(sql('SELECT count(*) FROM spectator_projection_v2.broadcast_pending_v1;'),'600');
assert.equal(jsonSql(`${service} SELECT to_jsonb(public.flush_public_spectator_broadcast_v2(1));`),1);
assert.equal(sql('SELECT count(*) FROM spectator_projection_v2.broadcast_pending_v1;'),'100');
assert.equal(jsonSql(`${service} SELECT to_jsonb(public.flush_public_spectator_broadcast_v2(1));`),1);
assert.equal(sql('SELECT count(*) FROM spectator_projection_v2.broadcast_pending_v1;'),'0');
assert.ok(Number(sql('SELECT max(event_id) FROM tracker_analytics_v1.access_revocations;'))>0);
const snapshot=jsonSql(`SET ROLE anon; SELECT public.get_public_tournament_viewer_snapshot_v2('${tour}','{}',ARRAY['payout'],'{}');`);
assert.equal(snapshot.sections.payout.maskChecked,true);
// Source transactions holding different rows must not wait for each other's
// component markers. The contender appends an immediately visible invalidation.
const holder=sqlAsync(`BEGIN; SELECT spectator_projection_v2.mark_dirty('${tour}','tables','writer-a');SELECT pg_sleep(2);COMMIT;`);
let locked=false;
for(let i=0;i<20;i++){
  if(sql(`SELECT pg_try_advisory_xact_lock(hashtextextended('public-gen:${tour}',0));`)==='f'){locked=true;break;}
  await new Promise(resolve=>setTimeout(resolve,25));
}
assert.equal(locked,true);
await sqlAsync(`SET statement_timeout='500ms';SELECT spectator_projection_v2.mark_dirty('${tour}','ranking','writer-b');`);
assert.equal(sql(`SELECT count(*) FROM spectator_projection_v2.deferred_generations_v1 WHERE tournament_id='${tour}';`),'1');
const deferred=jsonSql(`SET ROLE anon; SELECT public.get_public_tournament_viewer_snapshot_v2('${tour}','{}',ARRAY['ranking'],'{}');`);
assert.equal(deferred.sections.ranking.freshness.state,'updating');
await holder;
assert.equal(jsonSql(`${service} SELECT to_jsonb(public.absorb_public_spectator_generations_v2(100));`),1);
assert.equal(jsonSql(`${service} SELECT to_jsonb(public.absorb_public_spectator_generations_v2(100));`),0);
sql(`UPDATE public.tournaments SET deleted_at=now() WHERE id='${tour}';`);
assert.equal(jsonSql(`SET ROLE anon; SELECT public.get_public_tournament_viewer_snapshot_v2('${tour}','{}',ARRAY['tables'],'{}');`).access,'revoked');
// Clock/outbox-only dispatch must wake without any projection work remaining.
sql(`DELETE FROM spectator_projection_v2.work_groups;
 CREATE SCHEMA vault;CREATE TABLE vault.decrypted_secrets(name text,decrypted_secret text);
 INSERT INTO vault.decrypted_secrets VALUES('PUBLIC_SPECTATOR_WORKER_SECRET','disposable-test-only');
 CREATE SCHEMA net;CREATE FUNCTION net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds integer) RETURNS bigint LANGUAGE sql AS $$ SELECT 1::bigint $$;`);
assert.equal(jsonSql(`${service} SET app.supabase_url='http://127.0.0.1:1'; SELECT to_jsonb(public.dispatch_public_spectator_projection_v2());`),1);
sql(`DELETE FROM public.tournaments WHERE id='${tour}';`);
assert.equal(sql(`SELECT count(*) FROM spectator_projection_v2.entity_markers WHERE tournament_id='${tour}' AND entity_key<>'generation';`),'0');
assert.throws(()=>sql('SET ROLE anon; SELECT public.flush_public_spectator_broadcast_v2(100);'),/permission denied/);
console.log(JSON.stringify({kind:'NATIVE_POSTGRESQL_GENERATION_OUTBOX_NOT_WEBSOCKET',passed:true,checks:['bounded-generation','bounded-dirty-ids','fencing','durable-coalescing','component-broadcast','global-hud-revocation','flush-idempotency','payout-mask-preserved','nonblocking-concurrent-source-writes','deferred-freshness','deferred-absorption','clock-only-dispatch','hard-delete','visibility','worker-grants']}));
