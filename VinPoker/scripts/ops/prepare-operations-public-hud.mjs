// Actual isolated backfill and independent raw-source shadow before browser HUD
// checks. This is not a production activation tool or a load benchmark.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync,statSync,renameSync} from 'node:fs';
import {basename,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
import {createClient} from '@supabase/supabase-js';
import {loadPackage,MANIFEST_HASH} from './tracker-hud-20261104-release.mjs';
import {loadClassifier,createShadow,shadowSql} from './tracker-hud-shadow.mjs';
import {createOperationalHudControl} from './operations-hud-control.mjs';

const workerBuild={entryPoints:[fileURLToPath(new URL('../../supabase/functions/public-hud-projector-v1/worker.ts',import.meta.url))],bundle:true,write:false,platform:'node',format:'esm',logLevel:'silent'};
// Non-mutating source preflight; no target/credential reads or worker execution.
if(process.argv.length===3&&process.argv[2]==='--check-worker-bundle'){
 await build(workerBuild);console.log(JSON.stringify({kind:'OPERATIONAL_HUD_WORKER_SOURCE_BUNDLE_ONLY',bundled:true}));process.exit(0);
}
assert.equal(process.env.CASHIER_SCHEMA_MODE,'current');
assert.equal(process.env.LOCAL_OPERATIONS_CANDIDATE_PROBE,'1');
assert.equal(process.env.LOCAL_OPERATIONS_REALTIME,'1');
assert.ok(['10','1000'].includes(process.env.LOCAL_OPERATIONS_AUDIENCE));
const [statusPath,container,reportPath,controlDir]=process.argv.slice(2);
assert.ok(process.argv.length===5||process.argv.length===6);
assert.match(statusPath??'',/^\/tmp\/cashier-e2e-[A-Za-z0-9]+\/isolated-status\.json$/);
assert.match(container??'',/^[a-f0-9]{12,64}$/);
assert.ok(reportPath?.endsWith('/output/operations-latency/operations-hud-backfill-http.json'));
assert.match(process.env.LOCAL_OPERATIONS_SOURCE_SHA??'',/^[a-f0-9]{40}$/);
if(controlDir){assert.equal(controlDir,dirname(statusPath)+'/hud-control');assert.match(process.env.LOCAL_OPERATIONS_HUD_CONTROL_NONCE??'',/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);}
let stopping=false;
if(controlDir)process.once('SIGTERM',()=>{stopping=true;});
const inspected=spawnSync('docker',['inspect',container,'--format','{{.Name}}'],{encoding:'utf8'});
assert.equal(inspected.status,0,'Owned test container required');
assert.equal(inspected.stdout.trim(),'/supabase_db_'+basename(dirname(statusPath)));
const status=JSON.parse(readFileSync(statusPath,'utf8'));
assert.equal(status.API_URL,'http://127.0.0.1:54321');
assert.ok(typeof status.SERVICE_ROLE_KEY==='string'&&status.SERVICE_ROLE_KEY.length>32);
assert.equal(loadPackage().entries.length,30);
const execute=query=>{
 const result=spawnSync('docker',['exec','-i',container,'psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres'],{input:query,encoding:'utf8',maxBuffer:16*1024*1024});
 if(result.status!==0)throw Error('ISOLATED_HUD_SQL_FAILED');
 return result.stdout.trim();
};
const json=query=>JSON.parse(execute(query));
const scope=json(`SELECT jsonb_build_object('owned',current_user='postgres' AND current_database()='postgres'
 AND shobj_description((SELECT oid FROM pg_database WHERE datname=current_database()),'pg_database')='vinpoker-operational-schema-fence-disposable',
 'frozen',EXISTS(SELECT 1 FROM ops_load_fixture_v1.schema_fence WHERE singleton AND frozen AND admission_at IS NOT NULL),
 'eventGuard',EXISTS(SELECT 1 FROM pg_event_trigger WHERE evtname='ops_load_schema_frozen' AND evtenabled='O'),
 'disabled',EXISTS(SELECT 1 FROM tracker_analytics_v1.config WHERE singleton AND NOT enabled AND NOT worker_enabled AND NOT backfill_complete),
 'hands',(SELECT count(*) FROM public.tournament_hands),'results',(SELECT count(*) FROM public.player_results),
 'onlyOwnedSource',NOT EXISTS(SELECT 1 FROM public.tournament_hands WHERE tournament_id<>'a3000000-0000-4000-8000-000000000001'),
 'recordedFinish',EXISTS(SELECT 1 FROM public.tournament_hands h WHERE h.tournament_id='a3000000-0000-4000-8000-000000000001' AND h.hand_number=9023 AND h.status='completed'
 AND (SELECT count(*) FROM public.hand_players p WHERE p.hand_id=h.id)=3 AND (SELECT count(*) FROM public.hand_actions a WHERE a.hand_id=h.id)=5),
 'catalog',ops_load_fixture_v1.catalog_fingerprint());`);
for(const key of ['owned','frozen','eventGuard','disabled','onlyOwnedSource','recordedFinish'])assert.equal(scope[key],true,'Required fixture boundary: '+key);
assert.ok(scope.hands>=21&&scope.hands<=1000&&scope.results<=1000);
const client=createClient(status.API_URL,status.SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(input,init)=>fetch(input,{...init,signal:AbortSignal.timeout(5000)})}});
const bundle=await build(workerBuild);
const workerText=bundle.outputFiles[0].text;
const {processPublicHudJobs}=await import('data:text/javascript;base64,'+Buffer.from(workerText).toString('base64'));
const started=Date.now(),report={kind:'REAL_ISOLATED_OPERATIONAL_HUD_BACKFILL_AND_RAW_SHADOW',sha:process.env.LOCAL_OPERATIONS_SOURCE_SHA,manifestSha256:MANIFEST_HASH,
 workerSha256:createHash('sha256').update(workerText).digest('hex'),phase:'backfill',sourceHands:scope.hands,sourceResults:scope.results,batches:0,processed:0,failed:0,shadow:null,
 readsEnabled:false,elapsedMs:0,liveProcessed:0,controls:null,finalShadow:null,qualification:false,productionChanged:false,limitations:'Actual production worker through service HTTP RPCs and original raw-source read-only shadow on the owned disposable operational fixture. Optional private controls change only fixed TEST tour withdrawal/restore through source triggers;not operator authorization/UI proof. Not Edge/cron execution,1000-viewer capacity,production backfill or browser proof.'};
const save=()=>{report.elapsedMs=Date.now()-started;writeFileSync(reportPath,JSON.stringify(report,null,2));};
try{
 execute('UPDATE tracker_analytics_v1.config SET worker_enabled=true WHERE singleton AND NOT enabled AND NOT backfill_complete;');save();
 let complete=false;
 for(let batch=0;batch<100&&!complete;batch++){
  assert.ok(!stopping,'Preparation interrupted');
  assert.ok(Date.now()-started<120000,'Bounded fixture backfill deadline');
  const queued=await client.rpc('backfill_public_hud_v1',{p_limit:50});assert.ok(!queued.error,'Actual backfill RPC failed');report.batches++;
  while(Number(execute('SELECT count(*) FROM tracker_analytics_v1.jobs;'))>0){
   assert.ok(!stopping,'Preparation interrupted');
   assert.ok(Date.now()-started<120000,'Bounded fixture worker deadline');
   const work=await processPublicHudJobs(client,80,Date.now()+10000);report.processed+=work.processed;report.failed+=work.failed;
   assert.equal(work.failed,0,'Actual worker failure must stop activation');
   if(!work.claimed)await new Promise(resolve=>setTimeout(resolve,100));
  }
  complete=queued.data?.complete===true;save();
 }
 assert.equal(complete,true,'Actual backfill checkpoint must finish');
 report.phase='shadow';save();
 const classifier=await loadClassifier(),shadow=createShadow(classifier);
 execute(shadowSql).split('\n').filter(Boolean).forEach(line=>shadow.accept(JSON.parse(line)));
 report.shadow=shadow.finish();assert.equal(report.shadow.complete,true);assert.equal(report.shadow.passed,true);assert.equal(report.shadow.mismatches,0);
 report.phase='activate-isolated';save();
 execute('UPDATE tracker_analytics_v1.config SET enabled=true WHERE singleton AND backfill_complete AND hands_done AND results_done AND NOT EXISTS(SELECT 1 FROM tracker_analytics_v1.jobs) AND NOT EXISTS(SELECT 1 FROM tracker_analytics_v1.visibility_barriers);');
 assert.equal(execute('SELECT enabled FROM tracker_analytics_v1.config WHERE singleton;'),'t');
 assert.equal(execute('SELECT ops_load_fixture_v1.catalog_fingerprint();'),scope.catalog,'Preparation must not alter frozen schema');
 report.readsEnabled=true;report.phase='prepared';save();
 if(controlDir){
  const nonce=process.env.LOCAL_OPERATIONS_HUD_CONTROL_NONCE;
  const control=createOperationalHudControl({sha:report.sha,nonce,
   read:async()=>{const file=controlDir+'/requests/request.json';if(!existsSync(file))return;assert.ok(statSync(file).size<=1024);return readFileSync(file,'utf8');},
   apply:async action=>{
    const value=json(`WITH changed AS (UPDATE public.tournaments SET deleted_at=${action==='withdraw'?'clock_timestamp()':'NULL'}
     WHERE id='a3000000-0000-4000-8000-000000000001' AND club_id='a2000000-0000-4000-8000-000000000001' AND name='Cashier Edge TEST Tour'
     AND deleted_at IS ${action==='withdraw'?'NULL':'NOT NULL'} RETURNING id)
     SELECT jsonb_build_object('changed',(SELECT count(*) FROM changed),'sourceWrittenAt',extract(epoch FROM clock_timestamp())*1000);`);
    assert.equal(value.changed,1,'Only one owned fixture transition is permitted');
    return value;
   },
   write:async receipt=>{const next=controlDir+'/receipts/receipt.next';writeFileSync(next,JSON.stringify(receipt),{mode:0o600});renameSync(next,controlDir+'/receipts/receipt.json');},
  });
  const work=async()=>{const result=await processPublicHudJobs(client,80,Date.now()+10000);report.liveProcessed+=result.processed;report.failed+=result.failed;assert.equal(result.failed,0,'Live fixture projector failure');};
  report.phase='serving';save();
  while(!stopping){
   await control.poll();await work();
   const flushed=await client.rpc('flush_public_spectator_broadcast_v2',{p_limit:100});assert.ok(!flushed.error&&Number.isInteger(flushed.data),'Actual fixture Broadcast flush failed');
   report.controls=control.report();save();await new Promise(resolve=>setTimeout(resolve,250));
  }
  await control.stop();
  const drainUntil=Date.now()+15000;
  while(Number(execute('SELECT count(*) FROM tracker_analytics_v1.jobs;'))>0){assert.ok(Date.now()<drainUntil,'Final fixture drain deadline');await work();}
  const final=createShadow(classifier);execute(shadowSql).split('\n').filter(Boolean).forEach(line=>final.accept(JSON.parse(line)));
  report.finalShadow=final.finish();assert.equal(report.finalShadow.passed,true);assert.equal(report.finalShadow.mismatches,0);
  assert.equal(execute('SELECT ops_load_fixture_v1.catalog_fingerprint();'),scope.catalog);
  report.controls=control.report();report.phase='stopped';save();
 }
}catch{report.phase+='-failed';save();console.error('ISOLATED_OPERATIONS_HUD_PREPARATION_FAILED');process.exitCode=1;}
