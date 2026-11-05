import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,appendFileSync} from 'node:fs';
import {monitorEventLoopDelay,performance as nodePerformance} from 'node:perf_hooks';
import {parseEnv} from 'node:util';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createClient} from '@supabase/supabase-js';
import {configureLocalRealtime} from './scale.realtime.mjs';
import {handIncludesWrite,projectionIncludesWrite} from './scale.delivery.mjs';
import {createLocalHttpTransport} from './scale.http.mjs';
import {maximumSample,summaryApiReport} from './scale.summary.mjs';
import {readMatchedWriterQualification} from './scale.write.qualification.mjs';
import {beginHudRestoration,recordHudRestoration,setHudRestorationDeadline,hudRestorationFailure} from './scale.restoration.mjs';
import {classifyEdgeFailure,classifyHudReadFailure,classifyTableReadFailure} from './scale.failures.mjs';
import {registerPublicTournamentRead,PUBLIC_SPECTATOR_READ_INTERVAL_MS,PUBLIC_SPECTATOR_HINT_JITTER_MS} from '../../.local-data/hud-scale-runtime/publicSnapshotCoordinator.mjs';
import {readPublicTableRequest} from '../../.local-data/hud-scale-runtime/publicTableTransport.mjs';
import {parsePublicClockSummary} from '../../.local-data/hud-scale-runtime/publicTableHistory.mjs';
import {readPublicHudRequest,revalidatePublicHudRead,PUBLIC_HUD_REVALIDATION_WINDOW_MS} from '../../.local-data/hud-scale-runtime/publicHudTransport.mjs';
const status=parseEnv(readFileSync(process.env.PUBLIC_HUD_STATUS_FILE,'utf8'));
const project=process.env.PUBLIC_HUD_STACK_PROJECT;
if(status.API_URL!=='http://127.0.0.1:54321'||!/^hud-scale-[a-z0-9-]+$/.test(project))throw Error('Local isolated stack required');
const viewers=Number(process.env.PUBLIC_HUD_SCALE_VIEWERS??1000),targetDuration=Number(process.env.PUBLIC_HUD_SCALE_SECONDS??1800);
if(!Number.isInteger(viewers)||viewers<1||viewers>1000||targetDuration<30||targetDuration>1800)throw Error('Invalid load bounds');
const hudTransport=process.env.PUBLIC_HUD_SCALE_TRANSPORT??'product_rpc';
if(!['product_rpc','edge','direct_rpc'].includes(hudTransport)||hudTransport!=='product_rpc'&&targetDuration!==30)throw Error('Comparison transport is a short diagnostic only');
const run=promisify(execFile),sleep=ms=>new Promise(r=>setTimeout(r,ms));
const httpTransport=createLocalHttpTransport();process.on('exit',()=>httpTransport.close());
const uuid=(prefix,n)=>`${prefix}-0000-4000-8000-${n.toString(16).padStart(12,'0')}`;
const amendmentKinds=['correct','void','restore','verify','revoke','reverify','result_create','result_edit','result_revoke','result_reverify'];
const player=uuid('30000000',1),stats={summary:[],summaryHttp:[],realtime:[],sourceToReadStart:[],tableRead:[],snapshot:[],snapshotToReadStart:[],snapshotRead:[],snapshotToPublication:[],snapshotPublicationToRead:[],projection:[],errors:{},transportErrors:{},reconnects:0,sourceWrites:0,revocationClears:0};
const readyProbeTimes=new Map(),workerProbeDiagnostics=[];
let stopping=false;
let phases={},transportTimings={},rpcOutcomes={},runtimeFailures={},hudFailureKinds={},tableFailureKinds={},requestAccounting={},observationOrder=0;
let dispatchBuckets=new Map();
const dispatchReport=()=>({windowMs:100,source:'physical HTTP launches including errors and cancellations; nonempty generator-clock windows',paths:Object.fromEntries([...dispatchBuckets].map(([path,buckets])=>{const counts=[...buckets.values()];return [path,{nonEmptyWindows:counts.length,maxRequestsPerWindow:maximumSample(counts),p95RequestsPerWindow:percentile(counts,.95)}];}))});
const error=kind=>{stats.errors[kind]=(stats.errors[kind]??0)+1;};
const recordSummaryApi=(ms,phase,data)=>{const state=data?.access==='revoked'?'revoked':['current','updating','warming','unavailable'].includes(data?.state)?data.state:'unknown';stats.summaryHttp.push({ms,phase:phase??'unspecified',state,ready:data?.access==='public'&&['current','updating'].includes(state)});};
async function post(path,body,privileged=false,phase='other',callerSignal){
 const key=privileged?status.SERVICE_ROLE_KEY:status.ANON_KEY,start=performance.now();
 const accounting=requestAccounting[phase+':'+path]??={launched:0,requestBytes:0,completed:0,responseBytes:0,cancelled:0};
 const encoded=JSON.stringify(body);accounting.launched++;accounting.requestBytes+=Buffer.byteLength(encoded);
 const windows=dispatchBuckets.get(path)??new Map();dispatchBuckets.set(path,windows);const window=Math.floor(performance.now()/100);windows.set(window,(windows.get(window)??0)+1);
 const timeout=AbortSignal.timeout(10000),signal=callerSignal?AbortSignal.any([callerSignal,timeout]):timeout;
 const intentionallyCancelled=error=>error?.httpStatus===undefined&&callerSignal?.aborted&&!timeout.aborted&&(error===callerSignal.reason||error?.name==='AbortError');
 try{
 const response=await httpTransport.request(status.API_URL+path,{headers:{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:encoded,signal}).catch(error=>{
  if(intentionallyCancelled(error))throw error;
  const kind=`${phase}:${path.split('/').at(-1)}:${timeout.aborted?'timeout':'transport'}`;stats.transportErrors[kind]=(stats.transportErrors[kind]??0)+1;throw error;
 });
 const timingKey=phase+':'+path;
 const timings=transportTimings[timingKey]??={headers:[],complete:[],upstream:[],proxy:[],application:[],rpc:[],groupSize:[]};
 timings.headers.push(response.headersAt-start);
 const application=/\bhud;dur=([0-9]+(?:\.[0-9]+)?)/.exec(response.headers['server-timing']??'');if(application)timings.application.push(Number(application[1]));
 const rpcTiming=/\bhud_rpc;dur=([0-9]+(?:\.[0-9]+)?);desc="(ok|http|transport|deadline|cancelled)"/.exec(response.headers['server-timing']??'');
 if(rpcTiming){timings.rpc.push(Number(rpcTiming[1]));const key=phase+':'+rpcTiming[2];rpcOutcomes[key]=(rpcOutcomes[key]??0)+1;}
 const group=/\bhud_group;desc="([1-9][0-9]{0,2})"/.exec(response.headers['server-timing']??'');if(group&&Number(group[1])<=256)timings.groupSize.push(Number(group[1]));
 for(const [field,header] of [['upstream','x-kong-upstream-latency'],['proxy','x-kong-proxy-latency']]){const value=response.headers[header];if(value!==undefined&&Number.isFinite(Number(value)))timings[field].push(Number(value));}
 if(!response.ok){if(response.status>=500){const kind=phase+':'+classifyEdgeFailure(response.text);runtimeFailures[kind]=(runtimeFailures[kind]??0)+1;}let code='';try{const body=JSON.parse(response.text);if(typeof body.code==='string'&&/^[A-Z0-9_]{1,40}$/.test(body.code))code=':'+body.code;}catch{}const kind=`${phase}:${path.split('/').at(-1)}:HTTP_${response.status}${code}`;stats.transportErrors[kind]=(stats.transportErrors[kind]??0)+1;throw Error(`HTTP_${response.status}`);}
 const text=response.text;const value=JSON.parse(text);
 if(performance.now()-start>=10000){const kind=`${phase}:${path.split('/').at(-1)}:timeout`;stats.transportErrors[kind]=(stats.transportErrors[kind]??0)+1;throw Object.assign(new Error('HTTP_DEADLINE'),{name:'TimeoutError'});}
 accounting.completed++;accounting.responseBytes+=Buffer.byteLength(text);timings.complete.push(performance.now()-start);
 if(path.endsWith('/fixture_scale_hand_ready_v1')&&value===true){
  const observedAt=Date.parse(response.headers['x-hud-fixture-observed-at']??'');
  assert.ok(Number.isFinite(observedAt),'Missing fixture readiness clock');
  readyProbeTimes.set(body.p_hand_id,{observedAt,readMs:performance.now()-start});
 }
 if(hudTransport==='direct_rpc'&&path.endsWith('/get_public_player_hud_summary_v1')&&phase!=='diagnostic-direct-summary'){const elapsed=performance.now()-start;stats.summary.push(elapsed);(phases[phase]??=[]).push(elapsed);}
 return value;
 }catch(error){if(intentionallyCancelled(error)){accounting.cancelled++;throw Object.assign(new Error('HUD_SUPERSEDED'),{intentionalHudCancellation:true});}throw error;}
}
const rpc=(name,args,privileged=false)=>post('/rest/v1/rpc/'+name,args,privileged);
const hud=async(tour,mode='summary',accessSnapshot,phase,signal,onPreparing)=>{
 if(hudTransport!=='direct_rpc'){
  const start=performance.now();
  try{
  const caller=signal??new AbortController().signal;
  const request=owned=>readPublicHudRequest(status.API_URL,status.ANON_KEY,
   {tournament_id:tour,player_id:player,mode,access_snapshot:accessSnapshot},owned,
   async(url,init)=>{
    const target=new URL(url);assert.equal(target.origin,status.API_URL);
    assert.equal(target.pathname,'/rest/v1/rpc/'+(mode==='summary'?'get_public_player_hud_summary_v1':'get_public_player_hud_history_v1'));
    assert.equal(init.headers.apikey,status.ANON_KEY);assert.equal(init.headers.Authorization,`Bearer ${status.ANON_KEY}`);
    let data;const rpcStart=performance.now();
    try{data=await post(hudTransport==='edge'?'/functions/v1/public-player-hud':target.pathname,
     hudTransport==='edge'?{tournament_id:tour,player_id:player,mode,access_snapshot:accessSnapshot}:JSON.parse(init.body),false,phase,init.signal);}
    catch(error){if(error?.intentionalHudCancellation)throw new DOMException('aborted','AbortError');throw error;}
    if(mode==='summary')recordSummaryApi(performance.now()-rpcStart,phase,data);
    return new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}});
   });
  const value=mode==='summary'?await revalidatePublicHudRead(request,caller,onPreparing):await request(caller);
  if(mode==='summary'){const elapsed=performance.now()-start;stats.summary.push(elapsed);(phases[phase]??=[]).push(elapsed);}
  return value;
  }catch(error){
   // Only the original HUD caller can supersede its request. The helper's
   // five-second timer aborts a different signal and must remain a failure.
   const cancelled=signal?.aborted===true&&error?.publicHudCallerCancelled===true&&error?.publicHudDeadline!==true;
   const outcome=phase+':'+(cancelled?'caller_cancelled':'failed');rpcOutcomes[outcome]=(rpcOutcomes[outcome]??0)+1;
   if(!cancelled){const kind=phase+':'+classifyHudReadFailure(error);hudFailureKinds[kind]=(hudFailureKinds[kind]??0)+1;}
   if(cancelled)throw Object.assign(new Error('HUD_SUPERSEDED'),{intentionalHudCancellation:true});
   throw error;
  }
 }
 const start=performance.now();
 const value=await (hudTransport==='edge'
 ?post('/functions/v1/public-player-hud',{tournament_id:tour,player_id:player,mode,access_snapshot:accessSnapshot},false,phase,signal)
 :post('/rest/v1/rpc/'+(mode==='summary'?'get_public_player_hud_summary_v1':'get_public_player_hud_history_v1'),
  {p_tournament_id:tour,p_player_id:player,...(mode==='summary'?{p_access_snapshot:accessSnapshot??null}:{})},false,phase,signal));
 if(mode==='summary')recordSummaryApi(performance.now()-start,phase,value);
 return value;
};
async function until(fn,timeout,label){const start=Date.now();while(Date.now()-start<timeout){if(await fn())return;await sleep(200);}throw Error(label);}
const percentile=(values,p)=>values.length?[...values].sort((a,b)=>a-b)[Math.min(values.length-1,Math.floor(values.length*p))]:null;
const timingReport=()=>Object.fromEntries(Object.entries(transportTimings).map(([phase,parts])=>[phase,Object.fromEntries(Object.entries(parts).map(([name,values])=>[name,{samples:values.length,p95Ms:percentile(values,.95)}]))]));
const denied=await fetch(status.API_URL+'/rest/v1/rpc/claim_public_hud_jobs_v1',{method:'POST',headers:{apikey:status.ANON_KEY,Authorization:`Bearer ${status.ANON_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({p_limit:1})});
assert.ok([401,403].includes(denied.status),'Anonymous caller must not claim private jobs');
await rpc('fixture_scale_visibility_v1',{p_tournament_id:uuid('10000000',20),p_hidden:true},true);
const privilegedHeader=await post('/functions/v1/public-player-hud',{tournament_id:uuid('10000000',20),player_id:player,mode:'summary'},true);
assert.equal(privilegedHeader.access,'revoked','Service header must not widen the public Edge read');
await rpc('fixture_scale_visibility_v1',{p_tournament_id:uuid('10000000',20),p_hidden:false},true);
await until(async()=>{const value=await hud(uuid('10000000',1));return value.access==='public'&&['current','updating'].includes(value.state);},60000,'Lifetime visibility revalidation did not recover');
let restorationFailure=null;
const reports=[],sourceWriterBenchmark=JSON.parse(readFileSync('output/hud-scale/seed.json','utf8')).writer;
const writerMethod=process.env.PUBLIC_HUD_WRITER_QUALIFICATION_METHOD??'startup';
assert.ok(['startup','canonical-hand-observers-paired-v1'].includes(writerMethod),'Unknown writer grading method');
let writerQualification=null;
const save=(state)=>writeFileSync('output/hud-scale/http-ws.json',JSON.stringify({kind:'REAL_LOCAL_HTTP_SUPABASE_WEBSOCKET_POSTGRESQL',productionCapacityClaim:false,hudTransport,productTransport:hudTransport==='product_rpc',sourceWriterBenchmark,writerMethod,writerQualification,qualification:state==='passed'&&hudTransport==='product_rpc'&&viewers===1000&&targetDuration===1800,status:state,reports,
 partial:state==='failed'?{incomplete:true,restorationFailure,errors:stats.errors,transportErrors:stats.transportErrors,rpcOutcomes,runtimeFailures,hudFailureKinds,tableFailureKinds,requestAccounting,transportTimings:timingReport(),summaryApi:summaryApiReport(stats.summaryHttp),logicalHudSamples:stats.summary.length,observedLogicalHudP95Ms:percentile(stats.summary,.95),tableSamples:stats.realtime.length,observedTableP95Ms:percentile(stats.realtime,.95),snapshotSamples:stats.snapshot.length,observedSnapshotP95Ms:percentile(stats.snapshot,.95),sourceWrites:stats.sourceWrites}:undefined},null,2));
save('running');
process.on('uncaughtExceptionMonitor',()=>save('failed'));
if(writerMethod==='canonical-hand-observers-paired-v1'){
 writerQualification=readMatchedWriterQualification(JSON.parse(readFileSync('output/hud-scale/seed.json','utf8')).handsPerPlayer);
 save('running');
}
if(viewers===1000&&targetDuration===1800){
 const seed=JSON.parse(readFileSync('output/hud-scale/seed.json','utf8'));
 assert.equal(seed.handsPerPlayer,1_000_000);
 console.log(JSON.stringify({phase:'write-overhead-measured',thresholdPercent:10,observedPercent:seed.writer.p95OverheadPercent,passed:seed.writer.p95OverheadPercent<=10,grading:writerMethod==='startup'?'Startup overhead remains the final writer gate':'Startup measurement retained; explicitly selected matched method is independently graded at completion'}));
}
for(const scenario of ['concentrated','distributed','overview']){
 const overview=scenario==='overview',duration=overview?30:targetDuration;
 phases={};transportTimings={};rpcOutcomes={};runtimeFailures={};hudFailureKinds={};tableFailureKinds={};requestAccounting={};dispatchBuckets=new Map();const eventLoop=monitorEventLoopDelay({resolution:20});eventLoop.enable();const utilizationStart=nodePerformance.eventLoopUtilization();
 const cpuStart=process.cpuUsage(),generatorStart=performance.now();
 const offset={summary:stats.summary.length,summaryHttp:stats.summaryHttp.length,realtime:stats.realtime.length,sourceToReadStart:stats.sourceToReadStart.length,tableRead:stats.tableRead.length,snapshot:stats.snapshot.length,snapshotToReadStart:stats.snapshotToReadStart.length,snapshotRead:stats.snapshotRead.length,snapshotToPublication:stats.snapshotToPublication.length,snapshotPublicationToRead:stats.snapshotPublicationToRead.length,projection:stats.projection.length,reconnects:stats.reconnects,revocationClears:stats.revocationClears,sourceWrites:stats.sourceWrites};
 const tourCount=scenario==='concentrated'?1:20,clients=[],tasks=new Set();
 let end=Infinity,reconnecting=false,revoking=false,started=0,currentAmendment=null;
 let restorationDeadline=null;
 const checkRestoration=()=>{
  if(restorationDeadline!==null&&Date.now()>=restorationDeadline&&clients.some(c=>c.restoration?.receiptAt==null)){
   restorationFailure=hudRestorationFailure(clients,scenario);throw Error('Every restored HUD and independent history must recover within the original15s window');
  }
 };
 const notReadyOutcomes=[];
 const notReady=(part,phase,value)=>{
  error(part==='history'?'history_not_ready':'hud_not_ready');
  if(notReadyOutcomes.length>=50)return;
  const outcome={scenario,part,phase,at:Date.now(),access:['public','revoked'].includes(value?.access)?value.access:'unknown',state:['current','updating','warming','unavailable'].includes(value?.state)?value.state:'unknown',amendment:currentAmendment?{...currentAmendment}:null};
  notReadyOutcomes.push(outcome);appendFileSync('output/hud-scale/not-ready.jsonl',JSON.stringify(outcome)+'\n');
 };
 let expectedDeliveries=0,excludedForPlannedFault=0,missedDeliveries=0,minHealthyOnline=viewers,healthySocketMs=0,healthyWallMs=0,coverageAt=0,unexpectedDisconnects=0;
 let snapshotExpected=0,snapshotExcluded=0,snapshotMissed=0;
 const suspendDeliveries=(onlyTour)=>{for(const c of clients)if(!onlyTour||c.tour===onlyTour){excludedForPlannedFault+=c.expected.length;c.expected=[];snapshotExcluded+=c.snapshotExpected.length;c.snapshotExpected=[];}};
 const expireDeliveries=()=>{for(const c of clients){for(const [field,measure] of [['expected','realtime'],['snapshotExpected','snapshot']]){const remaining=[];for(const e of c[field]){if(Date.now()-e.at>10000){if(field==='expected')missedDeliveries++;else snapshotMissed++;stats[measure].push(Date.now()-e.at);}else remaining.push(e);}c[field]=remaining;}}};
 const health=[];
 const track=promise=>{tasks.add(promise);promise.finally(()=>tasks.delete(promise));};
 const resourceTimer=setInterval(()=>{
  // One observer per process, not viewer HUD polling: same anonymous prepared
  // summary via PostgREST distinguishes database/HTTP delay from Edge queuing.
  track(post('/rest/v1/rpc/get_public_player_hud_summary_v1',{p_tournament_id:uuid('10000000',1),p_player_id:player,p_access_snapshot:null},false,'diagnostic-direct-summary').catch(()=>error('diagnostic_summary_read')));
  appendFileSync('output/hud-scale/generator-memory.jsonl',JSON.stringify({at:Date.now(),scenario,...process.memoryUsage(),transport:httpTransport.metrics()})+'\n');
  track(fetch(status.API_URL+'/functions/v1/_internal/metric',{signal:AbortSignal.timeout(3000)}).then(async response=>{if(!response.ok)return;const value=await response.json();const safe={at:Date.now(),scenario};for(const key of ['activeUserWorkersCount','retiredUserWorkersCount','receivedRequestsCount','handledRequestsCount'])if(Number.isSafeInteger(value[key]))safe[key]=value[key];appendFileSync('output/hud-scale/edge-runtime.jsonl',JSON.stringify(safe)+'\n');}).catch(()=>{}));
  const resourceStartedAt=Date.now();
  track(run('docker',['stats','--no-stream','--format','{{json .}}',`supabase_db_${project}`,`supabase_realtime_${project}`,`supabase_edge_runtime_${project}`,`supabase_kong_${project}`,`supabase_rest_${project}`]).then(({stdout})=>{
   const at=Date.now();
   const samples=stdout.trim().split('\n').filter(Boolean).map(line=>({...JSON.parse(line),sampleStartedAt:resourceStartedAt,at,scenario}));
   appendFileSync('output/hud-scale/resource-samples.jsonl',samples.map(sample=>JSON.stringify(sample)).join('\n')+'\n');
  }).catch(()=>error('resource_sample')));
  const query="SELECT jsonb_build_object('at',clock_timestamp(),'backends',(SELECT jsonb_agg(to_jsonb(s)) FROM (SELECT state,wait_event_type,count(*) FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() GROUP BY state,wait_event_type) s),'waitingLocks',(SELECT count(*) FROM pg_locks WHERE NOT granted),'statsInfo',(SELECT to_jsonb(v) FROM spectator_projection_v2.fixture_rpc_profile_info v),'rpc',(SELECT coalesce(jsonb_agg(v ORDER BY rpc),'[]') FROM spectator_projection_v2.fixture_rpc_profile v));";
  track(run('psql',['-h','127.0.0.1','-p','54322','-U','postgres','-d','postgres','-w','-X','-qAt','-c',query],{env:{...process.env,PGPASSWORD:'postgres'}}).then(({stdout})=>appendFileSync('output/hud-scale/pg-pressure.jsonl',stdout)).catch(()=>error('pg_pressure_sample')));
 },5000);
 // Wait for the actual cron-dispatched Edge projector; no in-process worker shortcut.
 await until(async()=>{const reply=await rpc('get_public_tournament_viewer_snapshot_v2',{p_tournament_id:uuid('10000000',1),p_table_ids:[uuid('50000000',1)],p_sections:['tables'],p_known_revisions:{}});return reply.sections?.tables?.freshness?.state==='current';},60000,'Initial real worker publication unavailable');
 for(let i=0;i<viewers;i++){
  const n=1+i%tourCount,tour=uuid('10000000',n),table=uuid('50000000',n);
  const client=createClient(status.API_URL,status.ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},realtime:{params:{eventsPerSecond:100}}});
  const state={client,online:false,accessOnline:false,accessJoined:false,tableStatus:'INITIAL',accessStatus:'INITIAL',joined:false,reconnected:0,revocations:0,deliverySamples:0,snapshotSamples:0,expected:[],snapshotExpected:[],snapshotBusy:false,snapshotDirty:new Set(),known:{},snapshotLast:0,busy:false,pending:false,lastRead:0,nextVerify:Infinity,lastHud:0,failures:0,frozen:null,hudEpoch:0,hudController:null,hudActive:false,verifyAfterRead:false,hudCompletedEpoch:0,accessReconnect:0,verifiedAccessReconnect:0,table,tour};clients.push(state);
  // A Broadcast/read can finish before the writer's HTTP acknowledgement.
  // Credit its actual observation time once its source write is registered.
  const credit=(field,observation,predicate,measure,count)=>{
   if(!observation?.healthy)return;
   state[field]=state[field].filter(expected=>{
    if(!predicate(observation.value,expected,observation.requestOrder))return true;
    if(observation.at<expected.at){error('delivery_timestamp');return true;}
    if(measure==='realtime'){
     // Diagnostic only: retain signed timing when an in-flight read sees a
     // later commit. The two durations sum to this delivery's existing grade;
     // their independent percentiles must not be added together.
     stats.sourceToReadStart.push(observation.startedAt-expected.at);
     stats.tableRead.push(observation.at-observation.startedAt);
    }else if(measure==='snapshot'){
     stats.snapshotToReadStart.push(observation.startedAt-expected.at);
     stats.snapshotRead.push(observation.at-observation.startedAt);
     const publicationAt=Date.parse(observation.value.publishedAt);
     stats.snapshotToPublication.push(publicationAt-expected.at);
     stats.snapshotPublicationToRead.push(observation.startedAt-publicationAt);
    }
    stats[measure].push(observation.at-expected.at);state[count]++;return false;
   });
  };
  state.credit=()=>{credit('expected',state.handObservation,handIncludesWrite,'realtime','deliverySamples');credit('snapshotExpected',state.snapshotObservation,projectionIncludesWrite,'snapshot','snapshotSamples');};
  const healthy=()=>state.online&&!reconnecting&&(!revoking||tour!==uuid('10000000',20));
  let pageEpoch=0;
  const componentEpochs={tables:0,ranking:0,payout:0};
  const refreshSnapshot=async()=>{
   state.snapshotPending=false;if(!state.snapshotDirty.size)return;
   state.snapshotBusy=true;const epoch=pageEpoch,controller=new AbortController();state.snapshotController=controller;
   try{
    if(epoch!==pageEpoch)return;
    const requested=[...state.snapshotDirty];state.snapshotDirty.clear();state.snapshotLast=Date.now();
    const requestEpochs=Object.fromEntries(requested.map(section=>[section,componentEpochs[section]??0]));
    const requestOrder=++observationOrder;
    const value=await post('/rest/v1/rpc/get_public_tournament_viewer_snapshot_v2',{p_tournament_id:tour,p_table_ids:overview?[table]:[],p_sections:requested,p_known_revisions:state.known},false,'other',controller.signal);
    if(epoch!==pageEpoch)return;
    assert.equal(value.tournamentId,tour);if(revoking&&tour===uuid('10000000',20)&&value.access==='revoked'){state.known={};return;}assert.equal(value.access,'public');assert.equal(value.ok,true);
    for(const section of requested){
     if((section!=='tables'||overview)&&requestEpochs[section]!==componentEpochs[section]){
      delete value.sections[section];state.supersededSnapshotSections=(state.supersededSnapshotSections??0)+1;void snapshot([section]);continue;
     }
     assert.ok(value.sections[section]?.freshness);state.known[section]=value.sections[section].revision;
    }
    const tables=value.sections.tables;
    if(tables){state.snapshotObservation={value:tables.freshness,startedAt:state.snapshotLast,at:Date.now(),healthy:healthy(),requestOrder};state.credit();}
   }catch(cause){if(!cause.intentionalHudCancellation)error(reconnecting||!state.online?'offline_snapshot_read':'healthy_snapshot_read');}
   finally{controller.abort();state.snapshotBusy=false;}
  };
  const snapshotCoordinator=registerPublicTournamentRead(client,tour,()=>{const promise=refreshSnapshot();track(promise);return promise;});
  const snapshot=async(sections=['tables'])=>{
   for(const section of sections)state.snapshotDirty.add(section);
   if(state.snapshotDirty.size&&Date.now()<end+10000){state.snapshotPending=true;snapshotCoordinator.request();}
  };
  state.snapshot=snapshot;
  const clock=async()=>{try{const summary=await rpc('get_public_tournament_clock_summary',{p_tournament_id:tour});if(revoking&&tour===uuid('10000000',20)&&Array.isArray(summary)&&summary.length===0)return;assert.ok(parsePublicClockSummary(summary,tour),'Public clock must satisfy the production scoped parser');}catch{error('clock_read');}};
  state.clock=clock;
  const verifyPage=()=>{track(snapshot(['tables','ranking','payout']));track(clock());};
  const scheduleVerify=()=>{state.nextVerify=Date.now()+Math.round((state.online?30000:Math.min(30000,3000*2**Math.min(state.failures,4)))*(.9+Math.random()*.2));};
  const readCurrent=async()=>{
   if(overview)return;
   state.busy=true;const epoch=pageEpoch,sourceEpoch=componentEpochs.tables,controller=new AbortController(),startedAt=Date.now();state.tableController=controller;
   try{
    const reply=await readPublicTableRequest(status.API_URL,status.ANON_KEY,tour,table,controller.signal,async(url,init)=>{
     assert.equal(String(url),status.API_URL+'/rest/v1/rpc/get_public_tournament_table_live_or_last_hand_v2');
     assert.equal(init.headers.apikey,status.ANON_KEY);assert.equal(init.headers.Authorization,`Bearer ${status.ANON_KEY}`);
     try{return new Response(JSON.stringify(await post(new URL(url).pathname,JSON.parse(init.body),false,'current-table-rpc',init.signal)),{headers:{'Content-Type':'application/json'}});}
     catch(error){if(error?.intentionalHudCancellation)throw new DOMException('Aborted','AbortError');throw error;}
    });
    const value=reply.data;
    if(epoch!==pageEpoch)return;
    // Match TournamentLiveView's publicReadEpoch fence: even a payload that
    // contains a source write cannot be displayed after a newer table hint.
    if(value.access==='public'&&sourceEpoch!==componentEpochs.tables){state.supersededTableReads=(state.supersededTableReads??0)+1;return;}
    if(!(revoking&&tour===uuid('10000000',20)&&(value.access==='revoked'||value.error==='table_out_of_scope')))assert.equal(value.tableId,table);
    state.handObservation={value:value.hand,at:Date.now(),startedAt,healthy:healthy()};state.credit();
    state.failures=0;state.lastRead=Date.now();
   }catch(cause){if(!(controller.signal.aborted&&cause?.publicTableCallerCancelled===true)){const phase=reconnecting||!state.online?'offline':'healthy';const kind=phase+':'+classifyTableReadFailure(cause);tableFailureKinds[kind]=(tableFailureKinds[kind]??0)+1;state.failures++;error(phase+'_table_read');}}
   finally{controller.abort();state.busy=false;}
  };
  const tableCoordinator=registerPublicTournamentRead(client,tour,()=>{
   state.pending=false;const promise=readCurrent();track(promise);return promise;
  });
  const read=async()=>{if(!overview&&Date.now()<end+10000){state.pending=true;tableCoordinator.request();}};
  state.stopTableReads=()=>{tableCoordinator.stop();snapshotCoordinator.stop();};
  state.read=read;
  let hudTimerToken=0;
  const scheduleHudCheck=phase=>{
   if(state.hudActive){state.verifyAfterRead=true;return;}
   if(state.hudTimerPending)return;state.hudTimerPending=true;const token=++hudTimerToken;
   track((async()=>{
    recordHudRestoration(state,'verification-scheduled');
    await sleep(250+Math.random()*10000);if(token!==hudTimerToken)return;state.hudTimerPending=false;
    recordHudRestoration(state,'verification-started');
    if(state.hudActive){state.verifyAfterRead=true;return;}
    if(state.frozen)await verifyHud(phase);else await openHud('revocation-revalidate');
   })());
  };
  const finishHud=controller=>{
   if(state.hudController!==controller)return;
   state.hudActive=false;
   recordHudRestoration(state,'summary-finished');
   if(state.verifyAfterRead){
    state.verifyAfterRead=false;scheduleHudCheck('coalesced-access-verify');
   }
  };
  const readHudHistory=async(snapshot,phase,expectedRevocation)=>{
   state.historyController?.abort();const controller=new AbortController();state.historyController=controller;state.historyActive=true;state.historySnapshot=null;
   try{
    const history=await hud(tour,'history',undefined,phase+'-history',controller.signal);
    if(controller.signal.aborted||state.frozen!==snapshot)return;
    if(history.access==='public'&&['current','updating'].includes(history.state)){
     assert.ok(Array.isArray(history.handHistory)&&history.handHistory.length<=50);
     assert.ok(history.handHistory.every(h=>h.tableId===table),'History must remain in this tournament/table');
     state.historySnapshot=snapshot;
    }else{if(history.access==='revoked')state.frozen=null;if(!expectedRevocation)notReady('history',phase,history);}
   }catch(cause){if(!cause.intentionalHudCancellation)error('history_read');}
   finally{controller.abort();if(state.historyController===controller)state.historyActive=false;recordHudRestoration(state,'history-finished');}
  };
  const openHud=async(phase='user-open')=>{
   if(phase==='restoration-open')beginHudRestoration(state);
   if(phase==='revocation-revalidate'&&state.hudActive){state.verifyAfterRead=true;return;}
   if(phase!=='revocation-revalidate'){hudTimerToken++;state.hudTimerPending=false;state.verifyAfterRead=false;}
   state.hudController?.abort();state.historyController?.abort();state.historySnapshot=null;const controller=new AbortController();state.hudController=controller;state.hudActive=true;state.frozen=null;
   const epoch=++state.hudEpoch,expectedRevocation=revoking;
   const accessReconnect=state.accessReconnect;
   try{
    const value=await hud(tour,'summary',undefined,phase,controller.signal);
    if(epoch!==state.hudEpoch)return;
    state.lastHud=Date.now();
    if(value.access==='public'&&['current','updating'].includes(value.state)&&Number.isSafeInteger(value.counters?.publicHands)){
     state.frozen={revision:value.revision,accessSnapshot:value.accessSnapshot};
     state.hudCompletedEpoch=epoch;state.verifiedAccessReconnect=accessReconnect;
     track(readHudHistory(state.frozen,phase,expectedRevocation));
    }else{state.frozen=null;if(!expectedRevocation)notReady('summary',phase,value);}
   }catch(cause){if(!cause.intentionalHudCancellation){error('hud_read');if(epoch===state.hudEpoch){state.historyController?.abort();state.historySnapshot=null;state.frozen=null;}}}
   finally{controller.abort();finishHud(controller);}
  };
  state.openHud=openHud;
  const verifyHud=async(phase)=>{
   if(state.hudActive){state.verifyAfterRead=true;return;}
   const frozen=state.frozen;if(!frozen)return openHud('revocation-revalidate');
   state.hudController?.abort();const controller=new AbortController();state.hudController=controller;state.hudActive=true;
   const epoch=++state.hudEpoch,accessReconnect=state.accessReconnect;
   try{
    const value=await hud(tour,'summary',frozen.accessSnapshot,phase,controller.signal,()=>{
     if(epoch===state.hudEpoch){state.historyController?.abort();state.frozen=null;state.historySnapshot=null;}
    });
    if(epoch!==state.hudEpoch)return;
    if(value.access!=='public'||!['current','updating'].includes(value.state)){state.historyController?.abort();state.frozen=null;state.historySnapshot=null;if(!revoking)notReady('summary',phase,value);return;}
    if(value.accessChanged||!state.frozen){state.historyController?.abort();state.frozen={revision:value.revision,accessSnapshot:value.accessSnapshot};track(readHudHistory(state.frozen,phase+'-changed',revoking));}
    else assert.equal(state.frozen,frozen,'Access verification must retain the frozen HUD');
    if(epoch===state.hudEpoch&&state.frozen){state.hudCompletedEpoch=epoch;state.verifiedAccessReconnect=accessReconnect;}
   }catch(cause){if(!cause.intentionalHudCancellation){error('hud_read');if(epoch===state.hudEpoch){state.historyController?.abort();state.historySnapshot=null;state.frozen=null;}}}
   finally{controller.abort();finishHud(controller);}
  };
  state.verifyHud=verifyHud;
  client.channel(`public:tournament-viewer-v2:${tour}`,{config:{private:false}}).on('broadcast',{event:'changed'},message=>{
   if(message.payload?.tournamentId!==tour)return;
   const components=[...(message.payload.components??['tables'])];
   if(message.payload.handVisibilityOnly===true&&components.includes('visibility')){
    components.splice(components.indexOf('visibility'),1,'hand_visibility');
    if(!components.includes('tables'))components.push('tables');
   }
   for(const component of ['tables','ranking','payout'])if(components.includes(component))componentEpochs[component]++;
   if(components.some(c=>c==='visibility'||c==='hand_visibility')){pageEpoch++;state.tableController?.abort();state.snapshotController?.abort();state.handObservation=null;state.snapshotObservation=null;}
   if(components.some(c=>['tables','visibility','clock','ranking'].includes(c)))track(read());
   if(components.includes('visibility')){state.known={};verifyPage();}
   else {if(components.includes('hand_visibility'))delete state.known.tables;const sections=components.filter(c=>['tables','ranking','payout'].includes(c)&&(c!=='tables'||overview));if(sections.length)track(snapshot(sections));if(components.includes('clock')||components.includes('ranking'))track(clock());}
  }).subscribe(s=>{
   const epoch=++pageEpoch;state.tableStatus=s;state.online=s==='SUBSCRIBED';scheduleVerify();
   if(!state.online&&started&&Date.now()<end&&!reconnecting)unexpectedDisconnects++;
   if(state.online){
    const rejoined=state.joined;if(rejoined){stats.reconnects++;state.reconnected++;state.tableController?.abort();state.snapshotController?.abort();state.known={};state.snapshotDirty.clear();}state.joined=true;track(read());
    if(!rejoined)verifyPage();
    else {
     track(snapshot(['tables']));
     track((async()=>{await sleep(250+Math.random()*10000);if(epoch===pageEpoch&&state.online){track(read());track(snapshot(['ranking','payout']));track(clock());}})());
    }
   }
  });
  client.channel('public:player-hud-access-v1',{config:{private:false}}).on('broadcast',{event:'revoked'},()=>{
   ++state.hudEpoch;state.historyController?.abort();state.historySnapshot=null;state.frozen=null;state.hudController?.abort();state.revocations++;stats.revocationClears++;
   recordHudRestoration(state,'revoked');
   // Same immediate generation invalidation/abort, one physical in-flight
   // lifecycle and one queued recheck as UI. Genuine failures retain provenance.
   scheduleHudCheck('revocation-revalidate');
  }).subscribe(s=>{
   state.accessStatus=s;state.accessOnline=s==='SUBSCRIBED';if(!state.accessOnline&&started&&Date.now()<end&&!reconnecting)unexpectedDisconnects++;
   if(state.accessOnline){if(state.accessJoined){state.accessReconnect++;scheduleHudCheck('reconnect-verify');}state.accessJoined=true;}
  });
  // Admit at most 50 new viewers/second, then hold the entire target audience
  // for the full measured duration. Mass reconnect remains simultaneous.
  if(i%25===24)await sleep(500);
 }
 try{await until(async()=>clients.every(c=>c.online&&c.accessOnline),60000,'Not every viewer joined both live channels');}
 catch(error){
  const counts=field=>Object.fromEntries([...new Set(clients.map(c=>c[field]))].map(s=>[s,clients.filter(c=>c[field]===s).length]));
  const diagnostic={phase:'viewer-join-failure',scenario,viewers,table:counts('tableStatus'),access:counts('accessStatus'),bothSubscribed:clients.filter(c=>c.online&&c.accessOnline).length};
  writeFileSync('output/hud-scale/join-failure.json',JSON.stringify(diagnostic,null,2));console.log(JSON.stringify(diagnostic));throw error;
 }
 // Stagger opens so this tests a real HTTP audience, not a single service cache call.
 for(let i=0;i<clients.length;i+=25)await Promise.all(clients.slice(i,i+25).map(async c=>{await c.openHud('initial-open');await c.verifyHud('initial-verify');}));
 await until(async()=>clients.every(c=>!c.historyActive),15000,'Initial independent history reads did not settle');
 started=Date.now();end=started+duration*1000;coverageAt=started;
 const writer=async(n)=>{
  // All measured writes must follow the9M source-matrix fixture hand. Otherwise
  // a stale higher-numbered fixture could falsely satisfy later-hand delivery.
  let number=(scenario==='concentrated'?20_000_000:overview?80_000_000:50_000_000)+n*100000,step=0,hand=null,operation=crypto.randomUUID();
  while(Date.now()<end&&!stopping){
   const start=Date.now();
   try{
    const value=await rpc('fixture_scale_step_once_v1',{p_operation:operation,p_tournament_id:uuid('10000000',n),p_number:number,p_step:step,p_hand_id:hand},true);
    const event={handId:value.handId,number,step,at:Date.parse(value.sourceWrittenAt)};
    hand=value.handId;stats.sourceWrites++;const ackOrder=++observationOrder;
    // The intent is committed and acknowledged. Advance independently of
    // delivery checks so an invariant failure cannot replay a source action.
    if(step===5){
     const completed=hand,written=event.at;
     track((async()=>{try{
      await until(()=>rpc('fixture_scale_hand_ready_v1',{p_hand_id:completed},true),15000,'projection_timeout');
      const endToEndMs=Date.now()-written,probe=readyProbeTimes.get(completed);
      assert.ok(probe&&probe.observedAt>=written,'Invalid fixture readiness clock');
      workerProbeDiagnostics.push({scenario,endToEndMs,serverReadyUpperBoundMs:probe.observedAt-written,firstReadyReadMs:probe.readMs});
      stats.projection.push(endToEndMs);
     }catch{error('projection_timeout');}finally{readyProbeTimes.delete(completed);}})());
     number++;step=0;hand=null;
    }else step++;
    operation=crypto.randomUUID();
    if(!reconnecting&&(!revoking||n!==20))for(const c of clients)if(c.tour===uuid('10000000',n)&&c.online&&c.accessOnline){
     if(!overview){c.expected.push(event);expectedDeliveries++;}
     assert.match(value.generation,/^\d+$/);assert.equal(typeof value.generationDeferred,'boolean');
     if(overview){c.snapshotExpected.push({at:event.at,generation:value.generation,deferred:value.generationDeferred,ackOrder});snapshotExpected++;}
     c.credit();
    }
   }catch{error('source_write');}
   await sleep(Math.max(0,1000-(Date.now()-start)));
  }
  // Finish the fixture's final partial hand before starting the next scenario;
  // an old in-progress hand must not shadow the next tour's completed hand.
  while(hand&&step>0&&step<=5){await rpc('fixture_scale_step_once_v1',{p_operation:operation,p_tournament_id:uuid('10000000',n),p_number:number,p_step:step,p_hand_id:hand},true);step++;operation=crypto.randomUUID();}
 };
 const writers=Array.from({length:tourCount},(_,i)=>writer(i+1));
 // A separate serial writer edits a historical hand while the full audience
 // and normal 1Hz/tour source writers remain active. It never changes the
 // watched hand-number delivery oracle. Each proof mutation keeps the hand's
 // source revision fixed; readiness must match the receipt's full fingerprint.
 const amendmentSamples=[];
 const amendmentWriter=(async()=>{
  let cursor=0;
  while(Date.now()<end-5000&&!stopping){
   const kind=amendmentKinds[cursor%amendmentKinds.length],operation=crypto.randomUUID();
   currentAmendment={kind,operation,launchedAt:Date.now()};
   try{
    const receipt=await rpc('fixture_scale_amend_once_v1',{p_operation:operation,p_hand_id:uuid('20000000',1),p_kind:kind},true);
    assert.equal(receipt.operation,operation);assert.equal(receipt.kind,kind);
    const written=Date.parse(receipt.sourceWrittenAt);assert.ok(Number.isFinite(written)&&written>=started);
    currentAmendment.sourceWrittenAt=written;
    await until(()=>rpc('fixture_scale_amend_ready_v1',{p_operation:operation},true),15000,'amendment_projection_timeout');
    const endToEndMs=Date.now()-written;assert.ok(Number.isFinite(endToEndMs)&&endToEndMs>=0,'Invalid amendment timing clock');
    currentAmendment.readyObservedAt=Date.now();
    amendmentSamples.push({kind,endToEndMs,sourceRevision:receipt.sourceRevision,sourceWrittenAt:receipt.sourceWrittenAt});
    cursor++;
   }catch{error('amendment_projection_or_write');return;}
   await sleep(1000);
  }
 })();
 let restarted=false,withdrawn=false,lastHealth=0,lastProgress=0,revokedClients=0,reconnectedClients=0,restoredClients=0;
 while(Date.now()<end){
  const tick=Date.now(),online=clients.filter(c=>c.online&&c.accessOnline).length;
  if(!reconnecting&&!revoking){minHealthyOnline=Math.min(minHealthyOnline,online);healthySocketMs+=online*(tick-coverageAt);healthyWallMs+=tick-coverageAt;}
  coverageAt=tick;expireDeliveries();
  if(!withdrawn&&Date.now()-started>duration*250){
   withdrawn=true;revoking=true;suspendDeliveries(uuid('10000000',20));const before=clients.map(c=>c.revocations);
   await rpc('fixture_scale_visibility_v1',{p_tournament_id:uuid('10000000',20),p_hidden:true},true);
   await until(async()=>clients.every((c,i)=>c.revocations>before[i]),15000,'Cross-tour HUD revocation missed at least one viewer');
   revokedClients=clients.filter((c,i)=>c.revocations>before[i]).length;
   await sleep(duration===1800?5000:1000);
   await rpc('fixture_scale_visibility_v1',{p_tournament_id:uuid('10000000',20),p_hidden:false},true);
   await until(async()=>{const value=await hud(uuid('10000000',1));return value.access==='public'&&['current','updating'].includes(value.state);},15000,'Public restoration not ready');
   // Explicit user reopen after the preparation state, not background HUD polling.
   for(let i=0;i<clients.length;i+=25)await Promise.all(clients.slice(i,i+25).map(c=>c.openHud('restoration-open')));
   // Track each real summary+history recovery once. A later valid withdrawal
   // must clear that viewer again, but cannot erase its earlier recovery proof.
   // Keep the same15s window after the explicit reopen wave, without blocking
   // reconnect/health scheduling or requiring every HUD to be stable at once.
   restorationDeadline=Date.now()+15000;
   for(const c of clients)setHudRestorationDeadline(c,restorationDeadline);
   revoking=false;coverageAt=Date.now();
  }
  checkRestoration();
  if(!restarted&&Date.now()-started>duration*500){
   restarted=true;reconnecting=true;suspendDeliveries();const before=clients.map(c=>c.reconnected);for(const c of clients){c.online=false;c.accessOnline=false;}
   await run('docker',['restart',`supabase_realtime_${project}`]);
   await configureLocalRealtime(project);
   await until(async()=>clients.every((c,i)=>c.online&&c.accessOnline&&c.reconnected>before[i]),60000,'Mass reconnect failed');
   reconnectedClients=clients.filter((c,i)=>c.reconnected>before[i]).length;reconnecting=false;coverageAt=Date.now();
  }
  for(const c of clients){
   const now=Date.now();
   if(now>=c.nextVerify){c.nextVerify=now+Math.round((c.online?30000:Math.min(30000,3000*2**Math.min(c.failures,4)))*(.9+Math.random()*.2));track(c.read());track(c.snapshot(['tables','ranking','payout']));track(c.clock());}
   if(now-c.lastHud>60000){c.lastHud=now;track(c.openHud('simulated-user-reopen-60s'));}
  }
  if(Date.now()-lastHealth>5000){lastHealth=Date.now();track((async()=>{try{const h=await rpc('get_public_hud_projection_health_v1',{},true);health.push({at:Date.now(),jobs:h.jobs,oldestAgeMs:h.oldestLiveChangeAt?Math.max(0,Date.now()-Date.parse(h.oldestLiveChangeAt)):0,expiredLeases:h.expiredLeases,failedJobs:h.failedJobs});}catch{error('health_read');}})());}
  if(Date.now()-lastProgress>60000){
   lastProgress=Date.now();console.log(JSON.stringify({phase:'load-progress',scenario,elapsedSeconds:Math.floor((Date.now()-started)/1000),viewers,sourceWrites:stats.sourceWrites-offset.sourceWrites,projectionSamples:stats.projection.length-offset.projection,errors:stats.errors}));
  }
  await sleep(250);
 }
 await Promise.all(writers);
 await amendmentWriter;
 if(restorationDeadline!==null){
  try{await until(async()=>clients.every(c=>c.restoration?.receiptAt!=null),Math.max(1,restorationDeadline-Date.now()),'Every restored HUD and independent history must recover within the original15s window');}
  catch(error){restorationFailure=hudRestorationFailure(clients,scenario);throw error;}
  restoredClients=clients.filter(c=>c.restoration?.receiptAt!=null).length;
 }
 const drainUntil=Date.now()+10000;
 while(clients.some(c=>c.expected.length||c.snapshotExpected.length)&&Date.now()<drainUntil){expireDeliveries();await sleep(200);}
 expireDeliveries();clearInterval(resourceTimer);
 await until(async()=>tasks.size===0&&clients.every(c=>!c.pending&&!c.busy&&!c.snapshotPending&&!c.snapshotBusy),30000,'Pending transport/timer work did not drain');
 for(const c of clients)c.stopTableReads();
 await Promise.all(clients.map(c=>c.client.removeAllChannels()));
 const sample=key=>stats[key].slice(offset[key]);
 const apiSummary=summaryApiReport(sample('summaryHttp'));
 const report={scenario,viewers,durationSeconds:duration,summaryTimingVersion:'per-rpc-complete-body-and-ready-v1',apiSummary,httpSummarySamples:apiSummary.all.samples,httpSummaryP95Ms:apiSummary.all.p95Ms,readySummarySamples:apiSummary.ready.samples,readySummaryP95Ms:apiSummary.ready.p95Ms,logicalHudSamples:sample('summary').length,logicalHudP95Ms:percentile(sample('summary'),.95),logicalHudMaxMs:maximumSample(sample('summary')),healthyRealtimeSamples:sample('realtime').length,healthyRealtimeP95Ms:percentile(sample('realtime'),.95),expectedDeliveries,excludedForPlannedFault,missedDeliveries,pendingDeliveries:clients.reduce((n,c)=>n+c.expected.length,0),minSamplesPerViewer:Math.min(...clients.map(c=>c.deliverySamples)),minHealthyOnline,unexpectedDisconnects,healthySocketCoverage:healthyWallMs?healthySocketMs/(healthyWallMs*viewers):0,projectionSamples:sample('projection').length,projectionMaxMs:maximumSample(sample('projection')),projectedHandsPerSecond:sample('projection').length/duration,sourceWrites:stats.sourceWrites-offset.sourceWrites,health,errors:{...stats.errors},reconnects:stats.reconnects-offset.reconnects,reconnectedClients,revokedClients,revocationClears:stats.revocationClears-offset.revocationClears};
 reports.push(report);save('running');
 report.notReadyOutcomes=notReadyOutcomes;save('running');
 report.amendments={source:'real source triggers and production projector; selected contribution/job readiness, not an independent totals oracle',samples:amendmentSamples.length,maxMs:maximumSample(amendmentSamples.map(s=>s.endToEndMs)),byKind:Object.fromEntries(amendmentKinds.map(kind=>{const samples=amendmentSamples.filter(s=>s.kind===kind);return [kind,{samples:samples.length,maxMs:maximumSample(samples.map(s=>s.endToEndMs))}];})),changesDuringAudienceHold:amendmentSamples.every(s=>Date.parse(s.sourceWrittenAt)<=end)};save('running');
 const probes=workerProbeDiagnostics.filter(p=>p.scenario===scenario);
 report.workerProbeDiagnostics={samples:probes.length,serverReadyUpperBoundMaxMs:maximumSample(probes.map(p=>p.serverReadyUpperBoundMs)),firstReadyReadP95Ms:percentile(probes.map(p=>p.firstReadyReadMs),.95),slowest:[...probes].sort((a,b)=>b.endToEndMs-a.endToEndMs).slice(0,10),grading:'original end-to-end maximum <=5000ms; diagnostic clock does not replace it'};save('running');
 report.viewKind=overview?'visible-overview-grid':'watched-felt-hidden-hub';save('running');
 report.currentTableReader={source:'production-readPublicTableRequest',transport:'postgrest/get_public_tournament_table_live_or_last_hand_v2',anonymousAuthority:true,preQueryAdmissionMs:0,responseCache:false,requestTimeoutMs:5000,sourceHintEpochFence:true,supersededReads:clients.reduce((n,c)=>n+(c.supersededTableReads??0),0)};save('running');
 report.snapshotEpochFence={perComponent:true,hiddenHubIgnoresNormalTableHints:!overview,supersededSections:clients.reduce((n,c)=>n+(c.supersededSnapshotSections??0),0)};save('running');
 report.watchedReadCoordinator={source:'production-registerPublicTournamentRead',minIntervalMs:PUBLIC_SPECTATOR_READ_INTERVAL_MS,hintJitterMs:PUBLIC_SPECTATOR_HINT_JITTER_MS,snapshotUsesSameCoordinator:true,snapshotUsesSameImplementation:true,pendingAtGrading:clients.filter(c=>c.pending||c.busy||c.snapshotPending||c.snapshotBusy).length};report.requestDispatch=dispatchReport();save('running');
 report.watchedDeliveryTiming={samples:sample('tableRead').length,sourceToReadStartP95Ms:percentile(sample('sourceToReadStart'),.95),readToObservationP95Ms:percentile(sample('tableRead'),.95),readsStartedBeforeSource:sample('sourceToReadStart').filter(ms=>ms<0).length,perDeliveryIdentity:'sourceToReadStart + readToObservation = gradedRealtime',independentPercentilesAreNotAdditive:true};save('running');
 report.requestAccounting=requestAccounting;
 report.hudRecovery={restorationMethod:'per-viewer-owned-summary-and-exact-history-receipt-v1',restorationWindowMs:15000,restorationDeadline,receiptMaxElapsedMs:maximumSample(clients.map(c=>c.restoration?.receiptAt==null?0:c.restoration.receiptAt-c.restoration.launchedAt)),summaryAndHistoryIndependent:true,historyRequiredForAcceptance:true,restoredClients,finalCurrentClients:clients.filter(c=>c.frozen&&c.hudCompletedEpoch===c.hudEpoch&&!c.hudActive&&!c.historyActive&&c.historySnapshot===c.frozen&&!c.verifyAfterRead&&!c.hudTimerPending).length,reconnectVerifiedClients:clients.filter(c=>c.accessReconnect>0&&c.verifiedAccessReconnect===c.accessReconnect).length,pendingHudRequests:clients.filter(c=>c.hudActive||c.historyActive||c.verifyAfterRead||c.hudTimerPending).length};save('running');
 report.admission={maxNewViewersPerSecond:50,initialRequestErrorsIncluded:true,fullAudienceHoldSeconds:duration};save('running');
 report.snapshotDelivery={expected:snapshotExpected,excludedForPlannedFault:snapshotExcluded,missed:snapshotMissed,pending:clients.reduce((n,c)=>n+c.snapshotExpected.length,0),samples:sample('snapshot').length,p95Ms:percentile(sample('snapshot'),.95),minSamplesPerViewer:Math.min(...clients.map(c=>c.snapshotSamples)),sourceToReadStartP95Ms:percentile(sample('snapshotToReadStart'),.95),readToObservationP95Ms:percentile(sample('snapshotRead'),.95),sourceToCoveringPublicationP95Ms:percentile(sample('snapshotToPublication'),.95),coveringPublicationToReadStartP95Ms:percentile(sample('snapshotPublicationToRead'),.95),publicationTimingScope:'Chosen covering publication, not earliest possible publication; signed timings; independent percentiles not additive',timingIdentity:'Per delivery: sourceToReadStart + readToObservation = existing snapshot grade; independent percentiles are not additive'};save('running');
 eventLoop.disable();report.generator={eventLoopP95Ms:eventLoop.percentile(95)/1e6,eventLoopMaxMs:eventLoop.max/1e6,utilization:nodePerformance.eventLoopUtilization(utilizationStart).utilization};
 const cpu=process.cpuUsage(cpuStart);Object.assign(report.generator,{cpuMs:(cpu.user+cpu.system)/1000,elapsedMs:performance.now()-generatorStart,transport:httpTransport.metrics()});
 report.logicalHudPhases=Object.fromEntries(Object.entries(phases).map(([name,values])=>[name,{samples:values.length,p95Ms:percentile(values,.95)}]));save('running');
 report.transportErrors={...stats.transportErrors};save('running');
 report.runtimeFailures={...runtimeFailures};report.rpcOutcomes={...rpcOutcomes};report.hudFailureKinds={...hudFailureKinds};report.tableFailureKinds={...tableFailureKinds};report.transportTimings=Object.fromEntries(Object.entries(transportTimings).map(([key,value])=>[key,Object.fromEntries(Object.entries(value).map(([name,values])=>[name,{samples:values.length,p95Ms:percentile(values,.95)}]))]));save('running');
 console.log(JSON.stringify(report));
 assert.ok(report.httpSummarySamples>=viewers);assert.ok(report.readySummarySamples>=viewers,'Enough ready summary API responses are required');assert.ok(report.logicalHudSamples>=viewers);if(!overview)assert.ok(report.healthyRealtimeSamples>0);assert.ok(report.projectionSamples>0);
 assert.ok(report.reconnects>=viewers,'Every WebSocket client must reconnect');
 assert.ok(report.revocationClears>=viewers,'Every HUD must clear for withdrawal in another contributing tour');
 assert.equal(report.revokedClients,viewers);assert.equal(report.reconnectedClients,viewers);
 assert.equal(report.hudRecovery.restoredClients,viewers);assert.equal(report.hudRecovery.finalCurrentClients,viewers);assert.equal(report.hudRecovery.reconnectVerifiedClients,viewers);assert.equal(report.hudRecovery.pendingHudRequests,0);
 assert.equal(report.minHealthyOnline,viewers);assert.equal(report.healthySocketCoverage,1);
 assert.equal(report.unexpectedDisconnects,0);
 assert.equal(report.missedDeliveries,0);assert.equal(report.pendingDeliveries,0);
 assert.equal(snapshotMissed,0);assert.equal(report.snapshotDelivery.pending,0);assert.equal(report.snapshotDelivery.samples,snapshotExpected-snapshotExcluded);
 if(overview){assert.ok(report.snapshotDelivery.p95Ms<=3000,'Visible overview p95 > 3s');assert.ok(report.snapshotDelivery.minSamplesPerViewer>=Math.floor(duration/10));}
 assert.equal(report.healthyRealtimeSamples,report.expectedDeliveries-report.excludedForPlannedFault);
 if(!overview)assert.ok(report.minSamplesPerViewer>=Math.floor(duration/10),'Every viewer must observe enough real writes');
 assert.ok(report.sourceWrites>=tourCount*duration*.9,'Source write rate fell below the defined load');
 assert.ok(report.httpSummaryP95Ms<=1000,'HTTP summary p95 > 1s');assert.ok(report.readySummaryP95Ms<=1000,'Ready HTTP summary p95 > 1s');assert.ok(report.logicalHudMaxMs<=PUBLIC_HUD_REVALIDATION_WINDOW_MS,'Logical HUD preparation/revalidation exceeded its5s budget');if(!overview)assert.ok(report.healthyRealtimeP95Ms<=3000,'Visible felt p95 > 3s');assert.ok(report.projectionMaxMs<=5000,'Projection > 5s');
 assert.equal(stats.errors.source_write??0,0);assert.equal(stats.errors.projection_timeout??0,0);
 assert.equal(stats.errors.amendment_projection_or_write??0,0);
 assert.ok(report.amendments.samples>0);assert.ok(report.amendments.maxMs<=5000,'Amendment projection > 5s');assert.equal(report.amendments.changesDuringAudienceHold,true);
 if(duration===1800)for(const kind of amendmentKinds)assert.ok(report.amendments.byKind[kind].samples>0,`Missing loaded amendment case: ${kind}`);
 assert.equal(stats.errors.hud_read??0,0,'HUD HTTP failures are not excluded from acceptance');
 for(const kind of ['healthy_table_read','healthy_snapshot_read','clock_read','history_read','hud_not_ready','history_not_ready','health_read','delivery_timestamp'])assert.equal(stats.errors[kind]??0,0,kind);
}
if(viewers===1000&&targetDuration===1800){
 const seed=JSON.parse(readFileSync('output/hud-scale/seed.json','utf8'));
 assert.equal(seed.handsPerPlayer,1_000_000);
 if(writerMethod==='canonical-hand-observers-paired-v1')writerQualification=readMatchedWriterQualification(seed.handsPerPlayer);
 else assert.ok(seed.writer.p95OverheadPercent<=10,'Fixture source transaction marking overhead > 10%');
}
assert.equal(reports.length,3);save('passed');
