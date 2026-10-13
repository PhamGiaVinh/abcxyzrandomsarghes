import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {atomicSql,loadMigration,postcheckSql,preflightSql} from './floor-manual-67-release-plan.mjs';
import {receiptSql} from './floor-37-47-protected-apply.mjs';
test('PG17 atomic67 pins receipt66 and rolls back failed reader/ledger commits; exact success and replay',
  {skip:process.env.MANUAL67_PG_TEST!=='1'},()=>{
    assert.equal(process.env.PGHOST,'127.0.0.1');assert.equal(process.env.PGUSER,'postgres');
    assert.match(process.env.PGDATABASE??'',/^vinpoker_ops_floor66_atomic_/);assert.ok(['55464','55441'].includes(process.env.PGPORT));
    for(const k of ['PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGOPTIONS'])assert.ok(!process.env[k]);
    const query=sql=>spawnSync('psql',['-X','-qAt','-v','ON_ERROR_STOP=1'],{input:sql,encoding:'utf8'});
    const check=sql=>{const r=query(sql);assert.equal(r.status,0,r.stderr);return r.stdout.trim();};
    assert.equal(check("SELECT inet_server_addr()='127.0.0.1'::inet AND current_setting('server_version_num')::int BETWEEN 170000 AND 179999;"),'t');
    assert.equal(check("SELECT count(*)=0 FROM public.clubs;"),'t');
    const pre=JSON.parse(check(preflightSql()));assert.equal(pre.baseline,true);assert.equal(pre.existing,0);
    check(`CREATE FUNCTION public.reject67_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected67_receipt_failure';END $$;
      CREATE TRIGGER reject67 BEFORE INSERT ON supabase_migrations.schema_migrations FOR EACH ROW EXECUTE FUNCTION public.reject67_receipt();`);
    const failed=query(atomicSql());assert.notEqual(failed.status,0);assert.match(failed.stderr,/injected67_receipt_failure/);
    assert.equal(check("SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid='public.get_floor_restorable_entries_v3(uuid)'::regprocedure;"),'f9b32df63f6d9aa627aa5fbbd2d92d70');
    assert.deepEqual(JSON.parse(check(receiptSql(loadMigration()))),{count:0,exact:false});
    check('DROP TRIGGER reject67 ON supabase_migrations.schema_migrations;DROP FUNCTION public.reject67_receipt();');
    const corrupted=query(atomicSql().replace("e.source='manual'","e.source='tampered'"));
    assert.notEqual(corrupted.status,0);assert.match(corrupted.stderr,/manual_restore_reader_postcheck_failed/);
    assert.deepEqual(JSON.parse(check(receiptSql(loadMigration()))),{count:0,exact:false});
    check(atomicSql());check(postcheckSql());
    assert.deepEqual(JSON.parse(check(receiptSql(loadMigration()))),{count:1,exact:true});
    const replay=query(atomicSql());assert.notEqual(replay.status,0);assert.match(replay.stderr,/manual67_precondition_drift/);
    console.log('MANUAL67_ATOMIC_BASELINE66_ROLLBACK_COMMIT_REPLAY_PASS');
  });
