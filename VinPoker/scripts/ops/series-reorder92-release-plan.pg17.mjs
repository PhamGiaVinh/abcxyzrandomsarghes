import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {loadMigration,preflightSql,atomicSql,postcheckSql} from './series-reorder92-release-plan.mjs';
// Fresh caller-created owned clone only; committed synthetic ledger is retained.
const database='vinpoker_ops_series92_release';
for(const key of ['PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGOPTIONS'])assert.equal(process.env[key],undefined);
const command=process.platform==='win32'?'wsl':'psql';
const psql=['-X','-qAt','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-p','55441','-U','postgres','-d',database];
const args=process.platform==='win32'?['-d','PokerVision-P16-4C-Eval','--','psql',...psql]:psql;
const guard=`DO $$ BEGIN IF current_database()<>'${database}' OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet OR inet_server_port()<>55441 OR current_user<>'postgres' OR current_setting('server_version_num')::int NOT BETWEEN 170000 AND 179999 THEN RAISE EXCEPTION 'owned_series92_release_only'; END IF;END $$;`;
function query(sql,error){const r=spawnSync(command,args,{input:guard+sql,encoding:'utf8',timeout:90000,maxBuffer:2*1024*1024});if(error){assert.notEqual(r.status,0);assert.ok(r.stderr.includes(error),r.stderr);}else assert.equal(r.status,0,r.stderr+r.stdout);return r.stdout.trim();}
function nullablePolicyDrift(){
 query(`BEGIN;DROP POLICY "club_series_images public read" ON public.club_series_images;DROP POLICY "club_series_images manage" ON public.club_series_images;CREATE POLICY "club_series_images public read" ON public.club_series_images FOR SELECT;CREATE POLICY "club_series_images manage" ON public.club_series_images FOR ALL TO authenticated;${postcheckSql()}`,'series92_gallery_or_privilege_drift');
 // Failing connection rolled back the temporary policies; a new one must pass.
 query(postcheckSql());
}
if(process.argv[2]==='--postcheck-only'){
 nullablePolicyDrift();console.log('SERIES92_NULL_POLICY_DIGEST_REJECTED_AND_POLICY_ROLLBACK_NEW_CONNECTION_PASS');process.exit(0);
}
assert.equal(process.argv[2],undefined);
// Captured public schema excludes managed ledger. Tests mechanics, not live parity.
query('CREATE SCHEMA supabase_migrations;CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY,name text,statements text[]);');
const baseline=JSON.parse(query(preflightSql()));assert.deepEqual(baseline,{database,actor:'postgres',existing:0});
const item=loadMigration();
query(`CREATE FUNCTION public.test_reject_series92_ledger() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.version='${item.version}' THEN RAISE EXCEPTION 'injected_series92_ledger_failure';END IF;RETURN NEW;END $$;
 CREATE TRIGGER test_reject_series92_ledger BEFORE INSERT ON supabase_migrations.schema_migrations FOR EACH ROW EXECUTE FUNCTION public.test_reject_series92_ledger();`);
query(atomicSql(),'injected_series92_ledger_failure');
assert.deepEqual(JSON.parse(query(preflightSql())),baseline);
query('DROP TRIGGER test_reject_series92_ledger ON supabase_migrations.schema_migrations;DROP FUNCTION public.test_reject_series92_ledger();');
query(atomicSql());query(postcheckSql());
query(preflightSql(),'series92_catalog_collision');query(atomicSql(),'series92_catalog_collision');
query('GRANT EXECUTE ON FUNCTION public.reorder_club_series_images_v1(uuid,jsonb,uuid[],uuid,uuid) TO anon;');
query(postcheckSql(),'series92_object_or_acl_drift');
query('REVOKE EXECUTE ON FUNCTION public.reorder_club_series_images_v1(uuid,jsonb,uuid[],uuid,uuid) FROM anon;');
query('GRANT UPDATE(position) ON public.club_series_images TO authenticated;');
query(postcheckSql(),'series92_gallery_or_privilege_drift');
query('REVOKE UPDATE(position) ON public.club_series_images FROM authenticated;');
query(`BEGIN;CREATE POLICY test_series92_extra_policy ON public.club_series_images FOR SELECT TO authenticated USING(true);${postcheckSql()}`,'series92_gallery_or_privilege_drift');
query(postcheckSql());
nullablePolicyDrift();
assert.equal(query(`SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='${item.version}' OR name='${item.name}';`),'1');
console.log('SERIES92_RELEASE_LEDGER_FAULT_ROLLS_BACK_RPCS_AND_GRANTS_EXACT_APPLY_COLLISION_ACL_POSITION_POLICY_DRIFT_PASS');
