import assert from 'node:assert/strict';
import {execFileSync,spawn} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {pauseSql,resumeSql,activeSql} from './spectator342344-dispatch-control.mjs';
const container=process.env.CRON_TEST_CONTAINER;
assert.match(container??'',/^spectator-cron-[0-9]+$/);
const args=['exec','-i',container,'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-U','cron_admin','-d','postgres'];
const role='SET SESSION AUTHORIZATION postgres;';
const raw=(query)=>execFileSync('docker',args,{input:query,encoding:'utf8',stdio:['pipe','pipe','pipe'],timeout:15000});
const sql=query=>raw(role+query).trim();
const json=query=>JSON.parse(sql(query).split('\n').find(line=>line.startsWith('{')));
raw(`CREATE EXTENSION pg_cron VERSION '1.6';CREATE ROLE postgres LOGIN;GRANT USAGE ON SCHEMA cron TO postgres;GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA cron TO postgres;`);
assert.equal(raw("SELECT extversion FROM pg_extension WHERE extname='pg_cron';").trim(),'1.6');
// Upstream1.6.4 ships SQL extension version1.6. Source commit/tar digest is pinned in the image.
raw(readFileSync(new URL('./spectator342344-dispatcher-current.fixture.sql',import.meta.url),'utf8'));
raw("SELECT setval('cron.jobid_seq',51,true);");
sql("SELECT cron.schedule('public-spectator-v2-dispatch','1 second','SELECT public.dispatch_public_spectator_projection_v2()');");
raw("SELECT setval('cron.jobid_seq',54,true);");
sql("SELECT cron.schedule('public-hud-projection-v1-dispatch','1 second','SELECT public.dispatch_public_hud_projection_v1()');");
assert.equal(sql("SELECT has_table_privilege(current_user,'cron.job','UPDATE');"),'f');
assert.equal(sql("SELECT relrowsecurity FROM pg_class WHERE oid='cron.job'::regclass;"),'t');
assert.throws(()=>sql('BEGIN;SELECT jobid FROM cron.job FOR UPDATE NOWAIT;COMMIT;'),e=>e.stderr.includes('permission denied'));
assert.equal(json(activeSql()).exact,true);
const hud=()=>sql('SELECT xmin::text FROM cron.job WHERE jobid=55;');
const beforeHud=hud(),paused=json(pauseSql());assert.equal(paused.paused,true);assert.equal(hud(),beforeHud);
assert.throws(()=>sql(resumeSql('1')),e=>e.stderr.includes('dispatcher_pause_ownership_drift'));
assert.equal(json(resumeSql(paused.pauseXmin)).resumed,true);assert.equal(hud(),beforeHud);
json(pauseSql().replace('COMMIT;','ROLLBACK;'));assert.equal(json(activeSql()).exact,true);
const owned=json(pauseSql());sql('SELECT cron.alter_job(52,active:=false);');
assert.throws(()=>sql(resumeSql(owned.pauseXmin)),e=>e.stderr.includes('dispatcher_pause_ownership_drift'));
// Test-only recovery from deliberate competitor: never part of production controller.
sql('SELECT cron.alter_job(52,active:=true);');
function asynchronous(query){return new Promise(resolve=>{const child=spawn('docker',args,{stdio:['pipe','pipe','pipe']});let out='',err='';child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);child.on('close',code=>resolve({code,out,err}));child.stdin.end(role+"SET application_name='spectator-cron-race';"+query);});}
async function waitForSleep(){for(let i=0;i<50;i++){if(raw("SELECT count(*) FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND wait_event='PgSleep' AND application_name='spectator-cron-race';").trim()!=='0')return;await new Promise(r=>setTimeout(r,20));}throw Error('Concurrent transaction did not reach synchronized sleep');}
// Force a real committed competing update after the serializable snapshot, before API UPDATE.
const racing=asynchronous(pauseSql().replace(' PERFORM cron.alter_job(52,active:=false);',' PERFORM pg_sleep(5); PERFORM cron.alter_job(52,active:=false);'));
await waitForSleep();sql('SELECT cron.alter_job(52,active:=true);');
const race=await racing;assert.notEqual(race.code,0);assert.match(race.err,/could not serialize access/);assert.equal(json(activeSql()).exact,true);
// A55 change can serialize independently: fresh committed observations must reject it before migrations.
const racingHud=asynchronous(pauseSql().replace(' PERFORM cron.alter_job(52,active:=false);',' PERFORM pg_sleep(5); PERFORM cron.alter_job(52,active:=false);'));
await waitForSleep();sql('SELECT cron.alter_job(55,active:=false);');await racingHud;
assert.equal(json(activeSql()).exact,false);assert.equal(sql('SELECT active FROM cron.job WHERE jobid=55;'),'f');
sql('SELECT cron.alter_job(55,active:=true);SELECT cron.alter_job(52,active:=true);');
// Lost response: actual pause committed; discard result and observe, never blindly retry/resume.
sql(pauseSql());assert.equal(sql('SELECT active FROM cron.job WHERE jobid=52;'),'f');
console.log('REAL_PG_CRON_1_6_4_SELECT_ONLY_CALLER_API_SERIALIZATION_ROLLBACK_OWNERSHIP_PASS');
