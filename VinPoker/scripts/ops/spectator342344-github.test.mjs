import test from 'node:test';
import assert from 'node:assert/strict';
import {validateGithubEvidence,sourceRunIds,sourceBaseSha,controlPaths,validateControlAdvance} from './spectator342344-github.mjs';
function fixture(){
 const source='71d20fcefaf2c104b0a4cf9e35011b527c1a6882',main='a'.repeat(40);
 const env={GITHUB_REPOSITORY:'PhamGiaVinh/abcxyzrandomsarghes',GITHUB_REF:'refs/heads/main',GITHUB_EVENT_NAME:'workflow_dispatch',RELEASE_SHA:source,GITHUB_RUN_ID:'123',GITHUB_SHA:main};
 const comparison={base_commit:{sha:sourceBaseSha},merge_base_commit:{sha:sourceBaseSha},status:'ahead',total_commits:1,ahead_by:1,behind_by:0,commits:[{sha:main}],files:[...controlPaths].map(filename=>({filename,status:'added'}))};
 const evidence={mainRef:{ref:'refs/heads/main',object:{type:'commit',sha:main}},sourceCommit:{sha:source,parents:[{sha:'b'.repeat(40)},{sha:sourceBaseSha}]},controllerCompare:comparison,run:{id:123,workflow_id:456,head_sha:main,head_branch:'main',event:'workflow_dispatch',actor:{login:'PhamGiaVinh'},triggering_actor:{login:'PhamGiaVinh'}},workflow:{id:456},
  pr:{number:1646,state:'open',base:{ref:'main',sha:sourceBaseSha},head:{sha:source,repo:{full_name:env.GITHUB_REPOSITORY}}},
  environment:{deployment_branch_policy:{custom_branch_policies:true},protection_rules:[{type:'required_reviewers',reviewers:[{id:1}]}]},branches:{branch_policies:[{name:'main'}]},
  sourceRuns:sourceRunIds.map(id=>({id,head_sha:source,status:'completed',conclusion:'success',event:'pull_request'}))};
 return{env,evidence};
}
test('authenticated owner main dispatch binds exact open PR, reviewers and source CI runs',()=>{
 const{env,evidence}=fixture();validateGithubEvidence(env,evidence);
 for(const [field,value] of [['GITHUB_REF','refs/heads/other'],['RELEASE_SHA','b'.repeat(40)],['GITHUB_RUN_ID','124'],['GITHUB_SHA','c'.repeat(40)]])assert.throws(()=>validateGithubEvidence({...env,[field]:value},evidence));
});
test('stale PR, foreign actor, absent reviewers and failed or wrong-SHA runs stop',()=>{
 const mutations=[e=>{e.pr.base.sha='d'.repeat(40);},e=>{e.pr.head.sha='e'.repeat(40);},e=>{e.pr.state='closed';},e=>{e.run.triggering_actor.login='other';},e=>{e.run.workflow_id=999;},
  e=>{e.environment.protection_rules=[];},e=>{e.branches.branch_policies.push({name:'other'});},e=>{e.sourceRuns[0].conclusion='failure';},e=>{e.sourceRuns[0].head_sha='f'.repeat(40);},e=>{e.sourceRuns.pop();}];
 for(const mutation of mutations){const{env,evidence}=fixture();mutation(evidence);assert.throws(()=>validateGithubEvidence(env,evidence));}
});

test('control ancestry rejects truncation, unrelated paths, renames and incomplete coverage',()=>{
 const {evidence,env}=fixture();
 for(const change of [c=>c.commits=[],c=>c.files.pop(),c=>c.files[0].filename='VinPoker/src/App.tsx',c=>c.files[0].previous_filename='old',c=>c.merge_base_commit.sha='f'.repeat(40),c=>c.files[0].status='removed']){
  const c=structuredClone(evidence.controllerCompare);change(c);assert.throws(()=>validateControlAdvance(sourceBaseSha,env.GITHUB_SHA,c,true));
 }
 const c=structuredClone(evidence.controllerCompare);c.files=c.files.slice(0,1);validateControlAdvance(sourceBaseSha,env.GITHUB_SHA,c);
});
