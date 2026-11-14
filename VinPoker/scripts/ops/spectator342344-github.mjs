import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const repository='PhamGiaVinh/abcxyzrandomsarghes';
const source='71d20fcefaf2c104b0a4cf9e35011b527c1a6882';
export const sourceBaseSha='883131bd15a62620886fbbec2008c93b0b67aa5a';
export const controlPaths=new Set([
 '.github/workflows/spectator342344-protected-release.yml',
 ...['atomic-postgres.mjs','dispatch-control.mjs','dispatch-control.test.mjs','dispatcher-current.fixture.sql','github.mjs','github.test.mjs','manifest.json','production.mjs','protected-apply.mjs','protected-apply.test.mjs','release-context.mjs','release-context.test.mjs','release-plan.mjs','release-plan.test.mjs'].map(name=>'VinPoker/scripts/ops/spectator342344-'+name)
]);
export function validateControlAdvance(base,head,comparison,complete=false){
 assert.match(base,/^[a-f0-9]{40}$/);assert.match(head,/^[a-f0-9]{40}$/);
 assert.equal(comparison.base_commit?.sha,base);assert.equal(comparison.merge_base_commit?.sha,base);
 assert.equal(comparison.status,base===head?'identical':'ahead');
 assert.ok(Array.isArray(comparison.commits)&&comparison.commits.length<250);
 assert.equal(comparison.total_commits,comparison.commits.length);assert.equal(comparison.ahead_by,comparison.total_commits);assert.equal(comparison.behind_by,0);
 if(base!==head){assert.ok(comparison.commits.length>0);assert.equal(comparison.commits.at(-1).sha,head);}
 else assert.equal(comparison.commits.length,0);
 assert.ok(Array.isArray(comparison.files)&&comparison.files.length<300);
 const paths=new Set();for(const file of comparison.files){
  assert.ok(controlPaths.has(file.filename),'Unreviewed control advance');assert.ok(['added','modified'].includes(file.status));
  assert.equal(file.previous_filename,undefined);assert.ok(!paths.has(file.filename));paths.add(file.filename);
 }
 if(complete)assert.deepEqual([...paths].sort(),[...controlPaths].sort());
 if(base===head)assert.equal(paths.size,0);
}
export const sourceRunIds=[43617991978,43617991950,43617991959,43617991984,43617991949,43617992146,43617992221,43617992060,43617991953];
export function validateGithubEvidence(env,{run,workflow,pr,environment,branches,sourceRuns,mainRef,sourceCommit,controllerCompare,recoveryCompare}){
 assert.equal(env.GITHUB_REPOSITORY,repository);assert.equal(env.GITHUB_REF,'refs/heads/main');
 assert.equal(env.GITHUB_EVENT_NAME,'workflow_dispatch');assert.equal(env.RELEASE_SHA,source);
 assert.equal(String(run.id),env.GITHUB_RUN_ID);assert.equal(run.workflow_id,workflow.id);
 assert.equal(run.head_sha,env.GITHUB_SHA);assert.equal(run.head_branch,'main');
 assert.equal(run.event,'workflow_dispatch');assert.equal(run.actor?.login,'PhamGiaVinh');assert.equal(run.triggering_actor?.login,'PhamGiaVinh');
 assert.equal(pr.number,1646);assert.equal(pr.state,'open');assert.equal(pr.base?.ref,'main');assert.equal(pr.base?.sha,sourceBaseSha);
 assert.equal(mainRef.ref,'refs/heads/main');assert.equal(mainRef.object?.type,'commit');assert.equal(mainRef.object?.sha,env.GITHUB_SHA);
 assert.equal(sourceCommit.sha,source);assert.equal(sourceCommit.parents?.[1]?.sha,sourceBaseSha);
 validateControlAdvance(sourceBaseSha,env.GITHUB_SHA,controllerCompare,true);
 if(env.RECOVERY_BASE_SHA)validateControlAdvance(env.RECOVERY_BASE_SHA,env.GITHUB_SHA,recoveryCompare);
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
  mainRef:get('git/ref/heads/main'),sourceCommit:get(`commits/${source}`),controllerCompare:get(`compare/${sourceBaseSha}...${env.GITHUB_SHA}?per_page=100`),
  recoveryCompare:env.RECOVERY_BASE_SHA?get(`compare/${env.RECOVERY_BASE_SHA}...${env.GITHUB_SHA}?per_page=100`):undefined,
  branches:get('environments/dealer-swing-production-critical/deployment-branch-policies'),sourceRuns:sourceRunIds.map(id=>get(`actions/runs/${id}`))});
 console.log('AUTHENTICATED_EXACT_SOURCE_CONTROLLER_AND_REQUIRED_CHECKS_PASS');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{main();}catch{console.error('SPECTATOR342344_GITHUB_PROVENANCE_STOP');process.exitCode=1;}
}
