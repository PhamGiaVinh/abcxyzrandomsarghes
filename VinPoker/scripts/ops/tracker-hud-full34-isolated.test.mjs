import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {validateInvocation,CANDIDATE,BACKUP_RUN,SOURCE_ACTION_TABLE} from './tracker-hud-full34-isolated.mjs';
import {execFileSync} from 'node:child_process';
const env={GITHUB_ACTIONS:'true',GITHUB_RUN_ID:'123',GITHUB_WORKSPACE:resolve('/fixture/workspace'),RUNNER_TEMP:resolve('/fixture/temp'),HUD_FULL34_ISOLATION_VERIFIED:'egress-blocked-cron-off'};
const candidate=resolve(env.GITHUB_WORKSPACE,'candidate/VinPoker'),report=resolve(env.RUNNER_TEMP,'hud-full34-rehearsal.json'),container='a'.repeat(64);
test('source integrity query matches the pinned candidate action-table contract',()=>{
 const root=process.env.HUD_REHEARSAL_TEST_CANDIDATE_ROOT??resolve('../candidate/VinPoker');
 assert.equal(execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),CANDIDATE);
 const contract=readFileSync(resolve(root,'scripts/ops/tracker-hud-shadow.mjs'),'utf8');
 assert.equal(SOURCE_ACTION_TABLE,'public.hand_actions');assert.ok(contract.includes(SOURCE_ACTION_TABLE+' a WHERE a.hand_id=h.id'));
});
test('rehearsal refuses unbound containers, targets, output and isolation context before I/O',()=>{
 validateInvocation(container,candidate,report,env);
 for(const [key,value]of [['GITHUB_ACTIONS','false'],['GITHUB_RUN_ID',''],['HUD_FULL34_ISOLATION_VERIFIED','']])assert.throws(()=>validateInvocation(container,candidate,report,{...env,[key]:value}));
 for(const bad of ['postgres','db.orlesggcjamwuknxwcpk.supabase.co','a;echo x',''])assert.throws(()=>validateInvocation(bad,candidate,report,env));
 assert.throws(()=>validateInvocation(container,resolve('/production'),report,env));
 assert.throws(()=>validateInvocation(container,candidate,resolve('/dump.json'),env));
});
test('protected workflow pins archive, candidate and exact owner dispatch without production DB credentials',()=>{
 const yaml=readFileSync('../.github/workflows/tracker-hud-full34-isolated.yml','utf8');
 for(const text of [CANDIDATE,BACKUP_RUN,'refs/heads/main','dealer-swing-production-critical','CASHIER_BACKUP_AGE_IDENTITY','ISOLATED_FULL34_BACKUP_42373584563','3c9caf25231582967c0bc0bef61eba7da65565aeea09d292017bc900e8c4610e','cancel-in-progress: false','if: always()'])assert.ok(yaml.includes(text),text);
 assert.doesNotMatch(yaml,/SUPABASE_DB_PASSWORD|SUPABASE_ACCESS_TOKEN|functions deploy|db push/);
 const shell=readFileSync('scripts/ops/verify-floor-v3-recovery.sh','utf8');
 assert.ok(shell.indexOf('RESTORE_NETWORK_EGRESS=BLOCKED')<shell.indexOf("if [[ \"$rehearsal_mode\" == '--hud-full34-rehearsal' ]]"));
 assert.ok(shell.indexOf('RESTORED_CRON_JOBS=DISABLED')<shell.indexOf('HUD_FULL34_ISOLATION_VERIFIED='));
});
