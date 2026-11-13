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
// Additive bounded source batch candidate; worker remains on the original API
// until native contracts and the separate wave/deadline tests are established.
const batchSignature='public.get_public_spectator_projection_sources_v2(jsonb)';
const batchMigration=readFileSync('supabase/pending-migrations/20270128000344_spectator_bounded_source_batch.sql','utf8');
const batchReverse=readFileSync('tests/publicHud/spectator-source-batch.rollback.sql','utf8');
sql(batchMigration);
assert.throws(()=>sql(batchMigration,{captureFailure:true}),/preimage_drift/);
const batchProof=jsonSql(`BEGIN;
 INSERT INTO public.tournaments(id) SELECT ('10000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid FROM generate_series(91,96) i;
 SET LOCAL request.jwt.claim.role='service_role';
 CREATE TEMP TABLE batch_claims AS WITH claimed AS MATERIALIZED (SELECT public.claim_public_spectator_projection_v2(6) jobs)
 SELECT jsonb_agg(jsonb_build_object('tournament_id',item->'tournament_id','component',item->'component','fencing_token',item->'fencing_token')) jobs
 FROM claimed CROSS JOIN LATERAL jsonb_array_elements(claimed.jobs) item;
 GRANT SELECT ON batch_claims TO service_role;
 SET LOCAL ROLE service_role;
 SELECT jsonb_build_object('count',(SELECT jsonb_array_length(jobs) FROM batch_claims),
 'equal',(SELECT public.get_public_spectator_projection_sources_v2(jobs)=(SELECT jsonb_agg(item||jsonb_build_object('source',public.get_public_spectator_projection_source_v2((item->>'tournament_id')::uuid,item->>'component',(item->>'fencing_token')::uuid))) FROM jsonb_array_elements(jobs) item) FROM batch_claims),
 'wrongTokenFenced',(SELECT public.get_public_spectator_projection_sources_v2(jsonb_build_array((jobs->0)||jsonb_build_object('fencing_token',gen_random_uuid())))->0->'source'='{"fenced":true}'::jsonb FROM batch_claims));
 ROLLBACK;`);
assert.equal(batchProof.count,6);assert.equal(batchProof.equal,true);assert.equal(batchProof.wrongTokenFenced,true);
const budgetProof=[];
for(const characters of [530000,300000]){
 const measured=jsonSql(`BEGIN;
 CREATE TEMP TABLE large_scopes AS SELECT gen_random_uuid() id FROM generate_series(1,6);
 INSERT INTO public.tournaments(id) SELECT id FROM large_scopes;
 INSERT INTO public.tournament_tables(id,tournament_id,table_name) SELECT gen_random_uuid(),id,repeat('é',${characters}) FROM large_scopes;
 SELECT spectator_projection_v2.mark_dirty(id,'tables','generation','component') FROM large_scopes;
 SET LOCAL request.jwt.claim.role='service_role';
 CREATE TEMP TABLE large_claims AS WITH claimed AS MATERIALIZED (SELECT public.claim_public_spectator_projection_v2(50) jobs)
 SELECT jsonb_agg(jsonb_build_object('tournament_id',item->'tournament_id','component',item->'component','fencing_token',item->'fencing_token')) jobs
 FROM claimed CROSS JOIN LATERAL jsonb_array_elements(claimed.jobs) item WHERE item->>'component'='tables';
 GRANT SELECT ON large_claims TO service_role;SET LOCAL ROLE service_role;
 WITH reads AS MATERIALIZED (SELECT jobs,public.get_public_spectator_projection_sources_v2(jobs) batch FROM large_claims)
 SELECT jsonb_build_object('count',jsonb_array_length(jobs),'batchBytes',octet_length(convert_to(batch::text,'UTF8')),
 'individualCount',(SELECT count(*) FROM jsonb_array_elements(batch) item WHERE item->'requiresIndividual'='true'::jsonb),
 'sourceCount',(SELECT count(*) FROM jsonb_array_elements(batch) item WHERE item ? 'source'),
 'singleBytes',octet_length(convert_to(public.get_public_spectator_projection_source_v2((jobs->0->>'tournament_id')::uuid,'tables',(jobs->0->>'fencing_token')::uuid)::text,'UTF8')))
 FROM reads;ROLLBACK;`);
 assert.equal(measured.count,6);assert.ok(measured.batchBytes<=1048576);assert.ok(measured.singleBytes>characters*2);
 assert.equal(measured.sourceCount+measured.individualCount,6,'Budget fixtures must not hide source errors');
 if(characters===530000)assert.equal(measured.individualCount,6);
 else{assert.ok(measured.individualCount>0);assert.ok(measured.sourceCount>0);}
 budgetProof.push({characters,...measured});
}
const validJob={tournament_id:tour,component:'visibility',fencing_token:'00000000-0000-4000-8000-000000000001'};
for(const invalid of [null,{},[],Array(7).fill(validJob),[validJob,validJob],[{...validJob,extra:true}],
 [{...validJob,tournament_id:'bad'}],[{...validJob,fencing_token:null}],[{...validJob,component:'clock'}]]){
 const encoded=JSON.stringify(invalid).replaceAll("'","''");
 assert.throws(()=>sql(`${service}SELECT ${batchSignature.replace('(jsonb)',`('${encoded}'::jsonb)`)};`,{captureFailure:true}),/invalid_source_batch|duplicate_source_batch_job/);
}
for(const role of ['anon','authenticated'])assert.throws(()=>sql(`SET ROLE ${role};SELECT public.get_public_spectator_projection_sources_v2('[]');`,{captureFailure:true}),/permission denied/);
for(const role of ['authenticated',''])assert.throws(()=>sql(`SET request.jwt.claim.role='${role}';SELECT public.get_public_spectator_projection_sources_v2('[]');`,{captureFailure:true}),/forbidden/);
sql(`INSERT INTO public.tournaments(id) VALUES('10000000-0000-4000-8000-000000000093'),('10000000-0000-4000-8000-000000000094');
 SELECT spectator_projection_v2.mark_dirty(t.id,c,'generation','component') FROM public.tournaments t CROSS JOIN unnest(ARRAY['tables','ranking','payout','visibility']) c
 WHERE t.id IN ('10000000-0000-4000-8000-000000000093','10000000-0000-4000-8000-000000000094');`);
const batchComponents=new Set(),batchWaveSizes=[];
const batchClient={async rpc(name,args){
 if(name==='get_public_spectator_projection_sources_v2'){
  batchWaveSizes.push(args.p_jobs.length);for(const job of args.p_jobs)batchComponents.add(job.component);
 }
 return native.rpc(name,args);
}};
const batchWorkerResult=await processPublicSpectatorJobs(batchClient,Date.now()+20000,'batch');
assert.equal(batchWorkerResult.processed,8);assert.ok(batchWorkerResult.results.every(row=>row.published&&!row.error));
assert.deepEqual([...batchComponents].sort(),['payout','ranking','tables','visibility']);
assert.deepEqual(batchWaveSizes,[6,2]);
assert.equal(sql(`SELECT count(*) FROM spectator_projection_v2.work_groups WHERE tournament_id IN ('10000000-0000-4000-8000-000000000093','10000000-0000-4000-8000-000000000094');`),'0');
assert.throws(()=>sql(`BEGIN;GRANT EXECUTE ON FUNCTION ${batchSignature} TO anon;${strip(batchReverse)}ROLLBACK;`,{captureFailure:true}),/rollback_drift/);
sql(batchReverse);assert.equal(sql(`SELECT to_regprocedure('${batchSignature}') IS NULL;`),'t');
assert.equal(hash(),candidateHash);assert.deepEqual(metadata(),before);
console.log(JSON.stringify({kind:'NATIVE_SOURCE_BATCH_ENVELOPE_AND_CANONICAL_PARITY',...batchProof,budgetProof,batchWaveSizes,allFourComponents:true,actorDenied:true,envelopeDenied:true,repeatDenied:true,exactReverse:true,productionChanged:false,qualification:false}));
sql(recovery);assert.equal(hash(),baselineHash);assert.deepEqual(metadata(),before);
console.log(JSON.stringify({kind:'NATIVE_PENDING_SOURCE_ACTUAL_WORKER_RACE_NOT_HTTP_LOAD',passed:true,baselineHash,candidateHash,
 checks:['baseline-real-source-pending-worker-failure','source-update-commits-during-advisory-lock','candidate-no-payload-no-publish-no-failure','deferred-work-retained','later-worker-absorbs-and-publishes','parallel-startup-post-flush-absorption-retained','source-withdrawal-immediately-revoked','final-flush-delivers-later-notification','logical-deadline-retains-outbox','following-duplicate-workers-recover','metadata-preserved','actor-denied','backup-private','repeat-apply-denied','active-lease-recovery-denied','exact-recovery'],productionChanged:false,qualification:false}));
