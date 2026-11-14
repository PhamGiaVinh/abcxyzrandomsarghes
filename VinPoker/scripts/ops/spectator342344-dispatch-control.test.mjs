import test from 'node:test';
import assert from 'node:assert/strict';
import {loadPackage} from './spectator342344-release-plan.mjs';
import {pausedSql} from './spectator342344-protected-apply.mjs';
import {applyAfterVerifiedPlan,pauseSql,resumeSql,activeSql,drainSql} from './spectator342344-dispatch-control.mjs';
import {PRIOR_EDGE,validatePriorEdge,verifyPriorEdge} from './spectator342344-production.mjs';
const sourceRoot=process.env.RELEASE_SOURCE_ROOT;assert.ok(sourceRoot);const pkg=loadPackage(sourceRoot);
function fixture({busyUntil=0,failApply=false,edgeDrift=false,lostPause=false}={}){
 let clock=0,paused=false,edgeChecks=0;const committed=new Set(),events=[],writes=[],resumes=[];
 const transport={execute(sql){const e=pkg.entries.find(x=>x.atomic===sql);assert.ok(e);writes.push(e.version);if(failApply)throw Error('fixed simulated failure');committed.add(e.version);},
  json(sql){
   if(sql===pauseSql()){paused=true;return{paused:true,pauseXmin:'123'};}
   if(sql===resumeSql('123')){assert.ok(paused);resumes.push(clock);paused=false;return{resumed:true};}
   if(sql===activeSql())return{exact:!paused};
   if(sql===pausedSql())return{paused:paused&&!lostPause,hudPreserved:true,leasesDrained:clock>=busyUntil};
   if(sql===drainSql())return{leaseCount:clock<busyUntil?1:0,queuedRequests:clock<busyUntil?1:0,activeCalls:clock<busyUntil?1:0};
   if(sql.includes("'count',count(*)")){const e=pkg.entries.find(e=>sql.includes(`WHERE version='${e.version}'`));assert.ok(e);return{count:committed.has(e.version)?1:0,exact:committed.has(e.version)};}
   return{marker:true,source:true,batch:true,recovery:true};
  }};
 const args={sourceRoot,transport,verifyPriorEdge:async()=>{edgeChecks++;if(edgeDrift)throw Error('worker changed');},
  report:event=>events.push(event),sleep:async ms=>{clock+=ms;},now:()=>clock};
 return{run:()=>applyAfterVerifiedPlan(args),events,writes,resumes,get paused(){return paused;},get edgeChecks(){return edgeChecks;}};
}
test('drain includes12quietseconds after last active work, then commits and resumes owned job',async()=>{
 const f=fixture({busyUntil:5000});const result=await f.run();
 assert.equal(result.dispatcherStillPaused,false);assert.equal(f.writes.length,3);assert.equal(f.resumes.length,1);
 assert.ok(f.resumes[0]>=16500);assert.equal(f.paused,false);assert.equal(f.edgeChecks,1);
});
test('bounded drain timeout leaves paused and performs no migration',async()=>{
 const f=fixture({busyUntil:100000});await assert.rejects(f.run,/Protected spectator phase stopped/);
 assert.equal(f.writes.length,0);assert.equal(f.resumes.length,0);assert.equal(f.paused,true);
 assert.equal(f.events.at(-1).phase,'drain');
});
test('partial or unknown write outcome never resumes or writes downstream',async()=>{
 const f=fixture({failApply:true});await assert.rejects(f.run);
 assert.equal(f.writes.length,1);assert.equal(f.resumes.length,0);assert.equal(f.paused,true);
 assert.ok(f.events.some(e=>e.kind==='STOP_NO_RETRY_NO_RESUME'));
});
test('worker drift after verified DB commits prevents resume',async()=>{
 const f=fixture({edgeDrift:true});await assert.rejects(f.run);
 assert.equal(f.writes.length,3);assert.equal(f.resumes.length,0);assert.equal(f.paused,true);
 assert.equal(f.events.at(-1).phase,'verify-prior-worker');
 assert.deepEqual(f.events.at(-1).observed.map(x=>x.receipt),['committed-exact','committed-exact','committed-exact']);
 assert.equal(f.events.at(-1).objects,'verified');
});
test('lost pause ownership and untrusted resume token are rejected',async()=>{
 const f=fixture({lostPause:true});await assert.rejects(f.run);assert.equal(f.writes.length,0);
 for(const token of ['',"1';SELECT1",'-1',null])assert.throws(()=>resumeSql(token));
});
test('only exact actual v12 deployment metadata is accepted; request errors stop',async()=>{
 validatePriorEdge(PRIOR_EDGE);
 for(const key of Object.keys(PRIOR_EDGE))assert.throws(()=>validatePriorEdge({...PRIOR_EDGE,[key]:null}));
 const env={SUPABASE_PROJECT_REF:'orlesggcjamwuknxwcpk',SUPABASE_ACCESS_TOKEN:'synthetic-unit-only'};
 await verifyPriorEdge(env,async(url,init)=>{assert.equal(url,'https://api.supabase.com/v1/projects/orlesggcjamwuknxwcpk/functions/public-spectator-projector-v2');assert.ok(init.signal);return{status:200,json:async()=>PRIOR_EDGE};});
 await assert.rejects(()=>verifyPriorEdge(env,async()=>({status:403,json:async()=>PRIOR_EDGE})));
});
test('drain observes both startup RPCs as well as claim/publication lifecycle',()=>{
 for(const name of ['absorb_public_spectator_generations_v2','flush_public_spectator_broadcast_v2','claim_public_spectator_projection_v2','get_public_spectator_projection_source_v2','publish_public_spectator_projection_v2','fail_public_spectator_projection_v2'])assert.ok(drainSql().includes(name));
});
