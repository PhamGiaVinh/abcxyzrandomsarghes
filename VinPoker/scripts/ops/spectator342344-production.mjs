import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync,spawnSync} from 'node:child_process';
import {loadPackage} from './spectator342344-release-plan.mjs';
import {validateApproval} from './spectator342344-release-context.mjs';
import {psqlEnvironment} from './floor-37-47-protected-apply.mjs';
import {releaseDatabase} from './spectator342344-dispatch-control.mjs';

export const PRIOR_EDGE=Object.freeze({id:'0ea7dd50-342e-463b-a4a3-4778c3fc36fd',slug:'public-spectator-projector-v2',version:12,status:'ACTIVE',verify_jwt:false,import_map:true,ezbr_sha256:'0ad00272a4ead9987a40d1e969e06c713e8d6bb79218c4cd2b114cc2daa2933b'});
export function validatePriorEdge(value){
 for(const [key,expected] of Object.entries(PRIOR_EDGE))assert.equal(value?.[key],expected,'Prior Edge deployment drift');
}
export async function verifyPriorEdge(env,fetcher=fetch){
 assert.equal(env.SUPABASE_PROJECT_REF,'orlesggcjamwuknxwcpk');
 assert.ok(env.SUPABASE_ACCESS_TOKEN,'Private read-only Edge credential required');
 const response=await fetcher('https://api.supabase.com/v1/projects/orlesggcjamwuknxwcpk/functions/public-spectator-projector-v2',{
  headers:{Authorization:`Bearer ${env.SUPABASE_ACCESS_TOKEN}`},signal:AbortSignal.timeout(5000)});
 assert.equal(response.status,200,'Prior worker metadata unavailable');
 validatePriorEdge(await response.json());
}
async function main(){
 const mode=process.argv[2],env=process.env;
 const sourceRoot=resolve(env.RELEASE_SOURCE_ROOT),pkg=loadPackage(sourceRoot);
 const repoRoot=fileURLToPath(new URL('../../../',import.meta.url));
 const gitSha=root=>execFileSync('git',['-C',root,'rev-parse','HEAD'],{encoding:'utf8'}).trim();
 validateApproval(mode,env,JSON.parse(readFileSync(env.RECOVERY_RECEIPT_PATH,'utf8')),
  {controllerSha:gitSha(repoRoot),sourceSha:gitSha(sourceRoot)},pkg.manifest);
 const query=sql=>{
  const result=spawnSync('psql',['-X','-qAt','-v','ON_ERROR_STOP=1'],{input:sql,encoding:'utf8',env:psqlEnvironment(env),maxBuffer:2*1024*1024,timeout:15000});
  if(result.error||result.status!==0)throw Error('Private database command failed; raw output withheld');
  return result.stdout.trim();
 };
 const transport={execute:query,json:sql=>{
  const lines=query(sql).split('\n').filter(line=>line.startsWith('{')||line.startsWith('['));
  assert.equal(lines.length,1,'Expected one bounded database observation');return JSON.parse(lines[0]);
 }};
 const result=await releaseDatabase({mode,sourceRoot,transport,verifyPriorEdge:()=>verifyPriorEdge(env),report:event=>console.log(JSON.stringify(event))});
 console.log(JSON.stringify(result));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 main().catch(()=>{console.error('SPECTATOR342344_PROTECTED_STOP: inspect sanitized phase/receipts; no automatic retry or resume');process.exitCode=1;});
}
