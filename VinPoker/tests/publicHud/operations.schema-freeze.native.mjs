import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {sql,jsonSql} from './nativeDb.mjs';
const database=process.env.PUBLIC_HUD_LOCAL_DATABASE;
assert.match(database??'',/^vinpoker_hud_test_schema_fence_[a-z0-9_]+$/);
assert.deepEqual(process.argv.slice(2),['--initialize']);
assert.equal(sql('SELECT current_database();'),database);
assert.equal(sql("SELECT to_regnamespace('ops_load_fixture_v1') IS NULL;"),'t');
// Compile the exact operational action preflight with PostgreSQL's PL/pgSQL
// parser. bash -n cannot detect malformed dollar quoting or IF/CASE syntax.
// Compilation does not execute its catalog/data checks or install source DDL.
const shell=readFileSync(new URL('../../scripts/ops/cashier-tour-real-e2e.sh',import.meta.url),'utf8').replaceAll('\r\n','\n');
const match=shell.match(/<<'ACTION_GUARD_PREFLIGHT'\n([\s\S]*?)\nACTION_GUARD_PREFLIGHT/);
assert.ok(match,'Exact action preflight heredoc required');
const block=match[1].match(/\nDO \$\$([\s\S]*?)\$\$;\s*$/);
assert.ok(block,'Complete action preflight DO block required');
const compile=body=>sql(`BEGIN;CREATE FUNCTION pg_temp.check_action_preflight() RETURNS void LANGUAGE plpgsql AS $validate$${body}$validate$;ROLLBACK;`,{captureFailure:true});
compile(block[1]);
const malformed=block[1].replace('OR (CASE WHEN','OR CASE WHEN').replace("<>1 END)\n OR EXISTS","<>1 END\n OR EXISTS");
assert.notEqual(malformed,block[1]);
assert.throws(()=>compile(malformed),'Unparenthesized operational IF/CASE must fail native compilation');
const fixture=readFileSync(new URL('../../supabase/pending-tests/operations_schema_freeze_fixture.sql',import.meta.url),'utf8');
assert.throws(()=>sql(fixture,{captureFailure:true}),'Unmarked target must be rejected');
assert.equal(sql("SELECT to_regnamespace('ops_load_fixture_v1') IS NULL;"),'t');
sql(`COMMENT ON DATABASE ${database} IS 'vinpoker-operational-schema-fence-disposable';`);
sql("SET vinpoker.isolated_schema_fence='cashier-current-schema-v1';\n"+fixture);
assert.equal(sql('BEGIN;SET LOCAL ROLE anon;SELECT public.fixture_operations_schema_ready_v1();ROLLBACK;'),'operations-complete-schema-v1');
sql(`CREATE TABLE ops_load_fixture_v1.business_probe(id integer PRIMARY KEY,value integer NOT NULL);
INSERT INTO ops_load_fixture_v1.business_probe VALUES(1,0);`);
sql(`CREATE TABLE public.clubs(id uuid PRIMARY KEY,name text);
CREATE TABLE public.tournaments(id uuid PRIMARY KEY,name text);
INSERT INTO public.clubs VALUES('a2000000-0000-4000-8000-000000000001','Cashier Edge TEST');
INSERT INTO public.tournaments VALUES('a3000000-0000-4000-8000-000000000001','Cashier Edge TEST Tour');`);
const before=sql('SELECT ops_load_fixture_v1.catalog_fingerprint();');assert.match(before,/^[a-f0-9]{32}$/);
sql('UPDATE ops_load_fixture_v1.schema_fence SET frozen=true,admission_at=clock_timestamp() WHERE singleton;');
sql(`DO $$ DECLARE denied boolean;BEGIN
 denied=false;BEGIN CREATE TABLE ops_load_fixture_v1.denied_table(id integer);EXCEPTION WHEN SQLSTATE '55000' THEN denied=true;END;IF NOT denied THEN RAISE EXCEPTION 'create_not_fenced';END IF;
 denied=false;BEGIN ALTER TABLE ops_load_fixture_v1.business_probe ADD COLUMN forbidden integer;EXCEPTION WHEN SQLSTATE '55000' THEN denied=true;END;IF NOT denied THEN RAISE EXCEPTION 'alter_not_fenced';END IF;
 denied=false;BEGIN GRANT SELECT ON ops_load_fixture_v1.business_probe TO anon;EXCEPTION WHEN SQLSTATE '55000' THEN denied=true;END;IF NOT denied THEN RAISE EXCEPTION 'grant_not_fenced';END IF;
 FOR i IN 1..20 LOOP UPDATE ops_load_fixture_v1.business_probe SET value=value+1 WHERE id=1;END LOOP;
 IF (SELECT value FROM ops_load_fixture_v1.business_probe WHERE id=1)<>20 THEN RAISE EXCEPTION 'business_write_failed';END IF;
END $$;`);
assert.equal(sql('SELECT ops_load_fixture_v1.catalog_fingerprint();'),before);
const profile=readFileSync(new URL('../../scripts/ops/operations-rpc-profile.sql',import.meta.url),'utf8');
const observation=JSON.parse(sql(profile,{captureFailure:true}));
assert.equal(observation.capture,'unavailable');
assert.equal(observation.reason,'fixture_scope_or_statistics_extension');
assert.equal(sql('SELECT ops_load_fixture_v1.catalog_fingerprint();'),before);
assert.equal(sql('SELECT frozen FROM ops_load_fixture_v1.schema_fence WHERE singleton;'),'t');
const privacy=jsonSql(`SELECT jsonb_build_object('anon',has_function_privilege('anon','ops_load_fixture_v1.catalog_fingerprint()','EXECUTE'),
 'authenticated',has_table_privilege('authenticated','ops_load_fixture_v1.schema_fence','SELECT'),
 'service',has_function_privilege('service_role','ops_load_fixture_v1.guard_schema()','EXECUTE'));`);
assert.deepEqual(privacy,{anon:false,authenticated:false,service:false});
console.log(JSON.stringify({kind:'REAL_PG17_OPERATIONAL_SCHEMA_FREEZE',actionPreflightCompiled:true,malformedActionPreflightDenied:true,unmarkedTargetDenied:true,createBlocked:true,alterBlocked:true,grantBlocked:true,businessWrites:20,catalogUnchanged:true,profileReadUnderFence:true,privateFixture:true,qualification:false}));
