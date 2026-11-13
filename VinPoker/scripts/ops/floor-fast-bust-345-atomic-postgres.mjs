import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {loadPackage,atomicSql,postcheckSql} from './floor-fast-bust-345-protected-apply.mjs';
import {receiptSql} from './floor-37-47-protected-apply.mjs';

// TEST ONLY: never accepts a hosted database or a production database name.
assert.equal(process.env.PGHOST,'127.0.0.1');
assert.equal(process.env.PGPORT,'5432');
assert.equal(process.env.PGDATABASE,'vinpoker_ops_floor345');
assert.equal(process.env.PGUSER,'postgres');
assert.ok(!process.env.PGOPTIONS&&!process.env.PGSERVICE&&!process.env.PGSERVICEFILE);
function query(sql,success=true){
 const r=spawnSync('psql',['-X','-qAt','-v','ON_ERROR_STOP=1'],{input:sql,encoding:'utf8',timeout:150000});
 assert.ok(!r.error,'Isolated PostgreSQL transport failed');
 if(success)assert.equal(r.status,0,r.stderr);else assert.notEqual(r.status,0,'Expected atomic rollback');
 return r.stdout.trim();
}
const pkg=loadPackage(process.env.RELEASE_SOURCE_ROOT),sql=atomicSql(pkg);
const item={...pkg.manifest.migrations[0],hash:pkg.manifest.migrations[0].sha256};
assert.equal(query("SELECT current_database()='vinpoker_ops_floor345' AND current_user='postgres' AND to_regnamespace('supabase_migrations') IS NULL"),'t');
// The sanitized export intentionally excludes Supabase's internal ledger.
query(`CREATE SCHEMA supabase_migrations;
 CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY,name text,statements text[]);
 CREATE FUNCTION supabase_migrations.reject_test_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
 BEGIN RAISE EXCEPTION 'isolated injected ledger failure'; END $$;
 CREATE TRIGGER reject_test_receipt BEFORE INSERT ON supabase_migrations.schema_migrations
 FOR EACH ROW EXECUTE FUNCTION supabase_migrations.reject_test_receipt();`);
query(sql,false);
assert.equal(query(`SELECT count(*)=0 AND to_regprocedure('public.get_floor_tournament_table_roster_v7(uuid)') IS NULL
 AND to_regprocedure('public.floor_operator_bust_seat_v1(uuid,uuid,uuid,uuid,uuid,integer,uuid,bigint,uuid,text)') IS NULL
 FROM supabase_migrations.schema_migrations`),'t','DDL and ledger must roll back together');
query('DROP TRIGGER reject_test_receipt ON supabase_migrations.schema_migrations; DROP FUNCTION supabase_migrations.reject_test_receipt();');
query(sql);
const json=s=>JSON.parse(query(s).split('\n').find(x=>x.startsWith('{')));
assert.deepEqual(json(receiptSql(item)),{count:1,exact:true});
assert.deepEqual(json(postcheckSql(pkg)),{functions:true,baseline:true});
query(sql,false);
assert.deepEqual(json(receiptSql(item)),{count:1,exact:true});
assert.equal(query('SELECT count(*) FROM supabase_migrations.schema_migrations'),'1');
console.log('FLOOR345_ATOMIC_ROLLBACK_RECEIPT_DUPLICATE_PASS');
