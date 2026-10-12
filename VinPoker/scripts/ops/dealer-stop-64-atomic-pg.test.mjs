import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { atomicSql, loadMigration, dependencyPredicate, postcheckSql } from './dealer-stop-64-release-plan.mjs';
import { receiptSql } from './floor-37-47-protected-apply.mjs';

test('PG17 exact64 atomic receipt failure, commit, changed body and replay fence',
  { skip: process.env.STOP64_PG_TEST !== '1' }, () => {
    const db = 'vinpoker_ops_stop64_atomic_ci';
    assert.equal(process.env.PGHOST, '127.0.0.1');
    assert.equal(process.env.PGUSER, 'postgres'); assert.equal(process.env.PGDATABASE, db);
    for (const key of ['PGHOSTADDR', 'PGSERVICE', 'PGSERVICEFILE', 'PGOPTIONS']) assert.ok(!process.env[key]);
    const args = ['-w', '-h', '127.0.0.1', '-p', process.env.PGPORT || '5432', '-U', 'postgres', '-d', db, '-X', '-qAt', '-v', 'ON_ERROR_STOP=1'];
    const query = sql => spawnSync('psql', args, { input: sql, encoding: 'utf8' });
    const check = sql => { const r = query(sql); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
    assert.deepEqual(JSON.parse(check(`SELECT json_build_object('database',current_database()='${db}',
      'actor',current_user='postgres','loopback',inet_server_addr()='127.0.0.1'::inet,
      'pg17',current_setting('server_version_num')::int BETWEEN 170000 AND 179999,
      'ledger_absent',to_regclass('supabase_migrations.schema_migrations') IS NULL,
      'rpc_absent',to_regprocedure('public.operator_stop_dealer_swing_v1(uuid,uuid,uuid)') IS NULL,
      'empty_clubs',(SELECT count(*)=0 FROM public.clubs));`)),
    { database: true, actor: true, loopback: true, pg17: true, ledger_absent: true, rpc_absent: true, empty_clubs: true });
    assert.equal(check(`SELECT ${dependencyPredicate()};`), 't');
    check(`CREATE SCHEMA supabase_migrations;
      CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY,name text,statements text[]);
      CREATE FUNCTION public.reject64_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected64_receipt_failure';END $$;
      CREATE TRIGGER reject64 BEFORE INSERT ON supabase_migrations.schema_migrations FOR EACH ROW EXECUTE FUNCTION public.reject64_receipt();`);
    const failed = query(atomicSql());
    assert.notEqual(failed.status, 0); assert.match(failed.stderr, /injected64_receipt_failure/);
    assert.equal(check("SELECT to_regprocedure('public.operator_stop_dealer_swing_v1(uuid,uuid,uuid)') IS NULL;"), 't');
    assert.deepEqual(JSON.parse(check(receiptSql(loadMigration()))), { count: 0, exact: false });
    check('DROP TRIGGER reject64 ON supabase_migrations.schema_migrations;DROP FUNCTION public.reject64_receipt();');
    check(atomicSql()); check(postcheckSql());
    assert.deepEqual(JSON.parse(check(receiptSql(loadMigration()))), { count: 1, exact: true });
    const definition = check("SELECT pg_get_functiondef('public.operator_stop_dealer_swing_v1(uuid,uuid,uuid)'::regprocedure);");
    assert.ok(definition.includes('SET auto_swing_enabled=false'));
    check(definition.replace('SET auto_swing_enabled=false', 'SET auto_swing_enabled=true'));
    const altered = query(postcheckSql());
    assert.notEqual(altered.status, 0); assert.match(altered.stderr, /stop64_object_postcheck_failed/);
    check(definition); check(postcheckSql());
    const replay = query(atomicSql());
    assert.notEqual(replay.status, 0); assert.match(replay.stderr, /stop64_precondition_drift/);
    check(postcheckSql());
    assert.deepEqual(JSON.parse(check(receiptSql(loadMigration()))), { count: 1, exact: true });
    console.log('STOP64_ATOMIC_ROLLBACK_COMMIT_BODY_REPLAY_PASS');
  });
