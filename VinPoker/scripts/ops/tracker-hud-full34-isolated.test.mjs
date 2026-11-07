import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {validateInvocation,CANDIDATE,BACKUP_RUN,SOURCE_ACTION_TABLE,PAUSE_RESTORED_DISPATCHER_SQL,validateSnapshotContext,sqlFailureMetadata,isolatedWorkerSecretSql} from './tracker-hud-full34-isolated.mjs';
import {execFileSync} from 'node:child_process';
const env={GITHUB_ACTIONS:'true',GITHUB_RUN_ID:'123',GITHUB_WORKSPACE:resolve('/fixture/workspace'),RUNNER_TEMP:resolve('/fixture/temp'),HUD_FULL34_ISOLATION_VERIFIED:'egress-blocked-cron-off',HUD_FULL34_DATABASE_CONTEXT_VERIFIED:'true'};
const candidate=resolve(env.GITHUB_WORKSPACE,'candidate/VinPoker'),report=resolve(env.RUNNER_TEMP,'hud-full34-rehearsal.json'),container='a'.repeat(64);
test('isolated worker credentials replace only two named fixtures without decrypting hosted secrets',()=>{
 for(const name of ['PUBLIC_HUD_WORKER_SECRET','PUBLIC_SPECTATOR_WORKER_SECRET']){
  const text=isolatedWorkerSecretSql(name,'a'.repeat(64));
  for(const guard of ["current_database()<>'postgres'","current_user<>'postgres'","current_setting('cron.launch_active_jobs')<>'off'",'enabled FROM tracker_analytics_v1.config',`DELETE FROM vault.secrets WHERE name='${name}'`,'vault.create_secret','BEGIN;','COMMIT;'])assert.ok(text.includes(guard),guard);
  assert.doesNotMatch(text,/update_secret|decrypted_secrets|TRUNCATE|CASCADE|GRANT|ALTER ROLE/i);
 }
 assert.throws(()=>isolatedWorkerSecretSql('ANOTHER_SECRET','a'.repeat(64)));
 assert.throws(()=>isolatedWorkerSecretSql('PUBLIC_HUD_WORKER_SECRET',"';SELECT 1;"));
});
test('full35 rehearsal loads supplemental dispatcher and retains close-function postchecks',()=>{
 const source=readFileSync('scripts/ops/tracker-hud-full34-isolated.mjs','utf8');
 for(const text of ['loadDispatchPackage(candidate)','assert.equal(entries.length,35)','pkg.closeManifest.postchecks','validateDispatcherObjects(report.dispatcherObjects,[pkg.manifest.postcheck,pkg.manifest.spectatorPostcheck])','ISOLATED_FULL35_SQL_BACKFILL_REHEARSAL_NOT_PRODUCTION_RELEASE',"report.stage='close-postchecks'","report.stage='dispatcher-postchecks'"])assert.ok(source.includes(text),text);
 assert.doesNotMatch(source,/loadClosePackage\(candidate\)|entries.length,34/);
});
test('snapshot context must match the encrypted receipt without post-snapshot owner adjustment',()=>{
 const receipt={version:1,database:'postgres',owner:'postgres',acl:[{grantee:'postgres',grantor:'postgres',privilege:'CONNECT',grantable:false}]};
 validateSnapshotContext(receipt,structuredClone(receipt));
 for(const changed of [{...receipt,owner:'supabase_admin'},{...receipt,acl:[]},{...receipt,version:2}])assert.throws(()=>validateSnapshotContext(receipt,changed));
 assert.throws(()=>validateSnapshotContext({...receipt,version:2},receipt));
 const source=readFileSync('scripts/ops/tracker-hud-full34-isolated.mjs','utf8');
 assert.doesNotMatch(source,/ALTER DATABASE|RESTORE_OWNER_CONTEXT_SQL|supabase_admin -d postgres|separate post-snapshot/);
 assert.ok(source.includes('restore/payload/database-context.json'));
});

test('SQL failure diagnostics retain only numeric status, SQLSTATE and source line',()=>{
 const raw='psql:<stdin>:37: ERROR:  42501: permission denied\nDETAIL: private player and token values\nCONTEXT: SQL source';
 assert.deepEqual(sqlFailureMetadata(raw,3),{exitCode:3,sqlState:'42501',inputLine:37,reason:'unclassified'});
 assert.deepEqual(sqlFailureMetadata('connection failed: private-host',null),{exitCode:null,sqlState:null,inputLine:null,reason:'unclassified'});
 assert.doesNotMatch(JSON.stringify(sqlFailureMetadata(raw,3)),/private|player|token|CONTEXT|SQL source/);
});
test('permission reasons expose fixed categories rather than server messages',()=>{
 assert.equal(sqlFailureMetadata('ERROR: 42501: "postgres" is a reserved role, private diagnostic',3).reason,'postgres-role-reserved');
 assert.equal(sqlFailureMetadata('ERROR: 42501: permission denied to set parameter "app.supabase_url"; private context',3).reason,'url-parameter-set-denied');
 assert.doesNotMatch(JSON.stringify(sqlFailureMetadata('ERROR: 42501: permission denied for private object',3)),/private object/);
});
test('dispatcher pause uses the existing cron API available to non-superuser postgres',()=>{
 assert.equal(PAUSE_RESTORED_DISPATCHER_SQL,"SELECT cron.alter_job(jobid,active:=false) FROM cron.job WHERE jobname='public-spectator-v2-dispatch';");
 const source=readFileSync('scripts/ops/tracker-hud-full34-isolated.mjs','utf8');
 assert.doesNotMatch(source,/UPDATE\s+cron\.job|ALTER ROLE.*SUPERUSER|GRANT.*cron\.job/i);
});
test('source integrity query matches the pinned candidate action-table contract',()=>{
 const root=process.env.HUD_REHEARSAL_TEST_CANDIDATE_ROOT??resolve('../candidate/VinPoker');
 assert.equal(execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),CANDIDATE);
 const contract=readFileSync(resolve(root,'scripts/ops/tracker-hud-shadow.mjs'),'utf8');
 assert.equal(SOURCE_ACTION_TABLE,'public.hand_actions');assert.ok(contract.includes(SOURCE_ACTION_TABLE+' a WHERE a.hand_id=h.id'));
});
test('rehearsal refuses unbound containers, targets, output and isolation context before I/O',()=>{
 validateInvocation(container,candidate,report,env);
 for(const [key,value]of [['GITHUB_ACTIONS','false'],['GITHUB_RUN_ID',''],['HUD_FULL34_ISOLATION_VERIFIED',''],['HUD_FULL34_DATABASE_CONTEXT_VERIFIED','false']])assert.throws(()=>validateInvocation(container,candidate,report,{...env,[key]:value}));
 for(const bad of ['postgres','db.orlesggcjamwuknxwcpk.supabase.co','a;echo x',''])assert.throws(()=>validateInvocation(bad,candidate,report,env));
 assert.throws(()=>validateInvocation(container,resolve('/production'),report,env));
 assert.throws(()=>validateInvocation(container,candidate,resolve('/dump.json'),env));
});
test('protected workflow pins archive, candidate and exact owner dispatch without production DB credentials',()=>{
 const yaml=readFileSync('../.github/workflows/tracker-hud-full34-isolated.yml','utf8');
 for(const text of [CANDIDATE,BACKUP_RUN,'refs/heads/main','dealer-swing-production-critical','CASHIER_BACKUP_AGE_IDENTITY','ISOLATED_FULL35_BACKUP_42388834421','51e46c474ff6910d4a53e1cbec1ee78cbdec6a5add3961326e6b911d03276f5d','cancel-in-progress: false','if: always()'])assert.ok(yaml.includes(text),text);
 assert.doesNotMatch(yaml,/SUPABASE_DB_PASSWORD|SUPABASE_ACCESS_TOKEN|functions deploy|db push/);
 const shell=readFileSync('scripts/ops/verify-floor-v3-recovery.sh','utf8');
 assert.ok(shell.indexOf('RESTORE_NETWORK_EGRESS=BLOCKED')<shell.indexOf("if [[ \"$rehearsal_mode\" == '--hud-full34-rehearsal' ]]"));
 assert.ok(shell.indexOf('RESTORED_CRON_JOBS=DISABLED')<shell.indexOf('HUD_FULL34_ISOLATION_VERIFIED='));
});
