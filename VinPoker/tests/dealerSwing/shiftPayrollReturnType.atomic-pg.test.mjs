import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';

test('PG17 shift payroll83 ledger failure preserves definition and authority',
 {skip:process.env.PAYROLL83_PG_TEST!=='1'},()=>{
  assert.equal(process.env.PGHOST,'127.0.0.1');assert.equal(process.env.PGUSER,'postgres');
  assert.equal(process.env.PGDATABASE,'vinpoker_ops_payroll83_atomic_ci');
  for(const key of ['PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGOPTIONS']) assert.ok(!process.env[key]);
  const query=sql=>spawnSync('psql',['-X','-qAt','-v','ON_ERROR_STOP=1'],{input:sql,encoding:'utf8',timeout:60000});
  const check=sql=>{const r=query(sql);assert.equal(r.status,0,r.stderr);return r.stdout.trim();};
  assert.equal(check("SELECT current_setting('server_version_num')::int BETWEEN 170000 AND 179999;"),'t');
  const source=readFileSync(new URL('../../supabase/migrations/20270128000083_shift_payroll_return_type_v1.sql',import.meta.url),'utf8').replaceAll('\r\n','\n');
  const metadata=`SELECT jsonb_build_object('definition',pg_get_functiondef(oid),'owner',proowner,'acl',proacl::text)
   FROM pg_proc WHERE oid='public.get_shift_payroll_summary(uuid,date)'::regprocedure;`;
  const before=check(metadata);
  assert.equal(check("SELECT md5(pg_get_functiondef('public.get_shift_payroll_summary(uuid,date)'::regprocedure))='c2a77f3d6e04802d527342bd78cfb54c';"),'t');
  assert.equal(check("SELECT to_regclass('supabase_migrations.schema_migrations') IS NULL;"),'t');
  check(`CREATE SCHEMA supabase_migrations;
   CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY,name text,statements text[]);
   CREATE FUNCTION public.reject83_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    RAISE EXCEPTION 'injected83_receipt_failure';END $$;
   CREATE TRIGGER reject83 BEFORE INSERT ON supabase_migrations.schema_migrations
    FOR EACH ROW EXECUTE FUNCTION public.reject83_receipt();`);
  const atomic=`BEGIN;${source}
   INSERT INTO supabase_migrations.schema_migrations(version,name,statements)
   VALUES('20270128000083','shift_payroll_return_type_v1',ARRAY['${source.replaceAll("'","''")}']::text[]);COMMIT;`;
  const failed=query(atomic);assert.notEqual(failed.status,0);assert.match(failed.stderr,/injected83_receipt_failure/);
  assert.equal(check(metadata),before,'definition and permission guard must roll back together');
  assert.equal(check('SELECT count(*) FROM supabase_migrations.schema_migrations;'),'0');
  check('DROP TRIGGER reject83 ON supabase_migrations.schema_migrations;DROP FUNCTION public.reject83_receipt();');
  check(atomic);
  assert.equal(check(`SELECT count(*)=1 AND bool_and(name='shift_payroll_return_type_v1'
   AND statements=ARRAY['${source.replaceAll("'","''")}']::text[])
   FROM supabase_migrations.schema_migrations WHERE version='20270128000083';`),'t');
  const committed=JSON.parse(check(metadata));const previous=JSON.parse(before);
  assert.equal(committed.owner,previous.owner);assert.equal(committed.acl,previous.acl);
  assert.equal(committed.definition,previous.definition.replace(
   'COALESCE(SUM(da.overtime_minutes), 0) AS overtime_minutes',
   'COALESCE(SUM(da.overtime_minutes), 0)::INT AS overtime_minutes'));
  const replay=query(atomic);assert.notEqual(replay.status,0);assert.match(replay.stderr,/shift_payroll83_precondition_drift/);
  assert.deepEqual(JSON.parse(check(metadata)),committed);
  assert.equal(check('SELECT count(*) FROM supabase_migrations.schema_migrations;'),'1');
  console.log('SHIFT_PAYROLL83_LEDGER_ROLLBACK_EXACT_TYPE_ONLY_DELTA_AND_RECEIPT_PASS');
 });
