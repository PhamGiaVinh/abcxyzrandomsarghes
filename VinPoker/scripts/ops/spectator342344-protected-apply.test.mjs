import test from 'node:test';
import assert from 'node:assert/strict';
import {loadPackage} from './spectator342344-release-plan.mjs';
import {executePackage,postcheckSql,pausedSql,classifyPaused,classifyPostcheck} from './spectator342344-protected-apply.mjs';
const root=process.env.RELEASE_SOURCE_ROOT;
assert.ok(root,'Qualified source root required');
const pkg=loadPackage(root),ok={marker:true,source:true,batch:true,recovery:true};
function fixture({failAt,unknownReceipt=false,postFailure=false,lostPauseAt}={}){
 const committed=new Set(),writes=[],events=[];
 const transport={
  execute(sql){
   const e=pkg.entries.find(e=>e.atomic===sql);assert.ok(e);
   writes.push(e.version);
   if(e.version===failAt){if(unknownReceipt)committed.add(e.version);throw Error('fixed simulated transport fault');}
   committed.add(e.version);
  },
  json(sql){
   if(sql===pausedSql())return{paused:!(lostPauseAt===writes.length),hudPreserved:true,leasesDrained:true};
   if(sql.includes("'count',count(*)")){
    const e=pkg.entries.find(e=>sql.includes(`WHERE version='${e.version}'`));assert.ok(e);
    return{count:committed.has(e.version)?1:0,exact:committed.has(e.version)};
   }
   assert.ok(sql.startsWith('BEGIN READ ONLY;'));
   return postFailure?{...ok,batch:false}:ok;
  }
 };
 return{transport,writes,events,run:()=>executePackage(root,transport,e=>events.push(e))};
}
test('three ordered atomic writes with verified receipts and objects, no resume',()=>{
 const f=fixture();assert.deepEqual(f.run(),{kind:'SPECTATOR342344_DATABASE_VERIFIED',dispatcherStillPaused:true});
 assert.deepEqual(f.writes,pkg.entries.map(e=>e.version));
 assert.equal(f.events.length,3);
});
test('middle failure reports exact committed subset and never writes downstream',()=>{
 const f=fixture({failAt:pkg.entries[1].version});
 assert.throws(f.run,/partial-outcome/);
 assert.equal(f.writes.length,2);
 const event=f.events.at(-1);
 assert.equal(event.kind,'STOP_NO_RETRY_NO_RESUME');
 assert.deepEqual(event.observed.map(e=>e.receipt),['committed-exact','not-recorded','not-recorded']);
 assert.equal(event.currentObjectPhase,342);
});
test('lost response inspects durable receipt rather than replaying write',()=>{
 const f=fixture({failAt:pkg.entries[1].version,unknownReceipt:true});
 assert.throws(f.run,/partial-outcome/);assert.equal(f.writes.length,2);
 assert.deepEqual(f.events.at(-1).observed.map(e=>e.receipt),['committed-exact','committed-exact','not-recorded']);
 assert.equal(f.events.at(-1).currentObjectPhase,343);
});
test('failed object check stops after committed migration',()=>{
 const f=fixture({postFailure:true});assert.throws(f.run,/partial-outcome/);
 assert.equal(f.writes.length,1);assert.equal(f.events.at(-1).objects,'not-verified');
});
test('dispatcher activation between migrations prevents next write and reports subset',()=>{
 const f=fixture({lostPauseAt:1});assert.throws(f.run,/partial-outcome/);
 assert.equal(f.writes.length,1);assert.equal(f.events.at(-1).failedAt,pkg.entries[1].version);
});
test('failed final paused observation reports all committed receipts without retry',()=>{
 const f=fixture({lostPauseAt:3});assert.throws(f.run,/partial-outcome/);
 assert.equal(f.writes.length,3);
 const event=f.events.at(-1);
 assert.equal(event.kind,'STOP_NO_RETRY_NO_RESUME');
 assert.deepEqual(event.observed.map(e=>e.receipt),['committed-exact','committed-exact','committed-exact']);
 assert.equal(event.currentObjectPhase,344);
});
test('paused, lease, unrelated HUD dispatcher and all object checks are mandatory',()=>{
 for(const key of ['paused','hudPreserved','leasesDrained']){
  assert.throws(()=>classifyPaused({paused:true,hudPreserved:true,leasesDrained:true,[key]:false}));
 }
 for(const key of Object.keys(ok))assert.throws(()=>classifyPostcheck({...ok,[key]:false}));
 for(const phase of [342,343,344])assert.match(postcheckSql(pkg,phase),/^BEGIN READ ONLY;/);
 assert.throws(()=>postcheckSql(pkg,345));
});
