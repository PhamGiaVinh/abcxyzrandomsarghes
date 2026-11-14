import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,readdirSync,lstatSync,mkdtempSync,mkdirSync} from 'node:fs';
import {resolve,join,relative,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {loadPackage} from './spectator342344-release-plan.mjs';
import {postcheckSql,classifyPostcheck} from './spectator342344-protected-apply.mjs';
import {activeSql} from './spectator342344-dispatch-control.mjs';
import {PRIOR_EDGE,validatePriorEdge} from './spectator342344-production.mjs';
const project='orlesggcjamwuknxwcpk',name='public-spectator-projector-v2',repo='PhamGiaVinh/abcxyzrandomsarghes';
export const priorFiles=[{"path":"supabase/functions/public-spectator-projector-v2/index.ts","sha256":"a526662249793eb37b533a2192024fba8bab7569faf7b9c6900bf4e6c38a7d31"},{"path":"supabase/functions/_shared/vendor/tslib-2.8.1.mjs","sha256":"c38da5dd6da6281964435002ce204cd586634fe3bdfb24a0ee116f48cf3292e9"},{"path":"supabase/functions/public-spectator-projector-v2/worker.ts","sha256":"b8f252ef975bdf73900411300a35e3d1419abb95a46b259aeb95a692948f31df"},{"path":"supabase/functions/_shared/publicSpectatorReducer.ts","sha256":"e37dc20ba3a6abe1520efdfb069479abfb30ba7f7e555d66eb5e17c999b66365"},{"path":"src/lib/tracker-poker/handStateCore.ts","sha256":"de51b02dac7cd329c6768bc9510fc7bb09c3c31fd49d46f6eb9b1cd811c728ae"},{"path":"deno.json","sha256":"4318412df06f18476b113e627e442c1a8daef2ed77beaf55e8be5e16f4d6f9c0"}];
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
export function classifyHostedRuntime(before,after){
 assert.ok(Number.isSafeInteger(before.batchCalls)&&Number.isSafeInteger(after.batchCalls));
 let batchResponses=0,processed=0,published=0,errors=0;
 for(const row of after.responses){if(row.id<=before.lastResponseId)continue;let body;try{body=JSON.parse(row.content);}catch{continue;}
  if(!body||typeof body!=='object'||Array.isArray(body))continue;
  if(body.error==='projection_unavailable'){errors++;continue;}
  if(body.sourceMode!=='batch'||!Array.isArray(body.results))continue;
  batchResponses++;published+=body.results.filter(r=>r.published===true).length;if(row.status_code!==200)errors++;errors+=body.results.filter(r=>r.error).length;
  if(Number.isSafeInteger(body.processed)&&body.processed>0)processed+=body.processed;
 }
 const delta=after.batchCalls-before.batchCalls;
 return{state:batchResponses>0&&processed>0&&errors===0&&delta>0?'hosted-batch-observed':'not-proven',batchResponses,processed,published,publication:published>0?'publication-observed':'not-proven',requestAttribution:'supporting-not-exact',errors,batchRpcCallsDelta:delta};
}
export const hostedRuntimeSql=`BEGIN READ ONLY;SET LOCAL statement_timeout='5s';SELECT json_build_object(
 'batchCalls',COALESCE((SELECT sum(calls)::bigint FROM extensions.pg_stat_statements WHERE userid='service_role'::regrole AND query LIKE '%pgrst_source%' AND query ~ 'get_public_spectator_projection_sources_v2["[:space:]]*\\(' AND query NOT LIKE '%pg_stat_statements%'),0),
 'lastResponseId',COALESCE((SELECT max(id) FROM net._http_response),0),
 'responses',COALESCE((SELECT json_agg(row_to_json(r)) FROM(SELECT id,status_code,left(content,32768) AS content FROM net._http_response ORDER BY id DESC LIMIT 20)r),'[]'::json))::text;COMMIT;`;
export async function restorePriorCode({management,cli,priorRoot,readDownloaded,verifyDatabase,denied,report=()=>{}}){
 try{
 verifyDownloaded(priorRoot,{edgeFiles:priorFiles});await verifyDatabase();
 await management('POST','secrets',[{name:'PUBLIC_SPECTATOR_SOURCE_BATCH',value:'0'}]);verifySecret(await management('GET','secrets'),'0');
 cli(['functions','deploy',name,'--project-ref',project,'--no-verify-jwt','--workdir',priorRoot]);
 const meta=await management('GET',`functions/${name}`);assert.equal(meta.slug,name);assert.equal(meta.status,'ACTIVE');assert.equal(meta.verify_jwt,false);assert.equal(meta.import_map,true);assert.ok(meta.version>12);
 await readDownloaded({edgeFiles:priorFiles});const stable=await management('GET',`functions/${name}`);assert.equal(stable.version,meta.version);assert.equal(stable.ezbr_sha256,meta.ezbr_sha256);verifySecret(await management('GET','secrets'),'0');assert.equal(await denied(),401);await verifyDatabase();
 report({kind:'VERIFIED_PRIOR_V12_CODE_REDEPLOYED_AS_NEW_VERSION',version:meta.version,ezbrSha256:meta.ezbr_sha256,batch:'0',sourceCommit:'unknown'});
 }catch{
  let observed=null,flagZeroVerified=false;try{const m=await management('GET',`functions/${name}`);observed={version:m.version,ezbrSha256:m.ezbr_sha256,status:m.status};}catch{}
  try{verifySecret(await management('GET','secrets'),'0');flagZeroVerified=true;}catch{}
  report({kind:'PRIOR_CODE_RESTORE_STOP_NO_AUTOMATIC_RETRY',observed,flagZeroVerified});throw Error('Prior code restore stopped; inspect sanitized deployment state');
 }

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
 const operation=process.argv[2]??'deploy';assert.ok(['capture-prior','deploy','restore-prior'].includes(operation));
 const env=process.env;assert.equal(env.GITHUB_REPOSITORY,repo);assert.equal(env.GITHUB_REF,'refs/heads/main');assert.equal(env.GITHUB_EVENT_NAME,'workflow_dispatch');assert.equal(env.SUPABASE_PROJECT_REF,project);assert.ok(env.SUPABASE_ACCESS_TOKEN);
 assert.equal(env.CONFIRM_EDGE_RELEASE,operation==='restore-prior'?`RESTORE_SPECTATOR_PRIOR_CODE_${env.GITHUB_SHA}`:`RELEASE_SPECTATOR_BATCH_${env.GITHUB_SHA}`);
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
 const readDownloaded=async manifest=>{const downloadRoot=mkdtempSync(join(tmpdir(),'spectator-batch-verify-'));cli(['functions','download',name,'--project-ref',project,'--use-api','--workdir',downloadRoot]);verifyDownloaded(downloadRoot,manifest);};
 const denied=async()=>{const r=await fetch(`https://${project}.supabase.co/functions/v1/${name}`,{method:'POST',signal:AbortSignal.timeout(10000)});return r.status;};
 const report=event=>console.log(JSON.stringify(event));
 const priorRoot=resolve(env.RUNNER_TEMP,'spectator-prior-v12');
 if(operation==='capture-prior'){
  validatePriorEdge(await management('GET',`functions/${name}`));await verifyDatabase();
  const rawPrior=mkdtempSync(join(tmpdir(),'spectator-prior-download-'));cli(['functions','download',name,'--project-ref',project,'--use-api','--workdir',rawPrior]);verifyDownloaded(rawPrior,{edgeFiles:priorFiles});
  for(const file of priorFiles){const dest=resolve(priorRoot,file.path);mkdirSync(dirname(dest),{recursive:true});writeFileSync(dest,readFileSync(resolve(rawPrior,file.path)));}
  validatePriorEdge(await management('GET',`functions/${name}`));
  report({kind:'VERIFIED_PRIOR_V12_SIX_FILE_BACKUP',version:12,sourceCommit:'unknown'});return;
 }
 if(operation==='restore-prior'){
  assert.match(env.PRIOR_RELEASE_RUN_ID??'',/^\d+$/);const old=gh(`actions/runs/${env.PRIOR_RELEASE_RUN_ID}`);assert.equal(old.workflow_id,run.workflow_id);assert.equal(old.actor.login,'PhamGiaVinh');assert.equal(old.head_branch,'main');assert.equal(old.event,'workflow_dispatch');assert.equal(old.status,'completed');
  const items=gh(`actions/runs/${env.PRIOR_RELEASE_RUN_ID}/artifacts`).artifacts.filter(a=>a.name===`spectator-prior-v12-${env.PRIOR_RELEASE_RUN_ID}`&&!a.expired);assert.equal(items.length,1);
  const bytes=execFileSync('gh',['api',`repos/${repo}/actions/artifacts/${items[0].id}/zip`],{timeout:30000,maxBuffer:4*1024*1024,stdio:['ignore','pipe','pipe']});assert.equal('sha256:'+digest(bytes),items[0].digest);
  const backupZip=join(mkdtempSync(join(tmpdir(),'spectator-prior-')),'source.zip');writeFileSync(backupZip,bytes);
  const paths=execFileSync('unzip',['-Z1',backupZip],{encoding:'utf8'}).trim().split('\n');assert.deepEqual(paths.sort(),priorFiles.map(f=>f.path).sort());
  for(const file of priorFiles){const content=execFileSync('unzip',['-p',backupZip,file.path],{maxBuffer:2*1024*1024});assert.equal(digest(content.toString('utf8').replace(/\r\n?/g,'\n')),file.sha256);const dest=resolve(priorRoot,file.path);mkdirSync(dirname(dest),{recursive:true});writeFileSync(dest,content);}
  await restorePriorCode({management,cli,priorRoot,readDownloaded,verifyDatabase,denied,report});return;
 }
 const beforeRuntime=await query(hostedRuntimeSql);
 await runEdgeRelease({manifest:pkg.manifest,management,cli,verifyDatabase,readDownloaded,denied,report});
 for(let i=0;i<3;i++){await new Promise(r=>setTimeout(r,5000));const observed=classifyHostedRuntime(beforeRuntime,await query(hostedRuntimeSql));report({kind:'SPECTATOR_HOSTED_RUNTIME_OBSERVATION',...observed});if(observed.state==='hosted-batch-observed')break;}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(()=>{console.error('SPECTATOR_EDGE_RELEASE_STOP_RAW_DETAILS_WITHHELD');process.exitCode=1;});
