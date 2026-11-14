import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const repository='PhamGiaVinh/abcxyzrandomsarghes';
const source='71d20fcefaf2c104b0a4cf9e35011b527c1a6882';
export const sourceRunIds=[43617991978,43617991950,43617991959,43617991984,43617991949,43617992146,43617992221,43617992060,43617991953];
export function validateGithubEvidence(env,{run,workflow,pr,environment,branches,sourceRuns}){
 assert.equal(env.GITHUB_REPOSITORY,repository);assert.equal(env.GITHUB_REF,'refs/heads/main');
 assert.equal(env.GITHUB_EVENT_NAME,'workflow_dispatch');assert.equal(env.RELEASE_SHA,source);
 assert.equal(String(run.id),env.GITHUB_RUN_ID);assert.equal(run.workflow_id,workflow.id);
 assert.equal(run.head_sha,env.GITHUB_SHA);assert.equal(run.head_branch,'main');
 assert.equal(run.event,'workflow_dispatch');assert.equal(run.actor?.login,'PhamGiaVinh');assert.equal(run.triggering_actor?.login,'PhamGiaVinh');
 assert.equal(pr.number,1646);assert.equal(pr.state,'open');assert.equal(pr.base?.ref,'main');assert.equal(pr.base?.sha,env.GITHUB_SHA);
 assert.equal(pr.head?.sha,source);assert.equal(pr.head?.repo?.full_name,repository);
 assert.equal(environment.deployment_branch_policy?.custom_branch_policies,true);
 assert.ok(environment.protection_rules?.some(rule=>rule.type==='required_reviewers'&&rule.reviewers?.length>0),'Protected reviewers required');
 assert.deepEqual(branches.branch_policies?.map(x=>x.name).sort(),['main']);
 assert.equal(sourceRuns.length,sourceRunIds.length);
 for(const [i,result] of sourceRuns.entries()){
  assert.equal(result.id,sourceRunIds[i]);assert.equal(result.head_sha,source);
  assert.equal(result.status,'completed');assert.equal(result.conclusion,'success');assert.equal(result.event,'pull_request');
 }
}
function main(){
 const env=process.env;
 assert.match(env.GITHUB_RUN_ID??'',/^\d+$/);assert.match(env.GITHUB_SHA??'',/^[a-f0-9]{40}$/);
 const get=path=>JSON.parse(execFileSync('gh',['api',`repos/${repository}/${path}`],{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:30000,maxBuffer:2*1024*1024}));
 const run=get(`actions/runs/${env.GITHUB_RUN_ID}`),workflow=get('actions/workflows/spectator342344-protected-release.yml');
 validateGithubEvidence(env,{run,workflow,pr:get('pulls/1646'),environment:get('environments/dealer-swing-production-critical'),
  branches:get('environments/dealer-swing-production-critical/deployment-branch-policies'),sourceRuns:sourceRunIds.map(id=>get(`actions/runs/${id}`))});
 console.log('AUTHENTICATED_EXACT_SOURCE_CONTROLLER_AND_REQUIRED_CHECKS_PASS');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{main();}catch{console.error('SPECTATOR342344_GITHUB_PROVENANCE_STOP');process.exitCode=1;}
}
