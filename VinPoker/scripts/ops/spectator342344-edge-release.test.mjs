import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,copyFileSync,writeFileSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {runEdgeRelease,verifySecret,verifyPhaseA,verifyDownloaded,priorFiles,restorePriorCode,classifyHostedRuntime,normalizeDownloadedPaths,validateRepairBase} from './spectator342344-edge-release.mjs';
import {PRIOR_EDGE} from './spectator342344-production.mjs';
import {loadPackage} from './spectator342344-release-plan.mjs';
const root=process.env.RELEASE_SOURCE_ROOT;assert.ok(root);const{manifest}=loadPackage(root);
function fixture(fail,repair=false){
 const writes=[],events=[];let deployed=false,flag='0',reads=0;
 const base=repair?{...PRIOR_EDGE,version:18,ezbr_sha256:'1f97018b2874c4ea9595582fe441ca2d7f7447c9a1c170ea65b42a6ac3b63e44'}:PRIOR_EDGE;
 const after={...PRIOR_EDGE,version:repair?19:13,ezbr_sha256:'a'.repeat(64)};
 return{writes,events,run:()=>runEdgeRelease({manifest,sourceRoot:root,repair,
  management:async(method,path,body)=>{if(path==='secrets'){if(method==='POST'){flag=body[0].value;writes.push(flag);return;}return[{name:'PUBLIC_SPECTATOR_SOURCE_BATCH',value:flag}];}return deployed?after:base;},
  cli:args=>{assert.equal(flag,'0');assert.equal(args[0],'functions');assert.ok(args.includes('--use-api'));assert.equal(args[args.indexOf('--import-map')+1],join(args[args.indexOf('--workdir')+1],'deno.json'));if(fail==='deploy')throw Error('fixed');deployed=true;},
  verifyDatabase:async()=>{reads++;if(fail==='database'&&reads===2)throw Error('fixed');},
  readDownloaded:async()=>{assert.equal(flag,'0');if(fail==='closure')throw Error('fixed');},
  denied:async()=>fail==='auth'?200:401,report:e=>events.push(e)})};
}
test('batch1 follows exact source, metadata, database and auth verification at batch0',async()=>{const f=fixture();assert.deepEqual(await f.run(),{version:13,batch:'1'});assert.deepEqual(f.writes,['0','1']);assert.equal(f.events.at(-1).kind,'SPECTATOR_BATCH_EDGE_IDENTITY_AND_CONFIGURATION_VERIFIED_RUNTIME_OBSERVATION_REQUIRED');});
test('deploy, closure, database or auth failure stops and verifies batch0 without retry',async()=>{for(const failure of ['deploy','closure','database','auth']){const f=fixture(failure);await assert.rejects(f.run);assert.ok(!f.writes.includes('1'));assert.equal(f.writes.at(-1),'0');assert.equal(f.events.at(-1).batchDisabledVerified,true);}});
test('secret verification rejects missing, ambiguous or mismatching values',()=>{for(const flag of ['0','1']){verifySecret([{name:'PUBLIC_SPECTATOR_SOURCE_BATCH',value:flag}],flag);verifySecret([{name:'PUBLIC_SPECTATOR_SOURCE_BATCH',value:createHash('sha256').update(flag).digest('hex')}],flag);}for(const rows of [[],[{name:'PUBLIC_SPECTATOR_SOURCE_BATCH',value:'other'}],[{name:'PUBLIC_SPECTATOR_SOURCE_BATCH',value:'1'},{name:'PUBLIC_SPECTATOR_SOURCE_BATCH',value:'1'}]])assert.throws(()=>verifySecret(rows,'1'));});
test('only all three exact committed receipts with resumed dispatcher qualify',()=>{const rows=manifest.migrations.map(m=>({kind:'COMMITTED_EXACT_OBJECTS_VERIFIED',version:m.version,sha256:m.sha256}));rows.push({kind:'SPECTATOR342344_RESUMED_WITH_VERIFIED_PRIOR_SINGLE_WORKER'},{kind:'SPECTATOR342344_DATABASE_VERIFIED',dispatcherStillPaused:false,workerMode:'prior-v12-single'});const encode=r=>r.map(x=>JSON.stringify(x)).join('\n');verifyPhaseA(encode(rows),manifest);for(const mutate of [r=>r.shift(),r=>r[0].sha256='b'.repeat(64),r=>r.at(-1).dispatcherStillPaused=true]){const r=structuredClone(rows);mutate(r);assert.throws(()=>verifyPhaseA(encode(r),manifest));}});

test('downloaded closure must contain exactly the seven reviewed files and bytes',()=>{const dir=mkdtempSync(join(tmpdir(),'spectator-edge-test-'));for(const file of manifest.edgeFiles){const dest=join(dir,file.path);mkdirSync(dirname(dest),{recursive:true});copyFileSync(join(root,file.path),dest);}verifyDownloaded(dir,manifest);writeFileSync(join(dir,'supabase/functions/unreviewed.ts'),'extra');assert.throws(()=>verifyDownloaded(dir,manifest));});

test('verified six-file prior code can be redeployed only at batch0 and checked as a new version',async()=>{const dir=mkdtempSync(join(tmpdir(),'spectator-prior-test-'));for(const file of priorFiles){const dest=join(dir,file.path);mkdirSync(dirname(dest),{recursive:true});writeFileSync(dest,execFileSync('git',['show','6fa88c1428146948b5cb74dbcf3efc38aabe5879:VinPoker/'+file.path]));}const events=[],flags=[],calls=[];await restorePriorCode({priorRoot:dir,management:async(method,path,body)=>{if(path==='secrets'){if(method==='POST'){flags.push(body[0].value);return;}return[{name:'PUBLIC_SPECTATOR_SOURCE_BATCH',value:'0'}];}return{...PRIOR_EDGE,version:14};},cli:args=>calls.push(args),readDownloaded:async m=>assert.deepEqual(m.edgeFiles,priorFiles),verifyDatabase:async()=>{},denied:async()=>401,report:e=>events.push(e)});assert.deepEqual(flags,['0']);assert.equal(calls.length,1);assert.ok(calls[0].includes('--use-api'));assert.equal(calls[0][calls[0].indexOf('--import-map')+1],join(calls[0][calls[0].indexOf('--workdir')+1],'deno.json'));assert.equal(events[0].kind,'VERIFIED_PRIOR_V12_CODE_REDEPLOYED_AS_NEW_VERSION');assert.equal(events[0].version,14);});
test('idle configuration or responses without real batch RPC evidence never prove hosted execution',()=>{const before={batchCalls:10,lastResponseId:5};const response={id:6,status_code:200,content:JSON.stringify({sourceMode:'batch',processed:2,results:[{},{}]})};assert.equal(classifyHostedRuntime(before,{batchCalls:11,responses:[response]}).state,'hosted-batch-observed');for(const after of [{batchCalls:10,responses:[response]},{batchCalls:11,responses:[]},{batchCalls:11,responses:[{...response,id:4}]}])assert.equal(classifyHostedRuntime(before,after).state,'not-proven');});

test('one known download prefix is accepted without weakening paths or completeness',()=>{assert.deepEqual(normalizeDownloadedPaths(['VinPoker/deno.json','VinPoker/src/a.ts']),['deno.json','src/a.ts']);for(const paths of [['VinPoker/deno.json','src/a.ts'],['/deno.json'],['../deno.json'],['VinPoker/../deno.json'],['deno.json','deno.json']])assert.throws(()=>normalizeDownloadedPaths(paths));});
test('repair accepts only observed v18 bundle identity and pins explicit import map arguments',()=>{const base={...PRIOR_EDGE,version:18,ezbr_sha256:'1f97018b2874c4ea9595582fe441ca2d7f7447c9a1c170ea65b42a6ac3b63e44'};validateRepairBase(base);for(const field of ['version','ezbr_sha256','status','verify_jwt'])assert.throws(()=>validateRepairBase({...base,[field]:null}));});

test('observed18 repair deploys once with explicit import map before verified batch1',async()=>{const f=fixture(undefined,true);assert.deepEqual(await f.run(),{version:19,batch:'1'});assert.deepEqual(f.writes,['0','1']);});
test('prefixed seven-file closure keeps exact bytes and rejects mixed roots',()=>{const dir=mkdtempSync(join(tmpdir(),'spectator-prefix-test-'));for(const file of manifest.edgeFiles){const dest=join(dir,'VinPoker',file.path);mkdirSync(dirname(dest),{recursive:true});copyFileSync(join(root,file.path),dest);}verifyDownloaded(dir,manifest);copyFileSync(join(root,'deno.json'),join(dir,'deno.json'));assert.throws(()=>verifyDownloaded(dir,manifest));});

 test('readonly bundle inventory exposes shapes and hashes without metadata values',async()=>{
 const {summarizeBundleForm,validateInspectionBase}=await import('./spectator342344-edge-release.mjs');
 const form=new FormData();form.append('metadata',JSON.stringify({importMap:'PRIVATE_MAP_CONTENT',nested:{private:'PRIVATE_VALUE'}}));form.append('file',new Blob(['source']), 'index.ts');
 const result=await summarizeBundleForm(form),serialized=JSON.stringify(result);assert.ok(!serialized.includes('PRIVATE'));assert.deepEqual(result[0].metadataKeys,['importMap','nested']);assert.equal(result[1].bytes,6);assert.equal(result[1].name,'index.ts');
 assert.throws(()=>validateInspectionBase({version:18}));
});

test('raw hosted multipart verifies all seven distinct bytes and only bounded identical vendor duplication',async()=>{
 const {verifyBundleForm}=await import('./spectator342344-edge-release.mjs');
 const {readFileSync}=await import('node:fs');
 function form(change){const value=new FormData();value.append('metadata','{}');for(const f of manifest.edgeFiles)value.append('file',new Blob([readFileSync(join(root,f.path))]),f.path);if(change)change(value);return value;}
 const vendor=manifest.edgeFiles.find(f=>f.path.includes('/vendor/'));const addVendor=value=>value.append('file',new Blob([readFileSync(join(root,vendor.path))]),vendor.path);
 assert.deepEqual(await verifyBundleForm(form(),manifest),{distinctFiles:7,parts:7});assert.deepEqual(await verifyBundleForm(form(addVendor),manifest),{distinctFiles:7,parts:8});
 for(const change of [v=>{addVendor(v);addVendor(v);},v=>v.append('file',new Blob(['drift']),vendor.path),v=>v.append('file',new Blob(['extra']),'extra.ts'),v=>v.append('file',new Blob([readFileSync(join(root,'deno.json'))]),'deno.json')])await assert.rejects(()=>verifyBundleForm(form(change),manifest));
 const missing=new FormData();missing.append('metadata','{}');await assert.rejects(()=>verifyBundleForm(missing,manifest));
});
test('existing21 activation verifies source before and after one flag write and allows its single version increment',async()=>{
 const {activateVerifiedBundle}=await import('./spectator342344-edge-release.mjs');let flag='0',reads=0;const writes=[],events=[];const base={...PRIOR_EDGE,version:21,ezbr_sha256:'917bc15f88f8f17985e7deff37801699f80eeab04be8f8dcced1e246a265e8a5'};
 await activateVerifiedBundle({manifest,management:async(method,path,body)=>{if(path==='secrets'){if(method==='POST'){flag=body[0].value;writes.push(flag);return;}return[{name:'PUBLIC_SPECTATOR_SOURCE_BATCH',value:flag}];}return{...base,version:flag==='1'?22:21};},readDownloaded:async()=>{reads++;},verifyDatabase:async()=>{},denied:async()=>401,report:e=>events.push(e)});
 assert.deepEqual(writes,['1']);assert.equal(reads,2);assert.equal(events[0].version,22);assert.equal(events[0].kind,'SPECTATOR_EXISTING_BUNDLE_ACTIVATED_RUNTIME_OBSERVATION_REQUIRED');
});
test('existing activation rejects source failure without enabling or verifies batch0 after post-activation failure',async()=>{
 const {activateVerifiedBundle}=await import('./spectator342344-edge-release.mjs');
 for(const failAt of [1,2]){let flag='0',reads=0;const writes=[],events=[];const base={...PRIOR_EDGE,version:21,ezbr_sha256:'917bc15f88f8f17985e7deff37801699f80eeab04be8f8dcced1e246a265e8a5'};await assert.rejects(()=>activateVerifiedBundle({manifest,management:async(method,path,body)=>{if(path==='secrets'){if(method==='POST'){flag=body[0].value;writes.push(flag);return;}return[{name:'PUBLIC_SPECTATOR_SOURCE_BATCH',value:flag}];}return{...base,version:flag==='1'?22:21};},readDownloaded:async()=>{if(++reads===failAt)throw Error('fixed');},verifyDatabase:async()=>{},denied:async()=>401,report:e=>events.push(e)}));assert.deepEqual(writes,failAt===1?[]:['1','0']);assert.equal(events[0].batchDisabledVerified,failAt===2);}
});
