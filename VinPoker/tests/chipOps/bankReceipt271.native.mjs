import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';

assert.equal(process.env.VINPOKER_NATIVE_DB_TEST,'1','explicit local native test only');
const root=process.cwd();
const run=(input)=>spawnSync('wsl',['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1',
 'PGPORT=55441','PGUSER=postgres','PGDATABASE=vinpoker_ops_cash115_qualified_c','psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'],
 {input,encoding:'utf8',timeout:30000,maxBuffer:2e6});
const success=(input)=>{
 const result=run(input);if(result.error)throw result.error;
 assert.equal(result.status,0,result.stderr);return result.stdout.trim();
};
assert.equal(success(`BEGIN READ ONLY;SELECT current_database()||'|'||host(inet_server_addr())||'|'||inet_server_port()||'|'||(current_setting('server_version_num')::int/10000);ROLLBACK;`),
 'vinpoker_ops_cash115_qualified_c|127.0.0.1|55441|17');
const migration=readFileSync(resolve(root,'supabase/migrations/20270128000223_chip_bank_adjust_receipt_v2.sql'),'utf8');
const cases=readFileSync(resolve(root,'tests/chipOps/bankReceipt271.existing.pg17.sql'),'utf8');
const recovery=readFileSync(resolve(root,'tests/chipOps/bankReceipt271.recovery.pg17.sql'),'utf8');
assert.equal((migration.match(/^BEGIN;\s*$/gm)||[]).length,1);
assert.equal((migration.match(/^COMMIT;\s*$/gm)||[]).length,1);
const candidate=migration.replace(/^BEGIN;\s*$/m,'').replace(/^COMMIT;\s*$/m,'');
const transaction=(suffix)=>`BEGIN;\n${candidate}\n${suffix}\nROLLBACK;`;
assert.match(success(transaction(cases)),/BANK271_EXPECTED_ACTOR_RECEIPT_REJECT_LEGACY_FAULT_NATIVE_PASS/);
console.log('BANK271_CURRENT_SCHEMA_EXPECTED_ACTOR_RECEIPTS_NATIVE_PASS');
assert.match(success(transaction(recovery)),/BANK271_PREUSE_RECOVERY_EXACT_ORIGINAL_BODY_PASS/);
console.log('BANK271_PREUSE_RECOVERY_NATIVE_PASS');
const refused=run(transaction(cases+'\n'+recovery));
if(refused.error)throw refused.error;
assert.equal(refused.status,3,'psql ON_ERROR_STOP script failure must return3');
assert.match(refused.stdout,/BANK271_EXPECTED_ACTOR_RECEIPT_REJECT_LEGACY_FAULT_NATIVE_PASS/);
assert.match(refused.stderr,/BANK271_RECOVERY_REFUSES_EXISTING_RECEIPTS/);
console.log('BANK271_RECOVERY_REFUSES_EXISTING_RECEIPTS_NATIVE_PASS');
assert.equal(success(`BEGIN READ ONLY;
 SELECT md5(pg_get_functiondef('public.chip_ops_bank_adjust(uuid,uuid,text,bigint,uuid,integer,text)'::regprocedure));
 SELECT count(*) FROM pg_proc WHERE proname IN('chip_ops_bank_adjust_v2','get_chip_bank_adjust_receipt_v2','resolve_chip_bank_adjust_v2','chip_bank_adjust_primitive_v1');
 SELECT count(*) FROM auth.users WHERE id IN('e2710000-0000-4000-8000-000000000001','e2710000-0000-4000-8000-000000000002');
 SELECT count(*) FROM floor_private.chip_mutation_receipts WHERE request_key LIKE 'bank271-%';
 SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='20270128000223';
 ROLLBACK;`),'da643ca448cb56633268c8b377895b19\n0\n0\n0\n0');
console.log('BANK271_ORIGINAL_FUNCTION_NO_FIXTURES_RECEIPTS_CATALOG_DELTA_PASS');
