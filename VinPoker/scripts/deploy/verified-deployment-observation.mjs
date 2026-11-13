import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,existsSync,lstatSync,realpathSync,readdirSync,mkdtempSync} from 'node:fs';
import {resolve,relative,sep,extname,join,posix} from 'node:path';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';

export const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export function loadObservationPolicy(){
 const p=JSON.parse(readFileSync(new URL('./verified-deployment-observations.json',import.meta.url)));
 assert.equal(p.kind,'NORMALIZED_SOURCE_OBSERVATIONS_NOT_DEPLOYMENT_RECEIPTS');
 assert.equal(p.sourceCommit,'unknown');assert.equal(p.project,'orlesggcjamwuknxwcpk');
 return p;
}
function filePath(root,path,appRoot=false){
 assert.ok(/^VinPoker\/[A-Za-z0-9_./-]+$/.test(path)&&!path.split('/').includes('..'),'Unsafe observation path');
 const result=resolve(root,appRoot?path.slice('VinPoker/'.length):path);
 assert.ok(relative(realpathSync(root),realpathSync(result)).split(sep)[0]!=='..','Observation escapes root');
 assert.ok(lstatSync(result).isFile()&&!lstatSync(result).isSymbolicLink(),'Regular observation file required');
 return result;
}
export function compareObservedBytes(file,live,target){
 assert.equal(hash(live),file.liveRawSha256,'Live raw source drift');
 assert.equal(hash(target),file.targetRawSha256,'Target raw source drift');
 if(file.comparison==='exact'){assert.deepEqual(live,target);return;}
 assert.ok(['.ts','.tsx','.js','.mjs','.cjs'].includes(extname(file.path)),'Only reviewed JS/TS normalization is allowed');
 assert.ok(['crlf-only','one-target-leading-bom-and-crlf'].includes(file.comparison),'Unknown normalization');
 let targetText=target.toString('utf8');
 if(file.comparison==='one-target-leading-bom-and-crlf'){
  assert.ok(targetText.startsWith('\uFEFF')&&!targetText.slice(1).startsWith('\uFEFF'),'Expected one target BOM');
  targetText=targetText.slice(1);
 }
 assert.equal(live.toString('utf8').replace(/\r\n/g,'\n'),targetText.replace(/\r\n/g,'\n'),'Normalized source mismatch');
}
// A frozen, reviewed source attestation, not a general import-elision heuristic.
// Runtime-file hashes pin every possible importer; omitted modules stay covered
// by canonical hashes and explicit reviewed import-type statement identities.
export function validateTypeOnlyTargets(rule,readRaw){
 const result=[];
 for(const target of rule.typeOnlyTargets??[]){
  assert.ok(!result.includes(target.path)&&!rule.files.some(f=>f.path===target.path),'Ambiguous erased target');
  assert.equal(hash(readRaw(target.path)),target.targetRawSha256,'Erased target source drift');
  assert.ok(target.incomingEdges.length>0,'Reviewed incoming type edges required');
  for(const edge of target.incomingEdges){
   const importer=rule.files.find(f=>f.path===edge.importer);
   assert.ok(importer,'Erased edge must originate in the complete pinned runtime closure');
   assert.equal(importer.targetRawSha256,edge.importerTargetRawSha256);
   const bytes=readRaw(edge.importer);assert.equal(hash(bytes),edge.importerTargetRawSha256);
   const match=edge.statement.match(/^import\s+type\s+[\s\S]*?\sfrom\s+["']([^"']+)["'];?$/);
   assert.ok(match&&match[1].startsWith('.'),'Explicit local import type required');
   let resolved=posix.normalize(posix.join(posix.dirname(edge.importer),match[1]));
   if(!posix.extname(resolved))resolved+='.ts';
   assert.equal(resolved,target.path,'Type edge must resolve to its pinned target');
   assert.ok(bytes.toString('utf8').includes(edge.statement),'Reviewed type statement missing');
  }
  result.push(target.path);
 }
 return result;
}
export function observationCandidate(policy,{name,verifyJwt,frontendFingerprint,closure,readRaw}){
 const rule=policy?.functions.find(f=>f.name===name);
 if(!rule||!policy.frontends.some(f=>f.fingerprint===frontendFingerprint))return null;
 try{
  assert.equal(rule.verifyJwt,verifyJwt);assert.equal(rule.importMap,true);assert.equal(closure.complete,true);
  const paths=rule.files.map(f=>f.path);assert.equal(new Set(paths).size,paths.length);
  assert.ok(paths.includes('VinPoker/deno.json'),'Import-map source must be pinned');
  const erased=validateTypeOnlyTargets(rule,readRaw);
  for(const path of closure.files)assert.ok(paths.includes(path)||erased.includes(path),'Full target closure must be covered');
  for(const file of rule.files)assert.equal(hash(readRaw(file.path)),file.targetRawSha256);
  return {kind:'normalized_source_equivalence_candidate',sourceCommit:'unknown',version:rule.version,
   policyComponent:name,freshLiveVerificationRequired:true};
 }catch{return null;}
}
export function verifyMetadata(rule,rows){
 const matches=rows.filter(r=>r.slug===rule.name);assert.equal(matches.length,1,'Ambiguous live function');
 const row=matches[0];assert.equal(row.status,'ACTIVE');assert.equal(row.version,rule.version);
 assert.equal(row.verify_jwt,rule.verifyJwt);assert.equal(row.import_map,rule.importMap);
 assert.equal(row.ezbr_sha256,rule.ezbrSha256);return row;
}
function downloadFiles(root){
 const result=[];
 function visit(dir){for(const ent of readdirSync(dir,{withFileTypes:true})){
  assert.ok(!ent.isSymbolicLink(),'Downloaded symlink rejected');
  const path=join(dir,ent.name);if(ent.isDirectory())visit(path);else if(ent.isFile())result.push(path);
 }}
 visit(join(root,'supabase','functions'));
 if(existsSync(join(root,'src')))visit(join(root,'src'));
 result.push(join(root,'deno.json'));
 return result.map(p=>'VinPoker/'+relative(root,p).split(sep).join('/')).sort();
}
export function verifyLiveObservations({policy,names,targetRoot,runCli}){
 assert.equal(new Set(names).size,names.length);assert.ok(names.length>0);
 const before=JSON.parse(runCli(['functions','list','--project-ref',policy.project,'--output','json']));
 const evidence=[];
 for(const name of names){
  const rule=policy.functions.find(f=>f.name===name);assert.ok(rule,'Unreviewed observed component');verifyMetadata(rule,before);
  const root=mkdtempSync(join(tmpdir(),'vinpoker-observed-'));
  runCli(['functions','download',name,'--project-ref',policy.project,'--use-api','--workdir',root]);
  assert.deepEqual(downloadFiles(root),rule.files.map(f=>f.path).sort(),'Live closure file-set drift');
  for(const file of rule.files){
   compareObservedBytes(file,readFileSync(filePath(root,file.path,true)),readFileSync(filePath(targetRoot,file.path)));
  }
  evidence.push({name,version:rule.version,sourceCommit:'unknown',classification:'verified_normalized_source_equivalence'});
 }
 const after=JSON.parse(runCli(['functions','list','--project-ref',policy.project,'--output','json']));
 for(const name of names)verifyMetadata(policy.functions.find(f=>f.name===name),after);
 return {observedAt:new Date().toISOString(),sourceCommit:'unknown',components:evidence,productionMutated:false};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [targetRoot,namesJson]=process.argv.slice(2);
 const runCli=args=>{
  const r=spawnSync('supabase',args,{encoding:'utf8',timeout:90000,maxBuffer:4*1024*1024});
  if(r.status!==0)throw Error('Read-only live function verification failed; raw output withheld');
  return r.stdout;
 };
 try{console.log(JSON.stringify(verifyLiveObservations({policy:loadObservationPolicy(),names:JSON.parse(namesJson),targetRoot:resolve(targetRoot),runCli})));}
 catch{console.error('OBSERVED_SOURCE_NOT_VERIFIED: stop before frontend deployment');process.exitCode=1;}
}
