import test from 'node:test';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';
import {atomicSql,postcheckSql,loadMigration} from './dealer-next80-release-plan.mjs';
import {loadMigration as rest78} from './dealer-rest78-release-plan.mjs';
import {receiptSql} from './floor-37-47-protected-apply.mjs';
test('PG17 next80 ledger failure rolls both new RPCs back',{skip:process.env.NEXT80_PG_TEST!=='1'},()=>{
 assert.equal(process.env.PGHOST,'127.0.0.1');assert.equal(process.env.PGUSER,'postgres');
 assert.equal(process.env.PGDATABASE,'vinpoker_ops_next80_atomic_ci');
 for(const key of ['PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGOPTIONS'])assert.ok(!process.env[key]);
 const query=s=>spawnSync('psql',['-X','-qAt','-v','ON_ERROR_STOP=1'],{input:s,encoding:'utf8'});
 const check=s=>{const r=query(s);assert.equal(r.status,0,r.stderr);return r.stdout.trim();};
 assert.equal(check("SELECT current_setting('server_version_num')::int BETWEEN 170000 AND 179999;"),'t');
 // This isolated clone inherits actual rest78 raw apply and combined79/81
 // receipts. Record the exact raw78 source only in this disposable test ledger.
 const dependency=rest78();
 assert.equal(check(`SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='${dependency.version}';`),'0');
 check(`INSERT INTO supabase_migrations.schema_migrations(version,name,statements)
 VALUES('${dependency.version}','${dependency.name}',ARRAY['${dependency.sql.replaceAll("'","''")}']::text[]);`);
 const absent="SELECT to_regprocedure('public.operator_plan_next_dealer_v1(uuid,uuid,integer,uuid,uuid)') IS NULL AND to_regprocedure('public.get_dealer_next_intent_receipt_v1(uuid,uuid,integer,uuid,uuid)') IS NULL;";
 assert.equal(check(absent),'t');
 check(`CREATE FUNCTION public.reject80_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.version='20270128000080' THEN RAISE EXCEPTION 'injected80_receipt_failure';END IF;RETURN NEW;END $$;
 CREATE TRIGGER reject80 BEFORE INSERT ON supabase_migrations.schema_migrations FOR EACH ROW EXECUTE FUNCTION public.reject80_receipt();`);
 const failed=query(atomicSql());assert.notEqual(failed.status,0);assert.match(failed.stderr,/injected80_receipt_failure/);
 assert.equal(check(absent),'t');assert.deepEqual(JSON.parse(check(receiptSql(loadMigration()))),{count:0,exact:false});
 check('DROP TRIGGER reject80 ON supabase_migrations.schema_migrations;DROP FUNCTION public.reject80_receipt();');
 check(atomicSql());check(postcheckSql());assert.deepEqual(JSON.parse(check(receiptSql(loadMigration()))),{count:1,exact:true});
 const replay=query(atomicSql());assert.notEqual(replay.status,0);assert.match(replay.stderr,/next80_catalog_collision/);
 console.log('NEXT80_LEDGER_FAILURE_BOTH_RPC_ROLLBACK_EXACT_POSTCHECK_PASS');
});
