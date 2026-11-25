import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {preparePtReads355,ptReads355CatalogSql,item} from '../../scripts/ops/finance-pt-355-protected-apply.mjs';
import {receiptSql} from '../../scripts/ops/floor-37-47-protected-apply.mjs';
assert.equal(process.env.PGHOST,'127.0.0.1');
assert.equal(process.env.PGDATABASE,'vinpoker_ops_pt355_release');
function execute(query){return spawnSync('psql',['-XqAt','-v','ON_ERROR_STOP=1'],{input:query,encoding:'utf8',timeout:30000});}
function sql(query){const r=execute(query);assert.equal(r.status,0,`Isolated PT355 SQL failed: ${r.stderr}`);return r.stdout.trim();}
const catalog=()=>JSON.parse(sql(ptReads355CatalogSql()));
const root=resolve(process.env.RELEASE_SOURCE_ROOT);
const originalCatalog=()=>sql(readFileSync(resolve(root,'tests/financePayrollReadRelease/catalog-fingerprint.sql'),'utf8'));
sql(`CREATE SCHEMA supabase_migrations;
 CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY,name text,statements text[]);`);
const baseline=catalog();
assert.deepEqual(baseline,{database:'vinpoker_ops_pt355_release',actor:'postgres',ledgerCount:0,targetCount:0,authorizerExact:true,legacyIndexExact:true,readersExact:false});
// Same-named indexes on a different table do not satisfy the full-pay invariant.
sql(`DROP INDEX public.dealer_pt_wage_payments_statement_uq;
 CREATE TABLE public.pt355_index_decoy(statement_id uuid);
 CREATE UNIQUE INDEX dealer_pt_wage_payments_statement_uq ON public.pt355_index_decoy(statement_id) WHERE statement_id IS NOT NULL;`);
assert.equal(catalog().legacyIndexExact,false);
sql(`DROP INDEX public.dealer_pt_wage_payments_statement_uq;DROP TABLE public.pt355_index_decoy;
 CREATE UNIQUE INDEX dealer_pt_wage_payments_statement_uq ON public.dealer_pt_wage_payments(statement_id) WHERE statement_id IS NOT NULL;`);
assert.deepEqual(catalog(),baseline);
// Recreated index has a new OID, so freeze the comparison after restoring it.
const restoredFingerprint=originalCatalog();
const atomic=preparePtReads355(root);sql(atomic);
assert.deepEqual(JSON.parse(sql(receiptSql(item))),{count:1,exact:true});
const after=catalog();assert.deepEqual(after,{...baseline,ledgerCount:1,targetCount:2,readersExact:true});
assert.equal(originalCatalog(),restoredFingerprint,'original routines/relations/grants changed');
const duplicate=execute(atomic);assert.notEqual(duplicate.status,0);assert.match(duplicate.stderr,/migration ledger conflict/);
assert.deepEqual(catalog(),after);
// Changed defaults are drift even when the number of default arguments is two.
const historyDefinition=sql(`SELECT pg_get_functiondef('public.list_my_pt_statements_v1(uuid,uuid,timestamptz,uuid)'::regprocedure)`);
assert.match(historyDefinition,/DEFAULT NULL::uuid/);
sql(historyDefinition.replace('DEFAULT NULL::uuid',"DEFAULT '18000000-0000-4000-8000-000000000099'::uuid"));
assert.equal(catalog().readersExact,false);
const rollbackSource=readFileSync(resolve(root,'supabase/pending-migrations/finance_pt_statement_reads_v1.rollback.sql'),'utf8');
const drifted=catalog(),refused=execute(rollbackSource);assert.notEqual(refused.status,0);assert.match(refused.stderr,/PT_STATEMENT_READS_ROLLBACK_DRIFT/);
assert.deepEqual(catalog(),drifted,'refused rollback changed a reader');
sql(historyDefinition);
assert.deepEqual(catalog(),after);
sql(rollbackSource);
assert.deepEqual(catalog(),{...baseline,ledgerCount:1});
assert.deepEqual(JSON.parse(sql(receiptSql(item))),{count:1,exact:true},'rollback rewrote apply history');
assert.equal(originalCatalog(),restoredFingerprint);
assert.equal(sql('SELECT count(*) FROM public.dealer_pt_wage_payments'),'0');
console.log('PT355_EXACT_ATOMIC_RECEIPT_CATALOG_ROLLBACK_NO_REPLAY_NATIVE_PASS');
