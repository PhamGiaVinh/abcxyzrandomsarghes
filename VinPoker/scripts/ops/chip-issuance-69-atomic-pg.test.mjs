import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {atomicSql,loadMigration,postcheckSql,preflightSql} from './chip-issuance-69-release-plan.mjs';
import {receiptSql} from './floor-37-47-protected-apply.mjs';
test('PG17 issuance69 atomic ledger rollback, body rollback, commit and replay',
  {skip:process.env.ISSUANCE69_PG_TEST!=='1'},()=>{
    assert.equal(process.env.PGHOST,'127.0.0.1');assert.equal(process.env.PGUSER,'postgres');
    assert.match(process.env.PGDATABASE??'',/^vinpoker_ops_chip69_atomic_/);assert.ok(['55464','55441'].includes(process.env.PGPORT));
    for(const k of ['PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGOPTIONS'])assert.ok(!process.env[k]);
    const query=sql=>spawnSync('psql',['-X','-qAt','-v','ON_ERROR_STOP=1'],{input:sql,encoding:'utf8'});
    const check=sql=>{const r=query(sql);assert.equal(r.status,0,r.stderr);return r.stdout.trim();};
    assert.equal(check("SELECT inet_server_addr()='127.0.0.1'::inet AND current_setting('server_version_num')::int BETWEEN 170000 AND 179999;"),'t');
    assert.equal(check('SELECT count(*)=0 FROM public.clubs;'),'t');
    const pre=JSON.parse(check(preflightSql()));assert.equal(pre.baseline,true);assert.equal(pre.existing,0);
    const unchanged=()=>{
      assert.equal(check("SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid='public.chip_ops_set_issuance(uuid,integer)'::regprocedure;"),'e0fb34ec86462d73d7d95121f8ae5b3a');
      assert.equal(check("SELECT count(*) FROM pg_attribute WHERE attrelid='public.stack_template_issuance'::regclass AND attname='revision' AND NOT attisdropped;"),'0');
      assert.deepEqual(JSON.parse(check(receiptSql(loadMigration()))),{count:0,exact:false});
    };
    check(`CREATE FUNCTION public.reject69_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected69_receipt_failure';END $$;
      CREATE TRIGGER reject69 BEFORE INSERT ON supabase_migrations.schema_migrations FOR EACH ROW EXECUTE FUNCTION public.reject69_receipt();`);
    const failed=query(atomicSql());assert.notEqual(failed.status,0);assert.match(failed.stderr,/injected69_receipt_failure/);unchanged();
    check('DROP TRIGGER reject69 ON supabase_migrations.schema_migrations;DROP FUNCTION public.reject69_receipt();');
    const corrupted=query(atomicSql().replace("'EXACT_ISSUANCE_INTENT_REQUIRED'","'CORRUPTED_ISSUANCE'"));
    assert.notEqual(corrupted.status,0);assert.match(corrupted.stderr,/issuance69_object_postcheck_failed/);unchanged();
    check(atomicSql());check(postcheckSql());
    assert.deepEqual(JSON.parse(check(receiptSql(loadMigration()))),{count:1,exact:true});
    const replay=query(atomicSql());assert.notEqual(replay.status,0);assert.match(replay.stderr,/issuance69_precondition_drift/);
    console.log('ISSUANCE69_ATOMIC_ROLLBACK_COMMIT_REPLAY_PASS');
  });
