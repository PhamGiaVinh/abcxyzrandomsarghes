import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {preparePtReads355,applyPtReads355,ptReads355CatalogSql,verifyPtReadLoadEvidence,validatePtReads355Context,item,sourceSha} from './finance-pt-355-protected-apply.mjs';
const before={database:'postgres',actor:'postgres',ledgerCount:0,targetCount:0,authorizerExact:true,legacyIndexExact:true,readersExact:false};
const after={...before,ledgerCount:1,targetCount:2,readersExact:true};
test('requires owner/ACL restore proof and exact dispatch context before constructing a transport',()=>{
 const now=Date.parse('2026-11-26T00:00:00Z'),runner='b'.repeat(40);
 const env={SOURCE_CHECKOUT_SHA:sourceSha,GITHUB_SHA:runner,GITHUB_REF:'refs/heads/main',GITHUB_ACTIONS:'true',
  GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_REPOSITORY:'PhamGiaVinh/abcxyzrandomsarghes',
  INITIAL_ACTOR:'PhamGiaVinh',TRIGGERING_ACTOR:'PhamGiaVinh',REPOSITORY_OWNER:'PhamGiaVinh',SUPABASE_PROJECT_REF:'orlesggcjamwuknxwcpk',
  PGHOST:'aws-1-ap-southeast-2.pooler.supabase.com',PGPORT:'5432',PGUSER:'postgres.orlesggcjamwuknxwcpk',PGDATABASE:'postgres',PGSSLMODE:'require',PGPASSWORD:'synthetic-test-only',RECOVERY_BASE_SHA:'a'.repeat(40)};
 const receipt={schemaVersion:1,kind:'vinpoker-restore-verification',sourceSha:env.RECOVERY_BASE_SHA,snapshotAt:new Date(now-1000).toISOString(),
  isolatedRestore:'PASS',tableCountMatch:'PASS',productionMutation:false,ciphertextSha256:'c'.repeat(64),databaseOwnerAndEffectiveAclMatch:true};
 validatePtReads355Context(env,receipt,runner,now);
 for(const proof of [false,undefined])assert.throws(()=>validatePtReads355Context(env,{...receipt,databaseOwnerAndEffectiveAclMatch:proof},runner,now));
 for(const patch of [{GITHUB_EVENT_NAME:'pull_request'},{GITHUB_REPOSITORY:'elsewhere/repo'},{GITHUB_SHA:'d'.repeat(40)}])assert.throws(()=>validatePtReads355Context({...env,...patch},receipt,runner,now));
 assert.throws(()=>validatePtReads355Context(env,{...receipt,snapshotAt:new Date(now-3600001).toISOString()},runner,now));
});
test('assembles only the exact promoted source with an atomic immutable receipt',()=>{
 const dir=mkdtempSync(join(tmpdir(),'pt355-'));
 try{
  mkdirSync(join(dir,'supabase/migrations'),{recursive:true});
  const path=join(dir,`supabase/migrations/${item.version}_${item.name}.sql`);
  const source=process.env.RELEASE_SOURCE_ROOT
   ?readFileSync(join(process.env.RELEASE_SOURCE_ROOT,`supabase/migrations/${item.version}_${item.name}.sql`),'utf8')
   :execFileSync('git',['show',`4f4097b0:VinPoker/supabase/migrations/${item.version}_${item.name}.sql`],{encoding:'utf8'});
  writeFileSync(path,source.replace(/\r?\n/g,'\r\n'));
  const query=preparePtReads355(dir);
  assert.match(query,/migration ledger conflict/);assert.match(query,/INSERT INTO supabase_migrations.schema_migrations/);
  assert.ok(query.indexOf('INSERT INTO supabase_migrations.schema_migrations')<query.lastIndexOf('COMMIT;'));
  assert.equal((query.match(/INSERT INTO supabase_migrations.schema_migrations/g)??[]).length,1);
  writeFileSync(path,source+'\n-- drift\n');assert.throws(()=>preparePtReads355(dir),/differs/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('requires exact source and receipt plus postcheck, executes once',()=>{
 const responses=[before,{count:1,exact:true},after];let writes=0;const reports=[];
 applyPtReads355('atomic',{json:()=>responses.shift(),execute:q=>{assert.equal(q,'atomic');writes++;}},x=>reports.push(x));
 assert.equal(writes,1);assert.deepEqual(reports,['PT355_COMMITTED_EXACT_AND_POSTCHECK_PASS']);
 assert.match(ptReads355CatalogSql(),/^BEGIN READ ONLY;/);
});
test('refuses wrong database actor ledger overload authorizer and original index before writes',()=>{
 for(const patch of [{database:'elsewhere'},{actor:'authenticated'},{ledgerCount:1},{targetCount:1},{authorizerExact:false},{legacyIndexExact:false}]){
  let writes=0;assert.throws(()=>applyPtReads355('atomic',{json:()=>({...before,...patch}),execute:()=>writes++},()=>{}),/preflight/);assert.equal(writes,0);
 }
});
test('lost apply acknowledgement classifies receipt and never retries',()=>{
 for(const [receipt,outcome] of [[{count:1,exact:true},'committed-exact'],[{count:0,exact:false},'not-recorded'],[{count:1,exact:false},'drift'],[null,'unknown']]){
  let reads=0,writes=0;const reports=[];
  const transport={json:()=>{if(reads++===0)return before;if(receipt===null)throw Error('unavailable');return receipt;},execute:()=>{writes++;throw Error('lost response');}};
  assert.throws(()=>applyPtReads355('atomic',transport,x=>reports.push(x)),/requires review/);
  assert.equal(writes,1);assert.deepEqual(reports,[`PT355_STOP receipt=${outcome}`]);
 }
});
test('refuses an inexact receipt or changed post-apply metadata',()=>{
 for(const responses of [[before,{count:1,exact:false}],[before,{count:1,exact:true},{...after,readersExact:false}],[before,{count:1,exact:true},{...after,legacyIndexExact:false}]]){
  let writes=0;assert.throws(()=>applyPtReads355('atomic',{json:()=>responses.shift(),execute:()=>writes++},()=>{}));assert.equal(writes,1);
 }
});
test('regrades raw load samples instead of trusting a success label',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'pt355-load-'));
 try{
  const rel='tests/financePayrollReadRelease/load-qualification.mjs';mkdirSync(join(dir,'tests/financePayrollReadRelease'),{recursive:true});
  writeFileSync(join(dir,rel),process.env.RELEASE_SOURCE_ROOT?readFileSync(join(process.env.RELEASE_SOURCE_ROOT,rel),'utf8')
   :execFileSync('git',['show',`4f4097b0:VinPoker/${rel}`],{encoding:'utf8'}));
  const samples=Array.from({length:7200},(_,i)=>({actor:Math.floor(i/360),slot:i%360,kind:i%2?'statement':'history',ok:true,error:null,latencyMs:100,queueMs:1}));
  const input={sourceSha:'f2ef7ad92adfe1aa097856b3da65307f7b401852',actors:20,slots:360,paceMs:5000,pool:10,durationMs:1800000,
   productionCapacityClaim:false,fullIntegrationQualification:false,effectiveLoginConfig:{jit:'off'},documents:100000,lines:500000,months:12,
   financialFactsUnchanged:true,catalogFactsUnchanged:true,terminalError:null,elapsedMs:1800000,samples,qualification:true,
   results:{history:{count:3600,errors:0,p95Ms:100,maxMs:100},statement:{count:3600,errors:0,p95Ms:100,maxMs:100}}};
  await verifyPtReadLoadEvidence(input,dir);
  for(const patch of [{sourceSha:'0'.repeat(40)},{pool:20},{elapsedMs:1799999},{catalogFactsUnchanged:false},{productionCapacityClaim:true},
   {samples:samples.slice(1)},{samples:samples.map((s,i)=>i? s:{...s,ok:true,error:'timeout'})},
   {results:{...input.results,history:{...input.results.history,p95Ms:1}}}])await assert.rejects(()=>verifyPtReadLoadEvidence({...input,...patch},dir));
 }finally{rmSync(dir,{recursive:true,force:true});}
});
