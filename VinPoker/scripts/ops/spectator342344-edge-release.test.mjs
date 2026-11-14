import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,copyFileSync,writeFileSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {runEdgeRelease,verifySecret,verifyPhaseA,verifyDownloaded} from './spectator342344-edge-release.mjs';
import {PRIOR_EDGE} from './spectator342344-production.mjs';
import {loadPackage} from './spectator342344-release-plan.mjs';
const root=process.env.RELEASE_SOURCE_ROOT;assert.ok(root);const{manifest}=loadPackage(root);
function fixture(fail){
 const writes=[],events=[];let deployed=false,flag='0',reads=0;
 const after={...PRIOR_EDGE,version:13,ezbr_sha256:'a'.repeat(64)};
 return{writes,events,run:()=>runEdgeRelease({manifest,
  management:async(method,path,body)=>{if(path==='secrets'){if(method==='POST'){flag=body[0].value;writes.push(flag);return;}return[{name:'PUBLIC_SPECTATOR_SOURCE_BATCH',value:flag}];}return deployed?after:PRIOR_EDGE;},
  cli:args=>{assert.equal(flag,'0');assert.equal(args[0],'functions');if(fail==='deploy')throw Error('fixed');deployed=true;},
  verifyDatabase:async()=>{reads++;if(fail==='database'&&reads===2)throw Error('fixed');},
  readDownloaded:async()=>{assert.equal(flag,'0');if(fail==='closure')throw Error('fixed');},
  denied:async()=>fail==='auth'?200:401,report:e=>events.push(e)})};
}
test('batch1 follows exact source, metadata, database and auth verification at batch0',async()=>{const f=fixture();assert.deepEqual(await f.run(),{version:13,batch:'1'});assert.deepEqual(f.writes,['0','1']);assert.equal(f.events.at(-1).kind,'SPECTATOR_BATCH_EDGE_IDENTITY_AND_CONFIGURATION_VERIFIED_RUNTIME_OBSERVATION_REQUIRED');});
test('deploy, closure, database or auth failure stops and verifies batch0 without retry',async()=>{for(const failure of ['deploy','closure','database','auth']){const f=fixture(failure);await assert.rejects(f.run);assert.ok(!f.writes.includes('1'));assert.equal(f.writes.at(-1),'0');assert.equal(f.events.at(-1).batchDisabledVerified,true);}});
test('secret verification rejects missing, ambiguous or mismatching values',()=>{for(const flag of ['0','1']){verifySecret([{name:'PUBLIC_SPECTATOR_SOURCE_BATCH',value:flag}],flag);verifySecret([{name:'PUBLIC_SPECTATOR_SOURCE_BATCH',value:createHash('sha256').update(flag).digest('hex')}],flag);}for(const rows of [[],[{name:'PUBLIC_SPECTATOR_SOURCE_BATCH',value:'other'}],[{name:'PUBLIC_SPECTATOR_SOURCE_BATCH',value:'1'},{name:'PUBLIC_SPECTATOR_SOURCE_BATCH',value:'1'}]])assert.throws(()=>verifySecret(rows,'1'));});
test('only all three exact committed receipts with resumed dispatcher qualify',()=>{const rows=manifest.migrations.map(m=>({kind:'COMMITTED_EXACT_OBJECTS_VERIFIED',version:m.version,sha256:m.sha256}));rows.push({kind:'SPECTATOR342344_RESUMED_WITH_VERIFIED_PRIOR_SINGLE_WORKER'},{kind:'SPECTATOR342344_DATABASE_VERIFIED',dispatcherStillPaused:false,workerMode:'prior-v12-single'});const encode=r=>r.map(x=>JSON.stringify(x)).join('\n');verifyPhaseA(encode(rows),manifest);for(const mutate of [r=>r.shift(),r=>r[0].sha256='b'.repeat(64),r=>r.at(-1).dispatcherStillPaused=true]){const r=structuredClone(rows);mutate(r);assert.throws(()=>verifyPhaseA(encode(r),manifest));}});

test('downloaded closure must contain exactly the seven reviewed files and bytes',()=>{const dir=mkdtempSync(join(tmpdir(),'spectator-edge-test-'));for(const file of manifest.edgeFiles){const dest=join(dir,file.path);mkdirSync(dirname(dest),{recursive:true});copyFileSync(join(root,file.path),dest);}verifyDownloaded(dir,manifest);writeFileSync(join(dir,'supabase/functions/unreviewed.ts'),'extra');assert.throws(()=>verifyDownloaded(dir,manifest));});
