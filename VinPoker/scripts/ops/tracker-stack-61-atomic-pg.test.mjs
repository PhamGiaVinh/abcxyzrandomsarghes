import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {atomicSql,loadMigration,dependencyPredicate} from './tracker-stack-61-release-plan.mjs';
import {receiptSql} from './floor-37-47-protected-apply.mjs';
test('PG17 stack61 ledger failure rolls back catalog and replay is fenced',
 {skip:process.env.STACK61_PG_TEST!=='1'},()=>{
 const db='vinpoker_ops_stack61_atomic_20261011';
 assert.equal(process.env.PGHOST,'127.0.0.1');assert.equal(process.env.PGUSER,'postgres');
 assert.equal(process.env.PGDATABASE,db);
 for(const key of ['PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGOPTIONS'])assert.ok(!process.env[key]);
 const windows=process.platform==='win32';if(windows)assert.equal(process.env.PGPORT,'55441');
 const args=['-w','-h','127.0.0.1','-p',process.env.PGPORT||'5432','-U','postgres','-d',db,'-X','-qAt','-v','ON_ERROR_STOP=1'];
 const query=sql=>spawnSync(windows?'wsl':'psql',windows?['psql',...args]:args,{input:sql,encoding:'utf8'});
 const check=sql=>{const r=query(sql);assert.equal(r.status,0,r.stderr);return r.stdout.trim();};
 assert.equal(check(`SELECT current_database()='${db}' AND current_user='postgres' AND inet_server_addr()='127.0.0.1'::inet
 AND current_setting('server_version_num')::int BETWEEN 170000 AND 179999
 AND to_regclass('supabase_migrations.schema_migrations') IS NULL AND (SELECT count(*)=0 FROM public.clubs);`),'t');
 assert.equal(check(`SELECT ${dependencyPredicate()};`),'t');
 const snapshot=`SELECT jsonb_agg(jsonb_build_object('id',p.oid,'definition',pg_get_functiondef(p.oid),
 'owner',p.proowner,'security',p.prosecdef,'acl',p.proacl,'config',p.proconfig) ORDER BY p.oid)::text
 FROM pg_proc p WHERE p.oid IN ('public.update_stack(uuid,uuid,integer,integer)'::regprocedure,
 'public.bulk_update_stacks(uuid,jsonb)'::regprocedure,
 'public.set_tracker_table_roster_seat_v2(uuid,uuid,uuid,bigint,uuid,integer,text,integer,uuid,boolean,text,text)'::regprocedure);`;
 const before=check(snapshot);
 check(`CREATE SCHEMA supabase_migrations;CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY,name text,statements text[]);
 CREATE FUNCTION public.reject61_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.version='20270128000061' THEN RAISE EXCEPTION 'injected61_receipt_failure';END IF;RETURN NEW;END $$;
 CREATE TRIGGER reject61 BEFORE INSERT ON supabase_migrations.schema_migrations FOR EACH ROW EXECUTE FUNCTION public.reject61_receipt();`);
 const failed=query(atomicSql());assert.notEqual(failed.status,0);assert.match(failed.stderr,/injected61_receipt_failure/);
 assert.equal(check(snapshot),before);
 assert.deepEqual(JSON.parse(check(receiptSql(loadMigration()))),{count:0,exact:false});
 check('DROP TRIGGER reject61 ON supabase_migrations.schema_migrations;DROP FUNCTION public.reject61_receipt();');
 check(atomicSql());
 check(readFileSync(new URL('../../tests/floorProduction/legacyStackIntegrity.readonly-postcheck.sql',import.meta.url),'utf8'));
 assert.deepEqual(JSON.parse(check(receiptSql(loadMigration()))),{count:1,exact:true});
 const applied=check(snapshot),replay=query(atomicSql());
 assert.notEqual(replay.status,0);assert.match(replay.stderr,/stack61_precondition_drift/);
 assert.equal(check(snapshot),applied);
 assert.deepEqual(JSON.parse(check(receiptSql(loadMigration()))),{count:1,exact:true});
 console.log('STACK61_ATOMIC_ROLLBACK_RECEIPT_OBJECT_REPLAY_PASS');
});
