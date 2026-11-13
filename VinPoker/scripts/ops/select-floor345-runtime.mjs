import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const policyPath='VinPoker/scripts/ops/floor345-runtime-scope.json';
const selectorPath='VinPoker/scripts/ops/select-floor345-runtime.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
export function qualifyFloor345({repo,base,head,pr}){
 assert.match(base,/^[a-f0-9]{40}$/);assert.match(head,/^[a-f0-9]{40}$/);
 const git=(...args)=>execFileSync('git',['-C',repo,...args],{maxBuffer:16*1024*1024,stdio:['ignore','pipe','pipe']});
 const trees=new Map();
 const blob=(rev,path)=>{
  if(!trees.has(rev))trees.set(rev,new Map(git('ls-tree','-r','-z',rev).toString().split('\0').filter(Boolean).map(row=>{
   const tab=row.indexOf('\t');return [row.slice(tab+1),row.slice(0,tab)];
  })));
  assert.match(trees.get(rev).get(path)||'',/^100644 blob [a-f0-9]{40}$/,'Regular tracked proof/source file required');
  return git('show',`${rev}:${path}`);
 };
 // The policy and executable come ONLY from the protected event base commit.
 const policy=JSON.parse(blob(base,policyPath));
 assert.equal(policy.kind,'EXACT_FLOOR345_CURRENT_RUNTIME_NOT_HISTORICAL');
 assert.equal(policy.historicalCoverage,false);assert.equal(Number(pr),policy.pr);
 assert.ok(policy.guards.includes(policyPath)&&policy.guards.includes(selectorPath));
 for(const path of policy.guards)assert.ok(blob(base,path).equals(blob(head,path)),'PR changes its trusted proof or validator');
 const mergeBase=git('merge-base',base,head).toString().trim();assert.match(mergeBase,/^[a-f0-9]{40}$/);
 assert.match(policy.integrationWorkflow.preimageSha256,/^[a-f0-9]{64}$/);
 for(const rev of [base,mergeBase])assert.equal(hash(blob(rev,policy.integrationWorkflow.path)),policy.integrationWorkflow.preimageSha256,'Retained runtime preimage drift');
 const raw=git('diff','--no-renames','--name-status','-z',mergeBase,head).toString().split('\0');
 assert.equal(raw.pop(),'');assert.equal(raw.length%2,0);
 const expected=new Map(policy.files.map(f=>[f.path,f]));assert.equal(expected.size,policy.files.length);
 for(const file of policy.files){
  if(file.status==='M'){
   assert.match(file.preimageSha256,/^[a-f0-9]{64}$/);
   assert.equal(hash(blob(base,file.path)),file.preimageSha256,'Protected baseline source drift');
   assert.equal(hash(blob(mergeBase,file.path)),file.preimageSha256,'Merge-base source drift');
  }else{
   assert.equal(file.status,'A');
   for(const rev of [base,mergeBase])assert.equal(git('ls-tree','-r',rev,'--',file.path).length,0,'Added source already exists in baseline');
  }
 }
 const seen=new Set();let integration=false;
 for(let i=0;i<raw.length;i+=2){
  const [status,path]=[raw[i],raw[i+1]];
  assert.ok(['A','M'].includes(status),'Deletion, rename or unexpected change rejected');
  if(path===policy.integrationWorkflow.path){
   assert.equal(status,'M');assert.equal(hash(blob(head,path)),policy.integrationWorkflow.sha256);integration=true;continue;
  }
  const file=expected.get(path);assert.ok(file,'Extra source outside exact Floor345 package');
  assert.equal(status,file.status);assert.equal(hash(blob(head,path)),file.sha256);seen.add(path);
 }
 assert.equal(seen.size,expected.size,'Incomplete Floor345 source package');
 // The integration must be present, and no arbitrary workflow may select it.
 assert.ok(integration,'Exact reviewed runtime integration required');
 return true;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{const [repo,base,head,pr]=process.argv.slice(2);qualifyFloor345({repo,base,head,pr});console.log('floor345');}
 catch{console.log('legacy');}
}
