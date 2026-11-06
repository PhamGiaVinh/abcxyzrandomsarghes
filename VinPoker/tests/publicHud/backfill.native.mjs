import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {isAbsolute} from 'node:path';
import {build} from 'esbuild';
import {sql,jsonSql,service,createSqlSessionPool} from './nativeDb.mjs';
import {nativeWorkerClient,createNativeWorkerClient} from './nativeRpc.mjs';

const database=process.env.PUBLIC_HUD_LOCAL_DATABASE;
assert.match(database??'',/^vinpoker_hud_test_backfill_raw_[a-z0-9_]+$/,'Explicit raw disposable fixture required');
assert.ok(process.argv.length===3&&['--first-checkpoint','--resume'].includes(process.argv[2]));
const first=process.argv[2]==='--first-checkpoint',output=process.env.PUBLIC_HUD_BACKFILL_REPORT;
assert.ok(output&&isAbsolute(output),'Absolute nonsecret evidence path required');
const limit=Number(process.env.PUBLIC_HUD_BACKFILL_BATCH_SIZE??50);
assert.ok(Number.isSafeInteger(limit)&&limit>=1&&limit<=500);
const transport=process.env.PUBLIC_HUD_BACKFILL_TRANSPORT??'native-process';
assert.ok(['native-process','native-session'].includes(transport),'Explicit native transport required');
assert.equal(sql('SELECT current_database();'),database);
assert.equal(sql("SELECT to_regprocedure('public.fixture_scale_uuid(text,bigint)') IS NOT NULL AND to_regclass('tracker_analytics_v1.visibility_work') IS NOT NULL;"),'t');
const config=()=>jsonSql('SELECT to_jsonb(c) FROM tracker_analytics_v1.config c;');
const initial=config();assert.equal(initial.enabled,false);assert.equal(initial.backfill_complete,false);
if(first){assert.equal(initial.backfill_hand_cursor,null);assert.equal(sql('SELECT count(*) FROM tracker_analytics_v1.hand_contributions;'),'0');}
else assert.ok(initial.backfill_hand_cursor,'Resume must use an existing committed checkpoint');
const sourceHands=Number(sql('SELECT count(*) FROM public.tournament_hands;'));
assert.ok([100,1000,10000,100000,1000000].includes(sourceHands));
assert.ok(!first||limit<sourceHands,'First checkpoint must leave historical source for a separate resumed process');
const bundled=await build({entryPoints:['supabase/functions/public-hud-projector-v1/worker.ts'],bundle:true,write:false,platform:'node',format:'esm',logLevel:'silent'});
const {processPublicHudJobs}=await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].text).toString('base64'));
const sessions=transport==='native-session'?createSqlSessionPool(4):null;
const nativeRpcTiming={calls:0,totalMs:0,maxMs:0};
const client=sessions?createNativeWorkerClient(async query=>{
 const started=performance.now();try{return await sessions.query(query);}finally{const elapsed=performance.now()-started;nativeRpcTiming.calls++;nativeRpcTiming.totalMs+=elapsed;nativeRpcTiming.maxMs=Math.max(nativeRpcTiming.maxMs,elapsed);}
}):nativeWorkerClient;
const started=Date.now(),report={kind:'REAL_NATIVE_WORKER_BACKFILL_CHECKPOINT_NOT_HTTP_LOAD',database,sourceHands,mode:first?'first-checkpoint':'resume',initialCheckpoint:initial.backfill_hand_cursor,
 transport,nativeSessionConnections:sessions?4:0,nativeRpcTiming,
 batchSize:limit,batches:0,processed:0,claimed:0,failed:0,elapsedMs:0,complete:false,checkpoint:null,contributions:null,qualification:false,productionCapacityClaim:false,
 limitations:'Actual backfill RPC and production classifier/worker through declared native transport. Native-process includes per-RPC WSL startup;native-session retains four real psql sessions. Source invariant here is hand cardinality only,not complete content/players/actions immutability. Independent raw-source shadow is required separately. Not HTTP/Edge throughput,production capacity or concurrent live writes.'};
const save=()=>{report.elapsedMs=Date.now()-started;writeFileSync(output,JSON.stringify(report,null,2)+'\n');};
try{
 sql('UPDATE tracker_analytics_v1.config SET worker_enabled=true WHERE singleton AND NOT enabled;');
 for(let batch=0;batch<Math.ceil(sourceHands/limit)+100;batch++){
  const result=jsonSql(`${service}SELECT public.backfill_public_hud_v1(${limit});`);report.batches++;
  const drainDeadline=Date.now()+120000;
  while(Number(sql('SELECT count(*) FROM tracker_analytics_v1.jobs;'))>0){
   assert.ok(Date.now()<drainDeadline,'Worker drain exceeded bounded diagnostic window');
   const work=await processPublicHudJobs(client,80,Date.now()+10000);
   report.claimed+=work.claimed;report.processed+=work.processed;report.failed+=work.failed;
   assert.equal(work.failed,0,'Actual worker failed;do not certify partial work');
   if(!work.claimed)await new Promise(resolve=>setTimeout(resolve,100));
  }
  const current=config();report.checkpoint=current.backfill_hand_cursor;report.complete=current.backfill_complete;
  report.contributions=Number(sql('SELECT count(*) FROM tracker_analytics_v1.hand_contributions;'));save();
  if(first||result.complete||report.complete)break;
 }
 assert.equal(Number(sql('SELECT count(*) FROM public.tournament_hands;')),sourceHands);
 if(first){assert.ok(report.checkpoint);assert.equal(report.complete,false);assert.equal(report.contributions,Math.min(limit,sourceHands)*2);}
 else {assert.equal(report.complete,true);assert.equal(report.contributions,sourceHands*2);assert.equal(sql('SELECT count(*) FROM tracker_analytics_v1.jobs;'),'0');}
 save();console.log(JSON.stringify(report));
}catch(error){report.complete=false;report.failed+=1;save();throw error;}
finally{await sessions?.close();}
