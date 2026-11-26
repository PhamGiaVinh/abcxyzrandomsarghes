import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { edgeConsumers, releaseSha } from './tracker-bb-ante-release.mjs';
import { validateContext } from './floor-37-47-protected-apply.mjs';
import { loadDeploymentManifest } from '../deploy/deployment-manifest.mjs';
import { receiptComponents, recordSuccessfulReceipt, selectLatestSuccessfulReceipt } from '../deploy/deployment-receipts.mjs';

const project='orlesggcjamwuknxwcpk';
const frontendProject='prj_wLBZF7nG5O2bffM9Qu1v2rgMuMwk';
const team='team_tjxaiA2Z3ZwHSQUMnMs4F5yE';
// Exact independently reviewed deployment now serving production. Never accept
// an arbitrary successor or redeploy the original frontend over this release.
export const reviewedFrontend = Object.freeze({
  sourceSha:'c6e8bea574c438138734323637adf0a50e55c533',
  deploymentId:'dpl_4yEFUmAMegq5nUXEX39yPK75ZJUR',
  workflowRunId:'45407139593',
});
// Read-only production inventory observed2026-11-24. Drift requires review.
export const baseline=Object.freeze([
  {slug:'tournament-live-update',id:'4b89f5f8-05af-4025-a276-fe1f5051c6f1',version:80,verify_jwt:true,status:'ACTIVE'},
  {slug:'tournament-live-resettle',id:'deceffe8-f8a9-4269-a739-447657026f66',version:10,verify_jwt:true,status:'ACTIVE'},
  {slug:'tournament-live-resettle-commit',id:'12e0cb2a-98e7-4401-bf40-1a35ef1cc71e',version:18,verify_jwt:true,status:'ACTIVE'},
  {slug:'tournament-historical-settlement',id:'cda09755-240e-4a1e-be9b-c5a4f832e400',version:26,verify_jwt:true,status:'ACTIVE'},
  {slug:'tournament-historical-settlement-worker',id:'b28097ab-1af2-4a4b-a3bf-d0c4f51c9902',version:21,verify_jwt:false,status:'ACTIVE'},
  {slug:'tournament-historical-settlement-dispatcher',id:'4131b9e0-2659-4808-aed0-2c3d2a633adf',version:17,verify_jwt:false,status:'ACTIVE'},
]);
const subset=row=>({slug:row.slug,id:row.id,version:row.version,verify_jwt:row.verify_jwt,status:row.status});
function selected(inventory,slug){const rows=inventory.filter(row=>row.slug===slug);assert.equal(rows.length,1,'Edge metadata missing or duplicated');return subset(rows[0]);}
function frontendMatches(row){return row?.projectId===frontendProject&&row.target==='production'&&row.readyState==='READY'&&row.gitSource?.sha===releaseSha&&!row.meta?.gitDirty;}
function reviewedFrontendMatches(row){return row?.id===reviewedFrontend.deploymentId&&row.projectId===frontendProject&&row.target==='production'&&row.readyState==='READY'
  &&row.gitSource==null&&row.meta?.githubCommitSha===reviewedFrontend.sourceSha&&row.meta?.gitDirty==='1';}

export function validateConsumerReceipt(receipt){
  assert.ok(receipt?.sourceSha===releaseSha&&receipt.edgeVerified===true&&Array.isArray(receipt.edgeVersions),'Consumer receipt incomplete');
  assert.deepEqual(receipt.edgeFunctions,edgeConsumers,'Consumer receipt functions differ');
  assert.equal(receipt.edgeVersions.length,baseline.length,'Consumer receipt versions incomplete');
  for(const expected of baseline){const row=receipt.edgeVersions.find(r=>r.slug===expected.slug);
    assert.deepEqual(row,{...expected,beforeVersion:expected.version,version:expected.version+1},'Consumer receipt Edge metadata differs');}
  assert.ok(receipt.frontend?.projectId===frontendProject&&receipt.frontend.hostname==='vinpoker.vercel.app'&&receipt.frontend.readyState==='READY','Consumer receipt frontend differs');
  assert.match(receipt.frontend.deploymentId,/^dpl_[a-zA-Z0-9]+$/);
}

export function validateActivationReceipt(receipt){
  validateConsumerReceipt(receipt);
  const proof=receipt.activationFrontend;
  if(proof?.kind==='original'){
    assert.deepEqual(proof,{kind:'original',sourceSha:releaseSha,deploymentId:receipt.frontend.deploymentId});return;
  }
  assert.ok(proof?.kind==='reviewed-successor'&&proof.sourceSha===reviewedFrontend.sourceSha
    &&proof.deploymentId===reviewedFrontend.deploymentId&&proof.workflowRunId===reviewedFrontend.workflowRunId
    &&Number.isSafeInteger(proof.githubReceiptId)&&proof.githubReceiptId>0,'Current frontend release evidence missing or different');
}

export async function verifyDeployedConsumers(transport, receipt){
  validateConsumerReceipt(receipt);
  await transport.frontendPreflight();
  const inventory=await transport.listEdges();
  for(const expected of baseline)assert.deepEqual(selected(inventory,expected.slug),{...expected,version:expected.version+1},'Resumed Edge metadata differs');
  const deployed=await transport.getFrontend(receipt.frontend.deploymentId);
  const alias=await transport.getFrontend('vinpoker.vercel.app');
  assert.ok(frontendMatches(deployed)&&deployed.id===receipt.frontend.deploymentId,'Original frontend receipt deployment differs');
  let proof;
  if(frontendMatches(alias)&&alias.id===deployed.id){
    proof={kind:'original',sourceSha:releaseSha,deploymentId:deployed.id};
  }else{
    assert.ok(reviewedFrontendMatches(alias),'Resumed frontend revision or alias differs');
    const evidence=await transport.reviewedFrontendReceipt();
    assert.ok(evidence?.sha===reviewedFrontend.sourceSha&&Number.isSafeInteger(evidence.deploymentId)&&evidence.deploymentId>0,'Reviewed frontend durable receipt missing');
    proof={kind:'reviewed-successor',...reviewedFrontend,githubReceiptId:evidence.deploymentId};
  }
  await transport.verifyShells();
  const result={...receipt,activationFrontend:proof};validateActivationReceipt(result);return result;
}

export async function deployConsumers(transport,save){
  const initial=await transport.listEdges();
  for(const expected of baseline)assert.deepEqual(selected(initial,expected.slug),expected,'Edge production baseline differs');
  await transport.frontendPreflight();
  const receipt={sourceSha:releaseSha,edgeFunctions:[...edgeConsumers],edgeVersions:[],edgeVerified:false};
  save(receipt);
  for(const expected of baseline){
    await transport.deployEdge(expected.slug); // One write; never retry on an unknown response.
    const row=selected(await transport.listEdges(),expected.slug);
    assert.deepEqual(row,{...expected,version:expected.version+1},'Edge deployed metadata differs');
    receipt.edgeVersions.push({...row,beforeVersion:expected.version});save(receipt);
    await transport.recordComponent(expected.slug);
  }
  const created=await transport.createFrontend();
  assert.match(created.id,/^dpl_[a-zA-Z0-9]+$/);
  receipt.pendingFrontendId=created.id;save(receipt);
  const deadline=transport.now()+20*60*1000;
  while(true){
    const deployment=await transport.getFrontend(created.id);
    assert.equal(deployment.projectId,frontendProject,'Wrong frontend project');
    assert.equal(deployment.gitSource?.sha,releaseSha,'Wrong frontend revision');
    assert.ok(!['ERROR','CANCELED'].includes(deployment.readyState),'Frontend build failed');
    if(frontendMatches(deployment)){
      const alias=await transport.getFrontend('vinpoker.vercel.app');
      if(alias.id===created.id&&frontendMatches(alias))break;
    }
    assert.ok(transport.now()<deadline,'Frontend readiness/alias timeout');
    await transport.wait(15000);
  }
  // Re-read every Edge after the frontend build; a concurrent change stops activation.
  const latest=await transport.listEdges();
  for(const expected of baseline)assert.deepEqual(selected(latest,expected.slug),{...expected,version:expected.version+1},'Edge metadata changed before activation');
  await transport.verifyShells();
  await transport.recordComponent('frontend');
  receipt.frontend={projectId:frontendProject,hostname:'vinpoker.vercel.app',deploymentId:created.id,readyState:'READY'};
  receipt.edgeVerified=true;delete receipt.pendingFrontendId;
  validateConsumerReceipt(receipt);save(receipt);return receipt;
}

async function main(){
  const mode=process.argv[2];assert.ok(['preflight','deploy','verify-deployed'].includes(mode),'Explicit preflight, deploy or verify-deployed mode required');
  const env=process.env;
  assert.equal(env.GITHUB_EVENT_NAME,'workflow_dispatch');assert.equal(env.GITHUB_REPOSITORY,'PhamGiaVinh/abcxyzrandomsarghes');
  assert.equal(env.CONFIRM_TRACKER_BBA,`APPLY_TRACKER_BBA_350_351_${releaseSha}`);
  assert.equal(env.RELEASE_SHA,releaseSha);
  validateContext(env,JSON.parse(readFileSync(env.RECOVERY_RECEIPT_PATH,'utf8')));
  const root=resolve(env.RELEASE_SOURCE_ROOT);
  assert.equal(execFileSync('git',['-C',root,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),releaseSha);
  assert.equal(execFileSync('supabase',['--version'],{encoding:'utf8'}).trim(),'2.101.0');
  assert.ok(env.SUPABASE_ACCESS_TOKEN&&env.VERCEL_TOKEN&&env.GITHUB_TOKEN&&env.CONSUMER_RECEIPT_PATH);
  const manifest=loadDeploymentManifest();
  const registered=receiptComponents(manifest);
  const cli=args=>{
    const child=spawnSync('supabase',args,{cwd:root,env,encoding:'utf8',timeout:180000,maxBuffer:2*1024*1024});
    if(child.error||child.status!==0)throw Error('Supabase consumer command failed; inspect version before any retry');
    return child.stdout;
  };
  const vercel=async(path,body)=>{
    const response=await fetch(`https://api.vercel.com${path}${path.includes('?')?'&':'?'}teamId=${team}`,{
      method:body?'POST':'GET',headers:{Authorization:`Bearer ${env.VERCEL_TOKEN}`,'Content-Type':'application/json'},
      ...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000),
    });
    if(!response.ok)throw Error(`Vercel consumer operation failed (${response.status}); no automatic writer retry`);
    return response.json();
  };
  const github=async path=>{
    const response=await fetch(`https://api.github.com/repos/${env.GITHUB_REPOSITORY}/${path}`,{
      headers:{Authorization:`Bearer ${env.GITHUB_TOKEN}`,Accept:'application/vnd.github+json'},signal:AbortSignal.timeout(30000),
    });
    assert.ok(response.ok,'Reviewed frontend GitHub evidence unavailable');return response.json();
  };
  const transport={
    listEdges:async()=>JSON.parse(cli(['functions','list','--project-ref',project,'--output','json'])),
    deployEdge:async slug=>{assert.ok(edgeConsumers.includes(slug));cli(['functions','deploy',slug,'--project-ref',project,'--use-api','--yes']);console.log('TRACKER_EDGE_DEPLOYED '+slug);},
    createFrontend:()=>vercel('/v13/deployments',{name:'vinpoker',project:frontendProject,target:'production',gitSource:{type:'github',repoId:1240686570,ref:releaseSha}}),
    getFrontend:id=>{assert.ok(/^dpl_[a-zA-Z0-9]+$/.test(id)||id==='vinpoker.vercel.app');return vercel('/v13/deployments/'+id);},
    reviewedFrontendReceipt:async()=>{
      const run=await github('actions/runs/'+reviewedFrontend.workflowRunId);
      assert.ok(run.status==='completed'&&run.conclusion==='success'&&run.event==='workflow_dispatch'&&run.head_branch==='main'
        &&run.head_sha===reviewedFrontend.sourceSha&&run.path==='.github/workflows/vbackerworkflowmain.yml'
        &&run.actor?.login===env.REPOSITORY_OWNER&&run.triggering_actor?.login===env.REPOSITORY_OWNER,'Reviewed frontend protected workflow not successful');
      const deployments=await github('deployments?'+new URLSearchParams({environment:registered.frontend,sha:reviewedFrontend.sourceSha,per_page:'10'}));
      assert.ok(Array.isArray(deployments),'Reviewed frontend deployment evidence malformed');
      const statuses=new Map();
      for(const deployment of deployments){assert.equal(deployment.sha,reviewedFrontend.sourceSha);statuses.set(String(deployment.id),await github(`deployments/${deployment.id}/statuses?per_page=10`));}
      return selectLatestSuccessfulReceipt(deployments,statuses);
    },
    frontendPreflight:async()=>{
      const settings=await vercel('/v9/projects/'+frontendProject);
      assert.ok(settings.id===frontendProject&&settings.accountId===team&&settings.rootDirectory==='VinPoker'&&settings.framework==='vite','Frontend production project settings differ');
      const alias=await vercel('/v13/deployments/vinpoker.vercel.app');
      assert.equal(alias.projectId,frontendProject,'Frontend production alias belongs to another project');
    },
    now:()=>Date.now(),wait:milliseconds=>new Promise(resolve=>setTimeout(resolve,milliseconds)),
    verifyShells:async()=>{
      const result=spawnSync(process.execPath,[resolve('scripts/deploy/verify-app-shell-routing.mjs'),'--base-url','https://vinpoker.vercel.app'],{env,encoding:'utf8',timeout:30000});
      assert.ok(!result.error&&result.status===0,'Player/Ops frontend shells failed verification');
    },
    recordComponent:async component=>{
      // Reuse existing durable receipts for centrally registered components.
      // The other five exact consumers remain in this run's version artifact.
      if(registered[component])await recordSuccessfulReceipt({repository:env.GITHUB_REPOSITORY,token:env.GITHUB_TOKEN,component,targetSha:releaseSha,manifest});
    },
  };
  if(mode==='verify-deployed'){
    const receipt=await verifyDeployedConsumers(transport,JSON.parse(readFileSync(env.CONSUMER_RECEIPT_PATH,'utf8')));
    writeFileSync(env.CONSUMER_RECEIPT_PATH,JSON.stringify(receipt,null,2)+'\n',{mode:0o600});
    console.log('TRACKER_EXISTING_CONSUMERS_READONLY_VERIFIED');return;
  }
  if(mode==='preflight'){
    const inventory=await transport.listEdges();
    for(const expected of baseline)assert.deepEqual(selected(inventory,expected.slug),expected,'Edge production baseline differs');
    await transport.frontendPreflight();console.log('TRACKER_CONSUMERS_READONLY_PREFLIGHT_PASS');return;
  }
  await deployConsumers(transport,receipt=>writeFileSync(env.CONSUMER_RECEIPT_PATH,JSON.stringify(receipt,null,2)+'\n',{mode:0o600}));
  console.log('TRACKER_CONSUMERS_VERIFIED_FOR_ACTIVATION');
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  try{await main();}catch{console.error('TRACKER_CONSUMERS_STOP; retain dormant rule and inspect metadata receipt');process.exitCode=1;}
}
