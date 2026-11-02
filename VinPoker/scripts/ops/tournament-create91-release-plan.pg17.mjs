import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {loadMigration,preflightSql,atomicSql,postcheckSql} from './tournament-create91-release-plan.mjs';

// Caller creates a fresh owned clone; never accepts a target via environment.
const database='vinpoker_ops_create91_release_v2';
for(const key of ['PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGOPTIONS'])assert.equal(process.env[key],undefined);
const command=process.platform==='win32'?'wsl':'psql';
const psql=['-X','-qAt','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-p','55441','-U','postgres','-d',database];
const args=process.platform==='win32'?['-d','PokerVision-P16-4C-Eval','--','psql',...psql]:psql;
const guard=`DO $$ BEGIN IF current_database()<>'${database}' OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet OR inet_server_port()<>55441 OR current_user<>'postgres' OR current_setting('server_version_num')::integer NOT BETWEEN 170000 AND 179999 THEN RAISE EXCEPTION 'wrong_owned_create91_release_target'; END IF; END $$;`;
function query(sql,expectedError){
 const result=spawnSync(command,args,{input:`${guard}\n${sql}`,encoding:'utf8',timeout:90000,maxBuffer:2*1024*1024});
 if(expectedError){assert.notEqual(result.status,0);assert.ok(result.stderr.includes(expectedError),result.stderr);}
 else assert.equal(result.status,0,result.stderr+result.stdout);
 return result.stdout.trim();
}
const item=loadMigration();
// Schema-only snapshot intentionally excludes the managed migration ledger.
// This synthetic ledger tests atomic SQL mechanics, not live ledger parity.
query(`CREATE SCHEMA supabase_migrations; CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY,name text,statements text[]);`);
const baseline=JSON.parse(query(preflightSql()));
assert.deepEqual(baseline,{database,actor:'postgres',existing:0});
query(`CREATE FUNCTION public.test_reject_create91_ledger() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.version='${item.version}' THEN RAISE EXCEPTION 'injected_create91_ledger_failure'; END IF; RETURN NEW; END $$;
CREATE TRIGGER test_reject_create91_ledger BEFORE INSERT ON supabase_migrations.schema_migrations FOR EACH ROW EXECUTE FUNCTION public.test_reject_create91_ledger();`);
query(atomicSql(),'injected_create91_ledger_failure');
// New connection: both functions and ledger must be absent, not partially applied.
assert.deepEqual(JSON.parse(query(preflightSql())),baseline);
query('DROP TRIGGER test_reject_create91_ledger ON supabase_migrations.schema_migrations; DROP FUNCTION public.test_reject_create91_ledger();');
query(atomicSql());query(postcheckSql());
query(preflightSql(),'create91_catalog_collision');
query(atomicSql(),'create91_catalog_collision');
query('GRANT EXECUTE ON FUNCTION public.create_tournament_with_levels_v1(uuid,jsonb,jsonb,uuid,uuid) TO anon;');
query(postcheckSql(),'create91_object_or_acl_drift');
query('REVOKE EXECUTE ON FUNCTION public.create_tournament_with_levels_v1(uuid,jsonb,jsonb,uuid,uuid) FROM anon;');
query(postcheckSql());
assert.equal(query(`SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='${item.version}' OR name='${item.name}';`),'1');
console.log('CREATE91_RELEASE_LEDGER_FAULT_ROLLS_BACK_FUNCTIONS_EXACT_APPLY_COLLISION_AND_ACL_DRIFT_PASS');
