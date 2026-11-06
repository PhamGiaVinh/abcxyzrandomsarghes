import test from 'node:test';
import {selectedAudienceSections,audienceResourceStats} from './operations-audience-scope.mjs';
import http from 'node:http';
import {ownedAudienceCancellation,audienceClockSignal,audienceFailure,audienceFileLimits,audienceGatewayConfig,prepareAudienceGatewayTemplate,audienceJoinFailure,audienceSocketDiagnostic,audienceWorkerFailure,audienceServerTiming,observeAudienceHandshake,observeAudienceSubscriptions} from './operations-audience-scope.mjs';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { selectCashierSchemaMode } from './select-cashier-schema-mode.mjs';

const script = readFileSync(new URL('./cashier-tour-real-e2e.sh', import.meta.url), 'utf8');
const workflow = readFileSync(new URL('../../../.github/workflows/cashier-tour-real-e2e.yml', import.meta.url), 'utf8');

test('resource observations retain fixed numeric counters and reject labels or non-finite values',()=>{
 assert.deepEqual(audienceResourceStats('191.55%|12.30%|18\n'),{cpuPercent:191.55,memoryPercent:12.3,pids:18});
 for(const text of ['NaN%|0%|1','1%|101%|1','1%|0%|1\nprivate-label','1%|0%|-1','1%|0%|9007199254740992'])assert.throws(()=>audienceResourceStats(text));
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

test('selected-table hidden hub omits ordinary hand snapshots but retains scope and metadata checks',()=>{
 assert.deepEqual(selectedAudienceSections({reason:'changed',components:['tables']}),[]);
 assert.deepEqual(selectedAudienceSections({reason:'changed',components:['hand_visibility','tables']}),[]);
 assert.deepEqual(selectedAudienceSections({reason:'changed',components:['ranking','tables']}),['ranking']);
 assert.deepEqual(selectedAudienceSections({reason:'changed',components:['payout','clock']}),['payout']);
 assert.deepEqual(selectedAudienceSections({reason:'changed',components:['visibility']}),['tables','ranking','payout']);
 assert.deepEqual(selectedAudienceSections({reason:'verify',components:['tables']}),['tables']);
 assert.deepEqual(selectedAudienceSections({reason:'status',components:['tables','ranking','payout']}),[]);
});

function rejectedPreflight(mode,realtime='0',operations='0',clock='0',audience='0') {
  const filename = fileURLToPath(new URL('./cashier-tour-real-e2e.sh', import.meta.url));
  const env = { ...process.env, CASHIER_SCHEMA_MODE: mode, LOCAL_OPERATIONS_REALTIME:realtime, LOCAL_OPERATIONS_CANDIDATE_PROBE:operations, LOCAL_CLOCK_CANDIDATE_PROBE:clock, LOCAL_OPERATIONS_AUDIENCE:audience, SCHEMA_ARTIFACT_DIRECTORY: '/missing-cashier-schema' };
  if (process.platform === 'win32') {
    return spawnSync('wsl', ['-d', 'PokerVision-P16-4C-Eval', '--', 'env', `CASHIER_SCHEMA_MODE=${mode}`,`LOCAL_OPERATIONS_REALTIME=${realtime}`,`LOCAL_OPERATIONS_CANDIDATE_PROBE=${operations}`,`LOCAL_CLOCK_CANDIDATE_PROBE=${clock}`,`LOCAL_OPERATIONS_AUDIENCE=${audience}`, 'SCHEMA_ARTIFACT_DIRECTORY=/missing-cashier-schema', 'bash', '-s'], { encoding: 'utf8', input: script.replaceAll('\r\n', '\n') });
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
  assert.ok(workflow.includes('node VinPoker/scripts/ops/select-cashier-schema-mode.mjs'));
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
