import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {loadMigration,atomicSql,preflightSql,postcheckSql} from './tracker-public-74-release-plan.mjs';
import {receiptSql} from './floor-37-47-protected-apply.mjs';
test('PG17 visibility74 receipt failure rolls back all policies and helper; commit and replay',
 {skip:process.env.VISIBILITY74_PG_TEST!=='1'},()=>{
 assert.equal(process.env.PGHOST,'127.0.0.1');assert.equal(process.env.PGUSER,'postgres');
 assert.ok(['vinpoker_visibility74_atomic_ci','vinpoker_visibility74_atomic_20261014','vinpoker_visibility74_atomic_final_20261014'].includes(process.env.PGDATABASE));
 assert.ok(['55464','55441'].includes(process.env.PGPORT));
 for(const k of ['PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGOPTIONS'])assert.ok(!process.env[k]);
 const win=process.platform==='win32';if(win)assert.match(process.env.VINPOKER_TEST_WSL_DISTRO??'',/^[A-Za-z0-9_.-]+$/);
 const base=['-X','-qAt','-w','-v','ON_ERROR_STOP=1'];
 const args=win?['-d',process.env.VINPOKER_TEST_WSL_DISTRO,'--','psql','-h',process.env.PGHOST,'-p',process.env.PGPORT,'-U','postgres','-d',process.env.PGDATABASE,...base]:base;
 const query=sql=>spawnSync(win?'wsl':'psql',args,{input:sql,encoding:'utf8',maxBuffer:2*1024*1024,timeout:45000});
 const check=sql=>{const r=query(sql);assert.equal(r.status,0,r.stderr);return r.stdout.trim();};
 assert.equal(check("SELECT current_user='postgres' AND inet_server_addr()='127.0.0.1'::inet AND current_setting('server_version_num')::integer BETWEEN 170000 AND 179999 AND to_regclass('supabase_migrations.schema_migrations') IS NULL;"),'t');
 check('CREATE SCHEMA supabase_migrations; CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY,name text,statements text[]);');
 const item=loadMigration();assert.equal(JSON.parse(check(preflightSql()).split('\n').find(x=>x.startsWith('{'))).existing,0);
 const unchanged=()=>{
  assert.equal(check("SELECT to_regprocedure('floor_private.tracker_hand_read_scope74(uuid,boolean,uuid)') IS NULL AND (SELECT count(*) FROM pg_policies WHERE policyname IN ('tournament_hands_visibility74','hand_players_visibility74','hand_actions_visibility74'))=0;"),'t');
  assert.deepEqual(JSON.parse(check(receiptSql(item))),{count:0,exact:false});
 };
 check("CREATE FUNCTION public.visibility74_reject_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'visibility74_injected_receipt_failure'; END $$; CREATE TRIGGER visibility74_reject BEFORE INSERT ON supabase_migrations.schema_migrations FOR EACH ROW EXECUTE FUNCTION public.visibility74_reject_receipt();");
 const failed=query(atomicSql());assert.notEqual(failed.status,0);assert.match(failed.stderr,/visibility74_injected_receipt_failure/);unchanged();
 check('DROP TRIGGER visibility74_reject ON supabase_migrations.schema_migrations; DROP FUNCTION public.visibility74_reject_receipt();');
 const sql=atomicSql(),anchor='INSERT INTO supabase_migrations.schema_migrations';
 assert.equal(sql.split(anchor).length,2);
 const bodyFailure=query(sql.replace(anchor,"DO $visibility74_body_failure$ BEGIN RAISE EXCEPTION 'visibility74_injected_body_failure'; END $visibility74_body_failure$; "+anchor));
 assert.notEqual(bodyFailure.status,0);assert.match(bodyFailure.stderr,/visibility74_injected_body_failure/);unchanged();
 check(atomicSql());check(postcheckSql());assert.deepEqual(JSON.parse(check(receiptSql(item))),{count:1,exact:true});
 const replay=query(atomicSql());assert.notEqual(replay.status,0);assert.match(replay.stderr,/visibility74_ledger_drift/);
 check(postcheckSql());assert.deepEqual(JSON.parse(check(receiptSql(item))),{count:1,exact:true});
 console.log('VISIBILITY74_ATOMIC_BODY_RECEIPT_ROLLBACK_COMMIT_REPLAY_PASS');
});
