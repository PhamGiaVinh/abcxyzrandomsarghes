import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {validateProductionConnection,scalarRows,managementQuery} from './tracker-hud-production-query.mjs';
const env={TRACKER_HUD_TRANSPORT:'management',SUPABASE_PROJECT_REF:'orlesggcjamwuknxwcpk',SUPABASE_ACCESS_TOKEN:'private-test-credential'};
test('production transport requires exact explicit project and credential',()=>{
 assert.equal(validateProductionConnection(env),'management');
 for(const patch of [{SUPABASE_PROJECT_REF:'other'},{SUPABASE_ACCESS_TOKEN:''},{TRACKER_HUD_TRANSPORT:'unknown'},{TRACKER_HUD_TRANSPORT:undefined}])assert.throws(()=>validateProductionConnection({...env,...patch}));
 const direct={PGHOST:'db.orlesggcjamwuknxwcpk.supabase.co',PGPORT:'5432',PGUSER:'postgres',PGDATABASE:'postgres',PGSSLMODE:'require',PGPASSWORD:'private-test'};
 assert.equal(validateProductionConnection(direct),'psql');
 for(const key of Object.keys(direct))assert.throws(()=>validateProductionConnection({...direct,[key]:''}));
});
test('management results preserve exact scalar JSON and reject ambiguous shapes',()=>{
 assert.equal(scalarRows([{json_build_object:'{"a":true}'}]),'{"a":true}');assert.equal(scalarRows([]),'');
 for(const rows of [null,{},[null],[[]],[{a:1,b:2}],[{a:{secret:'never'}}]])assert.throws(()=>scalarRows(rows));
});
test('management requests bind endpoint and server identity without redirect or retry',async()=>{
 let calls=0;const request=async(url,options)=>{calls++;assert.equal(url,'https://api.supabase.com/v1/projects/orlesggcjamwuknxwcpk/database/query');assert.equal(options.redirect,'error');assert.equal(options.headers.Authorization,'Bearer private-test-credential');const q=JSON.parse(options.body).query;assert.match(q,/current_user<>'postgres'/);assert.match(q,/current_database\(\)<>'postgres'/);assert.ok(q.endsWith('SELECT 1;'));return {ok:true,json:async()=>[{value:'1'}]};};
 assert.equal(await managementQuery('SELECT 1;',env,request),'1');assert.equal(calls,1);
 calls=0;await assert.rejects(managementQuery('SELECT 1;',env,async()=>{calls++;return {ok:false,json:async()=>{throw Error('private server context');}};}),/Private database command failed/);assert.equal(calls,1);
 await assert.rejects(managementQuery('SELECT 1;',{...env,SUPABASE_PROJECT_REF:'other'},request));assert.equal(calls,1);
});
test('transport rejects malformed JSON and uncertain network outcomes without retry',async()=>{
 for(const request of [async()=>{throw Error('private timeout');},async()=>({ok:true,json:async()=>{throw Error('private response');}}),async()=>({ok:true,json:async()=>({error:'private'})})])await assert.rejects(managementQuery('SELECT 1;',env,request));
});
test('one complete request preserves real PostgreSQL transaction and rollback semantics', {skip:process.env.HUD_RELEASE_QUERY_NATIVE!=='1'},async()=>{
 assert.equal(process.env.GITHUB_ACTIONS,'true');assert.match(process.env.PUBLIC_HUD_LOCAL_DATABASE??'',/^vinpoker_hud_test_[a-z0-9_]+$/);
 // Use the CI service's separate postgres database to exercise the unchanged
 // production identity guard. This is fixed loopback with CI-only credentials;
 // it is not the application's fixture DB or hosted authorization evidence.
 assert.equal(process.env.PGPASSWORD,'postgres');
 const pg=sql=>spawnSync('psql',['-X','-qAt','-v','ON_ERROR_STOP=1','-f','-'],{input:sql,encoding:'utf8',env:{...process.env,PGHOST:'127.0.0.1',PGPORT:'5432',PGUSER:'postgres',PGDATABASE:'postgres'}});
 assert.equal(pg('SELECT current_database(),current_user;').stdout.trim(),'postgres|postgres');
 let lastError='';
 const request=async(_url,options)=>{const result=pg(JSON.parse(options.body).query);lastError=result.stderr;return {ok:result.status===0,json:async()=>result.stdout.trim()?[{value:result.stdout.trim()}]:[]};};
 assert.equal(pg('CREATE SCHEMA hud_transport_test;').status,0);
 try{
  await assert.rejects(managementQuery("BEGIN;CREATE TABLE hud_transport_test.receipt(id integer PRIMARY KEY);INSERT INTO hud_transport_test.receipt VALUES(1);DO $$ BEGIN RAISE EXCEPTION 'forced rollback';END $$;COMMIT;",env,request));
  assert.match(lastError,/forced rollback/);
  assert.equal(pg("SELECT to_regclass('hud_transport_test.receipt') IS NULL;").stdout.trim(),'t');
  await managementQuery('BEGIN;CREATE TABLE hud_transport_test.receipt(id integer PRIMARY KEY);INSERT INTO hud_transport_test.receipt VALUES(1);COMMIT;',env,request);
  assert.equal(pg('SELECT count(*) FROM hud_transport_test.receipt;').stdout.trim(),'1');
 }finally{assert.equal(pg('DROP SCHEMA hud_transport_test CASCADE;').status,0);}
});
