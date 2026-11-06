import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {sql,jsonSql} from './nativeDb.mjs';
const database=process.env.PUBLIC_HUD_LOCAL_DATABASE;
assert.match(database??'',/^vinpoker_hud_test_schema_fence_[a-z0-9_]+$/);
assert.deepEqual(process.argv.slice(2),['--initialize']);
assert.equal(sql('SELECT current_database();'),database);
assert.equal(sql("SELECT to_regnamespace('ops_load_fixture_v1') IS NULL;"),'t');
const fixture=readFileSync(new URL('../../supabase/pending-tests/operations_schema_freeze_fixture.sql',import.meta.url),'utf8');
assert.throws(()=>sql(fixture,{captureFailure:true}),'Unmarked target must be rejected');
assert.equal(sql("SELECT to_regnamespace('ops_load_fixture_v1') IS NULL;"),'t');
sql(`COMMENT ON DATABASE ${database} IS 'vinpoker-operational-schema-fence-disposable';`);
sql("SET vinpoker.isolated_schema_fence='cashier-current-schema-v1';\n"+fixture);
assert.equal(sql('BEGIN;SET LOCAL ROLE anon;SELECT public.fixture_operations_schema_ready_v1();ROLLBACK;'),'operations-complete-schema-v1');
sql(`CREATE TABLE ops_load_fixture_v1.business_probe(id integer PRIMARY KEY,value integer NOT NULL);
INSERT INTO ops_load_fixture_v1.business_probe VALUES(1,0);`);
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
const privacy=jsonSql(`SELECT jsonb_build_object('anon',has_function_privilege('anon','ops_load_fixture_v1.catalog_fingerprint()','EXECUTE'),
 'authenticated',has_table_privilege('authenticated','ops_load_fixture_v1.schema_fence','SELECT'),
 'service',has_function_privilege('service_role','ops_load_fixture_v1.guard_schema()','EXECUTE'));`);
assert.deepEqual(privacy,{anon:false,authenticated:false,service:false});
console.log(JSON.stringify({kind:'REAL_PG17_OPERATIONAL_SCHEMA_FREEZE',unmarkedTargetDenied:true,createBlocked:true,alterBlocked:true,grantBlocked:true,businessWrites:20,catalogUnchanged:true,privateFixture:true,qualification:false}));
