import test from 'node:test';
import assert from 'node:assert/strict';
import {validateLedger,ledgerIdentity,validateApproval} from './spectator342344-release-context.mjs';
import {loadPackage,MANIFEST_SHA256} from './spectator342344-release-plan.mjs';
const root=process.env.RELEASE_SOURCE_ROOT;assert.ok(root);
const {manifest}=loadPackage(root);
const rows=[{version:'20260922000000',name:null},{version:'20270128000345',name:'floor_operator_fast_bust_v1'}];
test('live version/name identity accepts known history and active sources, never unknown pairs',()=>{
 const m={ledger:{rows:2,identitySha256:ledgerIdentity(rows)}};
 validateLedger(rows,m,root);
 assert.throws(()=>validateLedger([...rows,{version:'20270128000999',name:'unknown'}],m,root));
 const wrong=[rows[0],{...rows[1],name:'unmapped'}];
 assert.throws(()=>validateLedger(wrong,{ledger:{rows:2,identitySha256:ledgerIdentity(wrong)}},root),/Unmapped/);
 assert.throws(()=>ledgerIdentity([rows[0],rows[0]]),/Duplicate/);
});
function approved(){
 const now=Date.parse('2026-11-15T00:30:00+07:00');
 const controller='1'.repeat(40),sha=manifest.referenceProductSha;
 const env={RELEASE_SHA:sha,SOURCE_CHECKOUT_SHA:sha,GITHUB_SHA:controller,GITHUB_REF:'refs/heads/main',GITHUB_ACTIONS:'true',
  INITIAL_ACTOR:'PhamGiaVinh',TRIGGERING_ACTOR:'PhamGiaVinh',REPOSITORY_OWNER:'PhamGiaVinh',
  SUPABASE_PROJECT_REF:'orlesggcjamwuknxwcpk',PGHOST:'aws-1-ap-southeast-2.pooler.supabase.com',PGPORT:'5432',
  PGUSER:'postgres.orlesggcjamwuknxwcpk',PGDATABASE:'postgres',PGSSLMODE:'require',PGPASSWORD:'synthetic-unit-only',
  RECOVERY_BASE_SHA:controller,GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_REPOSITORY:'PhamGiaVinh/abcxyzrandomsarghes',
  MANIFEST_SHA256,SOURCE_PR:'1646',SOURCE_PR_BASE_SHA:manifest.sourceBaseSha,CONFIRM_SPECTATOR_PACKAGE:`APPLY_SPECTATOR_342_344_${sha}`};
 const recovery={schemaVersion:1,kind:'vinpoker-restore-verification',sourceSha:controller,isolatedRestore:'PASS',tableCountMatch:'PASS',
  databaseOwnerAndEffectiveAclMatch:true,productionMutation:false,ciphertextSha256:'a'.repeat(64),snapshotAt:new Date(now-60000).toISOString()};
 return{env,recovery,observed:{controllerSha:controller,sourceSha:sha},now};
}
test('exact source, production target and fresh verified restore bind application',()=>{
 const a=approved();validateApproval('apply',a.env,a.recovery,a.observed,manifest,a.now);
 for(const [field,value] of [['PGHOST','127.0.0.1'],['PGHOSTADDR','127.0.0.1'],['SOURCE_PR','1634'],['RELEASE_SHA','2'.repeat(40)],['INITIAL_ACTOR','other'],['GITHUB_REF','refs/heads/other'],['MANIFEST_SHA256','a'.repeat(64)],['CONFIRM_SPECTATOR_PACKAGE','']]){
  assert.throws(()=>validateApproval('apply',{...a.env,[field]:value},a.recovery,a.observed,manifest,a.now),field);
 }
 for(const field of ['databaseOwnerAndEffectiveAclMatch','isolatedRestore','tableCountMatch']){
  assert.throws(()=>validateApproval('apply',a.env,{...a.recovery,[field]:false},a.observed,manifest,a.now),field);
 }
 assert.throws(()=>validateApproval('apply',a.env,a.recovery,a.observed,manifest,a.now+3600000));
 assert.throws(()=>validateApproval('apply',a.env,a.recovery,{...a.observed,sourceSha:'f'.repeat(40)},manifest,a.now));
});
