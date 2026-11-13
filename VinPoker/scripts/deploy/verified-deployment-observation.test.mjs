import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {hash,compareObservedBytes,observationCandidate,verifyMetadata,verifyLiveObservations,validateTypeOnlyTargets} from './verified-deployment-observation.mjs';
const target=Buffer.from('export const n=1;\n');
const live=Buffer.from('export const n=1;\r\n');
const file={path:'VinPoker/supabase/functions/test/index.ts',liveRawSha256:hash(live),targetRawSha256:hash(target),comparison:'crlf-only'};
const deno=Buffer.from('{"imports":{}}\n');
const denoFile={path:'VinPoker/deno.json',liveRawSha256:hash(deno),targetRawSha256:hash(deno),comparison:'exact'};
const rule={name:'test',version:1,verifyJwt:true,importMap:true,ezbrSha256:'a'.repeat(64),files:[file,denoFile]};
const policy={project:'test-project',frontends:[{fingerprint:'approved'}],functions:[rule]};
const context={name:'test',verifyJwt:true,frontendFingerprint:'approved',closure:{complete:true,files:[file.path]},
 readRaw:path=>path===file.path?target:deno};
const metadata={slug:'test',version:1,status:'ACTIVE',verify_jwt:true,import_map:true,ezbr_sha256:'a'.repeat(64)};
test('normalization preserves raw hashes and does not invent deployed source SHA',()=>{
 compareObservedBytes(file,live,target);
 const proof=observationCandidate(policy,context);
 assert.equal(proof.sourceCommit,'unknown');assert.equal(proof.freshLiveVerificationRequired,true);
 assert.equal(proof.sha,undefined);
});
test('does not trim source or normalize arbitrary assets',()=>{
 assert.throws(()=>compareObservedBytes(file,Buffer.from('export const n=1;'),target));
 assert.throws(()=>compareObservedBytes({...file,path:'VinPoker/config.json'},live,target));
 assert.throws(()=>compareObservedBytes({...file,comparison:'anything'},live,target));
});
test('allows exactly the reviewed one-target JS BOM rule',()=>{
 const bom=Buffer.concat([Buffer.from('\uFEFF'),target]);
 compareObservedBytes({...file,targetRawSha256:hash(bom),comparison:'one-target-leading-bom-and-crlf'},live,bom);
 assert.throws(()=>compareObservedBytes({...file,comparison:'one-target-leading-bom-and-crlf'},live,target));
});
for(const patch of [{verifyJwt:false},{frontendFingerprint:'unapproved'},
 {closure:{complete:false,files:[file.path]}},{closure:{complete:true,files:[file.path,'VinPoker/uncovered.ts']}},
 {readRaw:()=>Buffer.from('changed source')}]){
 test(`unqualified target remains changed: ${Object.keys(patch)}`,()=>assert.equal(observationCandidate(policy,{...context,...patch}),null));
}
for(const patch of [{version:2},{status:'REMOVED'},{verify_jwt:false},{import_map:false},{ezbr_sha256:'b'.repeat(64)}]){
 test(`live metadata drift rejects ${Object.keys(patch)}`,()=>assert.throws(()=>verifyMetadata(rule,[{...metadata,...patch}])));
}
test('duplicate live identity rejects',()=>assert.throws(()=>verifyMetadata(rule,[metadata,metadata])));
function fixture(drift=false,extra=false){
 const root=mkdtempSync(join(tmpdir(),'observation-test-'));let lists=0;
 for(const f of rule.files){const p=join(root,f.path);mkdirSync(dirname(p),{recursive:true});writeFileSync(p,f===file?target:deno);}
 const runCli=args=>{
  if(args[1]==='list')return JSON.stringify([{...metadata,version:drift&&++lists===2?2:1}]);
  assert.equal(args[1],'download');const dest=args[args.indexOf('--workdir')+1];
  for(const f of rule.files){const p=join(dest,f.path.slice('VinPoker/'.length));mkdirSync(dirname(p),{recursive:true});writeFileSync(p,f===file?live:deno);}
  if(extra)writeFileSync(join(dest,'supabase/functions/test/unreviewed.ts'),'unexpected');
  return '';
 };
 return {policy,names:['test'],targetRoot:root,runCli};
}
test('real file-set verification rechecks metadata after download and returns observation only',()=>{
 const proof=verifyLiveObservations(fixture());
 assert.equal(proof.productionMutated,false);assert.equal(proof.sourceCommit,'unknown');assert.equal(proof.components.length,1);
});
test('version race between reads and extra live closure files stop before frontend mutation',()=>{
 assert.throws(()=>verifyLiveObservations(fixture(true)));
 assert.throws(()=>verifyLiveObservations(fixture(false,true)));
});

 test('reviewed erased type edges stay hash-covered; runtime and drift cannot qualify',()=>{
 const modulePath='VinPoker/types.ts',importerPath='VinPoker/main.ts';
 const moduleBytes=Buffer.from('export interface T { n: number }');
 const statement='import type { T } from "./types.ts";';
 const importerBytes=Buffer.from(statement+'\nexport const n=1;\n');
 const r={files:[{path:importerPath,targetRawSha256:hash(importerBytes)}],typeOnlyTargets:[{
 path:modulePath,targetRawSha256:hash(moduleBytes),incomingEdges:[{importer:importerPath,statement,importerTargetRawSha256:hash(importerBytes)}]}]};
 const read=p=>p===modulePath?moduleBytes:importerBytes;
 assert.deepEqual(validateTypeOnlyTargets(r,read),[modulePath]);
 assert.throws(()=>validateTypeOnlyTargets(r,()=>Buffer.from('changed')));
 for(const mutate of [x=>x.typeOnlyTargets[0].incomingEdges=[],x=>x.typeOnlyTargets[0].incomingEdges[0].statement='import { T } from "./types.ts";',x=>x.typeOnlyTargets[0].incomingEdges[0].importer='VinPoker/uncovered.ts',x=>x.typeOnlyTargets.push(x.typeOnlyTargets[0])]){
 const bad=structuredClone(r);mutate(bad);assert.throws(()=>validateTypeOnlyTargets(bad,read));
 }
 });

test('fresh predeploy verification repeats erased-target hash proof before downloading',()=>{
 const state=fixture();const clone=structuredClone(state.policy);
 const target='VinPoker/erased-types.ts';
 clone.functions[0].typeOnlyTargets=[{path:target,targetRawSha256:hash(Buffer.from('reviewed type source')),incomingEdges:[]}];
 const dest=join(state.targetRoot,target);mkdirSync(dirname(dest),{recursive:true});writeFileSync(dest,'changed type source');
 let downloaded=false;const runCli=args=>{if(args[1]==='download')downloaded=true;return state.runCli(args);};
 assert.throws(()=>verifyLiveObservations({...state,policy:clone,runCli}),/Erased target source drift/);
 assert.equal(downloaded,false);
});
