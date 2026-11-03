import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync,spawnSync} from 'node:child_process';
import {canonicalSqlText,resolveWithinRoot,scanMigrationSource,buildAtomicMigrationQuery} from './ops-1359-release-gate.mjs';
import {backendObjectScope,backendSnapshotSql,backendContractGuard,backendContractHash,backendLedgerGuard} from './all-fixes-backend-object-contract.mjs';
export const PROJECT='orlesggcjamwuknxwcpk';
export const MANIFEST_SHA='70382982a76f195d915720a117d88a31daae788358d656b93d0db1d15c2f9a76';
export const CONTRACTS_SHA='e5a6e1ce27c5e290725874bd525c84da7423749dde362d634823ffe7bc656f66';
export const BASELINE_SHA='5a9f737bd2922c6e6b36d1377cdf2aa83646fe6917faadbb616f56ad30012f27';
export const REVIEWED_PREFIX120_SHA='7fc0319495bc3433318f665302bf5a5fb224c303188dc2fc4dd66103dd90c29e';
const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const sha=x=>createHash('sha256').update(x,'utf8').digest('hex');
export const LEDGER_QUERY="SELECT version,name,encode(extensions.digest(replace(array_to_string(statements,E'\\n'),E'\\r\\n',E'\\n'),'sha256'),'hex') AS normalized_sql_sha256 FROM supabase_migrations.schema_migrations ORDER BY version;";
export function loadPackage(root=ROOT){
 const raw=readFileSync(resolve(root,'scripts/ops/all-fixes-backend-20261103-manifest.json'),'utf8');
 if(sha(canonicalSqlText(raw))!==MANIFEST_SHA)throw Error('Exact release manifest hash mismatch');
 const manifest=JSON.parse(raw);
 if(manifest.projectRef!==PROJECT||manifest.kind!=='vinpoker-all-fixes-backend-release'||manifest.migrations.length!==278||manifest.migrationCount!==278)throw Error('Exact278 release identity mismatch');
 const contractsRaw=canonicalSqlText(readFileSync(resolve(root,'scripts/ops/all-fixes-backend-20261103-contracts.json'),'utf8'));
 if(sha(contractsRaw)!==CONTRACTS_SHA)throw Error('Exact native contract file hash mismatch');
 const contracts=JSON.parse(contractsRaw);
 if(contracts.phase!=='OWNED_278_STAGE_CONTRACT_REHEARSAL_PASS'||contracts.stages.length!==278)throw Error('Native stage qualification incomplete');
 const versions=new Set(),paths=new Set();
 const entries=manifest.migrations.map((item,index)=>{
  if(item.order!==index+1||item.action!=='APPLY'||!/^\d{14}$/.test(item.version)||!/^[a-z0-9_]+$/.test(item.name)||item.path!=='supabase/migrations/'+item.version+'_'+item.name+'.sql'||versions.has(item.version)||paths.has(item.path))throw Error('Release order/path boundary mismatch');
  versions.add(item.version);paths.add(item.path);
  const sql=canonicalSqlText(readFileSync(resolveWithinRoot(root,item.path),'utf8'));
  if(sha(sql)!==item.sha256)throw Error('Qualified source hash drift '+item.version);
  scanMigrationSource(sql);
  const contract=contracts.stages[index],scope=backendObjectScope(sql);
  if(contract.version!==item.version||contract.order!==item.order||JSON.stringify(contract.scope)!==JSON.stringify(scope)||!['beforeSha256','afterSha256','beforeLedgerSha256','afterLedgerSha256'].every(key=>/^[a-f0-9]{64}$/.test(contract[key])))throw Error('Stage scope/hash identity mismatch '+item.version);
  return {...item,sql,contract};
 });
 return {manifest,entries,contracts};
}
export function classifyHistory(rows,entries){
 if(!Array.isArray(rows))throw Error('Invalid ledger result');
 const byVersion=new Map();for(const r of rows){if(byVersion.has(r.version))throw Error('Duplicate live ledger version');byVersion.set(r.version,r);}
 const selected=new Set(entries.map(x=>x.version));
 const baseline=rows.filter(x=>!selected.has(x.version)).map(r=>({version:String(r.version),name:r.name,normalized_sql_sha256:r.normalized_sql_sha256})).sort((a,b)=>a.version.localeCompare(b.version));
 if(baseline.length!==483||sha(JSON.stringify(baseline))!==BASELINE_SHA)throw Error('Baseline ledger name/SQL hash drift');
 let gap=false,prefix=0;
 for(const e of entries){const row=byVersion.get(e.version);if(!row){gap=true;continue;}if(gap||row.name!==e.name||row.normalized_sql_sha256!==e.sha256)throw Error('Release ledger conflict/order/SQL hash drift '+e.version);prefix++;}
 return {committed:prefix,pending:entries.length-prefix};
}
export function atomicStageQuery(entry){
 let query=buildAtomicMigrationQuery(entry,entry.sql);
 const framing=scanMigrationSource(query);
 const marker='END $ops1359_guard$;\n',at=query.indexOf(marker)+marker.length;
 if(at<framing.insertAfterBegin||query.indexOf(marker)!==query.lastIndexOf(marker))throw Error('Atomic builder serialization seam drift');
 const pre='LOCK TABLE supabase_migrations.schema_migrations IN SHARE ROW EXCLUSIVE MODE;\n'+backendLedgerGuard(entry.contract.beforeLedgerSha256,'pre')+'\n'+backendContractGuard(entry.contract.scope,entry.contract.beforeSha256,'pre');
 const post=backendContractGuard(entry.contract.scope,entry.contract.afterSha256,'post')+'\n'+backendLedgerGuard(entry.contract.afterLedgerSha256,'post');
 return query.slice(0,at)+'\n'+pre+'\n'+query.slice(at,framing.insertBeforeCommit)+'\n'+post+'\n'+query.slice(framing.insertBeforeCommit);
}
async function query(sql){
 const response=await fetch('https://api.supabase.com/v1/projects/'+PROJECT+'/database/query',{method:'POST',headers:{Authorization:'Bearer '+process.env.SUPABASE_ACCESS_TOKEN,'Content-Type':'application/json'},body:JSON.stringify({query:sql}),signal:AbortSignal.timeout(150000)});
 if(!response.ok)throw Error('Management query HTTP '+response.status+'; no automatic retry');
 return response.json();
}
function validateRecovery(path){
 if(!path)throw Error('Verified private recovery receipt required');
 const r=JSON.parse(readFileSync(path,'utf8'));
 if(r.projectRef!==PROJECT||r.producerExit!==0||r.fullArchiveStreamReadbackExit!==0||r.bytes!==515539495||r.sha256!=='09fcdf1d3b2bd403d65ed61f97b17c2df232dab1b5141ceebae59a4975932a9d'||r.snapshotStart!=='2026-11-03T03:41:42.898Z'||!r.privateStorage)throw Error('Recovery point qualification mismatch');
 const age=Date.now()-Date.parse(r.snapshotStart);if(age<0||age>6*60*60*1000)throw Error('Recovery snapshot freshness requires reassessment');
}
export function validateReviewedPrefix120(state,pkg,receiptText,confirmation){
 if(state.committed!==120||state.pending!==158)throw Error('Reviewed continuation requires exact prefix120; no automatic resume');
 if(sha(canonicalSqlText(receiptText))!==REVIEWED_PREFIX120_SHA)throw Error('Exact owner-reviewed partial receipt mismatch');
 if(confirmation!=='REVIEWED_PREFIX120_'+REVIEWED_PREFIX120_SHA)throw Error('Owner partial receipt review confirmation missing');
 const receipt=JSON.parse(receiptText),last=pkg.entries[119];
 if(receipt.projectRef!==PROJECT||receipt.manifestSha256!==MANIFEST_SHA||receipt.sourceSha!=='ae7b4c1f3a26c07d67ec954cae46b3b5e33f4311'||receipt.status!=='READONLY_PARTIAL_PREFIX120_AND_POSTCATALOG_VERIFIED'||receipt.committed!==120||receipt.pending!==158||receipt.finalCommitted.version!==last.version||receipt.finalCommitted.sha256!==last.sha256||receipt.finalCommitted.postCatalogSha256!==last.contract.afterSha256||JSON.stringify(receipt.remaining)!==JSON.stringify(pkg.manifest.migrations.slice(120)))throw Error('Reviewed prefix/package identity mismatch');
 return 120;
}
async function execute(){
 const mode=process.argv[2];if(!['plan','apply','verify','plan-reviewed-prefix120','apply-reviewed-prefix120'].includes(mode))throw Error('Usage: plan|apply|verify|plan-reviewed-prefix120|apply-reviewed-prefix120');
 const reviewedContinuation=mode.endsWith('-reviewed-prefix120');
 if(process.env.SUPABASE_PROJECT_REF!==PROJECT||!process.env.SUPABASE_ACCESS_TOKEN)throw Error('Explicit credential/project context required');
 const pkg=loadPackage();
 for(const name of ['check-migration-catalog.mjs','check-floor-v3-migration-promotion.mjs']){
  const args=[resolve(ROOT,'scripts/security',name),...(name.includes('promotion')?['--static']:[])];
  const check=spawnSync(process.execPath,args,{cwd:ROOT,encoding:'utf8'});
  if(check.status!==0)throw Error('Required source catalog guard failed');
 }
 const rows=await query(LEDGER_QUERY);let state=classifyHistory(rows,pkg.entries);
 let startAt=0;
 if(reviewedContinuation){
  const receiptPath=process.env.BACKEND_REVIEWED_PREFIX120_RECEIPT;if(!receiptPath)throw Error('Exact reviewed partial receipt required');
  startAt=validateReviewedPrefix120(state,pkg,readFileSync(receiptPath,'utf8'),process.env.CONFIRM_BACKEND_PREFIX120_REVIEW);
  const last=pkg.entries[startAt-1].contract,actual=await query(backendSnapshotSql(last.scope));
  if(backendContractHash(actual[0].contract)!==last.afterSha256)throw Error('Reviewed prefix120 postcatalog drift');
 }
 if(mode==='plan-reviewed-prefix120'){
  const stage=pkg.entries[startAt].contract,actual=await query(backendSnapshotSql(stage.scope));
  if(backendContractHash(actual[0].contract)!==stage.beforeSha256)throw Error('Next-stage catalog drift');
  console.log(JSON.stringify({mode,project:PROJECT,manifestSha256:MANIFEST_SHA,...state,reviewedPrefix120Sha256:REVIEWED_PREFIX120_SHA,lastAndNextStageCatalog:'PASS'}));return;
 }
 if(mode==='plan'){
  if(state.committed!==0&&state.committed!==278)throw Error('Partial release requires owner receipt review; no resume mode');
  const index=state.committed===278?277:0,stage=pkg.entries[index].contract,expected=state.committed===278?stage.afterSha256:stage.beforeSha256;
  const actual=await query(backendSnapshotSql(stage.scope));if(backendContractHash(actual[0].contract)!==expected)throw Error('Live catalog differs from exact clean-baseline stage');
  console.log(JSON.stringify({mode,project:PROJECT,manifestSha256:MANIFEST_SHA,...state,firstOrFinalStageCatalog:'PASS'}));return;
 }
 if(mode==='verify'){
  if(state.pending)throw Error('Release incomplete');
  console.log(JSON.stringify({mode,project:PROJECT,...state,scope:'All278 exact receipts; final full-object postcheck is separate'}));return;
 }
 if(!reviewedContinuation&&state.committed!==0)throw Error('Apply starts only at untouched baseline; partial release requires owner review');
 if(process.env.CONFIRM_ALL_FIXES_BACKEND_APPLY!=='APPLY_278_'+MANIFEST_SHA)throw Error('Exact package activation confirmation missing');
 const sourceSha=execFileSync('git',['rev-parse','HEAD'],{cwd:ROOT,encoding:'utf8'}).trim();
 if(sourceSha!==process.env.BACKEND_RELEASE_SOURCE_SHA||!/^[a-f0-9]{40}$/.test(sourceSha))throw Error('Exact reviewed source revision mismatch');
 if(execFileSync('git',['status','--porcelain','--untracked-files=normal'],{cwd:ROOT,encoding:'utf8'}).trim())throw Error('Apply requires a clean source checkout');
 validateRecovery(process.env.BACKEND_RELEASE_RECOVERY_RECEIPT);
 const reportPath=process.env.BACKEND_RELEASE_REPORT_PATH;if(!reportPath)throw Error('Durable nonsecret receipt path required');
 const report={project:PROJECT,sourceSha,manifestSha256:MANIFEST_SHA,reviewedPrefix: startAt,reviewedPrefixReceiptSha256:reviewedContinuation?REVIEWED_PREFIX120_SHA:null,startedAt:new Date().toISOString(),committed:[],status:'RUNNING'};
 writeFileSync(reportPath,JSON.stringify(report,null,2),{flag:'wx'});
 for(const entry of pkg.entries.slice(startAt)){
  try{
   await query(atomicStageQuery(entry));
   const history=await query(LEDGER_QUERY);state=classifyHistory(history,pkg.entries);
   if(state.committed!==entry.order)throw Error('Committed receipt prefix differs from acknowledgement');
   report.committed.push({version:entry.version,name:entry.name,sha256:entry.sha256});writeFileSync(reportPath,JSON.stringify(report,null,2));
   console.log(JSON.stringify({committed:entry.order,total:278,version:entry.version}));
  }catch(error){
   report.status='STOPPED_PARTIAL_OR_UNCONFIRMED_NO_RETRY';report.stoppedAt=entry.version;report.error=error.message;
   try{report.observedLedgerState=classifyHistory(await query(LEDGER_QUERY),pkg.entries);}catch{report.observedLedgerState='UNAVAILABLE';}
   writeFileSync(reportPath,JSON.stringify(report,null,2));throw Error('Stopped at '+entry.version+'; inspect exact receipt report. No retry/resume enabled. '+error.message);
  }
 }
 report.status='ALL278_COMMITTED_POSTSTAGE_CONTRACTS_PASS';report.completedAt=new Date().toISOString();writeFileSync(reportPath,JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,reportPath}));
}
if(process.argv[1]&&resolve(process.argv[1])===resolve(fileURLToPath(import.meta.url)))execute().catch(e=>{console.error('ALL_FIXES_BACKEND_GATE_FAIL: '+e.message);process.exitCode=1;});
