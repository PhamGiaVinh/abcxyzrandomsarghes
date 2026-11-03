import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {classifyHistory,atomicStageQuery,loadPackage,validateReviewedPrefix120,REVIEWED_PREFIX120_SHA} from '../../scripts/ops/all-fixes-backend-20261103-release-gate.mjs';
import {scanMigrationSource} from '../../scripts/ops/ops-1359-release-gate.mjs';
const root=new URL('../../',import.meta.url);
const baseline=JSON.parse(readFileSync(new URL('scripts/ops/all-fixes-backend-20261103-baseline.json',root),'utf8'));
const entries=JSON.parse(readFileSync(new URL('scripts/ops/all-fixes-backend-20261103-manifest.json',root),'utf8')).migrations;
const receipt=e=>({version:e.version,name:e.name,normalized_sql_sha256:e.sha256});
const reviewedText=readFileSync(new URL('scripts/ops/all-fixes-backend-20261103-prefix120-reviewed.json',root),'utf8');
test('only explicitly reviewed exact prefix120 can select the158 remaining migrations',()=>{
 const pkg=loadPackage(),confirmation='REVIEWED_PREFIX120_'+REVIEWED_PREFIX120_SHA;
 const state=classifyHistory([...baseline,...entries.slice(0,120).map(receipt)],entries);
 assert.equal(validateReviewedPrefix120(state,pkg,reviewedText,confirmation),120);
 assert.equal(pkg.entries.slice(120).length,158);
 assert.equal(pkg.entries[120].version,'20270128000198');
 assert.throws(()=>validateReviewedPrefix120({committed:119,pending:159},pkg,reviewedText,confirmation),/exact prefix120/);
 assert.throws(()=>validateReviewedPrefix120({committed:121,pending:157},pkg,reviewedText,confirmation),/exact prefix120/);
 assert.throws(()=>validateReviewedPrefix120(state,pkg,reviewedText,''),/review confirmation/);
 assert.throws(()=>validateReviewedPrefix120(state,pkg,reviewedText.replace('"pending": 158','"pending": 157'),confirmation),/receipt mismatch/);
});
test('exact untouched483 receipt baseline and exact ordered prefix are recognized',()=>{
 assert.deepEqual(classifyHistory(baseline,entries),{committed:0,pending:278});
 assert.deepEqual(classifyHistory([...baseline,...entries.slice(0,2).map(receipt)].sort((a,b)=>a.version.localeCompare(b.version)),entries),{committed:2,pending:276});
});
test('name and statement hash drift in baseline or applied release are rejected',()=>{
 const changed=structuredClone(baseline);changed[0].name='different_name';
 assert.throws(()=>classifyHistory(changed,entries),/Baseline ledger/);
 const r=receipt(entries[0]);r.normalized_sql_sha256='0'.repeat(64);
 assert.throws(()=>classifyHistory([...baseline,r],entries),/Release ledger conflict/);
});
test('gaps, duplicate versions and unrelated new migrations fail closed',()=>{
 assert.throws(()=>classifyHistory([...baseline,receipt(entries[1])],entries),/Release ledger conflict/);
 assert.throws(()=>classifyHistory([...baseline,baseline[0]],entries),/Duplicate/);
 assert.throws(()=>classifyHistory([...baseline,{version:'20990101000000',name:'unrelated',normalized_sql_sha256:'0'.repeat(64)}],entries),/Baseline ledger/);
});
test('catalog checks and ledger prefix run after serialization; receipt and postchecks remain atomic',()=>{
 const entry={version:'20990101000001',name:'backend_gate_probe',action:'APPLY',sql:'BEGIN; CREATE TABLE private.backend_gate_probe(id integer); COMMIT;',contract:{scope:{functionNames:[],triggerNames:[],policyNames:[],indexNames:[],constraintNames:[],tableNames:['private.backend_gate_probe']},beforeSha256:'1'.repeat(64),afterSha256:'2'.repeat(64),beforeLedgerSha256:'3'.repeat(64),afterLedgerSha256:'4'.repeat(64)}};
 const query=atomicStageQuery(entry);
 assert.ok(query.indexOf('pg_advisory_xact_lock')<query.indexOf('LOCK TABLE supabase_migrations'));
 assert.ok(query.indexOf('LOCK TABLE supabase_migrations')<query.indexOf('backend_pre_ledger_contract_drift'));
 assert.ok(query.indexOf('backend_pre_catalog_contract_drift')<query.indexOf('CREATE TABLE private.backend_gate_probe'));
 assert.ok(query.indexOf('INSERT INTO supabase_migrations.schema_migrations')<query.indexOf('backend_post_catalog_contract_drift'));
 assert.ok(query.indexOf('backend_post_ledger_contract_drift')<query.lastIndexOf('COMMIT'));
 assert.equal(scanMigrationSource(query).mode,'outer-transaction');
});
