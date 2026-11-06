import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {build} from 'esbuild';
import {initialize,sql,jsonSql,sqlAsync,service} from './nativeDb.mjs';
import {nativeWorkerClient} from './nativeRpc.mjs';

const migration=readFileSync('supabase/migrations/20261106025221_public_hud_visibility_required_work.sql','utf8');
if(process.argv.includes('--initialize')){
 initialize();
 for(const file of ['20261104003100_public_hud_enqueue_write_coalescing.sql','20261106010000_public_hud_visibility_restore_reclassification.sql'])
  sql(readFileSync('supabase/migrations/'+file,'utf8'));
}
const identity=()=>jsonSql(`SELECT jsonb_agg(jsonb_build_object('oid',oid,'owner',proowner,'acl',proacl,'security',prosecdef,'config',proconfig) ORDER BY oid)
 FROM pg_proc WHERE oid IN ('public.process_public_hud_metadata_v1(text,uuid,bigint,uuid)'::regprocedure,'public.publish_public_hud_hand_v1(uuid,bigint,uuid,text,jsonb)'::regprocedure);`);
const before=identity();
function rejectsSql(query,pattern){assert.throws(()=>sql(query,{captureFailure:true}),error=>pattern.test(String(error.stderr??error.message)));}
sql('UPDATE tracker_analytics_v1.config SET enabled=true;');
rejectsSql(migration,/needs disabled reads\/worker and no outstanding leases/);
sql('UPDATE tracker_analytics_v1.config SET enabled=false,worker_enabled=true;');
rejectsSql(migration,/needs disabled reads\/worker and no outstanding leases/);
sql('UPDATE tracker_analytics_v1.config SET worker_enabled=false;');
// Already-paged work may have moved away from its old contribution tour.
sql(`INSERT INTO public.tournaments(id) VALUES('10000000-0000-4000-8000-000000000008');
 INSERT INTO tracker_analytics_v1.jobs(kind,entity_id,generation,refresh_hands,progress_cursor)
 VALUES('visibility','10000000-0000-4000-8000-000000000008',4,true,'ffffffff-ffff-ffff-ffff-ffffffffffff');
 INSERT INTO tracker_analytics_v1.jobs(kind,entity_id,lease_token,lease_until)
 VALUES('hand','b2000000-0000-4000-8000-000000000099',gen_random_uuid(),now()-interval '1 second');`);
rejectsSql(migration,/needs disabled reads\/worker and no outstanding leases/);
sql("UPDATE tracker_analytics_v1.jobs SET lease_token=NULL,lease_until=NULL;");
sql(migration);assert.deepEqual(identity(),before);
rejectsSql(migration,/preimage differs/);
for(const role of ['anon','authenticated','service_role']){
 assert.throws(()=>sql(`SET ROLE ${role}; SELECT * FROM tracker_analytics_v1.visibility_work;`,{captureFailure:true}),/Command failed/);
}
assert.equal(sql("SELECT relrowsecurity FROM pg_class WHERE oid='tracker_analytics_v1.visibility_work'::regclass;"),'t');
const compiled=await build({entryPoints:['supabase/functions/public-hud-projector-v1/worker.ts'],bundle:true,write:false,platform:'node',format:'esm',logLevel:'silent'});
const {processPublicHudJobs}=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const tour='10000000-0000-4000-8000-000000000006',other='10000000-0000-4000-8000-000000000007',player='30000000-0000-4000-8000-000000000001';
const hidden='b2000000-0000-4000-8000-000000000001',newer='b2000000-0000-4000-8000-000000000002',progress='b2000000-0000-4000-8000-000000000003';
const call=async(limit=20)=>{const result=await processPublicHudJobs(nativeWorkerClient,limit,Date.now()+20000);assert.equal(result.failed,0,JSON.stringify(result));return result;};
async function drain(){for(let n=0;n<100;n++){if(sql('SELECT count(*) FROM tracker_analytics_v1.jobs;')==='0')return;await call();await new Promise(r=>setTimeout(r,50));}throw Error('Queue failed to drain');}
const add=(hand,status='completed')=>sql(`INSERT INTO public.tournament_hands(id,tournament_id,status) VALUES('${hand}','${tour}','${status}');
 INSERT INTO public.hand_players(hand_id,tournament_id,player_id,seat_number,starting_stack) VALUES('${hand}','${tour}','${player}',1,1000);`);
const count=()=>sql(`SELECT count(*) FROM tracker_analytics_v1.visibility_work WHERE tournament_id='${tour}';`);
sql(`INSERT INTO public.tournaments(id) VALUES('${tour}'),('${other}');`);
await drain();
sql(`UPDATE public.tournaments SET deleted_at=now() WHERE id='${tour}';`);add(hidden);await drain();
sql(`UPDATE public.tournaments SET deleted_at=NULL WHERE id='${tour}';`);
await call(1);assert.equal(count(),'1');
// The required child cannot disappear on stale/failed publication.
let packet;
await processPublicHudJobs({async rpc(name,args){if(name==='publish_public_hud_hand_v1'){packet=args;return {data:true,error:null};}return nativeWorkerClient.rpc(name,args);}},1);
assert.ok(packet);assert.equal(count(),'1');
assert.equal((await nativeWorkerClient.rpc('publish_public_hud_hand_v1',{...packet,p_generation:packet.p_generation+1})).data,false);
assert.equal(count(),'1');
assert.equal((await nativeWorkerClient.rpc('publish_public_hud_hand_v1',packet)).data,true);assert.equal(count(),'0');
add(newer);
assert.equal(sql(`SELECT count(*) FROM tracker_analytics_v1.job_players WHERE player_id='${player}' AND hard_block;`),'0');
await new Promise(r=>setTimeout(r,1100));await call(1);
assert.equal(sql(`SELECT count(*) FROM tracker_analytics_v1.visibility_barriers WHERE tournament_id='${tour}';`),'0','Restoration must not wait for a later unrelated nonblocking hand');
assert.equal(sql(`SELECT count(*) FROM tracker_analytics_v1.jobs WHERE kind='hand' AND entity_id='${newer}';`),'1');
await drain();
// A full status refresh sees a never-published in-progress hand: enqueue no-op
// must not create immortal required work. Draft policy=false is legitimate.
add(progress,'in_progress');
assert.equal(sql(`SELECT count(*) FROM tracker_analytics_v1.jobs WHERE kind='hand' AND entity_id='${progress}';`),'0');
sql(`UPDATE public.tournaments SET status='draft' WHERE id='${tour}';`);await drain();assert.equal(count(),'0');
assert.equal(sql(`SELECT count(*) FROM tracker_analytics_v1.hand_contributions WHERE tournament_id='${tour}' AND settlement_evidence->>'policyEligible'='false';`),'2');
sql(`UPDATE public.tournaments SET deleted_at=now() WHERE id='${tour}';`);await drain();
sql(`UPDATE public.tournaments SET deleted_at=NULL WHERE id='${tour}';`);await drain();assert.equal(count(),'0');
// Crash/rollback after enqueue and registration leaves neither mutation behind.
sql(`UPDATE public.tournaments SET status='live' WHERE id='${tour}';`);
const lease=jsonSql(`${service}SELECT public.claim_public_hud_jobs_v1(1);`)[0];
assert.equal(lease.kind,'visibility');
sql(`BEGIN;${service}SELECT public.process_public_hud_metadata_v1('visibility','${tour}',${lease.generation},'${lease.lease_token}');ROLLBACK;`);
assert.equal(count(),'0');assert.equal(sql("SELECT count(*) FROM tracker_analytics_v1.jobs WHERE kind='hand';"),'0');
assert.equal((await nativeWorkerClient.rpc('process_public_hud_metadata_v1',{p_kind:'visibility',p_entity:tour,p_generation:lease.generation,p_lease:lease.lease_token})).data,true);
assert.equal(count(),'2');
// A deletion and a move require actual subtraction/replacement, not source FK
// cascade cleanup. A newer visibility generation resets the parent cursor.
sql(`DELETE FROM public.tournament_hands WHERE id='${hidden}';
 UPDATE public.tournament_hands SET tournament_id='${other}' WHERE id='${newer}';
 UPDATE public.hand_players SET tournament_id='${other}' WHERE hand_id='${newer}';
 UPDATE public.tournaments SET deleted_at=now() WHERE id='${tour}';
 UPDATE public.tournaments SET deleted_at=NULL WHERE id='${tour}';`);
assert.equal(count(),'2');
assert.equal((await nativeWorkerClient.rpc('process_public_hud_metadata_v1',{p_kind:'visibility',p_entity:tour,p_generation:lease.generation,p_lease:lease.lease_token})).data,false);
await drain();assert.equal(count(),'0');
assert.equal(sql(`SELECT count(*) FROM tracker_analytics_v1.hand_contributions WHERE hand_id='${hidden}';`),'0');
assert.equal(sql(`SELECT tournament_id FROM tracker_analytics_v1.hand_contributions WHERE hand_id='${newer}';`),other);
assert.equal(sql('SELECT count(*) FROM tracker_analytics_v1.visibility_work;'),'0');
// Two actual sessions: visibility source transaction holds parent while a
// previously captured publisher waits. It must reject its obsolete fingerprint.
sql(`UPDATE public.tournaments SET deleted_at=now() WHERE id='${other}';`);await drain();
sql(`UPDATE public.tournament_hands SET source_revision=source_revision+1 WHERE id='${newer}';`);await drain();
sql(`UPDATE public.tournaments SET deleted_at=NULL WHERE id='${other}';`);await call(1);
packet=undefined;
await processPublicHudJobs({async rpc(name,args){if(name==='publish_public_hud_hand_v1'){packet=args;return {data:true,error:null};}return nativeWorkerClient.rpc(name,args);}},1);
assert.ok(packet);
const sourceTransaction=sqlAsync(`SET application_name='hud-work-generation-race';BEGIN;
 UPDATE public.tournaments SET deleted_at=now() WHERE id='${other}';SELECT pg_sleep(1);COMMIT;`);
let held=false;
for(let n=0;n<30;n++){if(sql("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='hud-work-generation-race' AND wait_event='PgSleep');")==='t'){held=true;break;}await new Promise(r=>setTimeout(r,10));}
assert.equal(held,true,'Actual concurrent source transaction must be observed');
const concurrentPublish=nativeWorkerClient.rpc('publish_public_hud_hand_v1',packet);
await sourceTransaction;
assert.equal((await concurrentPublish).data,false);
// This test intercepted the worker to park its publish. Resume the real worker
// failure path too: rejected publication releases its still-current hand lease
// through the fenced RPC. Do not rely on slow local psql calls expiring it.
assert.equal(sql(`SELECT count(*) FROM tracker_analytics_v1.visibility_work WHERE hand_id='${newer}';`),'1');
const released=await nativeWorkerClient.rpc('fail_public_hud_job_v1',{
 p_kind:'hand',p_entity:packet.p_entity,p_generation:packet.p_generation,p_lease:packet.p_lease,p_error:'PUBLIC_HUD_WORK_FAILED',
});
assert.equal(released.error,null);
assert.equal(sql(`SELECT lease_token IS NULL FROM tracker_analytics_v1.jobs WHERE kind='hand' AND entity_id='${newer}';`),'t');
await drain();assert.equal(sql('SELECT count(*) FROM tracker_analytics_v1.visibility_work;'),'0');
// Metadata enqueues/registers while an earlier publisher is already claimed.
// Parent-before-child locks serialize them; enqueue fences the old hand lease.
sql(`UPDATE public.tournament_hands SET source_revision=source_revision+1 WHERE id='${newer}';
 UPDATE public.tournaments SET deleted_at=NULL WHERE id='${other}';`);
packet=undefined;
await processPublicHudJobs({async rpc(name,args){if(name==='publish_public_hud_hand_v1'){packet=args;return {data:true,error:null};}return nativeWorkerClient.rpc(name,args);}},1);
assert.ok(packet);
const metadataLease=jsonSql(`${service}SELECT public.claim_public_hud_jobs_v1(1);`)[0];assert.equal(metadataLease.kind,'visibility');
const metadataTransaction=sqlAsync(`SET application_name='hud-work-metadata-race';BEGIN;${service}
 SELECT public.process_public_hud_metadata_v1('visibility','${other}',${metadataLease.generation},'${metadataLease.lease_token}');SELECT pg_sleep(1);COMMIT;`);
held=false;
for(let n=0;n<30;n++){if(sql("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='hud-work-metadata-race' AND wait_event='PgSleep');")==='t'){held=true;break;}await new Promise(r=>setTimeout(r,10));}
assert.equal(held,true,'Actual concurrent metadata transaction must be observed');
const oldPublish=nativeWorkerClient.rpc('publish_public_hud_hand_v1',packet);
await metadataTransaction;assert.equal((await oldPublish).data,false);
assert.equal(sql(`SELECT count(*) FROM tracker_analytics_v1.visibility_work WHERE tournament_id='${other}';`),'1');
await drain();assert.equal(sql('SELECT count(*) FROM tracker_analytics_v1.visibility_work;'),'0');
const reverse=readFileSync('scripts/ops/tracker-hud-visibility-work-reverse.sql','utf8');
sql('UPDATE tracker_analytics_v1.config SET enabled=true;');
rejectsSql(reverse,/reverse needs disabled reads\/worker and empty work/);
sql('UPDATE tracker_analytics_v1.config SET enabled=false;');
sql(reverse);assert.deepEqual(identity(),before);
assert.equal(sql("SELECT md5(replace(pg_get_functiondef('public.process_public_hud_metadata_v1(text,uuid,bigint,uuid)'::regprocedure),chr(13),''));"),'ac3c705ee94ca18024759124088a15e8');
assert.equal(sql("SELECT count(*) FROM tracker_analytics_v1.visibility_work;"),'0');
console.log(JSON.stringify({kind:'NATIVE_VISIBILITY_REQUIRED_WORK_REAL_PROJECTOR',passed:true,
 checks:['disabled-reads-worker-and-expired-lease-guards','duplicate-apply-rejected','OID-owner-ACL-preserved','private-table-denials-and-RLS','later-nonblocking-hand-does-not-hold-barrier','stale-publication-retains-required-work','in-progress-enqueue-no-op','draft-hide-restore-drains','enqueue-registration-transaction-rollback','deleted-moved-hand-publication','new-generation-fencing','two-session-source-generation-vs-publisher','two-session-metadata-registration-vs-publisher','guarded-reverse-restores-prior-definitions'],
 limitations:'Tiny actual PostgreSQL/compiled worker fixtures;not HTTP/WS load,5s qualification or production deployment'}));
