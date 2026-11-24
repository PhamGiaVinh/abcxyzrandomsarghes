import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { applyPhase, catalogSql, preparePackage, releaseSha, qualifySourceTrees } from './tracker-bb-ante-release.mjs';

const root = process.env.RELEASE_SOURCE_ROOT ?? fileURLToPath(new URL('../..', import.meta.url));
const pre = { database: 'postgres', actor: 'postgres', pending: true, definitions: true, objects: true, metadata: Array.from({length:4}, (_, i) => ['retained', i, null]) };
const post = { ...pre };
const exact = { count: 1, exact: true };

test('activation-only qualifies the immutable release, while unrelated runner UI changes are never deployed', () => {
  const calls=[];
  const git=(cwd,args)=>{
    calls.push({cwd,args});
    if(cwd==='runner'&&args.includes('HEAD'))throw Error('runner has newer TV and finance UI');
    return '';
  };
  assert.doesNotThrow(()=>qualifySourceTrees('release','runner','45398872397',git));
  assert.equal(calls.length,2);assert.equal(calls[0].cwd,'release');
  assert.deepEqual(calls[0].args.slice(0,3),['status','--porcelain','--untracked-files=all']);
  assert.throws(()=>qualifySourceTrees('release','runner','',git),/newer TV/);
});

test('activation-only still rejects a changed release tree or an unrecognized original run', () => {
  assert.throws(()=>qualifySourceTrees('release','runner','45398872397',()=> ' M src/changed.ts'),/release tree/);
  assert.throws(()=>qualifySourceTrees('release','runner','other-run',()=>assert.fail('git must not run')),/resume run/);
  assert.throws(()=>qualifySourceTrees('release','runner','45398872397',(cwd,args)=>{
    if(cwd==='release')return '';
    assert.ok(args.includes('c6e8bea574c438138734323637adf0a50e55c533'));
    assert.ok(args.includes(':(exclude)src/pages/FinanceWorkspace.tsx'));
    throw Error('Tracker runtime changed');
  }),/Tracker runtime changed/);
});

test('actual activate351 CLI reaches its atomic writer without an import deadlock', () => {
  const directory = mkdtempSync(join(tmpdir(), 'tracker-activation-cli-'));
  try {
    const recovery = join(directory, 'recovery.json');
    const consumers = join(directory, 'consumers.json');
    const trace = join(directory, 'trace.txt');
    const preload = join(directory, 'transport.cjs');
    writeFileSync(recovery, JSON.stringify({schemaVersion:1,kind:'vinpoker-restore-verification',sourceSha:releaseSha,snapshotAt:new Date().toISOString(),isolatedRestore:'PASS',tableCountMatch:'PASS',productionMutation:false,databaseOwnerAndEffectiveAclMatch:true,ciphertextSha256:'a'.repeat(64)}));
    // Build the same complete receipt as the consumer CLI, without network access.
    const consumerModule = readFileSync(new URL('./tracker-bb-ante-consumers.mjs', import.meta.url), 'utf8');
    const inventory = [...consumerModule.matchAll(/\{slug:'([^']+)',id:'([^']+)',version:(\d+),verify_jwt:(true|false),status:'ACTIVE'\}/g)].map(([,slug,id,version,jwt]) => ({slug,id,version:Number(version)+1,beforeVersion:Number(version),verify_jwt:jwt==='true',status:'ACTIVE'}));
    assert.equal(inventory.length, 6);
    writeFileSync(consumers, JSON.stringify({sourceSha:releaseSha,edgeVerified:true,edgeFunctions:inventory.map(row=>row.slug),edgeVersions:inventory,frontend:{projectId:'prj_wLBZF7nG5O2bffM9Qu1v2rgMuMwk',hostname:'vinpoker.vercel.app',readyState:'READY',deploymentId:'dpl_CliFixture'}}));
    writeFileSync(preload, `
      const cp=require('node:child_process'),fs=require('node:fs');
      const responses=${JSON.stringify([pre,exact,exact,post])};
      cp.execFileSync=(command,args)=>{if(command!=='git'||!args.includes('rev-parse'))throw Error('Unexpected command');return '${releaseSha}\\n';};
      cp.spawnSync=(command,args,options)=>{
        if(command!=='psql')throw Error('Unexpected command');
        const writer=options.input.includes('INSERT INTO supabase_migrations.schema_migrations');
        fs.appendFileSync(${JSON.stringify(trace)},writer?'write\\n':'read\\n');
        return {status:0,stdout:writer?'':JSON.stringify(responses.shift()),stderr:''};
      };
      global.fetch=()=>{throw Error('Network forbidden in CLI fixture');};
      require('node:module').syncBuiltinESMExports();
    `);
    const result = spawnSync(process.execPath, ['--require',preload,fileURLToPath(new URL('./tracker-bb-ante-release.mjs',import.meta.url)),'activate351'], {encoding:'utf8',timeout:15000,env:{PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,
      RELEASE_SOURCE_ROOT:root,RELEASE_SHA:releaseSha,SOURCE_CHECKOUT_SHA:releaseSha,GITHUB_SHA:releaseSha,GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_REPOSITORY:'PhamGiaVinh/abcxyzrandomsarghes',GITHUB_REF:'refs/heads/main',GITHUB_ACTIONS:'true',INITIAL_ACTOR:'owner',TRIGGERING_ACTOR:'owner',REPOSITORY_OWNER:'owner',SUPABASE_PROJECT_REF:'orlesggcjamwuknxwcpk',PGHOST:'aws-1-ap-southeast-2.pooler.supabase.com',PGPORT:'5432',PGUSER:'postgres.orlesggcjamwuknxwcpk',PGDATABASE:'postgres',PGSSLMODE:'require',PGPASSWORD:'fixture-only-not-a-credential',RECOVERY_BASE_SHA:releaseSha,RECOVERY_RECEIPT_PATH:recovery,CONSUMER_RECEIPT_PATH:consumers,CONFIRM_TRACKER_BBA:`APPLY_TRACKER_BBA_350_351_${releaseSha}`}});
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout,/TRACKER_BBA_COMMITTED_EXACT 20270128000351/);
    assert.equal(readFileSync(trace,'utf8'),'read\nread\nwrite\nread\nread\n');
  } finally { rmSync(directory,{recursive:true,force:true}); }
});

test('pins the observed production reader and retains its plan-cache wrapper', () => {
  const phases=preparePackage(root);
  assert.match(catalogSql(phases[0]),/eae66e8c287d78489e8facea7303f7b9/);
  assert.match(catalogSql(phases[1],true),/f72e77c775b7b195dad149284f542533/);
});

test('prepares only the two reviewed migrations and pins the consumer source', () => {
  const phases = preparePackage(root);
  assert.equal(releaseSha, '3c6e2080a0afd2f611693ff13b280d368df886a3');
  assert.deepEqual(phases.map(p => p.version), ['20270128000350', '20270128000351']);
  for (const phase of phases) {
    assert.match(phase.atomic, /pg_advisory_xact_lock/);
    assert.match(phase.atomic, /INSERT INTO supabase_migrations.schema_migrations/);
  }
});

test('each phase performs one write and verifies the exact receipt and preserved metadata', () => {
  for (const phase of preparePackage(root)) {
    const responses = [pre, ...(phase.version.endsWith('351') ? [exact] : []), exact, post];
    let writes = 0;
    applyPhase(phase, { json: () => responses.shift(), execute: sql => { assert.equal(sql, phase.atomic); writes++; } });
    assert.equal(writes, 1);
    assert.deepEqual(responses, []);
  }
});

test('refuses a partial package or function drift before any write', () => {
  for (const changed of [{ pending: false }, { definitions: false }, { objects: false }, { metadata: [] }, { database: 'other' }]) {
    assert.throws(() => applyPhase(preparePackage(root)[0], {
      json: () => ({ ...pre, ...changed }), execute: () => assert.fail('unexpected write'),
    }), /preflight/);
  }
});

test('lost response is classified without retrying the writer or the next phase', () => {
  const responses = [pre, exact];
  let writes = 0;
  const messages = [];
  assert.throws(() => applyPhase(preparePackage(root)[0], {
    json: () => responses.shift(), execute: () => { writes++; throw Error('lost'); },
  }, message => messages.push(message)), /requires review/);
  assert.equal(writes, 1);
  assert.deepEqual(messages, ['TRACKER_BBA_STOP 20270128000350 receipt=committed-exact']);
});

test('a bad receipt or changed function privileges cannot produce success', () => {
  for (const responses of [[pre, exact, { count: 1, exact: false }], [pre, exact, exact, { ...post, metadata: [['changed']] }]]) {
    assert.throws(() => applyPhase(preparePackage(root)[1], {
      json: () => responses.shift(), execute: () => {},
    }, () => assert.fail('unexpected success')), /receipt|metadata/);
  }
});
