import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {atomicSql,loadMigration,dependencyPredicate,postcheckSql} from './floor-roster-62-release-plan.mjs';
import {receiptSql} from './floor-37-47-protected-apply.mjs';
test('PG17 roster62 receipt failure rolls back RPC; exact commit and replay fence',
 {skip:process.env.ROSTER62_PG_TEST!=='1'},()=>{
 const db='vinpoker_ops_roster62_atomic_20261011';
 assert.equal(process.env.PGHOST,'127.0.0.1');assert.equal(process.env.PGUSER,'postgres');assert.equal(process.env.PGDATABASE,db);
 for(const key of ['PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGOPTIONS'])assert.ok(!process.env[key]);
 const args=['-w','-h','127.0.0.1','-p',process.env.PGPORT||'5432','-U','postgres','-d',db,'-X','-qAt','-v','ON_ERROR_STOP=1'];
 const query=sql=>spawnSync('psql',args,{input:sql,encoding:'utf8'});
 const check=sql=>{const r=query(sql);assert.equal(r.status,0,r.stderr);return r.stdout.trim();};
 assert.deepEqual(JSON.parse(check(`SELECT json_build_object('database',current_database()='${db}',
 'actor',current_user='postgres','loopback',inet_server_addr()='127.0.0.1'::inet,
 'pg17',current_setting('server_version_num')::int BETWEEN 170000 AND 179999,
 'ledger_absent',to_regclass('supabase_migrations.schema_migrations') IS NULL,
 'rpc_absent',to_regprocedure('public.get_floor_tournament_table_roster_v6(uuid)') IS NULL,
 'empty_clubs',(SELECT count(*)=0 FROM public.clubs));`)),
 {database:true,actor:true,loopback:true,pg17:true,ledger_absent:true,rpc_absent:true,empty_clubs:true});
 assert.equal(check(`SELECT ${dependencyPredicate()};`),'t');
 check(`CREATE SCHEMA supabase_migrations;CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY,name text,statements text[]);
 CREATE FUNCTION public.reject62_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected62_receipt_failure';END $$;
 CREATE TRIGGER reject62 BEFORE INSERT ON supabase_migrations.schema_migrations FOR EACH ROW EXECUTE FUNCTION public.reject62_receipt();`);
 const failed=query(atomicSql());assert.notEqual(failed.status,0);assert.match(failed.stderr,/injected62_receipt_failure/);
 assert.equal(check("SELECT to_regprocedure('public.get_floor_tournament_table_roster_v6(uuid)') IS NULL;"),'t');
 assert.deepEqual(JSON.parse(check(receiptSql(loadMigration()))),{count:0,exact:false});
 check('DROP TRIGGER reject62 ON supabase_migrations.schema_migrations;DROP FUNCTION public.reject62_receipt();');
 check(atomicSql());check(postcheckSql());
 assert.deepEqual(JSON.parse(check(receiptSql(loadMigration()))),{count:1,exact:true});
 const definition=check("SELECT pg_get_functiondef('public.get_floor_tournament_table_roster_v6(uuid)'::regprocedure);");
 assert.ok(definition.includes('FROM roster r CROSS JOIN participation p;'));
 check(definition.replace('FROM roster r CROSS JOIN participation p;','FROM roster r CROSS JOIN participation p WHERE false;'));
 const changed=query(postcheckSql());assert.notEqual(changed.status,0);assert.match(changed.stderr,/roster62_object_postcheck_failed/);
 check(definition);check(postcheckSql());
 const replay=query(atomicSql());assert.notEqual(replay.status,0);assert.match(replay.stderr,/roster62_precondition_drift/);
 check(postcheckSql());assert.deepEqual(JSON.parse(check(receiptSql(loadMigration()))),{count:1,exact:true});
 console.log('ROSTER62_ATOMIC_ROLLBACK_COMMIT_REPLAY_PASS');
});
