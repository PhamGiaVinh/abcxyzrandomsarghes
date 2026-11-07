import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {build} from 'esbuild';
import {sql,jsonSql,sqlAsync,service} from './nativeDb.mjs';
import {nativeWorkerClient} from './nativeRpc.mjs';
const migration=readFileSync('supabase/migrations/20261106111519_public_hud_visibility_work_wakeup.sql','utf8');
const recovery=readFileSync('tests/publicHud/visibility-wake.forward-rollback.sql','utf8');
const strip=s=>s.replace(/^BEGIN;\r?\n/m,'').replace(/COMMIT;\s*$/,'');
const signature='public.publish_public_hud_hand_v1(uuid,bigint,uuid,text,jsonb)';
const hash=()=>sql(`SELECT md5(replace(pg_get_functiondef('${signature}'::regprocedure),chr(13),''));`);
const alreadyApplied=process.argv.includes('--already-applied');
assert.equal(hash(),alreadyApplied?'f0f90ec0eca53e1802bd059034b06782':'88a66fee5368a32e79a663dcadcd99e3');
if(alreadyApplied)assert.equal(sql("SELECT original_definition_hash||':'||candidate_definition_hash FROM tracker_analytics_v1.visibility_wake_original_v1;"),'88a66fee5368a32e79a663dcadcd99e3:f0f90ec0eca53e1802bd059034b06782');
const compiled=await build({entryPoints:['supabase/functions/public-hud-projector-v1/worker.ts'],bundle:true,write:false,platform:'node',format:'esm',logLevel:'silent'});
const {processPublicHudJobs}=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const call=async(limit=20,client=nativeWorkerClient)=>{const r=await processPublicHudJobs(client,limit,Date.now()+20000);assert.equal(r.failed,0);return r;};
const drain=async()=>{for(let n=0;n<100;n++){if(sql('SELECT count(*) FROM tracker_analytics_v1.jobs;')==='0')return;await call();await new Promise(r=>setTimeout(r,50));}throw Error('Wake fixture queue did not drain');};
await drain();
const flags=jsonSql('SELECT jsonb_build_object(\'enabled\',enabled,\'worker\',worker_enabled) FROM tracker_analytics_v1.config WHERE singleton;');
const metadata=()=>jsonSql(`SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE oid='${signature}'::regprocedure;`);
const beforeMeta=metadata();
const totals=()=>jsonSql("SELECT jsonb_agg(to_jsonb(p)-'revision'-'computed_at' ORDER BY player_id,version) FROM tracker_analytics_v1.player_totals p;");
const beforeTotals=totals();
sql('UPDATE tracker_analytics_v1.config SET enabled=false,worker_enabled=false;');
if(!alreadyApplied)sql(migration);const candidateHash=hash();assert.deepEqual(metadata(),beforeMeta);
const preimage=strip(recovery)+'DROP TABLE tracker_analytics_v1.visibility_wake_original_v1;';
assert.equal(sql(`BEGIN;${preimage}${strip(migration)}SELECT md5(replace(pg_get_functiondef('${signature}'::regprocedure),chr(13),''));ROLLBACK;`),candidateHash);
for(const change of [`ALTER FUNCTION ${signature} STABLE;`,`GRANT EXECUTE ON FUNCTION ${signature} TO anon;`])assert.throws(()=>sql(`BEGIN;${preimage}${change}${strip(migration)}ROLLBACK;`,{captureFailure:true}),/HUD visibility wake preimage differs/);
for(const change of ['UPDATE tracker_analytics_v1.config SET enabled=true;','UPDATE tracker_analytics_v1.config SET worker_enabled=true;',"INSERT INTO tracker_analytics_v1.jobs(kind,entity_id,lease_token,lease_until) VALUES('hand','f3000000-0000-4000-8000-000000000001',gen_random_uuid(),clock_timestamp()+interval '30 seconds');"])assert.throws(()=>sql(`BEGIN;${change}${strip(migration)}ROLLBACK;`,{captureFailure:true}),/HUD visibility wake needs disabled reads\/worker and no leases/);
for(const role of ['anon','authenticated','service_role'])assert.throws(()=>sql(`SET ROLE ${role};SELECT * FROM tracker_analytics_v1.visibility_wake_original_v1;`,{captureFailure:true}),/permission denied/);
const ids=n=>`f1000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const handId=(n,i)=>`f2000000-0000-4000-8000-${String(n*10+i).padStart(12,'0')}`;
const tours=[];
const parent=tour=>jsonSql(`SELECT to_jsonb(j) FROM tracker_analytics_v1.jobs j WHERE kind='visibility' AND entity_id='${tour}';`);
const work=tour=>Number(sql(`SELECT count(*) FROM tracker_analytics_v1.visibility_work WHERE tournament_id='${tour}';`));
const barrier=tour=>Number(sql(`SELECT count(*) FROM tracker_analytics_v1.visibility_barriers WHERE tournament_id='${tour}';`));
const future=tour=>sql(`UPDATE tracker_analytics_v1.jobs SET available_at=clock_timestamp()+interval '30 seconds' WHERE kind='visibility' AND entity_id='${tour}';`);
const capture=async(count)=>{const packets=[];for(let i=0;i<30&&packets.length<count;i++)await call(1,{async rpc(name,args){if(name==='publish_public_hud_hand_v1'){packets.push(args);return {data:true,error:null};}return nativeWorkerClient.rpc(name,args);}});assert.equal(packets.length,count);return packets;};
const publish=async packet=>{const r=await nativeWorkerClient.rpc('publish_public_hud_hand_v1',packet);assert.equal(r.error,null);return r.data;};
const literal=v=>`'${String(typeof v==='object'?JSON.stringify(v):v).replaceAll("'","''")}'`;
const publishSql=p=>`SELECT public.publish_public_hud_hand_v1(${['p_entity','p_generation','p_lease','p_fingerprint','p_rows'].map(k=>literal(p[k])).join(',')});`;
const prepare=async(n,count=1)=>{
 const tour=ids(n);tours.push(tour);sql(`INSERT INTO public.tournaments(id,deleted_at) VALUES('${tour}',clock_timestamp());`);await drain();
 for(let i=1;i<=count;i++)sql(`INSERT INTO public.tournament_hands(id,tournament_id,status) VALUES('${handId(n,i)}','${tour}','completed');INSERT INTO public.hand_players(hand_id,tournament_id,player_id,seat_number,starting_stack) VALUES('${handId(n,i)}','${tour}','30000000-0000-4000-8000-00000000000${i%2+1}',1,1000);`);
 await drain();sql(`UPDATE public.tournaments SET deleted_at=NULL WHERE id='${tour}';`);await call(1);assert.equal(work(tour),count);assert.equal(barrier(tour),1);
 const packets=await capture(count);future(tour);return {tour,packets};
};
const eligible=tour=>sql(`SELECT available_at<=clock_timestamp() FROM tracker_analytics_v1.jobs WHERE kind='visibility' AND entity_id='${tour}';`)==='t';
const waitState=async(application,kind)=>{for(let i=0;i<40;i++){if(sql(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND application_name='${application}' AND ${kind==='sleep'?"wait_event='PgSleep'":"wait_event_type='Lock'"});`)==='t')return;await new Promise(r=>setTimeout(r,10));}throw Error('Expected real concurrent session state absent');};
// A stale publisher and a transaction rollback cannot retire work or wake.
{
 const {tour,packets:[packet]}=await prepare(1),before=parent(tour);
 assert.equal(await publish({...packet,p_generation:packet.p_generation+1}),false);assert.deepEqual(parent(tour),before);assert.equal(work(tour),1);
 assert.equal(sql(`BEGIN;${service}${publishSql(packet)}ROLLBACK;`),'t');assert.deepEqual(parent(tour),before);assert.equal(work(tour),1);
 assert.equal(await publish(packet),true);assert.equal(work(tour),0);assert.equal(eligible(tour),true);assert.equal(barrier(tour),1,'Publish must not clear the visibility barrier');
 await call(1);assert.equal(barrier(tour),0);await drain();
}
// A newer generation cannot be accelerated by retired obsolete work.
{
 const {tour,packets:[packet]}=await prepare(2);sql(`UPDATE public.tournaments SET deleted_at=clock_timestamp() WHERE id='${tour}';UPDATE public.tournaments SET deleted_at=NULL WHERE id='${tour}';`);future(tour);const before=parent(tour);
 assert.equal(await publish(packet),true);assert.deepEqual(parent(tour),before);assert.equal(barrier(tour),1);
 sql(`UPDATE tracker_analytics_v1.jobs SET available_at=clock_timestamp() WHERE kind='visibility' AND entity_id='${tour}';`);await drain();
}
// A currently leased parent retains every lease/schedule field.
{
 const {tour,packets:[packet]}=await prepare(3);sql(`UPDATE tracker_analytics_v1.jobs SET available_at=clock_timestamp() WHERE kind='visibility' AND entity_id='${tour}';`);
 const lease=jsonSql(`${service}SELECT public.claim_public_hud_jobs_v1(1);`)[0];assert.equal(lease.entity_id,tour);const before=parent(tour);
 assert.equal(await publish(packet),true);assert.deepEqual(parent(tour),before);assert.equal(barrier(tour),1);
 const r=await nativeWorkerClient.rpc('process_public_hud_metadata_v1',{p_kind:'visibility',p_entity:tour,p_generation:lease.generation,p_lease:lease.lease_token});assert.equal(r.error,null);assert.equal(r.data,true);await drain();
}
// Ordinary hand publication has no cohort and must not alter an unrelated wait.
{
 const tour=ids(4);tours.push(tour);sql(`INSERT INTO public.tournaments(id) VALUES('${tour}');`);await drain();
 sql(`SELECT tracker_analytics_v1.enqueue('visibility','${tour}');`);future(tour);
 sql(`INSERT INTO public.tournament_hands(id,tournament_id,status) VALUES('${handId(4,1)}','${tour}','completed');INSERT INTO public.hand_players(hand_id,tournament_id,player_id,seat_number,starting_stack) VALUES('${handId(4,1)}','${tour}','30000000-0000-4000-8000-000000000001',1,1000);`);
 const [packet]=await capture(1),before=parent(tour);assert.equal(work(tour),0);assert.equal(await publish(packet),true);assert.deepEqual(parent(tour),before);
 sql(`UPDATE tracker_analytics_v1.jobs SET available_at=clock_timestamp() WHERE kind='visibility' AND entity_id='${tour}';`);await drain();
}
// Two actual concurrent publisher transactions: the second finishes while the
// first owns the parent lock, rather than waiting behind it. Both deltas survive.
{
 const {tour,packets}=await prepare(5,2);
 const first=sqlAsync(`SET application_name='hud-wake-first-publisher';BEGIN;${service}${publishSql(packets[0])}SELECT pg_sleep(3);COMMIT;`);
 try{await waitState('hud-wake-first-publisher','sleep');assert.equal(await publish(packets[1]),true);await waitState('hud-wake-first-publisher','sleep');}finally{await first;}
 assert.equal(work(tour),0);assert.equal(eligible(tour),true);assert.equal(barrier(tour),1);await drain();
 assert.equal(sql(`SELECT count(*) FROM tracker_analytics_v1.hand_contributions WHERE tournament_id='${tour}' AND public_hands=1;`),'2');
}
// Deleted-source subtraction has no source-parent lock. Reproduce the dangerous
// opposite lock order with two sessions: parent-job holder waits on child-job,
// while the real publisher already holds child-job and skips that parent lock.
{
 const {tour,packets:[old]}=await prepare(6);sql(`DELETE FROM public.tournament_hands WHERE id='${old.p_entity}';`);const [packet]=await capture(1);
 const publisher=sqlAsync(`SET application_name='hud-wake-child-holder';BEGIN;SET LOCAL statement_timeout='5s';SELECT 1 FROM tracker_analytics_v1.jobs WHERE kind='hand' AND entity_id='${packet.p_entity}' FOR UPDATE;SELECT pg_sleep(2);${service}${publishSql(packet)}COMMIT;`);
 let holder;
 try{await waitState('hud-wake-child-holder','sleep');holder=sqlAsync(`SET application_name='hud-wake-parent-holder';BEGIN;SET LOCAL statement_timeout='5s';SELECT 1 FROM tracker_analytics_v1.jobs WHERE kind='visibility' AND entity_id='${tour}' FOR UPDATE;SELECT 1 FROM tracker_analytics_v1.jobs WHERE kind='hand' AND entity_id='${packet.p_entity}' FOR UPDATE;COMMIT;`);await waitState('hud-wake-parent-holder','lock');await publisher;}finally{await publisher;if(holder)await holder;}
 assert.equal(work(tour),0);assert.equal(barrier(tour),1);assert.equal(eligible(tour),false,'Busy parent keeps the existing retry');
 sql(`UPDATE tracker_analytics_v1.jobs SET available_at=clock_timestamp() WHERE kind='visibility' AND entity_id='${tour}';`);await drain();
}
for(const tour of tours)sql(`DELETE FROM public.tournaments WHERE id='${tour}';`);await drain();assert.deepEqual(totals(),beforeTotals,'Publish/retire must conserve every original player counter and winnings');
assert.deepEqual(metadata(),beforeMeta);
const keys=['visibilityRestorePublisherMatches','visibilityWakePublisherMatches','visibilityWakePrivate'];
const lines=readFileSync('scripts/ops/tracker-hud-20261104-postcheck.sql','utf8').split(/\r?\n/);
const expressions=keys.map(key=>{const found=lines.filter(line=>line.trimStart().startsWith(`'${key}',`));assert.equal(found.length,1);return found[0].trim().replace(/,$/,'');});
const checks=(change='')=>jsonSql(`BEGIN;${change}SELECT jsonb_build_object(${expressions.join(',')});ROLLBACK;`);
assert.deepEqual(Object.values(checks()),[true,true,true]);
assert.equal(checks("UPDATE tracker_analytics_v1.visibility_wake_original_v1 SET original_definition_hash=repeat('0',32);").visibilityRestorePublisherMatches,false);
assert.equal(checks(`ALTER FUNCTION ${signature} STABLE;`).visibilityWakePublisherMatches,false);
assert.equal(checks('GRANT SELECT ON tracker_analytics_v1.visibility_wake_original_v1 TO anon;').visibilityWakePrivate,false);
assert.equal(sql(`BEGIN;${strip(recovery)}SELECT md5(replace(pg_get_functiondef('${signature}'::regprocedure),chr(13),''));ROLLBACK;`),'88a66fee5368a32e79a663dcadcd99e3');assert.equal(hash(),candidateHash);
sql(`UPDATE tracker_analytics_v1.config SET enabled=${flags.enabled},worker_enabled=${flags.worker} WHERE singleton;`);
const report={kind:'NATIVE_REQUIRED_WORK_PARENT_WAKE_REAL_PROJECTOR',passed:true,candidateHash,checks:['stale-publication-no-wake','rollback-no-wake','unleased-current-generation-eligible-now','barrier-only-cleared-by-metadata','new-generation-unchanged','leased-parent-unchanged','ordinary-hand-no-wake','two-real-concurrent-publishers-parent-skip','actual-parent-child-lock-order-no-deadlock','deleted-source-subtraction','all-original-counter-and-winnings-conservation','metadata-and-private-ACL','guarded-recovery'],qualification:false,productionChanged:false,limitations:'Tiny actual PostgreSQL/compiled-worker correctness and lock-order proof, not HTTP/WS latency or elimination of every restoration deadline. Busy parents keep the original retry.'};
if(process.env.PUBLIC_HUD_VISIBILITY_WAKE_REPORT)writeFileSync(process.env.PUBLIC_HUD_VISIBILITY_WAKE_REPORT,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
