import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {policy,validateCapture,validateSource} from './floor345-fresh-baseline.mjs';
const run={id:43463982023,workflow_id:322144993,repository:{full_name:'PhamGiaVinh/abcxyzrandomsarghes'},
 actor:{login:'PhamGiaVinh'},triggering_actor:{login:'PhamGiaVinh'},head_sha:'fb6c1055d40df8c5b014e9de228a98e1c6e0cbf9',
 head_branch:'main',event:'workflow_dispatch',status:'completed',conclusion:'success'};
const artifact={id:14058760605,name:'live-public-schema',digest:'sha256:e6c5509e28f50b82e850405958953c988cbd3853eef8deaf5b0a3f849372bbc0',expired:false,size_in_bytes:796667};
test('fresh capture remains explicitly different from historical recovery',()=>{
 assert.equal(policy.kind,'FRESH_CURRENT_SCHEMA_FOR_FLOOR345_NOT_PRE03_RECOVERY');
 assert.equal(policy.productionMutation,false); assert.equal(validateCapture(run,artifact),true);
});
for(const patch of [{id:1},{workflow_id:1},{repository:{full_name:'other/repo'}},{actor:{login:'other'}},
 {triggering_actor:{login:'other'}},{head_branch:'feature'},{head_sha:'0'.repeat(40)},
 {event:'pull_request'},{status:'in_progress'},{conclusion:'failure'}]){
 test(`rejects unqualified capture ${JSON.stringify(patch)}`,()=>assert.throws(()=>validateCapture({...run,...patch},artifact)));
}
for(const patch of [{id:1},{name:'other'},{digest:'sha256:'+'0'.repeat(64)},{expired:true},{size_in_bytes:0}]){
 test(`rejects unqualified artifact ${JSON.stringify(patch)}`,()=>assert.throws(()=>validateCapture(run,{...artifact,...patch})));
}
test('only the reviewed canonical SQL bytes qualify; never historical migration replay',()=>{
 const bytes=execFileSync('git',['show',`${policy.candidateSha}:${policy.migration.path}`]);
 assert.equal(validateSource(bytes),true);
 assert.throws(()=>validateSource(Buffer.concat([bytes,Buffer.from('\n-- drift')])));
});
