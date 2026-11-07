import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {build} from 'esbuild';
import {initialize,sql,jsonSql,service} from './nativeDb.mjs';
import {createNativeWorkerClient} from './nativeRpc.mjs';
if(process.argv.includes('--initialize')){
 initialize();
 for(const path of ['tests/publicHud/spectator-generation.fixture.sql','tests/publicHud/scale-runtime.fixture.sql',
  'supabase/migrations/20261104001900_public_spectator_compact_generations.sql',
  'supabase/migrations/20261104002100_public_current_hand_bounded.sql'])sql(readFileSync(path,'utf8'));
 const baseline=readFileSync('supabase/pending-migrations/20270115000000_public_spectator_realtime_v2.sql','utf8');
 for(const [begin,end] of [['CREATE OR REPLACE FUNCTION public.claim_public_spectator_projection_v2','CREATE OR REPLACE FUNCTION public.get_public_spectator_projection_source_v2'],['CREATE OR REPLACE FUNCTION public.fail_public_spectator_projection_v2','CREATE OR REPLACE FUNCTION public.get_public_tournament_viewer_snapshot_v2']])sql(baseline.slice(baseline.indexOf(begin),baseline.indexOf(end)));
}
const migration=readFileSync('supabase/migrations/20261106144208_public_spectator_source_lease_outcome.sql','utf8');
const recovery=readFileSync('tests/publicHud/spectator-source-lease.forward-rollback.sql','utf8');
const strip=s=>s.replace(/^BEGIN;\r?\n/m,'').replace(/COMMIT;\s*$/,'');
const signature='public.get_public_spectator_projection_source_v2(uuid,text,uuid)';
const hash=()=>sql(`SELECT md5(replace(pg_get_functiondef('${signature}'::regprocedure),chr(13),''));`);
assert.equal(hash(),'e2f16d348b583a4071683e811383a96d');
const metadata=()=>jsonSql(`SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE oid='${signature}'::regprocedure;`);
const before=metadata();sql(migration);assert.deepEqual(metadata(),before);const candidate=hash();
const tour='10000000-0000-4000-8000-000000000071';
sql(`INSERT INTO public.tournaments(id) VALUES('${tour}');SELECT spectator_projection_v2.mark_dirty('${tour}','tables','fixture');`);
const source=token=>jsonSql(`${service} SELECT public.get_public_spectator_projection_source_v2('${tour}','tables','${token}');`);
const jobs=()=>jsonSql(`${service} SELECT public.claim_public_spectator_projection_v2(50);`);
const a=jobs().find(j=>j.tournament_id===tour&&j.component==='tables');assert.ok(a);
const valid=source(a.fencing_token);assert.ok(valid.sourceVector&&valid.payload);assert.equal(valid.fenced,undefined);
sql(`SELECT spectator_projection_v2.mark_dirty('${tour}','tables','newer');`);
const b=jobs().find(j=>j.tournament_id===tour&&j.component==='tables');assert.ok(b);assert.notEqual(a.fencing_token,b.fencing_token);
assert.deepEqual(source(a.fencing_token),{fenced:true});
assert.equal(jsonSql(`${service} SELECT to_jsonb(public.publish_public_spectator_projection_v2('${tour}','tables','component','${a.fencing_token}','${JSON.stringify(valid.sourceVector)}','{"items":[],"removed":[]}'));`),false);
assert.equal(sql(`SELECT fencing_token FROM spectator_projection_v2.work_groups WHERE tournament_id='${tour}' AND component='tables';`),b.fencing_token);
assert.throws(()=>sql(migration,{captureFailure:true}),/no active leases/);
sql(`UPDATE spectator_projection_v2.work_groups SET claimed_until=clock_timestamp()-interval '1 second' WHERE tournament_id='${tour}';`);
assert.deepEqual(source(b.fencing_token),{fenced:true});
// Execute the actual worker. A separate committed source writer invalidates its
// claim immediately before its real DB source RPC; a later worker must recover.
const compiled=await build({entryPoints:['supabase/functions/public-spectator-projector-v2/worker.ts'],bundle:true,write:false,platform:'node',format:'esm',logLevel:'silent'});
const {processPublicSpectatorJobs}=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const native=createNativeWorkerClient();let raced=false,stalePublishes=0,staleFailures=0;const trace=[];
const racing={async rpc(name,args){
 if(name==='get_public_spectator_projection_source_v2'&&!raced&&args.p_tournament_id===tour&&args.p_component==='tables'){raced=true;sql(`SELECT spectator_projection_v2.mark_dirty('${tour}','tables','concurrent');`);}
 if(raced&&name==='publish_public_spectator_projection_v2'&&args.p_tournament_id===tour&&args.p_component==='tables')stalePublishes++;
 if(raced&&name==='fail_public_spectator_projection_v2'&&args.p_tournament_id===tour&&args.p_component==='tables')staleFailures++;
 const reply=await native.rpc(name,args);
 if(args.p_tournament_id===tour&&args.p_component==='tables')trace.push({name,fenced:reply.data?.fenced===true,error:reply.error?['permission denied','lease_expired','source_pending'].find(reason=>String(reply.error).includes(reason))??'other':null});
 return reply;
}};
const first=await processPublicSpectatorJobs(racing,Date.now()+20000);
assert.equal(raced,true);assert.equal(stalePublishes,0,JSON.stringify(trace));assert.equal(staleFailures,0,JSON.stringify(trace));
assert.ok(first.results.some(r=>r.key.startsWith(tour)&&!r.published&&!r.error));
const second=await processPublicSpectatorJobs(native,Date.now()+20000);
assert.ok(second.results.some(r=>r.key.startsWith(tour)&&r.published&&!r.error));
// Two actual workers overlap: A owns the old claim, a source commit revokes it,
// B publishes the new generation, and A resumes without touching B's state.
sql(`SELECT spectator_projection_v2.mark_dirty('${tour}','tables','worker-a');`);
let heldResolve,releaseResolve;
const held=new Promise(resolve=>{heldResolve=resolve;}),release=new Promise(resolve=>{releaseResolve=resolve;});
const older=processPublicSpectatorJobs({async rpc(name,args){
 if(name==='get_public_spectator_projection_source_v2'&&args.p_tournament_id===tour&&args.p_component==='tables'){
  heldResolve();await release;
 }
 return native.rpc(name,args);
}},Date.now()+20000);
await held;
let newer;
try{
 sql(`SELECT spectator_projection_v2.mark_dirty('${tour}','tables','worker-b');`);
 newer=await processPublicSpectatorJobs(native,Date.now()+20000);
 assert.ok(newer.results.some(r=>r.key.startsWith(tour)&&r.published&&!r.error));
}finally{releaseResolve();}
const olderResult=await older;
assert.ok(olderResult.results.some(r=>r.key.startsWith(tour)&&!r.published&&!r.error));
assert.equal(sql(`SELECT count(*) FROM spectator_projection_v2.work_groups WHERE tournament_id='${tour}' AND component='tables';`),'0');
for(const role of ['anon','authenticated'])assert.throws(()=>sql(`SET ROLE ${role};SELECT public.get_public_spectator_projection_source_v2('${tour}','tables',gen_random_uuid());`,{captureFailure:true}),/permission denied/);
for(const role of ['anon','authenticated','service_role'])assert.throws(()=>sql(`SET ROLE ${role};SELECT * FROM spectator_projection_v2.source_lease_original_v1;`,{captureFailure:true}),/permission denied/);
assert.throws(()=>sql(`SET request.jwt.claim.role='authenticated';SELECT public.get_public_spectator_projection_source_v2('${tour}','tables',gen_random_uuid());`,{captureFailure:true}),/forbidden/);
assert.equal(sql(`BEGIN;${strip(recovery)}SELECT md5(replace(pg_get_functiondef('${signature}'::regprocedure),chr(13),''));ROLLBACK;`),'e2f16d348b583a4071683e811383a96d');
assert.equal(hash(),candidate);
const keys=['spectatorSourceLeaseOriginalMatches','spectatorSourceLeaseCandidateMatches','spectatorSourceLeaseBackupPrivate'];
const postcheck=readFileSync('scripts/ops/tracker-hud-20261104-postcheck.sql','utf8').split(/\r?\n/);
const expressions=keys.map(key=>{const found=postcheck.filter(line=>line.trimStart().startsWith(`'${key}',`));assert.equal(found.length,1);return found[0].trim().replace(/,$/,'');});
const checks=(change='')=>jsonSql(`BEGIN;${change}SELECT jsonb_build_object(${expressions.join(',')});ROLLBACK;`);
assert.deepEqual(Object.values(checks()),[true,true,true]);
assert.equal(checks("UPDATE spectator_projection_v2.source_lease_original_v1 SET original_definition_hash=repeat('0',32);").spectatorSourceLeaseOriginalMatches,false);
assert.equal(checks(`ALTER FUNCTION ${signature} VOLATILE;`).spectatorSourceLeaseCandidateMatches,false);
assert.equal(checks(`GRANT EXECUTE ON FUNCTION ${signature} TO anon;`).spectatorSourceLeaseCandidateMatches,false);
assert.equal(checks('GRANT SELECT ON spectator_projection_v2.source_lease_original_v1 TO anon;').spectatorSourceLeaseBackupPrivate,false);
for(const mutation of [`ALTER FUNCTION ${signature} VOLATILE;`,`GRANT EXECUTE ON FUNCTION ${signature} TO anon;`]){
 assert.throws(()=>sql(`BEGIN;${strip(recovery)}DROP TABLE spectator_projection_v2.source_lease_original_v1;${mutation}${strip(migration)}ROLLBACK;`,{captureFailure:true}),/preimage differs/);
}
console.log(JSON.stringify({kind:'NATIVE_SPECTATOR_SOURCE_LEASE_RACE',passed:true,originalHash:'e2f16d348b583a4071683e811383a96d',candidateHash:candidate,
 checks:['metadata-ACL-OID-preserved','valid-source','superseded-token-no-payload','expired-token-no-payload','stale-publish-denied','new-lease-preserved','actual-worker-source-race','later-worker-publishes','two-overlapping-workers','actor-denied','backup-private','active-lease-guard','drift-guards','release-object-postchecks-and-tamper','exact-recovery'],productionChanged:false,qualification:false}));
