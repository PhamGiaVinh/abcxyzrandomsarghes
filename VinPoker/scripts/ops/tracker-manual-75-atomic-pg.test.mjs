import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {loadMigration,atomicSql,preflightSql,postcheckSql} from './tracker-manual-75-release-plan.mjs';
import {loadMigration as load74} from './tracker-public-74-release-plan.mjs';
import {receiptSql} from './floor-37-47-protected-apply.mjs';
test('PG17 manual75 body/ledger rollback, exact commit, postchecks and no replay',
 {skip:process.env.MANUAL75_PG_TEST!=='1'},()=>{
 assert.equal(process.env.PGHOST,'127.0.0.1');assert.equal(process.env.PGUSER,'postgres');
 assert.ok(['vinpoker_manual75_atomic_ci','vinpoker_manual75_atomic_20261014'].includes(process.env.PGDATABASE));
 assert.ok(['55464','55441'].includes(process.env.PGPORT));
 for(const key of ['PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGOPTIONS'])assert.ok(!process.env[key]);
 const win=process.platform==='win32';if(win)assert.match(process.env.VINPOKER_TEST_WSL_DISTRO??'',/^[A-Za-z0-9_.-]+$/u);
 const base=['-X','-qAt','-w','-v','ON_ERROR_STOP=1'];
 const args=win?['-d',process.env.VINPOKER_TEST_WSL_DISTRO,'--','psql','-h',process.env.PGHOST,'-p',process.env.PGPORT,'-U','postgres','-d',process.env.PGDATABASE,...base]:base;
 const query=sql=>spawnSync(win?'wsl':'psql',args,{input:sql,encoding:'utf8',maxBuffer:2*1024*1024,timeout:45000});
 const check=sql=>{const r=query(sql);assert.equal(r.status,0,r.stderr);return r.stdout.trim();};
 assert.equal(check("SELECT current_user='postgres' AND inet_server_addr()='127.0.0.1'::inet AND current_setting('server_version_num')::integer BETWEEN 170000 AND 179999 AND to_regclass('floor_private.tracker_manual_card_receipts_v1') IS NULL;"),'t');
 const item=loadMigration();assert.deepEqual(JSON.parse(check(receiptSql(load74()))),{count:1,exact:true});
 assert.equal(JSON.parse(check(preflightSql()).split('\n').find(s=>s.startsWith('{'))).existing,0);
 const fingerprint=()=>check("SELECT md5(jsonb_agg(jsonb_build_object('oid',p.oid,'definition',pg_get_functiondef(p.oid),'owner',p.proowner,'acl',p.proacl::text,'path',p.proconfig) ORDER BY p.oid)::text) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','floor_private') AND p.prokind='f';");
 check("CREATE FUNCTION public.manual75_reject_ledger() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.version='20270128000075' THEN RAISE EXCEPTION 'manual75_injected_ledger_failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER manual75_reject BEFORE INSERT ON supabase_migrations.schema_migrations FOR EACH ROW EXECUTE FUNCTION public.manual75_reject_ledger();");
 const before=fingerprint();
 const unchanged=()=>{
  assert.equal(fingerprint(),before);
  assert.equal(check("SELECT to_regclass('floor_private.tracker_manual_card_receipts_v1') IS NULL AND to_regprocedure('public.show_tracker_manual_cards_v1(uuid,uuid,bigint,bigint,text,jsonb)') IS NULL AND to_regprocedure('public.get_tracker_manual_card_receipt_v1(text,jsonb)') IS NULL;"),'t');
  assert.deepEqual(JSON.parse(check(receiptSql(item))),{count:0,exact:false});
  assert.deepEqual(JSON.parse(check(receiptSql(load74()))),{count:1,exact:true});
 };
 const failed=query(atomicSql());assert.notEqual(failed.status,0);assert.match(failed.stderr,/manual75_injected_ledger_failure/u);unchanged();
 const anchor='INSERT INTO supabase_migrations.schema_migrations',sql=atomicSql();assert.equal(sql.split(anchor).length,2);
 const bodyFailure=query(sql.replace(anchor,"DO $manual75_body_fault$ BEGIN RAISE EXCEPTION 'manual75_injected_body_failure'; END $manual75_body_fault$; "+anchor));
 assert.notEqual(bodyFailure.status,0);assert.match(bodyFailure.stderr,/manual75_injected_body_failure/u);unchanged();
 check('DROP TRIGGER manual75_reject ON supabase_migrations.schema_migrations; DROP FUNCTION public.manual75_reject_ledger();');
 check(atomicSql());check(postcheckSql());assert.deepEqual(JSON.parse(check(receiptSql(item))),{count:1,exact:true});
 const replay=query(atomicSql());assert.notEqual(replay.status,0);assert.match(replay.stderr,/manual75_ledger_drift/u);
 check(postcheckSql());assert.deepEqual(JSON.parse(check(receiptSql(item))),{count:1,exact:true});
 console.log('MANUAL75_ATOMIC_BODY_LEDGER_ROLLBACK_COMMIT_REPLAY_PASS');
});
