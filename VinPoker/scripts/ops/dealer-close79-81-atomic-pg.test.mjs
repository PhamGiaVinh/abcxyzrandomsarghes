import test from 'node:test';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';
import {atomicSql,postcheckSql,receiptSql} from './dealer-close79-81-release-plan.mjs';
test('PG17 combined79/81 second-receipt failure rolls first migration back',{skip:process.env.CLOSE7981_PG_TEST!=='1'},()=>{
 assert.equal(process.env.PGHOST,'127.0.0.1');assert.equal(process.env.PGUSER,'postgres');assert.equal(process.env.PGDATABASE,'vinpoker_ops_close7981_atomic_ci');
 for(const k of ['PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGOPTIONS'])assert.ok(!process.env[k]);
 const query=s=>spawnSync('psql',['-X','-qAt','-v','ON_ERROR_STOP=1'],{input:s,encoding:'utf8'});
 const check=s=>{const r=query(s);assert.equal(r.status,0,r.stderr);return r.stdout.trim();};
 assert.equal(check("SELECT current_setting('server_version_num')::int BETWEEN 170000 AND 179999;"),'t');
 const fingerprint="SELECT json_build_object('definition',md5(pg_get_functiondef(p.oid)),'owner',p.proowner,'acl',p.proacl::text,'config',p.proconfig)::text FROM pg_proc p WHERE p.oid='public.operator_close_club_table_v2(uuid,bigint,uuid)'::regprocedure;";
 const before=check(fingerprint);assert.equal(JSON.parse(before).definition,'7724e5d9abd44d876f990e2521830582');
 check(`CREATE FUNCTION public.reject81_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.version='20270128000081' THEN RAISE EXCEPTION 'injected81_receipt_failure';END IF;RETURN NEW;END $$;
 CREATE TRIGGER reject81 BEFORE INSERT ON supabase_migrations.schema_migrations FOR EACH ROW EXECUTE FUNCTION public.reject81_receipt();`);
 const failed=query(atomicSql());assert.notEqual(failed.status,0);assert.match(failed.stderr,/injected81_receipt_failure/);
 assert.equal(check(fingerprint),before);assert.deepEqual(JSON.parse(check(receiptSql())),{count:0,exact:false});
 check('DROP TRIGGER reject81 ON supabase_migrations.schema_migrations;DROP FUNCTION public.reject81_receipt();');
 check(atomicSql());check(postcheckSql());assert.deepEqual(JSON.parse(check(receiptSql())),{count:2,exact:true});
 const replay=query(atomicSql());assert.notEqual(replay.status,0);assert.match(replay.stderr,/ledger_collision/);
 console.log('CLOSE7981_SECOND_RECEIPT_FAILURE_FULL_OBJECT_ROLLBACK_EXACT_FINAL_PASS');
});
