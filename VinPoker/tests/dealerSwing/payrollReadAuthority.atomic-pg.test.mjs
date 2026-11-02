import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';

test('PG17 payroll82 source drift and ledger failure roll back both definitions and grants',
 {skip:process.env.PAYROLL82_PG_TEST!=='1'},()=>{
  assert.equal(process.env.PGHOST,'127.0.0.1');
  assert.equal(process.env.PGUSER,'postgres');
  assert.equal(process.env.PGDATABASE,'vinpoker_ops_payroll82_atomic_ci');
  for(const key of ['PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGOPTIONS']) assert.ok(!process.env[key]);
  const query=sql=>spawnSync('psql',['-X','-qAt','-v','ON_ERROR_STOP=1'],
   {input:sql,encoding:'utf8',timeout:60000});
  const check=sql=>{const r=query(sql);assert.equal(r.status,0,r.stderr);return r.stdout.trim();};
  assert.equal(check("SELECT current_setting('server_version_num')::int BETWEEN 170000 AND 179999;"),'t');
  const source=readFileSync(new URL('../../supabase/migrations/20270128000082_payroll_legacy_read_club_authority_v1.sql',import.meta.url),'utf8').replaceAll('\r\n','\n');
  const metadata=`SELECT jsonb_agg(jsonb_build_object('signature',oid::regprocedure::text,
   'definition',pg_get_functiondef(oid),'owner',proowner,'acl',proacl::text) ORDER BY oid)
   FROM pg_proc WHERE oid IN ('public.get_dealer_payroll(uuid,date,date)'::regprocedure,
    'public.get_shift_payroll_summary(uuid,date)'::regprocedure);`;
  const original=check(metadata);
  // Fail on the second function after the first function and grants were changed.
  check('ALTER FUNCTION public.get_shift_payroll_summary(uuid,date) COST 101;');
  const drifted=check(metadata);
  const drift=query(source);assert.notEqual(drift.status,0);
  assert.match(drift.stderr,/payroll_read_precondition_drift/);
  assert.equal(check(metadata),drifted,'first function/grants must roll back with second-function drift');
  check('ALTER FUNCTION public.get_shift_payroll_summary(uuid,date) COST 100;');
  assert.equal(check(metadata),original);
  assert.equal(check("SELECT to_regclass('supabase_migrations.schema_migrations') IS NULL;"),'t');
  check(`CREATE SCHEMA supabase_migrations;
   CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY,name text,statements text[]);
   CREATE FUNCTION public.reject82_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    RAISE EXCEPTION 'injected82_receipt_failure';END $$;
   CREATE TRIGGER reject82 BEFORE INSERT ON supabase_migrations.schema_migrations
    FOR EACH ROW EXECUTE FUNCTION public.reject82_receipt();`);
  const atomic=`BEGIN;${source}
   INSERT INTO supabase_migrations.schema_migrations(version,name,statements)
   VALUES('20270128000082','payroll_legacy_read_club_authority_v1',
    ARRAY['${source.replaceAll("'","''")}']::text[]);COMMIT;`;
  const failed=query(atomic);assert.notEqual(failed.status,0);
  assert.match(failed.stderr,/injected82_receipt_failure/);
  assert.equal(check(metadata),original,'both functions and ACLs must roll back with ledger failure');
  assert.equal(check('SELECT count(*) FROM supabase_migrations.schema_migrations;'),'0');
  check('DROP TRIGGER reject82 ON supabase_migrations.schema_migrations;DROP FUNCTION public.reject82_receipt();');
  check(atomic);
  assert.equal(check(`SELECT count(*)=1 AND bool_and(name='payroll_legacy_read_club_authority_v1'
   AND statements=ARRAY['${source.replaceAll("'","''")}']::text[])
   FROM supabase_migrations.schema_migrations WHERE version='20270128000082';`),'t');
  const committed=check(metadata);
  const replay=query(atomic);assert.notEqual(replay.status,0);
  assert.match(replay.stderr,/payroll_read_precondition_drift/);
  assert.equal(check(metadata),committed);
  assert.equal(check('SELECT count(*) FROM supabase_migrations.schema_migrations;'),'1');
  console.log('PAYROLL82_SECOND_FUNCTION_DRIFT_AND_LEDGER_FAILURE_FULL_ROLLBACK_EXACT_RECEIPT_PASS');
 });
