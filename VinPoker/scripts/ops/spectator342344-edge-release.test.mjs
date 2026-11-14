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
 const base=repair?{...PRIOR_EDGE,version:15,ezbr_sha256:'14140eeff59f2fcef84127235f89a9e91deeaba1d14c294e8c881c11de8e03bf'}:PRIOR_EDGE;
 const after={...PRIOR_EDGE,version:repair?16:13,ezbr_sha256:'a'.repeat(64)};
 return{writes,events,run:()=>runEdgeRelease({manifest,sourceRoot:root,repair,
  management:async(method,path,body)=>{if(path==='secrets'){if(method==='POST'){flag=body[0].value;writes.push(flag);return;}return[{name:'PUBLIC_SPECTATOR_SOURCE_BATCH',value:flag}];}return deployed?after:base;},
  cli:args=>{assert.equal(flag,'0');assert.equal(args[0],'functions');assert.equal(args[args.indexOf('--import-map')+1],join(root,'deno.json'));if(fail==='deploy')throw Error('fixed');deployed=true;},
  verifyDatabase:async()=>{reads++;if(fail==='database'&&reads===2)throw Error('fixed');},
  readDownloaded:async()=>{assert.equal(flag,'0');if(fail==='closure')throw Error('fixed');},
  denied:async()=>fail==='auth'?200:401,report:e=>events.push(e)})};
}
test('batch1 follows exact source, metadata, database and auth verification at batch0',async()=>{const f=fixture();assert.deepEqual(await f.run(),{version:13,batch:'1'});assert.deepEqual(f.writes,['0','1']);assert.equal(f.events.at(-1).kind,'SPECTATOR_BATCH_EDGE_IDENTITY_AND_CONFIGURATION_VERIFIED_RUNTIME_OBSERVATION_REQUIRED');});
test('deploy, closure, database or auth failure stops and verifies batch0 without retry',async()=>{for(const failure of ['deploy','closure','database','auth']){const f=fixture(failure);await assert.rejects(f.run);assert.ok(!f.writes.includes('1'));assert.equal(f.writes.at(-1),'0');assert.equal(f.events.at(-1).batchDisabledVerified,true);}});
test('secret verification rejects missing, ambiguous or mismatching values',()=>{for(const flag of ['0','1']){verifySecret([{name:'PUBLIC_SPECTATOR_SOURCE_BATCH',value:flag}],flag);verifySecret([{name:'PUBLIC_SPECTATOR_SOURCE_BATCH',value:createHash('sha256').update(flag).digest('hex')}],flag);}for(const rows of [[],[{name:'PUBLIC_SPECTATOR_SOURCE_BATCH',value:'other'}],[{name:'PUBLIC_SPECTATOR_SOURCE_BATCH',value:'1'},{name:'PUBLIC_SPECTATOR_SOURCE_BATCH',value:'1'}]])assert.throws(()=>verifySecret(rows,'1'));});
test('only all three exact committed receipts with resumed dispatcher qualify',()=>{const rows=manifest.migrations.map(m=>({kind:'COMMITTED_EXACT_OBJECTS_VERIFIED',version:m.version,sha256:m.sha256}));rows.push({kind:'SPECTATOR342344_RESUMED_WITH_VERIFIED_PRIOR_SINGLE_WORKER'},{kind:'SPECTATOR342344_DATABASE_VERIFIED',dispatcherStillPaused:false,workerMode:'prior-v12-single'});const encode=r=>r.map(x=>JSON.stringify(x)).join('\n');verifyPhaseA(encode(rows),manifest);for(const mutate of [r=>r.shift(),r=>r[0].sha256='b'.repeat(64),r=>r.at(-1).dispatcherStillPaused=true]){const r=structuredClone(rows);mutate(r);assert.throws(()=>verifyPhaseA(encode(r),manifest));}});

test('downloaded closure must contain exactly the seven reviewed files and bytes',()=>{const dir=mkdtempSync(join(tmpdir(),'spectator-edge-test-'));for(const file of manifest.edgeFiles){const dest=join(dir,file.path);mkdirSync(dirname(dest),{recursive:true});copyFileSync(join(root,file.path),dest);}verifyDownloaded(dir,manifest);writeFileSync(join(dir,'supabase/functions/unreviewed.ts'),'extra');assert.throws(()=>verifyDownloaded(dir,manifest));});

test('verified six-file prior code can be redeployed only at batch0 and checked as a new version',async()=>{const dir=mkdtempSync(join(tmpdir(),'spectator-prior-test-'));for(const file of priorFiles){const dest=join(dir,file.path);mkdirSync(dirname(dest),{recursive:true});writeFileSync(dest,execFileSync('git',['show','6fa88c1428146948b5cb74dbcf3efc38aabe5879:VinPoker/'+file.path]));}const events=[],flags=[],calls=[];await restorePriorCode({priorRoot:dir,management:async(method,path,body)=>{if(path==='secrets'){if(method==='POST'){flags.push(body[0].value);return;}return[{name:'PUBLIC_SPECTATOR_SOURCE_BATCH',value:'0'}];}return{...PRIOR_EDGE,version:14};},cli:args=>calls.push(args),readDownloaded:async m=>assert.deepEqual(m.edgeFiles,priorFiles),verifyDatabase:async()=>{},denied:async()=>401,report:e=>events.push(e)});assert.deepEqual(flags,['0']);assert.equal(calls.length,1);assert.equal(calls[0][calls[0].indexOf('--import-map')+1],join(dir,'deno.json'));assert.equal(events[0].kind,'VERIFIED_PRIOR_V12_CODE_REDEPLOYED_AS_NEW_VERSION');assert.equal(events[0].version,14);});
test('idle configuration or responses without real batch RPC evidence never prove hosted execution',()=>{const before={batchCalls:10,lastResponseId:5};const response={id:6,status_code:200,content:JSON.stringify({sourceMode:'batch',processed:2,results:[{},{}]})};assert.equal(classifyHostedRuntime(before,{batchCalls:11,responses:[response]}).state,'hosted-batch-observed');for(const after of [{batchCalls:10,responses:[response]},{batchCalls:11,responses:[]},{batchCalls:11,responses:[{...response,id:4}]}])assert.equal(classifyHostedRuntime(before,after).state,'not-proven');});

test('one known download prefix is accepted without weakening paths or completeness',()=>{assert.deepEqual(normalizeDownloadedPaths(['VinPoker/deno.json','VinPoker/src/a.ts']),['deno.json','src/a.ts']);for(const paths of [['VinPoker/deno.json','src/a.ts'],['/deno.json'],['../deno.json'],['VinPoker/../deno.json'],['deno.json','deno.json']])assert.throws(()=>normalizeDownloadedPaths(paths));});
test('repair accepts only observed v15 bundle identity and pins explicit import map arguments',()=>{const base={...PRIOR_EDGE,version:15,ezbr_sha256:'14140eeff59f2fcef84127235f89a9e91deeaba1d14c294e8c881c11de8e03bf'};validateRepairBase(base);for(const field of ['version','ezbr_sha256','status','verify_jwt'])assert.throws(()=>validateRepairBase({...base,[field]:null}));});

test('observed15 repair deploys once with explicit import map before verified batch1',async()=>{const f=fixture(undefined,true);assert.deepEqual(await f.run(),{version:16,batch:'1'});assert.deepEqual(f.writes,['0','1']);});
test('prefixed seven-file closure keeps exact bytes and rejects mixed roots',()=>{const dir=mkdtempSync(join(tmpdir(),'spectator-prefix-test-'));for(const file of manifest.edgeFiles){const dest=join(dir,'VinPoker',file.path);mkdirSync(dirname(dest),{recursive:true});copyFileSync(join(root,file.path),dest);}verifyDownloaded(dir,manifest);copyFileSync(join(root,'deno.json'),join(dir,'deno.json'));assert.throws(()=>verifyDownloaded(dir,manifest));});
