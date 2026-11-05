import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {build} from 'esbuild';
import {initialize,sql,jsonSql,sqlAsync,service} from './nativeDb.mjs';
import {loadClassifier,createShadow,shadowSql} from '../../scripts/ops/tracker-hud-shadow.mjs';

if(process.argv.includes('--initialize')){
 initialize();
 for(const file of ['20261104003100_public_hud_enqueue_write_coalescing.sql','20261106010000_public_hud_visibility_restore_reclassification.sql'])
  sql(readFileSync('supabase/migrations/'+file,'utf8'));
}
const compiled=await build({entryPoints:['supabase/functions/public-hud-projector-v1/worker.ts'],bundle:true,write:false,platform:'node',format:'esm',logLevel:'silent'});
const {processPublicHudJobs}=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const signatures={claim_public_hud_jobs_v1:['p_limit'],get_public_hud_job_source_v1:['p_kind','p_entity','p_generation','p_lease'],publish_public_hud_hand_v1:['p_entity','p_generation','p_lease','p_fingerprint','p_rows'],process_public_hud_metadata_v1:['p_kind','p_entity','p_generation','p_lease'],fail_public_hud_job_v1:['p_kind','p_entity','p_generation','p_lease','p_error']};
const quote=value=>value===null?'NULL':"'"+String(typeof value==='object'?JSON.stringify(value):value).replaceAll("'","''")+"'";
const rpcRejections=[];
const client={async rpc(name,args){
 assert.ok(name in signatures);
 try{
  const data=JSON.parse(await sqlAsync(`${service}SELECT to_jsonb(public.${name}(${signatures[name].map(key=>quote(args[key])).join(',')}));`));
  if(data===false&&['publish_public_hud_hand_v1','process_public_hud_metadata_v1'].includes(name))rpcRejections.push({name,reason:'fenced-publish'});
  return {data,error:null};
 }catch(error){
  const reason=String(error).split('\n')[0];rpcRejections.push({name,reason});return {data:null,error:reason};
 }
}};
const tour='10000000-0000-4000-8000-000000000005',player='30000000-0000-4000-8000-000000000001';
const first='50000000-0000-4000-8000-000000000001',late='50000000-0000-4000-8000-000000000000';
async function drain(){
 for(let round=0;round<160;round++){
  if(sql('SELECT count(*) FROM tracker_analytics_v1.jobs;')==='0')return;
  const before=rpcRejections.length,result=await processPublicHudJobs(client),rejected=rpcRejections.slice(before);
  // A metadata page may invalidate already claimed hand leases. Only explicit
  // source/publish fencing is retryable here; SQL errors/deadlocks still fail.
  assert.ok(rejected.every(row=>row.reason==='fenced-publish'
    ||(row.name==='get_public_hud_job_source_v1'&&row.reason.includes('lease_expired'))),JSON.stringify(rejected));
  assert.ok(result.failed<=rejected.length,JSON.stringify({result,rejected}));
  await new Promise(resolve=>setTimeout(resolve,50));
 }
 throw Error('Batch queue did not drain');
}
sql(`INSERT INTO public.tournaments(id) VALUES('${tour}');
 INSERT INTO public.tournament_hands(id,tournament_id,hand_number)
 SELECT ('50000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'${tour}',n FROM generate_series(1,201) n;
 INSERT INTO public.hand_players(hand_id,tournament_id,player_id,seat_number,starting_stack)
 SELECT id,tournament_id,'${player}',1,1000 FROM public.tournament_hands WHERE tournament_id='${tour}';`);
await drain();
assert.equal(sql(`SELECT count(*) FROM tracker_analytics_v1.hand_contributions WHERE tournament_id='${tour}';`),'201');
// Establish the actual backfill checkpoint before the race. Rebuilding after
// the race could conceal a missed job, so the final shadow may not do that.
for(let batch=0;batch<10;batch++){
 const checkpoint=jsonSql(`${service}SELECT public.backfill_public_hud_v1(50);`);
 await drain();if(checkpoint.complete)break;
}
assert.equal(sql('SELECT backfill_complete FROM tracker_analytics_v1.config;'),'t');
sql(`UPDATE public.tournaments SET deleted_at=now() WHERE id='${tour}';
 UPDATE public.tournament_hands SET source_revision=source_revision+1 WHERE tournament_id='${tour}';`);
await drain();
assert.equal(sql(`SELECT count(*) FROM tracker_analytics_v1.hand_contributions WHERE tournament_id='${tour}' AND settlement_evidence->>'policyEligible'='false';`),'201');
sql(`UPDATE public.tournaments SET deleted_at=NULL WHERE id='${tour}';`);
let firstLease;
const firstBatch=await processPublicHudJobs({async rpc(name,args){
 if(name==='process_public_hud_metadata_v1')firstLease={...args};
 return client.rpc(name,args);
}},1);
assert.equal(firstBatch.failed,0);assert.ok(firstLease);
assert.equal(sql("SELECT count(*) FROM tracker_analytics_v1.jobs WHERE kind='hand';"),'200');
assert.equal(sql(`SELECT progress_cursor FROM tracker_analytics_v1.jobs WHERE kind='visibility' AND entity_id='${tour}';`),'50000000-0000-4000-8000-000000000200');
assert.equal(sql(`SELECT count(*) FROM tracker_analytics_v1.visibility_barriers WHERE tournament_id='${tour}';`),'1');
// A source edit behind the checkpoint and a newly completed hand below it
// must survive source-job coalescing and a second hide/restore generation.
sql(`UPDATE public.tournament_hands SET source_revision=source_revision+1 WHERE id='${first}';
 INSERT INTO public.tournament_hands(id,tournament_id) VALUES('${late}','${tour}');
 INSERT INTO public.hand_players(hand_id,tournament_id,player_id,seat_number,starting_stack) VALUES('${late}','${tour}','${player}',1,1000);
 UPDATE public.tournaments SET deleted_at=now() WHERE id='${tour}';
 UPDATE public.tournaments SET deleted_at=NULL WHERE id='${tour}';`);
assert.equal(sql(`SELECT progress_cursor IS NULL FROM tracker_analytics_v1.jobs WHERE kind='visibility' AND entity_id='${tour}';`),'t');
assert.equal((await client.rpc('process_public_hud_metadata_v1',firstLease)).data,false);
assert.equal(sql(`SELECT count(*) FROM tracker_analytics_v1.visibility_barriers WHERE tournament_id='${tour}';`),'1');
await drain();
assert.equal(sql(`SELECT count(*) FROM tracker_analytics_v1.visibility_barriers WHERE tournament_id='${tour}';`),'0');
assert.equal(sql(`SELECT count(*) FROM tracker_analytics_v1.hand_contributions WHERE tournament_id='${tour}';`),'202');
const shadow=createShadow(await loadClassifier());
for(const line of sql(shadowSql).split('\n').filter(Boolean))shadow.accept(JSON.parse(line));
const report=shadow.finish();assert.equal(report.passed,true,JSON.stringify(report.examples));
console.log(JSON.stringify({kind:'NATIVE_TARGETED_RESTORE_200_ROW_CHECKPOINT_AND_SOURCE_WRITES',passed:true,
 sourceHands:report.sourceHands,contributions:report.contributions,mismatches:report.mismatches,
 fenceRejections:rpcRejections.filter(row=>row.reason==='fenced-publish'||row.reason.includes('lease_expired')).length,
 checks:['200of201-first-page','barrier-retained','source-edit-behind-cursor','new-hand-below-cursor','hide-restore-resets-cursor','old-lease-rejected','actual-worker-drain-and-independent-source-shadow'],
 limitations:'202synthetic hands,real native PostgreSQL/compiled worker;not HTTP/WS load or update5s qualification'}));
