import test from 'node:test';
import assert from 'node:assert/strict';
import {validateExecution,executeOnce,buildWriteSql,expectedInventory,confirmation,repository,project} from './retire-test-buyins-controller.mjs';

function fixture(){
 const sha='a'.repeat(40),now=Date.now(),who={login:'PhamGiaVinh'};
 const env={GITHUB_ACTIONS:'true',GITHUB_REF:'refs/heads/main',GITHUB_SHA:sha,RELEASE_SHA:sha,SOURCE_CHECKOUT_SHA:sha,RECOVERY_BASE_SHA:sha,
  INITIAL_ACTOR:'PhamGiaVinh',TRIGGERING_ACTOR:'PhamGiaVinh',REPOSITORY_OWNER:'PhamGiaVinh',GITHUB_REPOSITORY:repository,
  GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_RUN_ID:'100',RECOVERY_RUN_ID:'300',QUALIFICATION_RUN_ID:'200',
  SUPABASE_PROJECT_REF:project,PGHOST:'aws-1-ap-southeast-2.pooler.supabase.com',PGPORT:'5432',PGUSER:'postgres.'+project,
  PGDATABASE:'postgres',PGSSLMODE:'require',PGPASSWORD:'SYNTHETIC_FIXTURE_ONLY',CONFIRM_TEST_BUYIN_CLEANUP:confirmation};
 const receipt={schemaVersion:1,kind:'vinpoker-restore-verification',sourceSha:sha,snapshotAt:new Date(now-1000).toISOString(),
  isolatedRestore:'PASS',tableCountMatch:'PASS',productionMutation:false,ciphertextSha256:'c'.repeat(64),databaseOwnerAndEffectiveAclMatch:true};
 const evidence={run:{id:100,workflow_id:1,status:'in_progress',head_sha:sha,head_branch:'main',event:'workflow_dispatch',actor:who,triggering_actor:who},
  workflow:{id:1},mainRef:{ref:'refs/heads/main',object:{sha}},pr:{number:1664,merged:true,merge_commit_sha:sha,base:{ref:'main'},head:{sha:'b'.repeat(40),repo:{full_name:repository}}},
  qualification:{id:200,workflow_id:2,head_sha:'b'.repeat(40),event:'pull_request',status:'completed',conclusion:'success'},qualificationWorkflow:{id:2},qualificationJobs:{jobs:[{name:'restored-schema',conclusion:'success'}]},
  environment:{deployment_branch_policy:{custom_branch_policies:true},protection_rules:[{type:'required_reviewers',reviewers:[who]}]},branches:{branch_policies:[{name:'main'}]},
  recoveryRun:{id:300,workflow_id:3,head_sha:sha,event:'workflow_dispatch',head_branch:'main',status:'completed',conclusion:'success',actor:who,triggering_actor:who},recoveryWorkflow:{id:3},
  recoveryArtifact:{name:'floor-v3-restore-verification-300',expired:false,size_in_bytes:1000,digest:'sha256:'+'d'.repeat(64)},active:[]};
 return {env,receipt,evidence,now};
}
const before={rows:5,preimages:5,cancelled:0,auditExact:0,inFlight:0};
const after={rows:5,preimages:0,cancelled:5,auditExact:5,inFlight:0};
function transport(outputs,{fail=false}={}){
 let writes=0;const events=[];
 return {events,get writes(){return writes;},json:()=>structuredClone(outputs.shift()),execute:()=>{writes++;if(fail)throw Error('PRIVATE_SENTINEL');}};
}
test('authenticated exact source/recovery/protected reviewer context and fixed SQL accepted',()=>{
 const f=fixture();validateExecution(f.env,f.receipt,f.evidence,f.now);
 assert.match(buildWriteSql(f.env.RELEASE_SHA),/TEST_CLEANUP_INVENTORY_CHANGED/u);
});
test('wrong actor/tenant/source, expired recovery and weakened protection fail before write',()=>{
 const mutations=[
  f=>f.env.INITIAL_ACTOR='other',f=>f.env.SUPABASE_PROJECT_REF='other',f=>f.env.PGHOST='other',
  f=>f.env.CONFIRM_TEST_BUYIN_CLEANUP='other',f=>f.env.PGOPTIONS='-c role=postgres',
  f=>f.evidence.mainRef.object.sha='b'.repeat(40),f=>f.evidence.pr.merged=false,
  f=>f.evidence.qualification.conclusion='failure',f=>f.evidence.qualification.head_sha='c'.repeat(40),
  f=>f.evidence.qualificationJobs.jobs[0].conclusion='skipped',
  f=>f.evidence.environment.protection_rules=[],f=>f.evidence.branches.branch_policies.push({name:'*'}),
  f=>f.evidence.active.push(301),f=>f.evidence.recoveryRun.actor.login='other',
  f=>f.receipt.snapshotAt=new Date(f.now-3600001).toISOString(),f=>f.receipt.databaseOwnerAndEffectiveAclMatch=false,
  f=>f.receipt.sourceSha='b'.repeat(40),f=>f.evidence.recoveryArtifact.expired=true,
 ];
 for(const change of mutations){const f=fixture();change(f);assert.throws(()=>validateExecution(f.env,f.receipt,f.evidence,f.now));}
});
test('one verified write only, with exact final source and audit state',()=>{
 const f=fixture(),t=transport([{actor:'postgres',database:'postgres',inventory:expectedInventory},before,after]);
 const result=executeOnce({...f,transport:t,now:()=>f.now});
 assert.equal(result.phase,'EXACT_5_CANCELLED_AUDIT_VERIFIED');assert.equal(t.writes,1);
});
test('inventory or preimage drift prevents any write',()=>{
 for(const output of [[{actor:'postgres',database:'postgres',inventory:{}}],[{actor:'postgres',database:'postgres',inventory:expectedInventory},{...before,preimages:4}]]){
  const f=fixture(),t=transport(output);assert.throws(()=>executeOnce({...f,transport:t,now:()=>f.now}));assert.equal(t.writes,0);
 }
});
test('backup freshness is rechecked immediately before write',()=>{
 const f=fixture(),t=transport([{actor:'postgres',database:'postgres',inventory:expectedInventory},before]);let call=0;
 assert.throws(()=>executeOnce({...f,transport:t,now:()=>f.now+(call++?3600001:0)}));assert.equal(t.writes,0);
});
test('wire uncertainty and bad final observations stop without automatic retry or private output',()=>{
 for(const fail of [true,false]){
  const f=fixture(),t=transport([{actor:'postgres',database:'postgres',inventory:expectedInventory},before,{...after,inFlight:1}],{fail});const reports=[];
  assert.throws(()=>executeOnce({...f,transport:t,now:()=>f.now,report:r=>reports.push(r)}));
  assert.equal(t.writes,1);assert.ok(!JSON.stringify(reports).includes('PRIVATE_SENTINEL'));
 }
});
