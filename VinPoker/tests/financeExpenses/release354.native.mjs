import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {prepareExpense354,expense354CatalogSql} from '../../scripts/ops/finance-expense-354-protected-apply.mjs';
import {receiptSql} from '../../scripts/ops/floor-37-47-protected-apply.mjs';

assert.equal(process.env.PGHOST,'127.0.0.1');
assert.equal(process.env.PGDATABASE,'vinpoker_ops_expense354_release');
function sql(query) {
  const result=spawnSync('psql',['-X','-qAt','-v','ON_ERROR_STOP=1'],{input:query,encoding:'utf8',timeout:20000});
  assert.equal(result.status,0,'Isolated release SQL failed');
  return result.stdout.trim();
}
function catalog() { return JSON.parse(sql(expense354CatalogSql())); }
// Public schema is captured. This empty ledger table supplies the same receipt
// columns used by the existing release wrapper; it contains no production rows.
sql(`CREATE SCHEMA supabase_migrations;
CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY,name text,statements text[]);`);
const before=catalog();
assert.equal(before.database,'vinpoker_ops_expense354_release');
assert.equal(before.actor,'postgres');assert.equal(before.ledgerCount,0);
assert.equal(before.functionHash,'ec4209e4c6e11503ecd4e52c5d4be0ee');
assert.equal(before.readerHash,'15d1b9d63df67e34ee1d999adc7ffe08');
assert.equal(before.uniqueIndexValid,true);assert.equal(before.anonymousExecute,false);
assert.deepEqual(before.executors,['authenticated','postgres','service_role']);
// A matching name/column list on a different table is not expense protection.
sql(`DROP INDEX public.uq_club_expenses_idem;
CREATE TABLE public.expense354_index_decoy(club_id uuid,idempotency_key text);
CREATE UNIQUE INDEX uq_club_expenses_idem ON public.expense354_index_decoy(club_id,idempotency_key)
  WHERE idempotency_key IS NOT NULL;`);
assert.equal(catalog().uniqueIndexValid,false,'same-named foreign-table index bypassed expense gate');
sql(`DROP INDEX public.uq_club_expenses_idem;
DROP TABLE public.expense354_index_decoy;
CREATE UNIQUE INDEX uq_club_expenses_idem ON public.club_expenses(club_id,idempotency_key)
  WHERE idempotency_key IS NOT NULL;`);
assert.deepEqual(catalog(),before);
const atomic=prepareExpense354(process.env.RELEASE_SOURCE_ROOT);
sql(atomic);
const receipt=JSON.parse(sql(receiptSql({version:'20270128000354',name:'finance_expense_scope_idempotency',
  hash:'4c7615860dba50225a6507f6b2db378f417701a3968bb0063414bdad1ac62632'})));
assert.deepEqual(receipt,{count:1,exact:true});
const after=catalog();
assert.deepEqual(after,{...before,ledgerCount:1,functionHash:'a96cdd76edcbfb03cc1812b26047e179',searchPath:['search_path=""']});
// An existing receipt must reject a second execution, even with identical SQL.
const duplicate=spawnSync('psql',['-X','-qAt','-v','ON_ERROR_STOP=1'],{input:atomic,encoding:'utf8',timeout:20000});
assert.notEqual(duplicate.status,0);assert.match(duplicate.stderr,/migration ledger conflict/);
assert.deepEqual(catalog(),after);
assert.equal(sql('SELECT count(*) FROM public.club_expenses'),'0');
console.log('EXPENSE354_EXACT_ATOMIC_RECEIPT_METADATA_NO_REPLAY_NATIVE_PASS');
