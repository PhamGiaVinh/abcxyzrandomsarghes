import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {sql,jsonSql,sqlAsync,pgbench,service} from './nativeDb.mjs';
const tour='10000000-0000-4000-8000-000000000001',table='50000000-0000-4000-8000-000000000001',other='10000000-0000-4000-8000-000000000002';
const lease='40000000-0000-4000-8000-000000000001';
const signatures=['public.get_public_tournament_table_live_or_last_hand_v2(uuid,uuid)','public.publish_public_spectator_projection_v2(uuid,text,text,uuid,jsonb,jsonb)'];
const list=signatures.map(s=>`'${s}'::regprocedure`).join(',');
const metadata=()=>jsonSql(`SELECT jsonb_agg(to_jsonb(p)-'prosrc' ORDER BY p.oid) FROM pg_proc p WHERE p.oid IN (${list});`);
const publicRead=`public.get_public_tournament_table_live_or_last_hand_v2('${tour}','${table}')`;
const canonical=`spectator_projection_v2.current_table_source_v1('${tour}','${table}')`;
const hashes=()=>jsonSql(`SELECT jsonb_object_agg(oid::regprocedure::text,md5(replace(pg_get_functiondef(oid),chr(13),''))) FROM pg_proc WHERE oid IN (${list});`);
const beforeMeta=metadata(),beforeHashes=hashes(),before=jsonSql(`SET ROLE anon;SELECT ${publicRead};`);
const samples=()=>pgbench(`SET ROLE anon;SELECT ${publicRead};RESET ROLE;`);
const baseline=samples();
sql(readFileSync('supabase/migrations/20261104002700_public_current_table_prepared_reads.sql','utf8'));
assert.deepEqual(metadata(),beforeMeta);assert.deepEqual(jsonSql(`SET ROLE anon;SELECT ${publicRead};`),before);
const preparedHashes=hashes();
const equal=mutation=>{
 const reply=jsonSql(`BEGIN;${mutation};SELECT jsonb_build_object('actual',${publicRead},'expected',${canonical});ROLLBACK;`);
 assert.deepEqual(reply.actual,reply.expected);
};
const startJob=()=>{
 sql(`SELECT spectator_projection_v2.mark_dirty('${tour}','tables','prepared-read-test','component');
 UPDATE spectator_projection_v2.work_groups SET fencing_token='${lease}',claimed_until=clock_timestamp()+interval '30 seconds'
 WHERE tournament_id='${tour}' AND component='tables' AND group_key='component';`);
 return jsonSql(`SELECT jsonb_build_object('generation',source_revision::text) FROM spectator_projection_v2.entity_markers WHERE tournament_id='${tour}' AND component='tables' AND entity_key='generation';`);
};
const publishQuery=vector=>`${service}SELECT public.publish_public_spectator_projection_v2('${tour}','tables','component','${lease}','${JSON.stringify(vector)}','{"items":[],"removed":[]}');`;
const publish=vector=>sql(publishQuery(vector))==='t';
let vector=startJob();assert.equal(publish(vector),true);assert.equal(publish(vector),false,'A consumed lease cannot publish twice');
assert.deepEqual(jsonSql(`SET ROLE anon;SELECT ${publicRead};`),jsonSql(`SELECT ${canonical};`));
assert.equal(sql(`SELECT count(*) FROM spectator_projection_v2.current_table_publications_v1 WHERE tournament_id='${tour}';`),'1');
assert.equal(sql(`BEGIN;UPDATE spectator_projection_v2.current_table_publications_v1 SET payload=payload||'{"fixtureCacheHit":true}';SET LOCAL ROLE anon;SELECT ${publicRead}->>'fixtureCacheHit';ROLLBACK;`),'true');
for(const role of ['anon','authenticated','service_role']){
 assert.deepEqual(jsonSql(`SET ROLE ${role};SELECT ${publicRead};`),jsonSql(`SELECT ${canonical};`));
 for(const object of ['current_table_publications_v1','current_table_read_originals_v1'])assert.throws(()=>sql(`SET ROLE ${role};SELECT * FROM spectator_projection_v2.${object};`),/permission denied/);
 assert.throws(()=>sql(`SET ROLE ${role};SELECT ${canonical};`),/permission denied/);
}
assert.equal(jsonSql(`SET ROLE anon;SELECT public.get_public_tournament_table_live_or_last_hand_v2('${other}','${table}');`).error,'table_out_of_scope');
const hand=before.hand.id;
const mutations=[
 `UPDATE public.tournaments SET deleted_at=clock_timestamp() WHERE id='${tour}'`,
 `UPDATE public.table_sessions SET closed_at=clock_timestamp() WHERE id=(SELECT table_session_id FROM public.tournament_tables WHERE id='${table}')`,
 `UPDATE public.tournament_tables SET table_session_id=NULL WHERE id='${table}'`,
 `UPDATE public.tournament_tables SET tournament_id='${other}' WHERE id='${table}'`,
 `DELETE FROM public.tournament_tables WHERE id='${table}'`,
 `UPDATE public.tournament_hands SET is_voided=true WHERE id='${hand}'`,
 `DELETE FROM public.hand_actions WHERE hand_id='${hand}';DELETE FROM public.hand_players WHERE hand_id='${hand}';DELETE FROM public.tournament_hands WHERE id='${hand}'`,
 `UPDATE public.tournament_hands SET tournament_id='${other}' WHERE id='${hand}'`,
 `UPDATE public.hand_actions SET action_amount=action_amount+1 WHERE hand_id='${hand}'`,
 `DELETE FROM public.hand_actions WHERE hand_id='${hand}'`,
 `UPDATE public.hand_players SET player_name='Prepared cache invalidation' WHERE hand_id='${hand}'`,
 `DELETE FROM public.hand_players WHERE hand_id='${hand}'`,
 `INSERT INTO spectator_projection_v2.deferred_generations_v1(tournament_id,component) VALUES('${tour}','tables') ON CONFLICT DO NOTHING`,
 `UPDATE spectator_projection_v2.current_table_publications_v1 SET payload=payload||jsonb_build_object('tableId','${other}')`,
];
for(const mutation of mutations)equal(mutation);
// A separate empty tournament can be hard-deleted without bypassing FKs.
const empty='10000000-0000-4000-8000-000000000099',emptyTable='50000000-0000-4000-8000-000000000099',emptySession='60000000-0000-4000-8000-000000000099';
assert.equal(sql(`BEGIN;INSERT INTO public.tournaments(id) VALUES('${empty}');INSERT INTO public.table_sessions(id,tournament_id) VALUES('${emptySession}','${empty}');
 INSERT INTO public.tournament_tables(id,tournament_id,table_session_id) VALUES('${emptyTable}','${empty}','${emptySession}');
 INSERT INTO spectator_projection_v2.current_table_publications_v1 SELECT '${empty}','${emptyTable}',(v->>'sourceGeneration')::bigint,v FROM (SELECT spectator_projection_v2.current_table_source_v1('${empty}','${emptyTable}') v) q;
 DELETE FROM public.tournaments WHERE id='${empty}';SET LOCAL ROLE anon;SELECT public.get_public_tournament_table_live_or_last_hand_v2('${empty}','${emptyTable}')->>'access';ROLLBACK;`),'revoked');
// A false/expired/stolen source certificate never replaces the prepared row.
vector=startJob();const stored=sql(`SELECT payload::text FROM spectator_projection_v2.current_table_publications_v1 WHERE tournament_id='${tour}';`);
assert.equal(publish({generation:String(BigInt(vector.generation)-1n)}),false);
assert.equal(sql(`SELECT payload::text FROM spectator_projection_v2.current_table_publications_v1 WHERE tournament_id='${tour}';`),stored);
vector=startJob();sql(`UPDATE spectator_projection_v2.work_groups SET claimed_until=clock_timestamp()-interval '1 second' WHERE tournament_id='${tour}' AND component='tables';`);
assert.equal(publish(vector),false);
vector=startJob();assert.equal(publish(vector),true);
// Expired private orphans are pruned in bounded batches without parent FKs.
sql(`INSERT INTO spectator_projection_v2.current_table_publications_v1(tournament_id,table_id,generation,payload,published_at)
 SELECT gen_random_uuid(),gen_random_uuid(),0,'{}',clock_timestamp()-interval '2 hours' FROM generate_series(1,101);`);
vector=startJob();assert.equal(publish(vector),true);
assert.equal(sql("SELECT count(*) FROM spectator_projection_v2.current_table_publications_v1 WHERE payload='{}';"),'1');
vector=startJob();assert.equal(publish(vector),true);
assert.equal(sql("SELECT count(*) FROM spectator_projection_v2.current_table_publications_v1 WHERE payload='{}';"),'0');
// Real concurrency: block BEFORE INSERT after canonical JSON evaluation. A
// separate source writer commits a deferred invalidation before cache commit.
sql(`CREATE FUNCTION spectator_projection_v2.fixture_pause_prepared_insert() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_advisory_xact_lock(20261104,27);RETURN NEW;END $$;
 CREATE TRIGGER fixture_pause_prepared_insert BEFORE INSERT ON spectator_projection_v2.current_table_publications_v1 FOR EACH ROW EXECUTE FUNCTION spectator_projection_v2.fixture_pause_prepared_insert();`);
vector=startJob();
const barrier=sqlAsync(`BEGIN;SELECT pg_advisory_xact_lock(20261104,27);SELECT pg_advisory_xact_lock(hashtextextended('public-gen:${tour}',0));SELECT pg_sleep(5);COMMIT;`);
const concurrentName='Concurrent source '+Date.now();
let publishing;
try{
 let ready=false;for(let i=0;i<30;i++){if(sql('SELECT pg_try_advisory_xact_lock(20261104,27);')==='f'){ready=true;break;}await new Promise(r=>setTimeout(r,25));}assert.equal(ready,true);
 publishing=sqlAsync(publishQuery(vector));
 let waiting=false;for(let i=0;i<30;i++){if(sql("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE wait_event='advisory' AND query LIKE '%SELECT public.publish_public_spectator_projection_v2(%');")==='t'){waiting=true;break;}await new Promise(r=>setTimeout(r,25));}assert.equal(waiting,true);
 await sqlAsync(`SET statement_timeout='750ms';UPDATE public.hand_players SET player_name='${concurrentName}' WHERE hand_id='${hand}';`);
 assert.equal(Number(sql(`SELECT count(*) FROM spectator_projection_v2.deferred_generations_v1 WHERE tournament_id='${tour}' AND component='tables';`))>0,true);
 await barrier;assert.equal(await publishing,'t');
 const value=jsonSql(`SELECT jsonb_build_object('actual',${publicRead},'expected',${canonical},'prepared',(SELECT payload FROM spectator_projection_v2.current_table_publications_v1 WHERE tournament_id='${tour}' AND table_id='${table}'));`);
 assert.deepEqual(value.actual,value.expected);assert.notDeepEqual(value.prepared,value.expected,'The concurrent newer source must not be falsely certified');
 sql(`${service}SELECT public.absorb_public_spectator_generations_v2(100);`);equal('');
}finally{await Promise.allSettled([barrier,publishing].filter(Boolean));sql('DROP TRIGGER fixture_pause_prepared_insert ON spectator_projection_v2.current_table_publications_v1;DROP FUNCTION spectator_projection_v2.fixture_pause_prepared_insert();');}
vector=startJob();assert.equal(publish(vector),true);equal('');
// Publication cleans inactive table identities; reopening reads canonical data.
sql(`UPDATE public.table_sessions SET closed_at=clock_timestamp() WHERE id=(SELECT table_session_id FROM public.tournament_tables WHERE id='${table}');`);
vector=startJob();assert.equal(publish(vector),true);assert.equal(sql(`SELECT count(*) FROM spectator_projection_v2.current_table_publications_v1 WHERE tournament_id='${tour}';`),'0');
sql(`UPDATE public.table_sessions SET closed_at=NULL WHERE id=(SELECT table_session_id FROM public.tournament_tables WHERE id='${table}');`);
vector=startJob();assert.equal(publish(vector),true);
const manyPlan=jsonSql(`BEGIN;DO $$ DECLARE i integer;fixture_session uuid;fixture_table uuid;fixture_hand uuid;BEGIN FOR i IN 1..20 LOOP
 fixture_session:=md5('prepared-session-'||i)::uuid;fixture_table:=md5('prepared-table-'||i)::uuid;fixture_hand:=md5('prepared-hand-'||i)::uuid;
 INSERT INTO public.table_sessions(id,tournament_id) VALUES(fixture_session,'${tour}');
 INSERT INTO public.tournament_tables(id,tournament_id,table_session_id) VALUES(fixture_table,'${tour}',fixture_session);
 INSERT INTO public.tournament_hands SELECT (jsonb_populate_record(NULL::public.tournament_hands,to_jsonb(h)||jsonb_build_object('id',fixture_hand,'tournament_table_id',fixture_table,'table_session_id',fixture_session,'hand_number',90000000+i))).* FROM public.tournament_hands h WHERE h.id='${hand}';
 INSERT INTO public.hand_players SELECT (jsonb_populate_record(NULL::public.hand_players,to_jsonb(hp)||jsonb_build_object('id',gen_random_uuid(),'hand_id',fixture_hand))).* FROM public.hand_players hp WHERE hp.hand_id='${hand}';
 INSERT INTO public.hand_actions SELECT (jsonb_populate_record(NULL::public.hand_actions,to_jsonb(a)||jsonb_build_object('id',gen_random_uuid(),'hand_id',fixture_hand))).* FROM public.hand_actions a WHERE a.hand_id='${hand}';
 END LOOP;END $$;
 UPDATE spectator_projection_v2.work_groups SET fencing_token='${lease}',claimed_until=clock_timestamp()+interval '30 seconds' WHERE tournament_id='${tour}' AND component='tables' AND group_key='component';
 SET LOCAL request.jwt.claim.role='service_role';
 EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON) SELECT public.publish_public_spectator_projection_v2('${tour}','tables','component','${lease}',
  (SELECT jsonb_build_object('generation',source_revision::text) FROM spectator_projection_v2.entity_markers WHERE tournament_id='${tour}' AND component='tables' AND entity_key='generation'),'{"items":[],"removed":[]}');
 DO $$ BEGIN IF (SELECT count(*) FROM spectator_projection_v2.current_table_publications_v1 WHERE tournament_id='${tour}')<>21 THEN RAISE EXCEPTION 'many_table_fill_missing';END IF;END $$;ROLLBACK;`);
const prepared=samples();
const recovery=readFileSync('tests/publicHud/current-table-prepared.forward-rollback.sql','utf8').replace(/^BEGIN;\r?\n/m,'').replace(/COMMIT;\s*$/,'');
const restored=jsonSql(`BEGIN;${recovery}SELECT jsonb_object_agg(oid::regprocedure::text,md5(replace(pg_get_functiondef(oid),chr(13),''))) FROM pg_proc WHERE oid IN (${list});ROLLBACK;`);
assert.deepEqual(restored,beforeHashes);assert.deepEqual(hashes(),preparedHashes);assert.deepEqual(metadata(),beforeMeta);
// Verify the exact affected object-check expressions without touching managed
// Vault/cron schemas or changing their grants in the genuine Supabase stack.
const objectKeys=['readPlanDefinitionsMatch','currentTablePreparedDefinitionsMatch','currentTablePreparedSourceMatches','currentTablePreparedRls','currentTablePreparedExpiryIndex','currentTablePreparedHelperPrivate','currentTablePreparedPrivateGrants'];
const postcheckLines=readFileSync('scripts/ops/tracker-hud-20261104-postcheck.sql','utf8').split(/\r?\n/);
const objectChecks=objectKeys.map(key=>{const matches=postcheckLines.filter(line=>line.trimStart().startsWith(`'${key}',`));assert.equal(matches.length,1,key);return matches[0].trim().replace(/,$/,'');});
const objects=jsonSql(`SELECT jsonb_build_object(${objectChecks.join(',\n')});`);
for(const key of objectKeys.filter(key=>key!=='currentTablePreparedPrivateGrants'))assert.equal(objects[key],true,key);
assert.equal(objects.currentTablePreparedPrivateGrants,0);
const distribution=a=>({samples:a.length,p50Ms:a[Math.floor(a.length*.5)],p95Ms:a[Math.floor(a.length*.95)]});
const report={kind:'NATIVE_PREPARED_CURRENT_TABLE',productionCapacityClaim:false,passed:true,checks:['metadata-OID-ACL-preserved','actual-cache-hit','anonymous-scope','private-helper-denied','exact-canonical-fallback','source-mutation-invalidation','deferred-source-commit-during-publication','lease-vector-retry-fences','inactive-table-cleanup','bounded-expired-orphan-pruning','21-active-table-publication','ordered-exact-recovery'],baseline:distribution(baseline),prepared:distribution(prepared),manyActiveTables:{tables:21,playersPerAddedTable:2,actionsPerAddedTable:4,executionMs:manyPlan[0]['Execution Time'],httpCapacityClaim:false},preparedHashes};
if(process.env.PUBLIC_HUD_TABLE_PREPARED_REPORT)writeFileSync(process.env.PUBLIC_HUD_TABLE_PREPARED_REPORT,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
