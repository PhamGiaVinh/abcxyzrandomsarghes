import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {build} from 'esbuild';
import {initialize,sql,sqlAsync,jsonSql,service} from './nativeDb.mjs';
import {createNativeWorkerClient} from './nativeRpc.mjs';
initialize();
for(const file of ['tests/publicHud/spectator-generation.fixture.sql','tests/publicHud/scale-runtime.fixture.sql',
 'supabase/migrations/20261104001900_public_spectator_compact_generations.sql',
 'supabase/migrations/20261104002100_public_current_hand_bounded.sql'])sql(readFileSync(file,'utf8'));
const original=readFileSync('supabase/pending-migrations/20270115000000_public_spectator_realtime_v2.sql','utf8');
for(const [begin,end] of [['CREATE OR REPLACE FUNCTION public.claim_public_spectator_projection_v2','CREATE OR REPLACE FUNCTION public.get_public_spectator_projection_source_v2'],
 ['CREATE OR REPLACE FUNCTION public.fail_public_spectator_projection_v2','CREATE OR REPLACE FUNCTION public.get_public_tournament_viewer_snapshot_v2']])sql(original.slice(original.indexOf(begin),original.indexOf(end)));
sql(readFileSync('supabase/migrations/20261106144208_public_spectator_source_lease_outcome.sql','utf8'));
const migration=readFileSync('supabase/migrations/20270128000343_spectator_pending_source_outcome.sql','utf8');
const recovery=readFileSync('tests/publicHud/spectator-source-pending.forward-rollback.sql','utf8');
const strip=s=>s.replace(/^BEGIN;\r?\n/m,'').replace(/COMMIT;\s*$/,'');
const signature='public.get_public_spectator_projection_source_v2(uuid,text,uuid)';
const hash=()=>sql(`SELECT md5(replace(pg_get_functiondef('${signature}'::regprocedure),chr(13),''));`);
const metadata=()=>jsonSql(`SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE oid='${signature}'::regprocedure;`);
const baselineHash=hash(),before=metadata();assert.equal(baselineHash,'0557076e4866159dc1095c5257ceb7c6');
const bundle=await build({entryPoints:['supabase/functions/public-spectator-projector-v2/worker.ts'],bundle:true,write:false,platform:'node',format:'esm',logLevel:'silent'});
const {processPublicSpectatorJobs}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const native=createNativeWorkerClient(),tour='10000000-0000-4000-8000-000000000072';
sql(`INSERT INTO public.tournaments(id) VALUES('${tour}');`);
let lockSequence=343000;
async function pendingRace(){
 let raced=false,publishes=0,failures=0,sourceReply,fixtureFailure;
 const result=await processPublicSpectatorJobs({async rpc(name,args){
  const target=args.p_tournament_id===tour&&args.p_component==='visibility';
  if(name==='get_public_spectator_projection_source_v2'&&target&&!raced){
   raced=true;const key=++lockSequence;
   // A separate transaction holds the generation advisory lock. A real source
   // UPDATE must commit through the durable deferred path while our claim lives.
   const holder=sqlAsync(`BEGIN;SELECT pg_advisory_xact_lock(hashtextextended('public-gen:${tour}',0));SELECT pg_advisory_xact_lock(${key});SELECT pg_sleep(2);COMMIT;`);
   try{
    let ready=false;
    for(let i=0;i<40;i++){
     if(sql(`SELECT pg_try_advisory_xact_lock(${key});`)==='f'){ready=true;break;}
     await new Promise(resolve=>setTimeout(resolve,25));
    }
    assert.ok(ready,'Separate source-lock holder must be ready');
    sql(`SET lock_timeout='250ms';UPDATE public.tournaments SET deleted_at=clock_timestamp() WHERE id='${tour}' AND deleted_at IS NULL;`);
    assert.equal(sql(`SELECT count(*) FROM spectator_projection_v2.deferred_generations_v1 WHERE tournament_id='${tour}' AND component='visibility';`),'1');
    sourceReply=await native.rpc(name,args);return sourceReply;
   }catch(error){fixtureFailure=error;throw error;}finally{await holder;}
  }
  if(target&&name==='publish_public_spectator_projection_v2')publishes++;
  if(target&&name==='fail_public_spectator_projection_v2')failures++;
  return native.rpc(name,args);
 }},Date.now()+20000);
 // The production worker catches job failures. Fixture/setup assertions must
 // still surface directly, rather than masquerading as the expected DB error.
 if(fixtureFailure)throw fixtureFailure;
 assert.equal(raced,true);
 assert.equal(publishes,0,'No publication may cross a pending source barrier');
 assert.equal(sql(`SELECT count(*) FROM spectator_projection_v2.deferred_generations_v1 WHERE tournament_id='${tour}' AND component='visibility';`),'1');
 return {result,failures,sourceReply};
}
const baseline=await pendingRace();
assert.match(String(baseline.sourceReply.error),/source_pending/);
assert.equal(baseline.failures,1);
assert.ok(baseline.result.results.some(row=>row.key.startsWith(tour)&&row.error==='source_failed'));
const drain=async()=>{
 const value=await processPublicSpectatorJobs(native,Date.now()+20000);
 assert.ok(value.results.some(row=>row.key.startsWith(tour)&&row.published&&!row.error));
 assert.equal(sql(`SELECT count(*) FROM spectator_projection_v2.deferred_generations_v1 WHERE tournament_id='${tour}';`),'0');
 assert.equal(sql(`SELECT count(*) FROM spectator_projection_v2.work_groups WHERE tournament_id='${tour}';`),'0');
};
await drain();
assert.throws(()=>sql(`BEGIN;SET ROLE service_role;${migration}ROLLBACK;`,{captureFailure:true}),/permission denied|preimage_or_lease_drift/);
sql(migration);const candidateHash=hash();assert.notEqual(candidateHash,baselineHash);assert.deepEqual(metadata(),before);
assert.throws(()=>sql(migration,{captureFailure:true}),/preimage_or_lease_drift/);
sql(`UPDATE public.tournaments SET deleted_at=NULL WHERE id='${tour}' AND deleted_at IS NOT NULL;`);
const candidate=await pendingRace();
assert.deepEqual(candidate.sourceReply,{data:{fenced:true},error:null});
assert.equal(candidate.failures,0);
assert.ok(candidate.result.results.some(row=>row.key.startsWith(tour)&&!row.published&&!row.error));
assert.equal(sql(`SELECT count(*) FROM spectator_projection_v2.work_groups WHERE tournament_id='${tour}' AND component='visibility' AND claimed_until>clock_timestamp() AND fencing_token IS NOT NULL;`),'1','No-op retains durable claim for next absorption');
assert.throws(()=>sql(recovery,{captureFailure:true}),/active_lease/);
await drain();
// Force the startup flush to finish before absorption starts. Both operations
// are real independent SQL transactions; the gate only controls their order.
// Source revocation must already be authoritative, and notifications created
// later by absorption must survive for final flush or the next dispatcher.
async function startupOutboxRace(exhaustDeadline){
 sql(`UPDATE public.tournaments SET deleted_at=NULL WHERE id='${tour}' AND deleted_at IS NOT NULL;`);
 await processPublicSpectatorJobs(native,Date.now()+20000);
 const key=++lockSequence;
 const holder=sqlAsync(`BEGIN;SELECT pg_advisory_xact_lock(hashtextextended('public-gen:${tour}',0));SELECT pg_advisory_xact_lock(${key});SELECT pg_sleep(2);COMMIT;`);
 try{
  let ready=false;
  for(let i=0;i<40;i++){
   if(sql(`SELECT pg_try_advisory_xact_lock(${key});`)==='f'){ready=true;break;}
   await new Promise(resolve=>setTimeout(resolve,25));
  }
  assert.ok(ready,'Withdrawal source lock must be ready');
  sql(`SET lock_timeout='250ms';UPDATE public.tournaments SET deleted_at=clock_timestamp() WHERE id='${tour}' AND deleted_at IS NULL;`);
  assert.equal(jsonSql(`SET ROLE anon;SELECT public.get_public_tournament_viewer_snapshot_v2('${tour}','{}',ARRAY['tables'],'{}');`).access,'revoked');
 }finally{await holder;}
 assert.equal(sql(`SELECT count(*) FROM spectator_projection_v2.deferred_generations_v1 WHERE tournament_id='${tour}' AND component='visibility';`),'1');
 let releaseFlush,absorbStarted=false,firstFlush=true,afterAbsorb=0,fixtureError;
 const flushed=new Promise(resolve=>{releaseFlush=resolve;});
 const originalNow=Date.now,deadline=Date.now()+20000;
 const messagesBefore=Number(sql(`SELECT count(*) FROM realtime.fixture_messages WHERE event='changed' AND payload->>'tournamentId'='${tour}';`));
 const client={async rpc(name,args){
  try{
   if(name==='absorb_public_spectator_generations_v2'){
    absorbStarted=true;await flushed;
    const reply=await native.rpc(name,args);
    afterAbsorb=Number(sql(`SELECT count(*) FROM spectator_projection_v2.broadcast_pending_v1 WHERE tournament_id='${tour}' AND component='visibility';`));
    assert.ok(afterAbsorb>0,'Post-flush absorption notification must remain durable');
    // Logical budget exhaustion only, not a claim about wall-clock capacity.
    if(exhaustDeadline)Date.now=()=>deadline;
    return reply;
   }
   if(name==='flush_public_spectator_broadcast_v2'&&firstFlush){
    firstFlush=false;
    try{assert.equal(absorbStarted,true);return await native.rpc(name,args);}
    finally{releaseFlush();}
   }
   if(name==='claim_public_spectator_projection_v2')assert.ok(afterAbsorb>0);
   return await native.rpc(name,args);
  }catch(error){fixtureError=error;throw error;}
 }};
 let result;
 try{
  if(exhaustDeadline)await assert.rejects(processPublicSpectatorJobs(client,deadline),/deadline_exceeded/);
  else result=await processPublicSpectatorJobs(client,deadline);
 }finally{Date.now=originalNow;}
 if(fixtureError)throw fixtureError;
 if(exhaustDeadline){
  assert.ok(Number(sql(`SELECT count(*) FROM spectator_projection_v2.broadcast_pending_v1 WHERE tournament_id='${tour}';`))>0);
  // Duplicate following workers must drain the same durable work safely.
  const recovered=await Promise.allSettled([processPublicSpectatorJobs(native,Date.now()+20000),processPublicSpectatorJobs(native,Date.now()+20000)]);
  assert.ok(recovered.every(value=>value.status==='fulfilled'&&value.value.results.every(row=>!row.error)));
 }else assert.ok(result.results.some(row=>row.key.startsWith(tour)&&row.published&&!row.error));
 assert.equal(sql(`SELECT count(*) FROM spectator_projection_v2.broadcast_pending_v1 WHERE tournament_id='${tour}';`),'0');
 assert.equal(sql(`SELECT count(*) FROM spectator_projection_v2.work_groups WHERE tournament_id='${tour}';`),'0');
 assert.ok(Number(sql(`SELECT count(*) FROM realtime.fixture_messages WHERE event='changed' AND payload->>'tournamentId'='${tour}';`))>=messagesBefore+2);
 assert.equal(jsonSql(`SET ROLE anon;SELECT public.get_public_tournament_viewer_snapshot_v2('${tour}','{}',ARRAY['tables'],'{}');`).access,'revoked');
}
await startupOutboxRace(false);
await startupOutboxRace(true);
for(const mutation of [`GRANT EXECUTE ON FUNCTION ${signature} TO anon;`,`ALTER FUNCTION ${signature} VOLATILE;`]){
 assert.throws(()=>sql(`BEGIN;${mutation}${strip(recovery)}ROLLBACK;`,{captureFailure:true}),/metadata_drift/);
}
for(const role of ['anon','authenticated','service_role'])assert.throws(()=>sql(`SET ROLE ${role};SELECT * FROM spectator_projection_v2.source_pending_original_v1;`,{captureFailure:true}),/permission denied/);
for(const role of ['anon','authenticated'])assert.throws(()=>sql(`SET ROLE ${role};SELECT public.get_public_spectator_projection_source_v2('${tour}','visibility',gen_random_uuid());`,{captureFailure:true}),/permission denied/);
assert.throws(()=>sql(`SET request.jwt.claim.role='authenticated';SELECT public.get_public_spectator_projection_source_v2('${tour}','visibility',gen_random_uuid());`,{captureFailure:true}),/forbidden/);
sql(recovery);assert.equal(hash(),baselineHash);assert.deepEqual(metadata(),before);
console.log(JSON.stringify({kind:'NATIVE_PENDING_SOURCE_ACTUAL_WORKER_RACE_NOT_HTTP_LOAD',passed:true,baselineHash,candidateHash,
 checks:['baseline-real-source-pending-worker-failure','source-update-commits-during-advisory-lock','candidate-no-payload-no-publish-no-failure','deferred-work-retained','later-worker-absorbs-and-publishes','parallel-startup-post-flush-absorption-retained','source-withdrawal-immediately-revoked','final-flush-delivers-later-notification','logical-deadline-retains-outbox','following-duplicate-workers-recover','metadata-preserved','actor-denied','backup-private','repeat-apply-denied','active-lease-recovery-denied','exact-recovery'],productionChanged:false,qualification:false}));
