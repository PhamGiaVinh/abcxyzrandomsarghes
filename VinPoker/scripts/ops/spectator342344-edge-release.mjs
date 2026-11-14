import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,readdirSync,lstatSync,mkdtempSync} from 'node:fs';
import {resolve,join,relative} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {loadPackage} from './spectator342344-release-plan.mjs';
import {postcheckSql,classifyPostcheck} from './spectator342344-protected-apply.mjs';
import {activeSql} from './spectator342344-dispatch-control.mjs';
import {validatePriorEdge} from './spectator342344-production.mjs';
const project='orlesggcjamwuknxwcpk',name='public-spectator-projector-v2',repo='PhamGiaVinh/abcxyzrandomsarghes';
const digest=x=>createHash('sha256').update(x).digest('hex');
export function verifySecret(rows,flag){
 assert.ok(['0','1'].includes(flag));const values=rows.filter(r=>r.name==='PUBLIC_SPECTATOR_SOURCE_BATCH');
 assert.equal(values.length,1);assert.ok([flag,digest(flag)].includes(values[0].value),'Batch configuration not verified');
}
export function verifyDownloaded(root,manifest){
 const paths=[];function walk(dir){for(const item of readdirSync(dir,{withFileTypes:true})){
  const file=join(dir,item.name);assert.ok(!item.isSymbolicLink());if(item.isDirectory())walk(file);else{assert.ok(item.isFile());paths.push(relative(root,file).replaceAll('\\','/'));}
 }}
 walk(join(root,'supabase','functions'));walk(join(root,'src'));paths.push('deno.json');
 assert.deepEqual(paths.sort(),manifest.edgeFiles.map(f=>f.path).sort(),'Downloaded closure differs');
 for(const file of manifest.edgeFiles){const path=resolve(root,file.path);assert.ok(lstatSync(path).isFile());assert.equal(digest(readFileSync(path,'utf8').replace(/\r\n?/g,'\n')),file.sha256,'Downloaded runtime source drift');}
}
export function verifyPhaseA(lines,manifest){
 const rows=lines.trim().split(/\r?\n/).map(line=>JSON.parse(line));
 assert.equal(rows.length,5);
 const committed=rows.filter(r=>r.kind==='COMMITTED_EXACT_OBJECTS_VERIFIED');
 assert.equal(committed.length,3);
 for(const [i,item]of manifest.migrations.entries()){assert.equal(committed[i].version,item.version);assert.equal(committed[i].sha256,item.sha256);}
 assert.equal(rows.filter(r=>r.kind==='SPECTATOR342344_RESUMED_WITH_VERIFIED_PRIOR_SINGLE_WORKER').length,1);
 const final=rows.at(-1);assert.equal(final.kind,'SPECTATOR342344_DATABASE_VERIFIED');assert.equal(final.dispatcherStillPaused,false);assert.equal(final.workerMode,'prior-v12-single');
}
export async function runEdgeRelease({management,cli,readDownloaded,manifest,verifyDatabase,denied,report=()=>{}}){
 let phase='preflight',changed=false;
 const meta=()=>management('GET',`functions/${name}`);
 const flag=async value=>{await management('POST','secrets',[{name:'PUBLIC_SPECTATOR_SOURCE_BATCH',value}]);verifySecret(await management('GET','secrets'),value);};
 try{
  await verifyDatabase();validatePriorEdge(await meta());
  phase='batch-zero';changed=true;await flag('0');
  phase='deploy';cli(['functions','deploy',name,'--project-ref',project,'--no-verify-jwt']);
  const first=await meta();assert.equal(first.slug,name);assert.equal(first.status,'ACTIVE');assert.equal(first.verify_jwt,false);assert.equal(first.import_map,true);assert.ok(Number.isInteger(first.version)&&first.version>12);assert.match(first.ezbr_sha256,/^[a-f0-9]{64}$/);
  phase='verify-deployed-source';await readDownloaded(manifest);verifySecret(await management('GET','secrets'),'0');
  const stable=await meta();assert.equal(stable.version,first.version);assert.equal(stable.ezbr_sha256,first.ezbr_sha256);assert.equal(await denied(),401);await verifyDatabase();
  phase='batch-one';await flag('1');const after=await meta();assert.equal(after.version,first.version);assert.equal(after.ezbr_sha256,first.ezbr_sha256);await verifyDatabase();assert.equal(await denied(),401);
  report({kind:'SPECTATOR_BATCH_EDGE_IDENTITY_AND_CONFIGURATION_VERIFIED_RUNTIME_OBSERVATION_REQUIRED',version:first.version,ezbrSha256:first.ezbr_sha256,closureFiles:manifest.edgeFiles.length,batch:'1'});
  return {version:first.version,batch:'1'};
 }catch{
  let disabled=false;if(changed){try{await flag('0');disabled=true;}catch{}}
  let observed=null;try{const m=await meta();observed={version:m.version,ezbrSha256:m.ezbr_sha256,status:m.status};}catch{}
  report({kind:'SPECTATOR_EDGE_STOP_NO_AUTOMATIC_RETRY',phase,batchDisabledVerified:disabled,fallback:'candidate-single-mode-not-prior-v12-rollback',observed});throw Error('Controlled Edge release stopped; inspect sanitized phase');
 }
}
async function main(){
 const env=process.env;assert.equal(env.GITHUB_REPOSITORY,repo);assert.equal(env.GITHUB_REF,'refs/heads/main');assert.equal(env.GITHUB_EVENT_NAME,'workflow_dispatch');assert.equal(env.SUPABASE_PROJECT_REF,project);assert.ok(env.SUPABASE_ACCESS_TOKEN);
 assert.equal(env.CONFIRM_EDGE_RELEASE,`RELEASE_SPECTATOR_BATCH_${env.GITHUB_SHA}`);
 const root=resolve(fileURLToPath(new URL('../..',import.meta.url))),pkg=loadPackage(root);
 const gh=path=>JSON.parse(execFileSync('gh',['api',`repos/${repo}/${path}`],{encoding:'utf8',timeout:30000,maxBuffer:2*1024*1024,stdio:['ignore','pipe','pipe']}));
 assert.equal(gh('git/ref/heads/main').object.sha,env.GITHUB_SHA);
 const run=gh(`actions/runs/${env.GITHUB_RUN_ID}`);assert.equal(run.head_sha,env.GITHUB_SHA);assert.equal(run.event,'workflow_dispatch');assert.equal(run.actor?.login,'PhamGiaVinh');assert.equal(run.triggering_actor?.login,'PhamGiaVinh');assert.equal(run.workflow_id,gh('actions/workflows/spectator342344-edge-release.yml').id);
 const pr=gh('pulls/1646');assert.equal(pr.merged,true);assert.equal(pr.head.sha,pkg.manifest.referenceProductSha);assert.equal(pr.merge_commit_sha,'440731086582389e70bc935f77df1bb90fa8a425');
 const environment=gh('environments/dealer-swing-production-critical');assert.equal(environment.deployment_branch_policy.custom_branch_policies,true);assert.ok(environment.protection_rules.some(r=>r.type==='required_reviewers'&&r.reviewers.length));assert.deepEqual(gh('environments/dealer-swing-production-critical/deployment-branch-policies').branch_policies.map(p=>p.name),['main']);
 const phaseA=gh('actions/runs/43624550712');assert.equal(phaseA.status,'completed');assert.equal(phaseA.conclusion,'success');assert.equal(phaseA.head_sha,'6fa88c1428146948b5cb74dbcf3efc38aabe5879');assert.equal(phaseA.actor.login,'PhamGiaVinh');assert.equal(phaseA.workflow_id,gh('actions/workflows/spectator342344-protected-release.yml').id);
 const artifacts=gh('actions/runs/43624550712/artifacts').artifacts.filter(a=>a.name==='spectator342344-receipts-43624550712'&&!a.expired);assert.equal(artifacts.length,1);
 const zip=execFileSync('gh',['api',`repos/${repo}/actions/artifacts/${artifacts[0].id}/zip`],{timeout:30000,maxBuffer:1024*1024,stdio:['ignore','pipe','pipe']});assert.equal('sha256:'+digest(zip),artifacts[0].digest);
 const zipPath=join(mkdtempSync(join(tmpdir(),'spectator-phase-a-')),'receipts.zip');writeFileSync(zipPath,zip);const receipt=execFileSync('unzip',['-p',zipPath,'spectator342344-apply.txt'],{encoding:'utf8',maxBuffer:1024*1024});verifyPhaseA(receipt,pkg.manifest);
 const management=async(method,path,body)=>{const response=await fetch(`https://api.supabase.com/v1/projects/${project}/${path}`,{method,headers:{Authorization:`Bearer ${env.SUPABASE_ACCESS_TOKEN}`,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)});assert.ok(response.ok,'Management request failed; raw body withheld');return method==='POST'&&path==='secrets'?undefined:response.json();};
 const query=async sql=>{const rows=await management('POST','database/query',{query:sql});assert.equal(rows.length,1);const values=Object.values(rows[0]);assert.equal(values.length,1);return typeof values[0]==='string'?JSON.parse(values[0]):values[0];};
 const verifyDatabase=async()=>{const result=await query(postcheckSql(pkg,344));classifyPostcheck(result);const active=await query(activeSql());assert.equal(active.exact,true);};
 const cli=args=>{const r=spawnSync('supabase',args,{cwd:root,encoding:'utf8',timeout:120000,maxBuffer:4*1024*1024});assert.equal(r.status,0,'CLI operation failed; raw output withheld');return r.stdout;};
 assert.equal(cli(['--version']).trim(),'2.101.0','Pinned CLI version required');
 await runEdgeRelease({manifest:pkg.manifest,management,cli,verifyDatabase,readDownloaded:async manifest=>{const downloadRoot=mkdtempSync(join(tmpdir(),'spectator-batch-verify-'));cli(['functions','download',name,'--project-ref',project,'--use-api','--workdir',downloadRoot]);verifyDownloaded(downloadRoot,manifest);},denied:async()=>{const r=await fetch(`https://${project}.supabase.co/functions/v1/${name}`,{method:'POST',signal:AbortSignal.timeout(10000)});return r.status;},report:event=>console.log(JSON.stringify(event))});
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(()=>{console.error('SPECTATOR_EDGE_RELEASE_STOP_RAW_DETAILS_WITHHELD');process.exitCode=1;});
