import test, { after } from 'node:test';
import {selectedAudienceMetadata,audienceResourceStats,audiencePoolStats,readAudiencePoolMetrics,reentryServerTiming} from './operations-audience-scope.mjs';
import http from 'node:http';
import {ownedAudienceCancellation,audienceClockSignal,audienceScopeSignal,audienceFailure,audienceFileLimits,audienceGatewayConfig,prepareAudienceGatewayTemplate,audienceJoinFailure,audienceSocketDiagnostic,audienceWorkerFailure,audienceServerTiming,observeAudienceHandshake,observeAudienceSubscriptions} from './operations-audience-scope.mjs';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, existsSync, cpSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, posix, resolve } from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { selectCashierSchemaMode, qualifiedHud35 } from './select-cashier-schema-mode.mjs';
import { loadPackage } from './tracker-hud-20261104-release.mjs';
import {configureIsolatedPostgrestPool} from './isolated-postgrest-pool.mjs';

const script = readFileSync(new URL('./cashier-tour-real-e2e.sh', import.meta.url), 'utf8');
const workflow = readFileSync(new URL('../../../.github/workflows/cashier-tour-real-e2e.yml', import.meta.url), 'utf8');

test('targeted diagnostics refuse invalid scope before any service operation',()=>{
 const bash=process.platform==='win32'?'D:/Git/bin/bash.exe':'bash';
 const entry=fileURLToPath(new URL('./cashier-tour-real-e2e.sh',import.meta.url));
 for(const patch of [
  {LOCAL_OPERATIONS_DIAGNOSTIC_SCOPE:'other'},
  {LOCAL_OPERATIONS_DIAGNOSTIC_SCOPE:'cashier-payment',CASHIER_SCHEMA_MODE:'pre03'},
  {LOCAL_OPERATIONS_DIAGNOSTIC_SCOPE:'dealer-checkin',CASHIER_SCHEMA_MODE:'current',LOCAL_OPERATIONS_CANDIDATE_PROBE:'1',LOCAL_OPERATIONS_REALTIME:'1',LOCAL_OPERATIONS_AUDIENCE:'0'},
 ]){
  const r=spawnSync(bash,[entry],{env:{...process.env,...patch},encoding:'utf8',timeout:5000});
  assert.notEqual(r.status,0);assert.match(r.stderr,/Unknown targeted diagnostic|Targeted diagnostics require/);
 }
});

test('targeted runs stay separate from full acceptance and retain actual conservation gates',()=>{
 const start=script.indexOf('if [[ "$diagnostic_scope" != none ]]; then\n  loaded_phase_checkpoint');
 const end=script.indexOf('\nrun_browser_proof\n',start);
 assert.ok(start>0&&end>start);
 const branch=script.slice(start,end);
 assert.match(branch,/targeted canonical Cashier payment reproduction across ten fresh tours/);
 assert.match(branch,/real check-in HTTP commit, independent observation, exact retry and tenant boundary/);
 assert.match(branch,/movements:200,cash:1320000000,entries:200,activeSeats:200,seatedChips:4000000/);
 assert.match(branch,/assert\.equal\(fence\.before,after\)/);
 assert.match(branch,/assert\.ok\(Object\.values\(audience\.checks\)\.every\(v=>v===true\)\)/);
 assert.match(branch,/TARGETED_OPERATIONAL_REPRODUCTION_NOT_FULL_ACCEPTANCE/);
 assert.match(branch,/assert\.equal\(runtime\.pendingReentryTransportApplied,true\)/);
 assert.match(branch,/assert\.equal\(runtime\.correctionMigrationApplied,true\)/);
 const guard=script.slice(script.indexOf('case "$diagnostic_scope"'),script.indexOf('if [[ "$operations_rest_pool"'));
 assert.match(guard,/"\$reentry_transport_probe" != 1/);
 assert.match(guard,/"\$correction_undo_probe" != 1/);
 assert.match(guard,/"\$prize_close_probe" != 1/);
 assert.match(guard,/"\$reentry_fault_mode" != healthy/);
 assert.doesNotMatch(branch,/all-operational-stages-passed/);
 assert.match(branch,/\n  exit 0\nfi$/);
 assert.match(workflow,/github\.event_name == 'workflow_dispatch' && inputs\.diagnostic_scope \|\| 'none'/);
});

test('handover fixture cannot consume the independent salary actor',()=>{
 const selection=script.slice(script.indexOf("SELECT 'ad500000-0000-4000-8000-000000000001',c.user_id"),script.indexOf('ORDER BY c.user_id LIMIT 1;'));
 assert.match(selection,/c\.user_id=\(SELECT id FROM auth\.users WHERE email='cashier-latency-19@test\.invalid'\)/);
 assert.match(selection,/NOT EXISTS\(SELECT 1 FROM public\.clubs owned WHERE owned\.owner_id=c\.user_id\)/);
 assert.match(script,/IF \(SELECT count\(\*\) FROM auth\.users WHERE email='cashier-latency-20@test\.invalid'\)<>1/);
 assert.match(script,/RAISE EXCEPTION 'salary_fixture_requires_independent_unowned_actor'/);
});

test('redraw join diagnosis survives the actual workflow artifact filter',()=>{
 const output=script.match(/output\/operations-latency\/(cashier-http-floor-redraw-diagnostic[^"\s]*)/)?.[1];
 assert.ok(output,'Expected bounded scalar redraw diagnostic');
 const patterns=[...workflow.matchAll(/^\s+(VinPoker\/output\/operations-latency\/[^\s]+)$/gm)].map(m=>m[1]);
 assert.ok(patterns.some(pattern=>posix.matchesGlob('VinPoker/output/operations-latency/'+output,pattern)),'Diagnostic must be retained by actual upload filter');
});

test('real-stack rollback refuses foreign scope and remote API before any database call',()=>{
 const dir=mkdtempSync(join(tmpdir(),'hud-rollback-guard-'));const status=join(dir,'status.env');
 writeFileSync(status,'API_URL=https://example.invalid\nANON_KEY=synthetic-public-key\n');
 const entry=fileURLToPath(new URL('../../tests/publicHud/scale.rollback-runtime.mjs',import.meta.url));
 const env={...process.env,PUBLIC_HUD_STACK_PROJECT:'hud-scale-guard',PUBLIC_HUD_ISOLATED_STACK:'vinpoker-hud-scale',PUBLIC_HUD_LOCAL_DATABASE:'postgres',PUBLIC_HUD_LOCAL_PORT:'54322',PUBLIC_HUD_STATUS_FILE:status};
 for(const patch of [{PUBLIC_HUD_STACK_PROJECT:'production'},{PUBLIC_HUD_LOCAL_PORT:'5432'},{}]){const r=spawnSync(process.execPath,[entry],{env:{...env,...patch},encoding:'utf8',timeout:5000});assert.notEqual(r.status,0);assert.match(r.stderr,/Disposable|example\.invalid/);}
 const stack=readFileSync(new URL('../../tests/publicHud/scale.stack.sh',import.meta.url),'utf8');
 assert.ok(stack.indexOf('node tests/publicHud/scale.rollback-runtime.mjs')>stack.indexOf('node tests/publicHud/scale.http-ws.mjs'));
 rmSync(dir,{recursive:true,force:true});
});

test('real-stack worker uses the HUD schedule addressed by release postcheck and rollback',()=>{
 const setup=readFileSync(new URL('../../tests/publicHud/scale.stack-setup.mjs',import.meta.url),'utf8');
 const rollback=readFileSync(new URL('./tracker-hud-20261104-rollback-stop.sql',import.meta.url),'utf8');
 const postcheck=readFileSync(new URL('./tracker-hud-20261104-postcheck.sql',import.meta.url),'utf8');
 const name=rollback.match(/WHERE jobname='([^']+)'/)?.[1];assert.equal(name,'public-hud-projection-v1-dispatch');
 assert.ok(setup.includes("cron.schedule('"+name+"','1 second','SELECT public.dispatch_public_hud_projection_v1()')"));
 assert.ok(postcheck.includes(name));assert.match(setup,/if\(!scheduleReady\)throw Error/);
 assert.ok(setup.includes("count(*)=2 AND bool_and(active AND schedule='1 second'"));
 const privateProvisioning=setup.slice(setup.indexOf('CREATE FUNCTION public.fixture_provision_hud_workers_v1'),setup.indexOf('END $$;'));
 assert.ok(!privateProvisioning.includes('cron.schedule'));
 assert.ok(setup.includes("if(sql('SELECT current_user;')!=='postgres')"));
 assert.ok(setup.includes("username='postgres' AND"));
});

test('redraw probe refuses historical/incomplete modes before allocating a stack',()=>{
 const base={CASHIER_SCHEMA_MODE:'current',LOCAL_OPERATIONS_REALTIME:'1',LOCAL_OPERATIONS_CANDIDATE_PROBE:'1',LOCAL_CLOCK_CANDIDATE_PROBE:'0',LOCAL_REENTRY_TRANSPORT_PROBE:'0',LOCAL_REENTRY_FAULT_MODE:'failure-injection',LOCAL_CORRECTION_UNDO_PROBE:'0',LOCAL_OPERATIONS_REDRAW_PROBE:'1',LOCAL_OPERATIONS_AUDIENCE:'0',LOCAL_OPERATIONS_AUDIENCE_MODEL:'selected-table',LOCAL_OPERATIONS_REST_POOL:'10',SCHEMA_ARTIFACT_DIRECTORY:'/missing-redraw-probe-fixture'};
 const run=(patch={})=>{const args=Object.entries({...base,...patch}).map(([k,v])=>k+'='+v);return spawnSync(process.platform==='win32'?'wsl':'env',process.platform==='win32'?['-d','PokerVision-P16-4C-Eval','--','env',...args,'bash','-s']:[...args,'bash','-s'],{input:script,encoding:'utf8',timeout:10000});};
 for(const patch of [{LOCAL_OPERATIONS_REDRAW_PROBE:'invalid'},{CASHIER_SCHEMA_MODE:'pre03',LOCAL_OPERATIONS_REALTIME:'0',LOCAL_OPERATIONS_CANDIDATE_PROBE:'0'},{LOCAL_OPERATIONS_CANDIDATE_PROBE:'0'}]){const r=run(patch);assert.equal(r.status,1);assert.match(r.stderr,/Redraw probe requires current isolated full operations/);}
 const valid=run();assert.equal(valid.status,1);assert.match(valid.stderr,/Verified schema-only baseline artifact is required/);
});

test('Undo HTTP probe rejects incomplete or historical scope before any stack access',()=>{
 const base={CASHIER_SCHEMA_MODE:'current',LOCAL_OPERATIONS_REALTIME:'1',LOCAL_OPERATIONS_CANDIDATE_PROBE:'1',LOCAL_CLOCK_CANDIDATE_PROBE:'0',LOCAL_REENTRY_TRANSPORT_PROBE:'1',LOCAL_REENTRY_FAULT_MODE:'healthy',LOCAL_CORRECTION_UNDO_PROBE:'1',LOCAL_OPERATIONS_AUDIENCE:'0',LOCAL_OPERATIONS_AUDIENCE_MODEL:'selected-table',LOCAL_OPERATIONS_REST_POOL:'10',SCHEMA_ARTIFACT_DIRECTORY:'/missing-undo-probe-fixture'};
 const run=(patch={})=>{
  const assignments=Object.entries({...base,...patch}).map(([k,v])=>k+'='+v);
  return spawnSync(process.platform==='win32'?'wsl':'env',process.platform==='win32'?['-d','PokerVision-P16-4C-Eval','--','env',...assignments,'bash','-s']:[...assignments,'bash','-s'],{input:script,encoding:'utf8',timeout:10000});
 };
 for(const patch of [{LOCAL_CORRECTION_UNDO_PROBE:'2'},{LOCAL_REENTRY_TRANSPORT_PROBE:'0',LOCAL_REENTRY_FAULT_MODE:'failure-injection'},{LOCAL_REENTRY_FAULT_MODE:'failure-injection'}]){
  const r=run(patch);assert.equal(r.status,1);assert.match(r.stderr,/Correction Undo probe requires current isolated full operations and healthy reentry candidate/);
 }
 const valid=run();assert.equal(valid.status,1);assert.match(valid.stderr,/Verified schema-only baseline artifact is required/);
 const historical=run({CASHIER_SCHEMA_MODE:'pre03',LOCAL_OPERATIONS_REALTIME:'0',LOCAL_OPERATIONS_CANDIDATE_PROBE:'0',LOCAL_REENTRY_TRANSPORT_PROBE:'0',LOCAL_REENTRY_FAULT_MODE:'failure-injection'});
 assert.equal(historical.status,1);assert.match(historical.stderr,/Correction Undo probe requires current isolated full operations/);
});

test('isolated historical Edge graph requires the unchanged canonical hand-state core',async(t)=>{
 const {build}=await import('esbuild');
 const root=mkdtempSync(join(tmpdir(),'cashier-historical-graph-'));
 t.after(()=>{assert.ok(root.startsWith(join(tmpdir(),'cashier-historical-graph-')));rmSync(root,{recursive:true,force:true});});
 const functions=join(root,'supabase','functions');mkdirSync(functions,{recursive:true});
 for(const name of ['_shared','tournament-historical-settlement'])cpSync(new URL('../../supabase/functions/'+name,import.meta.url),join(functions,name),{recursive:true});
 const entry=join(functions,'tournament-historical-settlement','index.ts');
 const options={entryPoints:[entry],bundle:true,write:false,format:'esm',platform:'neutral',external:['https://*','npm:*'],logLevel:'silent'};
 await assert.rejects(build(options),/handStateCore/);
 const core=join(root,'src','lib','tracker-poker','handStateCore.ts');mkdirSync(join(root,'src','lib','tracker-poker'),{recursive:true});
 cpSync(new URL('../../src/lib/tracker-poker/handStateCore.ts',import.meta.url),core);
 const bundled=await build(options);assert.equal(bundled.errors.length,0);
 writeFileSync(entry,bundled.outputFiles[0].text);rmSync(join(root,'src'),{recursive:true});
 // Standalone function entry still resolves when src is outside the CLI mount.
 assert.equal((await build(options)).errors.length,0);
 assert.match(script,/entryPoints:\['supabase\/functions\/tournament-historical-settlement\/index\.ts'\]/);
});

test('resource observations retain fixed numeric counters and reject labels or non-finite values',()=>{
 assert.deepEqual(audienceResourceStats('191.55%|12.30%|18\n'),{cpuPercent:191.55,memoryPercent:12.3,pids:18});
 for(const text of ['NaN%|0%|1','1%|101%|1','1%|0%|1\nprivate-label','1%|0%|-1','1%|0%|9007199254740992'])assert.throws(()=>audienceResourceStats(text));
});

const poolText='pgrst_db_pool_available 2.0\npgrst_db_pool_waiting 3e0\npgrst_db_pool_max 10\npgrst_db_pool_timeouts_total 0\n';
test('pool diagnostics retain four unlabeled integer counters,never substitute missing data',()=>{
  assert.deepEqual(audiencePoolStats('# private comment\n'+poolText+'unrelated_metric{secret="private"} 42\n'),{available:2,waiting:3,max:10,timeouts:0});
  for(const value of [poolText.replace('waiting 3e0','waiting NaN'),poolText.replace('waiting 3e0','waiting -1'),poolText.replace('max 10','max 1'),poolText.replace('available 2.0','available{private="x"} 2'),poolText.replace('pgrst_db_pool_max 10\n',''),poolText+'pgrst_db_pool_waiting 1\n','x'.repeat(65537)])assert.throws(()=>audiencePoolStats(value));
});
test('existing admin HTTP reads are bounded,anonymous and never follow redirects or expose bodies',async()=>{
  let mode='ok',calls=0;
  const server=http.createServer((request,response)=>{
    calls++;assert.equal(request.url,'/metrics');assert.equal(request.headers.authorization,undefined);assert.equal(request.headers.cookie,undefined);
    if(mode==='redirect'){response.writeHead(302,{Location:'http://8.8.8.8/metrics'});response.end('private');}
    else if(mode==='denied'){response.writeHead(403);response.end('private');}
    else if(mode==='large')response.end('x'.repeat(65537));
    else if(mode==='slow'){response.writeHead(200);response.write('pgrst_');}
    else response.end(poolText);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const address=`http://127.0.0.1:${server.address().port}/metrics`;
  try{
    const first=await readAudiencePoolMetrics(address);assert.equal(first.available,2);assert.equal(first.waiting,3);assert.ok(first.observerMs>=0);
    for(mode of ['redirect','denied','large','slow'])await assert.rejects(readAudiencePoolMetrics(address,50),{message:'Isolated pool metrics unavailable'});
    assert.equal(calls,5);
    for(const url of ['http://8.8.8.8:3001/metrics','http://127.evil.invalid:3001/metrics',address+'?token=private',address.replace('/metrics','/schema_cache'),address.replace('127.0.0.1','user:private@127.0.0.1')])assert.throws(()=>readAudiencePoolMetrics(url));
    assert.equal(calls,5);
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});

test('operational HUD backfill refuses non-disposable targets before Docker or activation',()=>{
 const helper=fileURLToPath(new URL('./prepare-operations-public-hud.mjs',import.meta.url));
 const env={...process.env,CASHIER_SCHEMA_MODE:'current',LOCAL_OPERATIONS_CANDIDATE_PROBE:'1',LOCAL_OPERATIONS_REALTIME:'1',LOCAL_OPERATIONS_AUDIENCE:'10',LOCAL_OPERATIONS_SOURCE_SHA:'a'.repeat(40)};
 for(const status of ['https://production.invalid/isolated-status.json','/tmp/other-fixture/isolated-status.json']){
  const result=spawnSync(process.execPath,[helper,status,'a'.repeat(12),'/tmp/output/operations-latency/operations-hud-backfill-http.json'],{env,encoding:'utf8'});
  assert.notEqual(result.status,0);assert.equal(result.stdout,'');assert.match(result.stderr,/AssertionError/);
 }
});

test('operational HUD worker bundles from a foreign working directory without a target',()=>{
 const helper=fileURLToPath(new URL('./prepare-operations-public-hud.mjs',import.meta.url));
 const result=spawnSync(process.execPath,[helper,'--check-worker-bundle'],{cwd:tmpdir(),encoding:'utf8'});
 assert.equal(result.status,0);assert.deepEqual(JSON.parse(result.stdout),{kind:'OPERATIONAL_HUD_WORKER_SOURCE_BUNDLE_ONLY',bundled:true});
});

test('selected-table hidden hub retains only access checks and scope fences',()=>{
 for(const components of [['tables'],['ranking','tables'],['payout','clock']])assert.equal(selectedAudienceMetadata({reason:'changed',components}),false);
 for(const components of [['visibility'],['hand_visibility','tables']])assert.equal(selectedAudienceMetadata({reason:'changed',components}),true);
 assert.equal(selectedAudienceMetadata({reason:'verify',components:['tables']}),true);
 assert.equal(selectedAudienceMetadata({reason:'changed',components:['tables'],invalidatePending:true}),true);
 assert.equal(selectedAudienceMetadata({reason:'status',components:['tables','ranking','payout']}),false);
});
function rejectedPreflight(mode,realtime='0',operations='0',clock='0',audience='0',reentry='0',faultMode='failure-injection',pool='10') {
  const filename = fileURLToPath(new URL('./cashier-tour-real-e2e.sh', import.meta.url));
  const env = { ...process.env, CASHIER_SCHEMA_MODE: mode, LOCAL_OPERATIONS_REALTIME:realtime, LOCAL_OPERATIONS_CANDIDATE_PROBE:operations, LOCAL_CLOCK_CANDIDATE_PROBE:clock, LOCAL_OPERATIONS_AUDIENCE:audience, LOCAL_REENTRY_TRANSPORT_PROBE:reentry, LOCAL_REENTRY_FAULT_MODE:faultMode, LOCAL_OPERATIONS_REST_POOL:pool, SCHEMA_ARTIFACT_DIRECTORY: '/missing-cashier-schema' };
  if (process.platform === 'win32') {
    return spawnSync('wsl', ['-d', 'PokerVision-P16-4C-Eval', '--', 'env', `CASHIER_SCHEMA_MODE=${mode}`,`LOCAL_OPERATIONS_REALTIME=${realtime}`,`LOCAL_OPERATIONS_CANDIDATE_PROBE=${operations}`,`LOCAL_CLOCK_CANDIDATE_PROBE=${clock}`,`LOCAL_OPERATIONS_AUDIENCE=${audience}`,`LOCAL_REENTRY_TRANSPORT_PROBE=${reentry}`,`LOCAL_REENTRY_FAULT_MODE=${faultMode}`,`LOCAL_OPERATIONS_REST_POOL=${pool}`, 'SCHEMA_ARTIFACT_DIRECTORY=/missing-cashier-schema', 'bash', '-s'], { encoding: 'utf8', input: script.replaceAll('\r\n', '\n') });
  }
  return spawnSync('bash', [filename], { encoding: 'utf8', env });
}

test('invalid mode fails before allocating a test environment', () => {
  const result = rejectedPreflight('unsupported');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unsupported Cashier schema mode/);
});

test('current mode rejects missing schema before Docker or application loading', () => {
  const result = rejectedPreflight('current');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Verified schema-only baseline artifact is required/);
});

test('Realtime requires contemporary mode and rejects invalid input before allocating resources',()=>{
  for(const [mode,realtime]of [['pre03','1'],['current','invalid']]){
    const result=rejectedPreflight(mode,realtime);
    assert.equal(result.status,1);assert.match(result.stderr,/Realtime timing requires explicit contemporary isolated mode/);
  }
});

test('private dependencies use digest-matching source bodies and restricted grants', () => {
  const output = join(mkdtempSync(join(tmpdir(), 'cashier-dependency-test-')), 'dependencies.sql');
  const generator = fileURLToPath(new URL('./prepare-cashier-runtime-dependencies.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [generator, output], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const sql = readFileSync(output, 'utf8');
  assert.ok(sql.includes("RAISE EXCEPTION 'CENTERPOINT_TOURNAMENT_OPS_RELEASE_CLOSED'"));
  assert.ok(sql.includes('p_club_id = ANY(r.allowed_club_ids)'));
  assert.ok(sql.includes('storage.foldername(p_name)'));
  assert.ok(sql.includes('FROM PUBLIC, anon, authenticated, service_role;'));
  assert.ok(!sql.includes('SELECT false;'));
  assert.ok(!sql.includes('ALTER TABLE'));
});

function dependencyDriftResult(transform) {
  const root = mkdtempSync(join(tmpdir(), 'cashier-dependency-drift-'));
  const scripts = join(root, 'scripts', 'ops');
  const migrations = join(root, 'supabase', 'pending-migrations');
  mkdirSync(scripts, { recursive: true });
  mkdirSync(migrations, { recursive: true });
  const generator = join(scripts, 'prepare-cashier-runtime-dependencies.mjs');
  writeFileSync(generator, readFileSync(new URL('./prepare-cashier-runtime-dependencies.mjs', import.meta.url)));
  for (const name of ['20260924165219_centerpoint_tournament_ops_release_v1.sql', '20260924065041_tv_layout_editor_v1.sql']) {
    const source = readFileSync(new URL(`../../supabase/pending-migrations/${name}`, import.meta.url), 'utf8');
    writeFileSync(join(migrations, name), name.includes('centerpoint_tournament') ? transform(source) : source);
  }
  const output = join(root, 'dependencies.sql');
  const result = spawnSync(process.execPath, [generator, output], { encoding: 'utf8' });
  return { result, output };
}

test('dependency header-only security drift is rejected without generating SQL', () => {
  const { result, output } = dependencyDriftResult(source => source.replace('SECURITY DEFINER', 'SECURITY INVOKER'));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /reviewed signature\/security metadata mismatch/);
  assert.equal(existsSync(output), false);
});

test('dependency business-body drift is rejected without generating SQL', () => {
  const { result, output } = dependencyDriftResult(source => source.replace('SELECT r.enabled', 'SELECT true'));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /reviewed live body mismatch/);
  assert.equal(existsSync(output), false);
});

test('historical mode remains default and requires original baseline', () => {
  assert.ok(script.includes('CASHIER_SCHEMA_MODE:-pre03'));
  assert.ok(workflow.includes('capture_id=35982674365'));
  assert.ok(script.includes('"$schema_mode" == pre03 && "$baseline_state" != \'t|t\''));
  assert.ok(workflow.includes('gh api --paginate --slurp'));
  assert.ok(workflow.includes('git show "$BASE_SHA:VinPoker/scripts/ops/select-cashier-schema-mode.mjs"'));
  assert.ok(workflow.includes('node "$trusted_selector" "$GITHUB_WORKSPACE" "$BASE_SHA" "$HEAD_SHA"'));
  assert.ok(workflow.includes('fetch-depth: 0'));
});

// Real committed Git trees, using the actual qualified PR1600 SQL and receipt.
// Full-history checkout is mandatory in CI; no network or production access.
const sourceRoot = fileURLToPath(new URL('../../../', import.meta.url));
const fixtureRoot = mkdtempSync(join(tmpdir(), 'cashier-qualified-tree-'));
after(() => rmSync(fixtureRoot, { recursive: true, force: true }));
const git = (...args) => execFileSync('git', ['-C', fixtureRoot, ...args], { encoding: 'utf8' });
const sourceGit = (...args) => execFileSync('git', ['-C', sourceRoot, ...args], { encoding: 'utf8' });
git('init', '--quiet');
git('config', 'user.name', 'Isolated CI fixture');
git('config', 'user.email', 'ci@example.invalid');
const common = sourceGit('rev-parse', '--git-common-dir').trim();
writeFileSync(join(fixtureRoot, '.git', 'objects', 'info', 'alternates'), resolve(sourceRoot, common, 'objects').replaceAll('\\', '/') + '\n');
const policyFile = 'VinPoker/scripts/ops/cashier-hud35-qualified-scope.json';
const receiptFile = 'VinPoker/scripts/ops/fixtures/cashier-ci-hud35-qualified-receipt-20261107.json';
const policy = JSON.parse(readFileSync(join(sourceRoot, policyFile)));
const baseline = 'ea3844085ecfd34b7b21ba19160317e57db4637d';
function setBlob(path, bytes, mode = '100644') {
  const oid = execFileSync('git', ['-C', fixtureRoot, 'hash-object', '-w', '--stdin'], { input: bytes, encoding: 'utf8' }).trim();
  git('update-index', '--add', '--cacheinfo', `${mode},${oid},${path}`);
}
function commitTree(parent) {
  return git('commit-tree', git('write-tree').trim(), ...(parent ? ['-p', parent] : []), '-m', 'isolated test').trim();
}
git('read-tree', baseline);
for (const path of [policyFile, receiptFile, 'VinPoker/scripts/ops/select-cashier-schema-mode.mjs', '.github/workflows/cashier-tour-real-e2e.yml']) {
  setBlob(path, readFileSync(join(sourceRoot, path)));
}
const trustedBase = commitTree(baseline);
// Preserve the Tracker branch's extra operational inputs/checks when integrating
// the trusted-base selector. Only this exact combined workflow may differ.
const workflowPath = '.github/workflows/cashier-tour-real-e2e.yml';
const mergePaths = ['ours.yml', 'base.yml', 'candidate.yml'].map(name => join(fixtureRoot, name));
writeFileSync(mergePaths[0], workflow.replace(/\r\n?/g, '\n'));
writeFileSync(mergePaths[1], sourceGit('show', `${baseline}:${workflowPath}`).replace(/\r\n?/g, '\n'));
writeFileSync(mergePaths[2], sourceGit('show', `${policy.runtimeInputs.candidateSha}:${workflowPath}`).replace(/\r\n?/g, '\n'));
const integratedWorkflow = git('merge-file', '-p', '--union', ...mergePaths)
  .replace('          node --test scripts/ops/cashier-schema-mode.test.mjs supabase/pending-tests/fake-sepay-server.test.mjs\n', '');
git('read-tree', policy.runtimeInputs.candidateSha);
for (const path of [policyFile, receiptFile, 'VinPoker/scripts/ops/select-cashier-schema-mode.mjs', '.github/workflows/cashier-tour-real-e2e.yml']) {
  setBlob(path, readFileSync(join(sourceRoot, path)));
}
setBlob(workflowPath, integratedWorkflow);
const qualifiedHead = commitTree(trustedBase);
function pagesFor(head, base = trustedBase) {
  const fields = git('diff', '--no-renames', '--name-status', '-z', base, head).split('\0');
  fields.pop();
  const files = [];
  for (let i = 0; i < fields.length; i += 2) files.push({ filename: fields[i + 1], status: { A: 'added', M: 'modified', D: 'removed' }[fields[i]] });
  return [files];
}
const context = { repo: fixtureRoot, base: trustedBase, head: qualifiedHead };
function mutation(change) {
  git('read-tree', qualifiedHead);
  change();
  const head = commitTree(trustedBase);
  return { head, files: pagesFor(head).flat(), context: { ...context, head } };
}
test('complete actual qualified35 package selects current with committed provenance', () => {
  assert.equal(qualifiedHud35(pagesFor(qualifiedHead).flat(), context), true);
  assert.equal(selectCashierSchemaMode(pagesFor(qualifiedHead), context), 'current');
});
test('unknown, partial, altered SQL, symlinks, catalog and historical changes reject qualification', () => {
  const first = policy.scope.newSqlFiles[0].path;
  const historical = 'VinPoker/supabase/migrations/20270115000003_cashier_tour_money_v1.sql';
  for (const change of [
    () => setBlob('VinPoker/supabase/migrations/unknown.sql', 'SELECT 1;'),
    () => git('update-index', '--force-remove', first),
    () => setBlob(first, sourceGit('show', `${policy.scope.candidateSha}:${first}`) + '\n-- changed'),
    () => setBlob(first, 'target.sql', '120000'),
    () => setBlob(policy.scope.catalogMetadata.path, '{}'),
    () => setBlob(historical, '-- altered historical writer'),
    () => git('update-index', '--force-remove', historical),
    () => { git('update-index', '--force-remove', first); setBlob('VinPoker/supabase/migrations/renamed.sql', 'SELECT 1;'); },
  ]) {
    const m = mutation(change);
    assert.throws(() => qualifiedHud35(m.files, m.context));
  }
});
test('head cannot rewrite policy, proof, validator or workflow to exempt itself', () => {
  for (const path of [policyFile, receiptFile, 'VinPoker/scripts/ops/select-cashier-schema-mode.mjs', '.github/workflows/cashier-tour-real-e2e.yml']) {
    const m = mutation(() => setBlob(path, '{}'));
    assert.throws(() => qualifiedHud35(m.files, m.context), /trusted guard/);
  }
});
test('runtime runner, browser test and executable fixtures cannot be weakened', () => {
  for (const path of ['VinPoker/scripts/ops/cashier-tour-real-e2e.sh', 'VinPoker/e2e/cashier-tour-real.spec.ts', 'VinPoker/playwright.config.ts', 'VinPoker/supabase/pending-tests/fake-sepay-server.mjs']) {
    const m = mutation(() => setBlob(path, '// no-op'));
    assert.throws(() => qualifiedHud35(m.files, m.context), /Runtime guard drift/);
  }
});
test('wrong base/head, omitted API paths, duplicate paths, unsupported status and renames fail closed', () => {
  const files = pagesFor(qualifiedHead).flat();
  assert.throws(() => qualifiedHud35(files, { ...context, head: trustedBase }), /tree diff/);
  assert.throws(() => qualifiedHud35(files, { ...context, base: 'main;echo unsafe' }), /Exact base/);
  assert.throws(() => qualifiedHud35(files.slice(1), context), /tree diff/);
  assert.throws(() => selectCashierSchemaMode([[{ filename: 'VinPoker/src/stale.ts', status: 'modified' }]], context), /tree diff/);
  assert.throws(() => selectCashierSchemaMode([[...files, files[0]]], context), /Duplicate/);
  assert.throws(() => qualifiedHud35(files.map((f, i) => i ? f : { ...f, status: 'copied' }), context), /tree diff/);
  const renamed = files.map(f => f.filename === policy.scope.newSqlFiles[0].path ? { ...f, previous_filename: 'old.sql' } : f);
  assert.throws(() => qualifiedHud35(renamed, context), /Renames/);
});
test('missing, failed or wrong-origin trusted proof and checksum drift are rejected', () => {
  for (const change of [
    p => { delete p.proof; },
    p => { p.proof.conclusion = 'failure'; },
    p => { p.proof.actor = 'untrusted'; },
    p => { p.proof.workflowId = 1; },
    p => { p.proof.receiptSha256 = '0'.repeat(64); },
    p => { p.runtimeInputs.kind = 'NATIVE_TEST_MASQUERADING_AS_BROWSER_PROOF'; },
  ]) {
    const altered = structuredClone(policy);
    change(altered);
    git('read-tree', trustedBase);
    setBlob(policyFile, JSON.stringify(altered));
    const base = commitTree(trustedBase);
    git('read-tree', qualifiedHead);
    setBlob(policyFile, JSON.stringify(altered));
    const head = commitTree(base);
    assert.throws(() => qualifiedHud35(pagesFor(head, base).flat(), { repo: fixtureRoot, base, head }));
  }
});
test('line ending normalization alone preserves qualified SQL', () => {
  const path = policy.scope.newSqlFiles[0].path;
  const m = mutation(() => setBlob(path, sourceGit('show', `${policy.scope.candidateSha}:${path}`).replace(/\r\n?/g, '\n').replaceAll('\n', '\r\n')));
  assert.equal(qualifiedHud35(m.files, m.context), true);
});

test('migration changes and rename out require historical proof across pages', () => {
  for (const directory of ['migrations/', 'migration-archive/', 'pending-migrations/']) {
    const oldPath = `VinPoker/supabase/${directory}test.sql`;
    assert.equal(selectCashierSchemaMode([[{ filename: oldPath, status: 'removed' }]]), 'pre03');
    assert.equal(selectCashierSchemaMode([[{ filename: 'src/ui.ts' }], [{ filename: 'elsewhere.sql', previous_filename: oldPath, status: 'renamed' }]]), 'pre03');
  }
  assert.equal(selectCashierSchemaMode([[{ filename: 'VinPoker/src/ui.ts' }]]), 'current');
});

test('unverifiable PR file input fails closed', () => {
  for (const input of [null, [], [[]], [{ filename: 'x' }], [[{}]], [[{ filename: 'x', previous_filename: 7 }]]]) {
    assert.throws(() => selectCashierSchemaMode(input));
  }
  assert.throws(() => selectCashierSchemaMode([Array.from({ length: 3000 }, (_, index) => ({ filename: `src/${index}.ts` }))]), /API cap reached/);
});

test('current mode pins reviewed bytes and does not replay historical writers', () => {
  assert.ok(script.includes('expected_schema_sha=d23cfa75a7381453ba0d6216346f6460c816a3b1525ef5d47984c3a995ddc56a'));
  assert.ok(script.includes('"$actual_schema_sha" != "$expected_schema_sha"'));
  assert.ok(script.includes('elif [[ "$baseline_state" != \'t|f\' ]]'));
  const migrationBlock = script.slice(script.indexOf("cashier_migration="), script.indexOf('applied_state='));
  assert.ok(migrationBlock.includes('if [[ "$schema_mode" == pre03 ]]; then'));
  assert.ok(migrationBlock.includes('<"$repo_root/supabase/migrations/$cashier_migration"'));
  assert.ok(migrationBlock.indexOf('if [[ "$schema_mode" == pre03 ]]; then') < migrationBlock.indexOf('<"$repo_root/supabase/migrations/$cashier_migration"'));
  assert.ok(workflow.includes('recovery_id=38275767630'));
  assert.ok(workflow.includes('not pre03 migration proof'));
  assert.ok(workflow.includes('.workflow_id == 322144993 and .head_branch == "main"'));
  assert.ok(workflow.includes('.head_sha == "09cff8a829caf3f514a615b231ab96f4ed238757"'));
  assert.ok(workflow.includes('--operations-recovery-provenance'));
});

test('both paths retain money/refund and network/secret/cron guards', () => {
  for (const marker of ['Unexpected remote credential', 'Disposable cron guard', 'cashier_tour_money_v1.sql', 'cashier_no_floor=on', 'cashier-tour-real.spec.ts']) {
    assert.ok(script.includes(marker), marker);
  }
  assert.ok(script.indexOf('Unsupported Cashier schema mode') < script.indexOf('test_root='));
});

test('candidate operations mode rejects unsafe or ambiguous combinations before allocating resources',()=>{
  for(const [mode,realtime,operations,clock]of [['pre03','0','1','0'],['current','0','1','0'],['current','1','invalid','0'],['current','1','1','1']]){
    const result=rejectedPreflight(mode,realtime,operations,clock);
    assert.equal(result.status,1);assert.match(result.stderr,/Candidate operations probe requires current isolated Realtime mode and excludes clock-only mode/);
  }
  const valid=rejectedPreflight('current','1','1','0');
  assert.equal(valid.status,1);assert.match(valid.stderr,/Verified schema-only baseline artifact is required/);
});

test('current Floor dependency preserves original actor checks and rejects body/header drift',()=>{
  const filename='20270128000031_tournament_participation_current_scope_v1.sql';
  const original=readFileSync(new URL('../../supabase/migrations/'+filename,import.meta.url),'utf8');
  for(const [valid,transform] of [[true,source=>source],[false,source=>source.replace('LANGUAGE plpgsql STABLE SECURITY DEFINER', 'LANGUAGE plpgsql STABLE SECURITY INVOKER')],[false,source=>source.replace('DECLARE a uuid:=auth.uid(); c uuid;','DECLARE a uuid:=NULL; c uuid;')]]){
    const root=mkdtempSync(join(tmpdir(),'floor-v6-reader-')),scripts=join(root,'scripts','ops'),migrations=join(root,'supabase','migrations');
    mkdirSync(scripts,{recursive:true});mkdirSync(migrations,{recursive:true});
    const generator=join(scripts,'prepare-cashier-runtime-dependencies.mjs'),output=join(root,'reader.sql');
    writeFileSync(generator,readFileSync(new URL('./prepare-cashier-runtime-dependencies.mjs',import.meta.url)));
    const changed=transform(original);assert.equal(changed===original,valid,'Drift mutation must change the source');writeFileSync(join(migrations,filename),changed);
    const result=spawnSync(process.execPath,[generator,output,'--restore-floor-v6-reader'],{encoding:'utf8'});
    if(!valid){assert.notEqual(result.status,0);assert.equal(existsSync(output),false);continue;}
    assert.equal(result.status,0,result.stderr);const sql=readFileSync(output,'utf8');
    for(const marker of ['auth.uid()','actor_not_authorized','public.is_club_floor(a,c)','public.is_club_tracker(a,c)','public.is_club_cashier(a,c)','FROM PUBLIC,anon,authenticated,service_role;','TO authenticated;','isolated_floor_v6_dependency_collision_or_drift'])assert.ok(sql.includes(marker),marker);
    assert.ok(!sql.includes('SET check_function_bodies = false'));
  }
});

test('candidate admission and final receipt require the exact reviewed manifest count',()=>{
  const expected=loadPackage().entries.length;
  const admission=script.match(/\[\[ "\$candidate_count" == (\d+) \]\]/g)??[];
  const emitted=script.match(/phase:'package-applied',migrations:(\d+)/g)??[];
  const completion=script.match(/assert\.equal\(report\.migrations,(\d+)\)/g)??[];
  for(const [name,matches] of [['admission',admission],['emitted receipt',emitted],['completion',completion]]){
    assert.equal(matches.length,1,name);
    assert.equal(Number(matches[0].match(/\d+/)?.[0]),expected,name);
  }
});

test('full candidate Floor uses the current guarded roster and actual redraw build gate',()=>{
  const browser=readFileSync(new URL('../../e2e/cashier-tour-real.spec.ts',import.meta.url),'utf8');
  const currentReader='20270128000062_floor_roster_participation_integrity_v6.sql';
  const prerequisite=script.indexOf('<"$repo_root/supabase/migrations/20270128000299_participation_bagged_read_classification_v1.sql"');
  const install=script.indexOf('<"$repo_root/supabase/migrations/'+currentReader+'"');
  const pending=script.indexOf('candidate_count=0');
  assert.ok(install>=0&&prerequisite>install&&pending>prerequisite,'Install current reader at its original pre299 preimage,then299 and candidate wrappers');
  assert.match(script,/if \[\[ "\$operations_candidate_probe" == 1 \]\]; then floor_redraw_build=preview; fi/);
  assert.match(script,/VITE_FLOOR_REDRAW_SEAT_LOCK_V1="\$floor_redraw_build"/);
  assert.match(script,/--env LOCAL_OPERATIONS_FLOOR_ROSTER_V6_ENABLED="\$operations_candidate_probe"/);
  assert.match(browser,/currentFloorRosterV6\?'get_floor_tournament_table_roster_v6':'get_floor_tournament_table_roster_v3'/);
  assert.match(browser,/expect\(rosterRpc\)\.toBe\(floorRosterRpc\)/);
  assert.match(browser,/const readers=\[floorRosterRpc,/);
});

test('shared flusher accepts exactly one candidate mode and retains disposable target guard',()=>{
  const filename=fileURLToPath(new URL('./clock-candidate-broadcast.mjs',import.meta.url));
  for(const [clock,operations]of [['0','0'],['1','1'],['invalid','0']]){
    const result=spawnSync(process.execPath,[filename],{encoding:'utf8',env:{...process.env,LOCAL_CLOCK_CANDIDATE_PROBE:clock,LOCAL_OPERATIONS_CANDIDATE_PROBE:operations,CASHIER_SCHEMA_MODE:'current',LOCAL_OPERATIONS_REALTIME:'1',LOCAL_CLOCK_CANDIDATE_STATUS:'/invalid-target'}});
    assert.notEqual(result.status,0);assert.match(result.stderr,/Exactly one candidate probe mode is required/);
  }
  for(const [clock,operations]of [['1','0'],['0','1']]){
    const result=spawnSync(process.execPath,[filename],{encoding:'utf8',env:{...process.env,LOCAL_CLOCK_CANDIDATE_PROBE:clock,LOCAL_OPERATIONS_CANDIDATE_PROBE:operations,CASHIER_SCHEMA_MODE:'current',LOCAL_OPERATIONS_REALTIME:'1',LOCAL_CLOCK_CANDIDATE_STATUS:'/invalid-target'}});
    assert.notEqual(result.status,0);assert.match(result.stderr,/cashier-e2e-/);assert.doesNotMatch(result.stderr,/Exactly one candidate probe mode is required/);
  }
});

test('mixed audience starts its HTTP flusher after disposable PostgREST recreation and readiness',()=>{
  const pool=script.indexOf('LOCAL_OPERATIONS_REST_POOL="$operations_rest_pool" node');
  const frozen=script.indexOf('\nSCHEMA_FROZEN_RECEIPT\n',pool);
  const start=script.indexOf('\n    start_candidate_broadcast\n',frozen);
  const audience=script.indexOf('    audience_pid=$!',start);
  assert.ok(pool>0&&frozen>pool&&start>frozen&&audience>start);
  assert.match(script,/if \[\[ "\$clock_candidate_probe" == 1 \|\| "\$audience_count" == 0 \]\]; then\n    start_candidate_broadcast\n  fi/);
  assert.match(script,/assert\.equal\(report\.phase,'stopped'\);assert\.equal\(report\.failures,0\)/);
});

test('mixed audience cannot run outside exact candidate or exceed bounded load',()=>{
  const unsupported=rejectedPreflight('current','1','1','0','1001');assert.equal(unsupported.status,1);assert.match(unsupported.stderr,/Unsupported isolated operational audience/);
  const unscoped=rejectedPreflight('current','1','0','0','10');assert.equal(unscoped.status,1);assert.match(unscoped.stderr,/requires explicit full candidate operations mode/);
  for(const count of ['10','1000']){const valid=rejectedPreflight('current','1','1','0',count);assert.equal(valid.status,1);assert.match(valid.stderr,/Verified schema-only baseline artifact is required/);}
});

test('audience executable rejects invalid mode, count and non-disposable status before connection',()=>{
  const filename=fileURLToPath(new URL('./operations-audience.mjs',import.meta.url));
  const base={...process.env,CASHIER_SCHEMA_MODE:'current',LOCAL_OPERATIONS_REALTIME:'1',LOCAL_OPERATIONS_CANDIDATE_PROBE:'1',LOCAL_CLOCK_CANDIDATE_PROBE:'0',LOCAL_OPERATIONS_AUDIENCE:'10',LOCAL_OPERATIONS_AUDIENCE_STATUS:'/invalid-target'};
  for(const [override,pattern]of [[{LOCAL_OPERATIONS_AUDIENCE:'1001'},/Explicit bounded isolated audience required/],[{LOCAL_OPERATIONS_CANDIDATE_PROBE:'0'},/ERR_ASSERTION/],[{LOCAL_OPERATIONS_AUDIENCE_MODEL:'unknown'},/Explicit audience model required/],[{LOCAL_OPERATIONS_AUDIENCE_MODEL:'selected-table'},/cashier-e2e-/],[{LOCAL_OPERATIONS_AUDIENCE_MODEL:'grid-detail-stress'},/cashier-e2e-/]]){
    const result=spawnSync(process.execPath,[filename],{encoding:'utf8',env:{...base,...override}});assert.notEqual(result.status,0);assert.match(result.stderr,pattern);
  }
});

test('shutdown cannot erase HTTP errors or a deadline that won an abort race',async()=>{
  const scope=new AbortController(),deadline=new AbortController();scope.abort();
  assert.equal(ownedAudienceCancellation(new Error('HTTP_503'),scope,deadline.signal),false);
  assert.equal(ownedAudienceCancellation(scope.signal.reason,scope,deadline.signal),true);
  deadline.abort(new DOMException('Deadline','TimeoutError'));
  assert.equal(ownedAudienceCancellation(scope.signal.reason,scope,deadline.signal),false);
  assert.equal(ownedAudienceCancellation(new DOMException('Deadline','TimeoutError'),scope,deadline.signal,'table'),false);
  assert.equal(ownedAudienceCancellation({publicTableCallerCancelled:true},scope,deadline.signal,'table'),true);
});

test('real HTTP body cancellation is owned; real timeout and HTTP failure remain errors after stop',async()=>{
  const server=http.createServer((request,response)=>{
    if(request.url==='/status'){response.writeHead(503);response.end('{}');return;}
    if(request.url==='/body'){response.writeHead(200,{'Content-Type':'application/json'});response.write('{');}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  try{
    const scope=new AbortController(),timeout=AbortSignal.timeout(5000);
    const response=await fetch(base+'/body',{signal:AbortSignal.any([scope.signal,timeout])});
    const pending=response.json();scope.abort();
    const cause=await pending.then(()=>null,error=>error);assert.ok(cause);
    assert.equal(ownedAudienceCancellation(cause,scope,timeout),true);
    const lateScope=new AbortController(),deadline=AbortSignal.timeout(30);
    const timeoutCause=await fetch(base+'/slow',{signal:AbortSignal.any([lateScope.signal,deadline])}).then(()=>null,error=>error);
    lateScope.abort();assert.ok(timeoutCause);assert.equal(ownedAudienceCancellation(timeoutCause,lateScope,deadline),false);
    const failedScope=new AbortController(),failedTimeout=AbortSignal.timeout(5000);
    const failed=await fetch(base+'/status',{signal:AbortSignal.any([failedScope.signal,failedTimeout])});
    assert.equal(failed.status,503);const httpError=new Error('HTTP_503');failedScope.abort();
    assert.equal(ownedAudienceCancellation(httpError,failedScope,failedTimeout),false);
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});

test('ordinary verification preserves scope and clock while actual withdrawal still invalidates',()=>{
 const all=['tables','ranking','payout','visibility','clock'];
 assert.deepEqual(audienceScopeSignal({reason:'verify',components:all}),{invalidate:false,clearClock:false,handOnly:false});
 assert.deepEqual(audienceClockSignal({reason:'verify',components:all}),{invalidate:false,reload:true});
 assert.deepEqual(audienceScopeSignal({reason:'status',components:all}),{invalidate:false,clearClock:false,handOnly:false});
 assert.deepEqual(audienceScopeSignal({reason:'changed',components:['tables']}),{invalidate:false,clearClock:false,handOnly:false});
 assert.deepEqual(audienceScopeSignal({reason:'changed',components:['visibility']}),{invalidate:true,clearClock:true,handOnly:false});
 assert.deepEqual(audienceScopeSignal({reason:'changed',components:['hand_visibility','tables']}),{invalidate:true,clearClock:false,handOnly:true});
 assert.deepEqual(audienceClockSignal({reason:'changed',components:['hand_visibility','tables']}),{invalidate:false,reload:false});
 assert.deepEqual(audienceScopeSignal({reason:'verify',components:['tables'],invalidatePending:true}),{invalidate:true,clearClock:false,handOnly:false});
 assert.deepEqual(audienceScopeSignal({reason:'changed',components:['visibility','hand_visibility']}),{invalidate:true,clearClock:true,handOnly:false});
});

test('clock rechecks immediately after reconnect/withdrawal and on ranking hints',()=>{
  for(const event of [{reason:'verify',components:['tables'],invalidatePending:true},{reason:'changed',components:['visibility']}]){
    const state=audienceClockSignal(event);assert.equal(state.invalidate,true);assert.equal(state.reload,true);
    const controller=new AbortController();if(state.invalidate)controller.abort();assert.equal(controller.signal.aborted,true);
  }
  assert.deepEqual(audienceClockSignal({reason:'changed',components:['ranking']}),{invalidate:false,reload:true});
  assert.deepEqual(audienceClockSignal({reason:'changed',components:['tables']}),{invalidate:false,reload:false});
  assert.deepEqual(audienceClockSignal({reason:'status',components:['clock','ranking']}),{invalidate:false,reload:false});
});

test('audience diagnostics distinguish descriptor pressure, deadlines and HTTP without leaking exception text',()=>{
  assert.deepEqual(audienceFailure({name:'TypeError',cause:{code:'EMFILE',message:'private'}},undefined),{kind:'file_descriptor_limit',httpStatus:null,serverCode:null});
  assert.equal(audienceFailure({name:'TimeoutError',message:'private'}).kind,'deadline');
  assert.deepEqual(audienceFailure({code:'PGRST003',message:'private'},504),{kind:'http_error',httpStatus:504,serverCode:'PGRST003'});
  assert.deepEqual(audienceFailure({code:'TOKEN',message:'private',Authorization:'private'},'500'),{kind:'unknown',httpStatus:null,serverCode:null});
  assert.equal(audienceFailure({code:'42501'},403).serverCode,'42501');
  for(const message of ['worker_deadline','deadline_exceeded','generation_absorb_failed','broadcast_flush_failed','claim_failed']){
   assert.deepEqual(audienceFailure(Error(message)),{kind:message,httpStatus:null,serverCode:null});
   assert.equal(audienceFailure(Error(message+' private SQL/token')).kind,'unknown');
  }
});

test('worker diagnostics preserve exact known lease rejection without exporting arbitrary RPC or error text',()=>{
 assert.deepEqual(audienceWorkerFailure('get_public_spectator_projection_source_v2',{message:'lease_expired'}),{operation:'get_public_spectator_projection_source_v2',reason:'lease_expired'});
 assert.deepEqual(audienceWorkerFailure('private_rpc',{message:'private SQL and token'}),{operation:'unknown',reason:'unknown'});
 assert.equal(audienceWorkerFailure('claim_public_spectator_projection_v2',{message:'lease_expired private'}).reason,'unknown');
});

test('server timing retains only bounded numeric known phases and gateway durations',()=>{
 const headers=new Headers({'Server-Timing':'jwt;dur=0.2, transaction;dur=12.8, private;dur=3, plan;dur=NaN, parse;dur=90000, response;dur=1;desc="private"','X-Kong-Upstream-Latency':'14','X-Kong-Proxy-Latency':'private'});
 assert.deepEqual(audienceServerTiming(headers),{jwt:.2,transaction:12.8,kongUpstream:14});
 assert.deepEqual(audienceServerTiming(new Headers()),{});
});

test('actual proc file-limit format retains whitespace and unknown values stay unknown',()=>{
  assert.deepEqual(audienceFileLimits('Max open files            16384              16384              files     \n'),{soft:16384,hard:16384});
  assert.equal(audienceFileLimits('Max open files unlimited unlimited files'),null);
});

test('generated gateway resource receipts reject ambiguity, symbolic values and incomplete directives',()=>{
 const config='worker_processes 4;\nworker_rlimit_nofile 16384;\nevents {\n worker_connections 4096;\n}\n# private token';
 assert.deepEqual(audienceGatewayConfig(config),{workers:4,connectionsPerWorker:4096,fileLimitPerWorker:16384});
 assert.equal(audienceGatewayConfig(config+'\nworker_processes 1;'),null);
 assert.equal(audienceGatewayConfig(config.replace('worker_processes 4','worker_processes auto')),null);
 assert.equal(audienceGatewayConfig('worker_processes 4;'),null);
 assert.deepEqual(audienceGatewayConfig('worker_processes 1;',{allowImplicitLimits:true}),{workers:1,connectionsPerWorker:null,fileLimitPerWorker:null});
 assert.equal(audienceGatewayConfig(config+'\nworker_processes 1;',{allowImplicitLimits:true}),null);
 assert.throws(()=>prepareAudienceGatewayTemplate('events {\n private\n}'),/template drift/);
 assert.equal(JSON.stringify(audienceGatewayConfig(config)).includes('private'),false);
});

test('gateway preparation refuses non-owned containers and non1000 modes before Docker',()=>{
 const filename=fileURLToPath(new URL('./operations-gateway.mjs',import.meta.url));
 const env={...process.env,CASHIER_SCHEMA_MODE:'current',LOCAL_OPERATIONS_REALTIME:'1',LOCAL_OPERATIONS_CANDIDATE_PROBE:'1',LOCAL_OPERATIONS_AUDIENCE:'1000'};
 for(const args of [['supabase_kong_other','supabase_network_cashier-e2e-test','/output/operations-latency/operations-gateway-http.json'],['supabase_kong_cashier-e2e-test','shared-network','/output/operations-latency/operations-gateway-http.json']]){
  const result=spawnSync(process.execPath,[filename,...args],{encoding:'utf8',env});assert.notEqual(result.status,0);assert.match(result.stderr,/ERR_ASSERTION/);assert.doesNotMatch(result.stderr,/Isolated gateway command failed/);
 }
 const result=spawnSync(process.execPath,[filename],{encoding:'utf8',env:{...env,LOCAL_OPERATIONS_AUDIENCE:'10'}});assert.notEqual(result.status,0);assert.match(result.stderr,/ERR_ASSERTION/);
});

test('subscription diagnostics preserve SDK identity, arguments, timeout and callback values',()=>{
  let actualArgs,actualTimeout,actualCallback;const marker={},channel={subscribe(callback,timeout){actualCallback=callback;actualTimeout=timeout;return marker;}};
  const client={channel(...args){actualArgs=args;return channel;}};const observations=[];
  observeAudienceSubscriptions(client,(...args)=>observations.push(args));
  const config={config:{private:false}},received=[],error=new Error('ConnectionRateLimitReached private');
  assert.equal(client.channel('public:tournament-viewer-v2:test',config),channel);
  assert.equal(channel.subscribe((...args)=>received.push(args),1234),marker);
  actualCallback('CHANNEL_ERROR',error);assert.deepEqual(actualArgs,['public:tournament-viewer-v2:test',config]);assert.equal(actualTimeout,1234);
  assert.equal(received[0][1],error);assert.equal(observations[0][1],error);assert.equal(audienceJoinFailure(error),'connection_limit');
  assert.equal(audienceJoinFailure(new Error('ClientJoinRateLimitReached private')),'join_rate_limit');
  assert.equal(audienceJoinFailure(new Error('private')),'unknown');
});

test('socket diagnostics retain nested error codes and close codes without endpoint or payload text',()=>{
 const event={error:{cause:{code:'ECONNRESET',message:'private endpoint'}}};event.cause=event;
 assert.deepEqual(audienceSocketDiagnostic('transport','error',event),{event:'transport_error',kind:'connection_lost',httpStatus:null,serverCode:null,joinKind:'unknown',closeCode:null});
 const closed=audienceSocketDiagnostic('transport','close',{code:1006,reason:'private token'});
 assert.equal(closed.closeCode,1006);assert.equal(JSON.stringify(closed).includes('private'),false);
 assert.equal(audienceSocketDiagnostic('push','private topic',{token:'private'}),null);
 const opened=audienceSocketDiagnostic('transport','connected to ws://private?apikey=private',{});
 assert.equal(opened.event,'transport_open');assert.equal(JSON.stringify(opened).includes('private'),false);
 assert.equal(audienceSocketDiagnostic('channel','error private',{cause:new Error('ConnectionRateLimitReached private')}).joinKind,'connection_limit');
});

test('real native WebSocket handshake failure can be inspected without serializing its ErrorEvent',async()=>{
 const server=http.createServer((_request,response)=>{response.writeHead(403);response.end();});server.on('upgrade',(_request,socket)=>socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'));
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 let socket,timer;const observed=[],origin='http://127.0.0.1:'+server.address().port,stop=observeAudienceHandshake(origin,event=>observed.push(event));
 try{
  await fetch(origin+'/ordinary?private=fixture');assert.deepEqual(observed,[]);
  const result=await new Promise((resolve,reject)=>{
   timer=setTimeout(()=>reject(Error('WebSocket test deadline')),3000);
   socket=new WebSocket('ws://127.0.0.1:'+server.address().port+'/realtime/v1/websocket?private=fixture');
   socket.addEventListener('error',event=>resolve(audienceSocketDiagnostic('transport','error',event)),{once:true});
  });
  assert.equal(result.event,'transport_error');assert.equal(JSON.stringify(result).includes('fixture'),false);
  assert.ok(observed.some(e=>e.event==='handshake_response'&&e.httpStatus===403));assert.equal(JSON.stringify(observed).includes('fixture'),false);
  assert.throws(()=>observeAudienceHandshake('https://example.com',()=>{}),/Loopback/);
 }finally{stop();clearTimeout(timer);socket?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});


test('latency-only collection rejects incomplete, transport and source failures and remains fatal',()=>{
 const match=script.match(/<<'REENTRY_LATENCY_ONLY_FAILURE'\r?\n([\s\S]*?)\r?\nREENTRY_LATENCY_ONLY_FAILURE/);assert.ok(match);
 const dir=mkdtempSync(join(tmpdir(),'reentry-latency-gate-')),file=join(dir,'receipt.json'),sha='a'.repeat(40);
 const keys=['bustMs','bustRetryMs','registrationMs','registrationRetryMs','paymentMs','paymentRetryMs','independentReadMs'];
 const fixture=()=>({sha,kind:'REAL_AUTH_FLOOR_BUST_REENTRY_EDGE_AND_CANONICAL_CASH_SEATING',phase:'latency-failed',failure:null,graded:20,warmup:0,qualification:false,rows:Array.from({length:20},(_,actor)=>({actor,...Object.fromEntries(keys.map(k=>[k,k==='registrationMs'?1200:100]))})),distributions:Object.fromEntries(keys.map(k=>[k,{samples:20,p95Ms:k==='registrationMs'?1200:100,maxMs:k==='registrationMs'?1200:100}]))});
 const run=value=>{writeFileSync(file,JSON.stringify(value));return spawnSync(process.execPath,['--input-type=module','-',file,sha],{input:match[1],encoding:'utf8'}).status;};
 assert.equal(run(fixture()),0);
 for(const mutate of [r=>r.phase='serial-failed',r=>r.failure={kind:'deadline'},r=>r.phase='latency-failed-failed',r=>r.sha='b'.repeat(40),r=>r.rows.pop(),r=>r.rows[1].actor=0,r=>r.rows[0].bustMs='100',r=>r.distributions.registrationMs.p95Ms=999,r=>r.qualification=true]){const value=fixture();mutate(value);assert.notEqual(run(value),0);}
 const fast=fixture();for(const row of fast.rows)row.registrationMs=100;fast.distributions.registrationMs={samples:20,p95Ms:100,maxMs:100};assert.notEqual(run(fast),0);
 const gate=script.indexOf('if [[ "$reentry_latency_failed" == 1 ]]');assert.ok(gate>script.indexOf('REENTRY_LATENCY_ONLY_FAILURE'));assert.match(script.slice(gate,gate+230),/exit 1/);assert.ok(gate<script.indexOf("<<'OPERATIONS_PACKAGE_FINISHED'"));
 const boundary=script.slice(script.indexOf('reentry_latency_failed=0'),script.indexOf("<<'REENTRY_LATENCY_ONLY_FAILURE'"));
 assert.match(boundary,/\[\[ \"\$operations_candidate_probe\" == 1 \]\] \|\| exit 1/);
 assert.ok(script.indexOf('Reentry generation/money/receipt conservation failed')>script.indexOf('REENTRY_LATENCY_ONLY_FAILURE'));
});


test('manual Finish latency-only collection requires every validated hand and retains final failure',()=>{
 const match=script.match(/<<'MANUAL_FINISH_LATENCY_ONLY_FAILURE'\r?\n([\s\S]*?)\r?\nMANUAL_FINISH_LATENCY_ONLY_FAILURE/);assert.ok(match);
 const dir=mkdtempSync(join(tmpdir(),'manual-finish-latency-gate-')),file=join(dir,'receipt.json'),sha='a'.repeat(40);
 const keys=['startMs','finishMs','retryMs','receiptMs','independentReadMs'];
 const fixture=()=>({sha,kind:'REAL_AUTH_TWENTY_MANUAL_SUPPLIED_ACTION_FINISH_HTTP',phase:'graded-failed',failure:null,warmupCompleted:true,actors:20,qualification:false,
  rows:Array.from({length:20},(_,i)=>({handNumber:9003+i,...Object.fromEntries(keys.map(k=>[k,k==='independentReadMs'?1200:100]))})),
  distributions:Object.fromEntries(keys.map(k=>[k,{samples:20,p95Ms:k==='independentReadMs'?1200:100,maxMs:k==='independentReadMs'?1200:100}]))});
 const run=value=>{writeFileSync(file,JSON.stringify(value));return spawnSync(process.execPath,['--input-type=module','-',file,sha],{input:match[1],encoding:'utf8'}).status;};
 assert.equal(run(fixture()),0);
 for(const mutate of [r=>r.phase='setup-failed',r=>r.failure={kind:'deadline'},r=>r.sha='b'.repeat(40),r=>r.warmupCompleted=false,r=>r.actors=19,r=>r.rows.pop(),r=>r.rows[1].handNumber=9003,r=>r.rows[0].finishMs=-1,r=>r.rows[0].finishMs='100',r=>r.distributions.independentReadMs.p95Ms=999,r=>r.qualification=true]){const value=fixture();mutate(value);assert.notEqual(run(value),0);}
 const fast=fixture();for(const row of fast.rows)row.independentReadMs=100;fast.distributions.independentReadMs={samples:20,p95Ms:100,maxMs:100};assert.notEqual(run(fast),0);
 const gate=script.indexOf('if [[ "$manual_finish_latency_failed" == 1 ]]');assert.ok(gate>script.indexOf('MANUAL_FINISH_LATENCY_ONLY_FAILURE'));assert.match(script.slice(gate,gate+240),/exit 1/);assert.ok(gate<script.indexOf("<<'OPERATIONS_PACKAGE_FINISHED'"));
 assert.ok(script.indexOf('Manual action Finish conservation failed')>script.indexOf('MANUAL_FINISH_LATENCY_ONLY_FAILURE'));
});

test('reentry timing export accepts only fixed scalar phases and never header text',()=>{
 const value='reentry_auth;dur=1.250;desc="1", reentry_configuration;dur=5.125;desc="3", reentry_total;dur=8.000';
 assert.deepEqual(reentryServerTiming(value),{capture:'available',totalMs:8,phases:{auth:{ms:1.25,calls:1},configuration:{ms:5.125,calls:3}}});
 assert.deepEqual(reentryServerTiming(value+', private{secret="DO_NOT_EMIT"};dur=1'),reentryServerTiming(value));
 for(const header of [null,'PRIVATE_DO_NOT_EMIT','x'.repeat(4097),value+', reentry_total;dur=8',value.replace('1.250','NaN'),value.replace('desc="3"','desc="11"'),value.replace('desc="1"','desc="SECRET"'),value.replace('1.250','120001'),value.replace('reentry_configuration','reentry_SECRET')])assert.deepEqual(reentryServerTiming(header),{capture:'unavailable'});
});


test('pending reentry transport is explicit,current-only and capped before allocation',()=>{
 for(const args of [['current','1','1','0','10','invalid'],['current','1','0','0','0','1'],['current','1','1','0','1000','1'],['pre03','0','0','0','0','1']]){
  const result=rejectedPreflight(...args);assert.equal(result.status,1);
  assert.match(result.stderr,/Pending reentry transport requires/);
 }
 const valid=rejectedPreflight('current','1','1','0','10','1');assert.equal(valid.status,1);
 assert.match(valid.stderr,/Verified schema-only baseline artifact is required/);
 assert.ok(script.indexOf('20261107013500_cashier_app_reentry_transport_v1.sql')<script.indexOf('UPDATE ops_load_fixture_v1.schema_fence SET frozen=true'));
 assert.match(script,/BASE31_PLUS_PENDING_REENTRY_TRANSPORT_RUNTIME/);
 const paid=script.slice(script.indexOf('install_current_paid_schema() {'),script.indexOf('install_current_revenue_schema() {'));
 assert.ok(paid.indexOf('PAID_SEATING_SCHEMA_PROOF')<paid.indexOf('20261107013500_cashier_app_reentry_transport_v1.sql'));
 assert.match(paid,/pendingReentryTransportApplied=true/);
});


test('healthy reentry load is explicit;fault injection remains capped and other mode is rejected',()=>{
 const invalid=rejectedPreflight('current','1','1','0','10','1','other');assert.equal(invalid.status,1);assert.match(invalid.stderr,/Unsupported isolated reentry fault mode/);
 const noCandidate=rejectedPreflight('current','1','1','0','10','0','healthy');assert.equal(noCandidate.status,1);assert.match(noCandidate.stderr,/healthy mode requires the candidate/);
 const fullHealthy=rejectedPreflight('current','1','1','0','1000','1','healthy');assert.equal(fullHealthy.status,1);assert.match(fullHealthy.stderr,/Verified schema-only baseline artifact is required/);
 const fullFault=rejectedPreflight('current','1','1','0','1000','1','failure-injection');assert.equal(fullFault.status,1);assert.match(fullFault.stderr,/fault injection is capped at10viewers/);
});

test('pool comparison refuses foreign containers and invalid workload before Docker',async()=>{
 for(const args of [['supabase_rest_production','supabase_network_production',20],['supabase_rest_cashier-e2e-abc','other',20],['supabase_rest_cashier-e2e-abc','supabase_network_cashier-e2e-abc',30]])await assert.rejects(configureIsolatedPostgrestPool(...args));
 for(const [mode,rt,ops,audience,pool] of [['pre03','0','0','0','20'],['current','1','1','10','20'],['current','1','1','1000','30']]){const result=rejectedPreflight(mode,rt,ops,'0',audience,'0','failure-injection',pool);assert.notEqual(result.status,0);assert.match(result.stderr,/Pool comparison requires/);}
 const valid=rejectedPreflight('current','1','1','0','1000','1','healthy','20');assert.notEqual(valid.status,0);assert.doesNotMatch(valid.stderr,/Pool comparison requires/);
});

test('bank ambiguity executes only after its dedicated fixture stage,not the initial all-tests run',()=>{
 const spec=readFileSync(new URL('../../e2e/cashier-tour-real.spec.ts',import.meta.url),'utf8');
 assert.match(spec,/LOCAL_REENTRY_BANK_PROBE_STAGE!=='1'/);
 assert.match(script,/LOCAL_REENTRY_BANK_PROBE_STAGE:-0/);
 const stage=script.indexOf('LOCAL_REENTRY_BANK_PROBE_STAGE=1 run_browser_proof');assert.ok(stage>script.indexOf('REENTRY_BANK_AMBIGUITY_SETUP'));
 assert.ok(stage<script.indexOf('REENTRY_BANK_AMBIGUITY_RECOVERY'));
 assert.equal(script.split('LOCAL_REENTRY_BANK_PROBE_STAGE=1').length-1,1);
});


test('prize-close HTTP probe requires full current33 and retains its bounded final receipt',()=>{
 const env={CASHIER_SCHEMA_MODE:'current',LOCAL_OPERATIONS_REALTIME:'1',LOCAL_OPERATIONS_CANDIDATE_PROBE:'1',LOCAL_CLOCK_CANDIDATE_PROBE:'0',LOCAL_REENTRY_TRANSPORT_PROBE:'1',LOCAL_REENTRY_FAULT_MODE:'healthy',LOCAL_CORRECTION_UNDO_PROBE:'1',LOCAL_OPERATIONS_PRIZE_CLOSE_PROBE:'1',LOCAL_OPERATIONS_REDRAW_PROBE:'0',LOCAL_OPERATIONS_AUDIENCE:'0',LOCAL_OPERATIONS_AUDIENCE_MODEL:'selected-table',LOCAL_OPERATIONS_REST_POOL:'10',SCHEMA_ARTIFACT_DIRECTORY:'/missing-prize-close-fixture'};
 const run=patch=>{const args=Object.entries({...env,...patch}).map(([k,v])=>k+'='+v);return spawnSync(process.platform==='win32'?'wsl':'env',process.platform==='win32'?['-d','PokerVision-P16-4C-Eval','--','env',...args,'bash','-s']:[...args,'bash','-s'],{input:script,encoding:'utf8',timeout:10000});};
 for(const patch of [{LOCAL_OPERATIONS_PRIZE_CLOSE_PROBE:'invalid'},{LOCAL_CORRECTION_UNDO_PROBE:'0'}]){const r=run(patch);assert.equal(r.status,1);assert.match(r.stderr,/PRIZE_CLOSE_PROBE_REQUIRES_CURRENT_FULL33_OPERATIONS/);}
 const valid=run({});assert.equal(valid.status,1);assert.match(valid.stderr,/Verified schema-only baseline artifact is required/);
 assert.ok(script.indexOf("[functions.compute-payouts]")<script.indexOf('supabase start --exclude'));
 assert.ok(script.indexOf("CLOSE_PRIZE_CANDIDATE_PATH")>script.indexOf('CORRECTION_OWNED_PREFLIGHT'));
 assert.ok(script.indexOf('hud_projector_pid=$!')<script.lastIndexOf('PRIZE_CLOSE_FRESH_FIXTURE'));
 // The manual targeted mode exits before the default full stages. Its own
 // drain is not the full-suite prize/HUD drain checked here.
 const fullStart=script.indexOf('\nrun_browser_proof\n');
 assert.ok(fullStart>script.lastIndexOf('TARGETED_FINAL_RECEIPT'));
 const fullStages=script.slice(fullStart);
 assert.ok(fullStages.lastIndexOf('PRIZE_CLOSE_FRESH_FIXTURE')<fullStages.indexOf('kill -TERM "$audience_pid"'));
 assert.ok(fullStages.indexOf('kill -TERM "$audience_pid"')<fullStages.indexOf('HUD_DRAIN_BARRIER'));
 assert.ok(script.indexOf('HUD_DRAIN_BARRIER')<script.indexOf('PREPARED_HUD_FINAL_RECEIPT'));
 assert.ok(posix.matchesGlob('VinPoker/output/operations-latency/cashier-http-prize-close-http.json','VinPoker/output/operations-latency/*-http.json'));
 const e2e=readFileSync(new URL('../../e2e/cashier-tour-real.spec.ts',import.meta.url),'utf8');assert.ok(e2e.includes('LOCAL_OPERATIONS_PRIZE_CLOSE_ENABLED'));assert.ok(e2e.includes("prizeTotal=closed.prize_total"));
});
