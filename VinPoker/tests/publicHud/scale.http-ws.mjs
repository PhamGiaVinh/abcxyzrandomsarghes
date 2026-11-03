import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,appendFileSync} from 'node:fs';
import {monitorEventLoopDelay,performance as nodePerformance} from 'node:perf_hooks';
import {parseEnv} from 'node:util';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createClient} from '@supabase/supabase-js';
import {configureLocalRealtime} from './scale.realtime.mjs';
import {handIncludesWrite,projectionIncludesWrite} from './scale.delivery.mjs';
const status=parseEnv(readFileSync(process.env.PUBLIC_HUD_STATUS_FILE,'utf8'));
const project=process.env.PUBLIC_HUD_STACK_PROJECT;
if(status.API_URL!=='http://127.0.0.1:54321'||!/^hud-scale-[a-z0-9-]+$/.test(project))throw Error('Local isolated stack required');
const viewers=Number(process.env.PUBLIC_HUD_SCALE_VIEWERS??1000),duration=Number(process.env.PUBLIC_HUD_SCALE_SECONDS??1800);
if(!Number.isInteger(viewers)||viewers<1||viewers>1000||duration<30||duration>1800)throw Error('Invalid load bounds');
const run=promisify(execFile),sleep=ms=>new Promise(r=>setTimeout(r,ms));
const uuid=(prefix,n)=>`${prefix}-0000-4000-8000-${n.toString(16).padStart(12,'0')}`;
const player=uuid('30000000',1),stats={summary:[],realtime:[],snapshot:[],projection:[],errors:{},transportErrors:{},reconnects:0,sourceWrites:0,revocationClears:0};
let stopping=false;
let phases={},transportTimings={},observationOrder=0;
const error=kind=>{stats.errors[kind]=(stats.errors[kind]??0)+1;};
async function post(path,body,privileged=false,phase='other'){
 const key=privileged?status.SERVICE_ROLE_KEY:status.ANON_KEY,start=performance.now();
 const response=await fetch(status.API_URL+path,{method:'POST',headers:{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(10000)}).catch(error=>{
  const kind=`${phase}:${path.split('/').at(-1)}:${error?.name==='TimeoutError'?'timeout':'transport'}`;stats.transportErrors[kind]=(stats.transportErrors[kind]??0)+1;throw error;
 });
 const timingKey=phase+':'+path;
 const timings=transportTimings[timingKey]??={headers:[],upstream:[],proxy:[]};
 timings.headers.push(performance.now()-start);
 for(const [field,header] of [['upstream','x-kong-upstream-latency'],['proxy','x-kong-proxy-latency']]){const value=response.headers.get(header);if(value!==null&&Number.isFinite(Number(value)))timings[field].push(Number(value));}
 if(!response.ok){let code='';try{const body=await response.json();if(typeof body.code==='string'&&/^[A-Z0-9_]{1,40}$/.test(body.code))code=':'+body.code;}catch{}const kind=`${phase}:${path.split('/').at(-1)}:HTTP_${response.status}${code}`;stats.transportErrors[kind]=(stats.transportErrors[kind]??0)+1;throw Error(`HTTP_${response.status}`);}
 const value=await response.json();if(path.endsWith('public-player-hud')&&body.mode==='summary'){const elapsed=performance.now()-start;stats.summary.push(elapsed);(phases[phase]??=[]).push(elapsed);}
 return value;
}
const rpc=(name,args,privileged=false)=>post('/rest/v1/rpc/'+name,args,privileged);
const hud=(tour,mode='summary',accessSnapshot,phase)=>post('/functions/v1/public-player-hud',{tournament_id:tour,player_id:player,mode,access_snapshot:accessSnapshot},false,phase);
async function until(fn,timeout,label){const start=Date.now();while(Date.now()-start<timeout){if(await fn())return;await sleep(200);}throw Error(label);}
const percentile=(values,p)=>values.length?[...values].sort((a,b)=>a-b)[Math.min(values.length-1,Math.floor(values.length*p))]:null;
const denied=await fetch(status.API_URL+'/rest/v1/rpc/claim_public_hud_jobs_v1',{method:'POST',headers:{apikey:status.ANON_KEY,Authorization:`Bearer ${status.ANON_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({p_limit:1})});
assert.ok([401,403].includes(denied.status),'Anonymous caller must not claim private jobs');
await rpc('fixture_scale_visibility_v1',{p_tournament_id:uuid('10000000',20),p_hidden:true},true);
const privilegedHeader=await post('/functions/v1/public-player-hud',{tournament_id:uuid('10000000',20),player_id:player,mode:'summary'},true);
assert.equal(privilegedHeader.access,'revoked','Service header must not widen the public Edge read');
await rpc('fixture_scale_visibility_v1',{p_tournament_id:uuid('10000000',20),p_hidden:false},true);
await until(async()=>{const value=await hud(uuid('10000000',1));return value.access==='public'&&['current','updating'].includes(value.state);},60000,'Lifetime visibility revalidation did not recover');
const reports=[];
const save=(state)=>writeFileSync('output/hud-scale/http-ws.json',JSON.stringify({kind:'REAL_LOCAL_HTTP_SUPABASE_WEBSOCKET_POSTGRESQL',productionCapacityClaim:false,qualification:state==='passed'&&viewers===1000&&duration===1800,status:state,reports,
 partial:state==='failed'?{incomplete:true,errors:stats.errors,transportErrors:stats.transportErrors,summarySamples:stats.summary.length,observedSummaryP95Ms:percentile(stats.summary,.95),tableSamples:stats.realtime.length,snapshotSamples:stats.snapshot.length,sourceWrites:stats.sourceWrites}:undefined},null,2));
save('running');
process.on('uncaughtExceptionMonitor',()=>save('failed'));
if(viewers===1000&&duration===1800){
 const seed=JSON.parse(readFileSync('output/hud-scale/seed.json','utf8'));
 assert.equal(seed.handsPerPlayer,1_000_000);
 assert.ok(seed.writer.p95OverheadPercent<=10,'Committed fixture marking overhead > 10%; stop before the long soak');
}
for(const scenario of ['concentrated','distributed']){
 phases={};transportTimings={};const eventLoop=monitorEventLoopDelay({resolution:20});eventLoop.enable();const utilizationStart=nodePerformance.eventLoopUtilization();
 const offset={summary:stats.summary.length,realtime:stats.realtime.length,snapshot:stats.snapshot.length,projection:stats.projection.length,reconnects:stats.reconnects,revocationClears:stats.revocationClears,sourceWrites:stats.sourceWrites};
 const tourCount=scenario==='concentrated'?1:20,clients=[],tasks=new Set();
 let end=Infinity,reconnecting=false,revoking=false,started=0;
 let expectedDeliveries=0,excludedForPlannedFault=0,missedDeliveries=0,minHealthyOnline=viewers,healthySocketMs=0,healthyWallMs=0,coverageAt=0,unexpectedDisconnects=0;
 let snapshotExpected=0,snapshotExcluded=0,snapshotMissed=0;
 const suspendDeliveries=(onlyTour)=>{for(const c of clients)if(!onlyTour||c.tour===onlyTour){excludedForPlannedFault+=c.expected.length;c.expected=[];snapshotExcluded+=c.snapshotExpected.length;c.snapshotExpected=[];}};
 const expireDeliveries=()=>{for(const c of clients){for(const [field,measure] of [['expected','realtime'],['snapshotExpected','snapshot']]){const remaining=[];for(const e of c[field]){if(Date.now()-e.at>10000){if(field==='expected')missedDeliveries++;else snapshotMissed++;stats[measure].push(Date.now()-e.at);}else remaining.push(e);}c[field]=remaining;}}};
 const health=[];
 const track=promise=>{tasks.add(promise);promise.finally(()=>tasks.delete(promise));};
 const resourceTimer=setInterval(()=>{
  track(fetch(status.API_URL+'/functions/v1/_internal/metric',{signal:AbortSignal.timeout(3000)}).then(async response=>{if(!response.ok)return;const value=await response.json();const safe={at:Date.now(),scenario};for(const key of ['activeUserWorkersCount','retiredUserWorkersCount','receivedRequestsCount','handledRequestsCount'])if(Number.isSafeInteger(value[key]))safe[key]=value[key];appendFileSync('output/hud-scale/edge-runtime.jsonl',JSON.stringify(safe)+'\n');}).catch(()=>{}));
  track(run('docker',['stats','--no-stream','--format','{{json .}}',`supabase_db_${project}`,`supabase_realtime_${project}`,`supabase_edge_runtime_${project}`,`supabase_kong_${project}`,`supabase_rest_${project}`]).then(({stdout})=>appendFileSync('output/hud-scale/resource-samples.jsonl',stdout)).catch(()=>error('resource_sample')));
  const query="SELECT jsonb_build_object('at',clock_timestamp(),'backends',(SELECT jsonb_agg(to_jsonb(s)) FROM (SELECT state,wait_event_type,count(*) FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() GROUP BY state,wait_event_type) s),'waitingLocks',(SELECT count(*) FROM pg_locks WHERE NOT granted));";
  track(run('psql',['-h','127.0.0.1','-p','54322','-U','postgres','-d','postgres','-w','-X','-qAt','-c',query],{env:{...process.env,PGPASSWORD:'postgres'}}).then(({stdout})=>appendFileSync('output/hud-scale/pg-pressure.jsonl',stdout)).catch(()=>error('pg_pressure_sample')));
 },5000);
 // Wait for the actual cron-dispatched Edge projector; no in-process worker shortcut.
 await until(async()=>{const reply=await rpc('get_public_tournament_viewer_snapshot_v2',{p_tournament_id:uuid('10000000',1),p_table_ids:[uuid('50000000',1)],p_sections:['tables'],p_known_revisions:{}});return reply.sections?.tables?.freshness?.state==='current';},60000,'Initial real worker publication unavailable');
 for(let i=0;i<viewers;i++){
  const n=1+i%tourCount,tour=uuid('10000000',n),table=uuid('50000000',n);
  const client=createClient(status.API_URL,status.ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},realtime:{params:{eventsPerSecond:100}}});
  const state={client,online:false,accessOnline:false,accessJoined:false,tableStatus:'INITIAL',accessStatus:'INITIAL',joined:false,reconnected:0,revocations:0,deliverySamples:0,snapshotSamples:0,expected:[],snapshotExpected:[],snapshotBusy:false,snapshotDirty:new Set(),known:{},snapshotLast:0,busy:false,pending:false,lastRead:0,nextVerify:Infinity,lastHud:0,failures:0,frozen:null,hudEpoch:0,table,tour};clients.push(state);
  // A Broadcast/read can finish before the writer's HTTP acknowledgement.
  // Credit its actual observation time once its source write is registered.
  const credit=(field,observation,predicate,measure,count)=>{
   if(!observation?.healthy)return;
   state[field]=state[field].filter(expected=>{
    if(!predicate(observation.value,expected,observation.requestOrder))return true;
    assert.ok(observation.at>=expected.at,'Observed source timestamp is in the future');
    stats[measure].push(observation.at-expected.at);state[count]++;return false;
   });
  };
  state.credit=()=>{credit('expected',state.handObservation,handIncludesWrite,'realtime','deliverySamples');credit('snapshotExpected',state.snapshotObservation,projectionIncludesWrite,'snapshot','snapshotSamples');};
  const healthy=()=>state.online&&!reconnecting&&(!revoking||tour!==uuid('10000000',20));
  const snapshot=async(sections=['tables'])=>{
   for(const section of sections)state.snapshotDirty.add(section);
   if(state.snapshotBusy)return;state.snapshotBusy=true;
   try{
    await sleep(Math.max(0,1000-(Date.now()-state.snapshotLast)));
    const requested=[...state.snapshotDirty];state.snapshotDirty.clear();state.snapshotLast=Date.now();
    const requestOrder=++observationOrder;
    const value=await rpc('get_public_tournament_viewer_snapshot_v2',{p_tournament_id:tour,p_table_ids:[],p_sections:requested,p_known_revisions:state.known});
    assert.equal(value.tournamentId,tour);if(revoking&&tour===uuid('10000000',20)&&value.access==='revoked'){state.known={};return;}assert.equal(value.access,'public');assert.equal(value.ok,true);
    for(const section of requested){assert.ok(value.sections[section]?.freshness);state.known[section]=value.sections[section].revision;}
    const tables=value.sections.tables;
    if(tables){state.snapshotObservation={value:tables.freshness,at:Date.now(),healthy:healthy(),requestOrder};state.credit();}
   }catch{error(reconnecting||!state.online?'offline_snapshot_read':'healthy_snapshot_read');}
   finally{state.snapshotBusy=false;if(state.snapshotDirty.size&&Date.now()<end+10000)track(snapshot([]));}
  };
  state.snapshot=snapshot;
  const clock=async()=>{try{const [value,summary]=await Promise.all([rpc('get_tournament_clock',{p_tournament_id:tour}),rpc('get_public_tournament_clock_summary',{p_tournament_id:tour})]);assert.equal(value.tournament_id,tour);if(revoking&&tour===uuid('10000000',20)&&Array.isArray(summary)&&summary.length===0)return;assert.ok(Array.isArray(summary)&&summary.length===1&&summary[0].tournament_id===tour);}catch{error('clock_read');}};
  state.clock=clock;
  const verifyPage=()=>{track(snapshot(['tables','ranking','payout']));track(clock());};
  const scheduleVerify=()=>{state.nextVerify=Date.now()+Math.round((state.online?30000:Math.min(30000,3000*2**Math.min(state.failures,4)))*(.9+Math.random()*.2));};
  const read=async()=>{
   if(state.busy){state.pending=true;return;}state.busy=true;
   try{
    const value=await rpc('get_public_tournament_table_live_or_last_hand_v2',{p_tournament_id:tour,p_tournament_table_id:table});
    if(!(revoking&&tour===uuid('10000000',20)&&value.access==='revoked'))assert.equal(value.tableId,table);
    state.handObservation={value:value.hand,at:Date.now(),healthy:healthy()};state.credit();
    state.failures=0;state.lastRead=Date.now();
   }catch{state.failures++;error(reconnecting||!state.online?'offline_table_read':'healthy_table_read');}
   finally{state.busy=false;if(state.pending&&Date.now()<end+10000){state.pending=false;track(read());}}
  };
  state.read=read;
  const openHud=async(phase='user-open')=>{
   const epoch=++state.hudEpoch,expectedRevocation=revoking;
   try{
    let value,history;
    if(phase==='revocation-revalidate'){
     value=await hud(tour,'summary',undefined,phase);
     if(value.access==='public'&&['current','updating'].includes(value.state))history=await hud(tour,'history',undefined,phase+'-history');
    }else [value,history]=await Promise.all([hud(tour,'summary',undefined,phase),hud(tour,'history')]);
    if(epoch!==state.hudEpoch)return;
    state.lastHud=Date.now();
    if(value.access==='public'&&['current','updating'].includes(value.state)&&Number.isSafeInteger(value.counters?.publicHands)){
     state.frozen={revision:value.revision,accessSnapshot:value.accessSnapshot};
     if(history.access==='public'&&['current','updating'].includes(history.state)){
      assert.ok(Array.isArray(history.handHistory)&&history.handHistory.length<=50);
      assert.ok(history.handHistory.every(h=>h.tableId===table),'History must remain in this tournament/table');
     }else if(!expectedRevocation)error('history_not_ready');
    }else{state.frozen=null;if(!expectedRevocation)error('hud_not_ready');}
   }catch{error('hud_read');}
  };
  state.openHud=openHud;
  const verifyHud=async(phase)=>{
   const epoch=state.hudEpoch,frozen=state.frozen;if(!frozen)return;
   try{
    const value=await hud(tour,'summary',frozen.accessSnapshot,phase);
    if(epoch!==state.hudEpoch)return;
    if(value.access!=='public'||!['current','updating'].includes(value.state)){state.frozen=null;if(!revoking)error('hud_not_ready');return;}
    if(value.accessChanged){state.frozen=null;const history=await hud(tour,'history',undefined,phase+'-changed-history');if(epoch===state.hudEpoch){assert.equal(history.access,'public');assert.ok(Array.isArray(history.handHistory)&&history.handHistory.length<=50);state.frozen={revision:value.revision,accessSnapshot:value.accessSnapshot};}}
    else assert.equal(state.frozen,frozen,'Access verification must retain the frozen HUD');
   }catch{error('hud_read');}
  };
  state.verifyHud=verifyHud;
  client.channel(`public:tournament-viewer-v2:${tour}`,{config:{private:false}}).on('broadcast',{event:'changed'},message=>{
   if(message.payload?.tournamentId!==tour)return;
   const components=message.payload.components??['tables'];
   if(components.some(c=>['tables','visibility','clock','ranking'].includes(c)))track(read());
   if(components.includes('visibility')){state.known={};verifyPage();}
   else {const sections=components.filter(c=>['tables','ranking','payout'].includes(c));if(sections.length)track(snapshot(sections));if(components.includes('clock')||components.includes('ranking'))track(clock());}
  }).subscribe(s=>{state.tableStatus=s;state.online=s==='SUBSCRIBED';scheduleVerify();if(!state.online&&started&&Date.now()<end&&!reconnecting)unexpectedDisconnects++;if(state.online){if(state.joined){stats.reconnects++;state.reconnected++;}state.joined=true;track(read());verifyPage();}});
  client.channel('public:player-hud-access-v1',{config:{private:false}}).on('broadcast',{event:'revoked'},()=>{
   const epoch=++state.hudEpoch;state.frozen=null;state.revocations++;stats.revocationClears++;
   // Same clear-now, jittered verification policy as the actual HUD component.
   track((async()=>{await sleep(250+Math.random()*2500);if(epoch===state.hudEpoch&&Date.now()<end)await openHud('revocation-revalidate');})());
  }).subscribe(s=>{
   state.accessStatus=s;state.accessOnline=s==='SUBSCRIBED';if(!state.accessOnline&&started&&Date.now()<end&&!reconnecting)unexpectedDisconnects++;
   if(state.accessOnline){if(state.accessJoined)track((async()=>{await sleep(250+Math.random()*2500);await verifyHud('reconnect-verify');})());state.accessJoined=true;}
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
 started=Date.now();end=started+duration*1000;coverageAt=started;
 const writer=async(n)=>{
  let number=(scenario==='concentrated'?2_000_000:5_000_000)+n*100000,step=0,hand=null;
  while(Date.now()<end&&!stopping){
   const start=Date.now();
   try{
    const value=await rpc('fixture_scale_step_v1',{p_tournament_id:uuid('10000000',n),p_number:number,p_step:step,p_hand_id:hand},true);
    hand=value.handId;stats.sourceWrites++;const ackOrder=++observationOrder;
    if(!reconnecting&&(!revoking||n!==20))for(const c of clients)if(c.tour===uuid('10000000',n)&&c.online&&c.accessOnline){
     const at=Date.parse(value.sourceWrittenAt);c.expected.push({handId:hand,number,step,at});expectedDeliveries++;
     assert.match(value.generation,/^\d+$/);assert.equal(typeof value.generationDeferred,'boolean');c.snapshotExpected.push({at,generation:value.generation,deferred:value.generationDeferred,ackOrder});snapshotExpected++;
     c.credit();
    }
    if(step===5){
     const completed=hand,written=Date.parse(value.sourceWrittenAt);
     track((async()=>{try{await until(()=>rpc('fixture_scale_hand_ready_v1',{p_hand_id:completed},true),15000,'projection_timeout');stats.projection.push(Date.now()-written);}catch{error('projection_timeout');}})());
     number++;step=0;hand=null;
    }else step++;
   }catch{error('source_write');}
   await sleep(Math.max(0,1000-(Date.now()-start)));
  }
  // Finish the fixture's final partial hand before starting the next scenario;
  // an old in-progress hand must not shadow the next tour's completed hand.
  while(hand&&step>0&&step<=5){await rpc('fixture_scale_step_v1',{p_tournament_id:uuid('10000000',n),p_number:number,p_step:step,p_hand_id:hand},true);step++;}
 };
 const writers=Array.from({length:tourCount},(_,i)=>writer(i+1));
 let restarted=false,withdrawn=false,lastHealth=0,lastProgress=0,revokedClients=0,reconnectedClients=0;
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
   revoking=false;coverageAt=Date.now();
  }
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
 const drainUntil=Date.now()+10000;
 while(clients.some(c=>c.expected.length||c.snapshotExpected.length)&&Date.now()<drainUntil){expireDeliveries();await sleep(200);}
 expireDeliveries();clearInterval(resourceTimer);await Promise.allSettled([...tasks]);
 await Promise.all(clients.map(c=>c.client.removeAllChannels()));
 const sample=key=>stats[key].slice(offset[key]);
 const report={scenario,viewers,durationSeconds:duration,httpSummarySamples:sample('summary').length,httpSummaryP95Ms:percentile(sample('summary'),.95),healthyRealtimeSamples:sample('realtime').length,healthyRealtimeP95Ms:percentile(sample('realtime'),.95),expectedDeliveries,excludedForPlannedFault,missedDeliveries,pendingDeliveries:clients.reduce((n,c)=>n+c.expected.length,0),minSamplesPerViewer:Math.min(...clients.map(c=>c.deliverySamples)),minHealthyOnline,unexpectedDisconnects,healthySocketCoverage:healthyWallMs?healthySocketMs/(healthyWallMs*viewers):0,projectionSamples:sample('projection').length,projectionMaxMs:Math.max(0,...sample('projection')),projectedHandsPerSecond:sample('projection').length/duration,sourceWrites:stats.sourceWrites-offset.sourceWrites,health,errors:{...stats.errors},reconnects:stats.reconnects-offset.reconnects,reconnectedClients,revokedClients,revocationClears:stats.revocationClears-offset.revocationClears};
 reports.push(report);save('running');
 report.admission={maxNewViewersPerSecond:50,initialRequestErrorsIncluded:true,fullAudienceHoldSeconds:duration};save('running');
 report.snapshotDelivery={expected:snapshotExpected,excludedForPlannedFault:snapshotExcluded,missed:snapshotMissed,pending:clients.reduce((n,c)=>n+c.snapshotExpected.length,0),samples:sample('snapshot').length,p95Ms:percentile(sample('snapshot'),.95),minSamplesPerViewer:Math.min(...clients.map(c=>c.snapshotSamples))};save('running');
 eventLoop.disable();report.generator={eventLoopP95Ms:eventLoop.percentile(95)/1e6,eventLoopMaxMs:eventLoop.max/1e6,utilization:nodePerformance.eventLoopUtilization(utilizationStart).utilization};
 report.httpPhases=Object.fromEntries(Object.entries(phases).map(([name,values])=>[name,{samples:values.length,p95Ms:percentile(values,.95)}]));save('running');
 report.transportErrors={...stats.transportErrors};save('running');
 report.transportTimings=Object.fromEntries(Object.entries(transportTimings).map(([key,value])=>[key,Object.fromEntries(Object.entries(value).map(([name,values])=>[name,{samples:values.length,p95Ms:percentile(values,.95)}]))]));save('running');
 console.log(JSON.stringify(report));
 assert.ok(report.httpSummarySamples>=viewers);assert.ok(report.healthyRealtimeSamples>0);assert.ok(report.projectionSamples>0);
 assert.ok(report.reconnects>=viewers,'Every WebSocket client must reconnect');
 assert.ok(report.revocationClears>=viewers,'Every HUD must clear for withdrawal in another contributing tour');
 assert.equal(report.revokedClients,viewers);assert.equal(report.reconnectedClients,viewers);
 assert.equal(report.minHealthyOnline,viewers);assert.equal(report.healthySocketCoverage,1);
 assert.equal(report.unexpectedDisconnects,0);
 assert.equal(report.missedDeliveries,0);assert.equal(report.pendingDeliveries,0);
 assert.equal(snapshotMissed,0);assert.equal(report.snapshotDelivery.pending,0);assert.equal(report.snapshotDelivery.samples,snapshotExpected-snapshotExcluded);assert.ok(report.snapshotDelivery.p95Ms<=3000,'Projected tables p95 > 3s');assert.ok(report.snapshotDelivery.minSamplesPerViewer>=Math.floor(duration/10));
 assert.equal(report.healthyRealtimeSamples,report.expectedDeliveries-report.excludedForPlannedFault);
 assert.ok(report.minSamplesPerViewer>=Math.floor(duration/10),'Every viewer must observe enough real writes');
 assert.ok(report.sourceWrites>=tourCount*duration*.9,'Source write rate fell below the defined load');
 assert.ok(report.httpSummaryP95Ms<=1000,'HTTP summary p95 > 1s');assert.ok(report.healthyRealtimeP95Ms<=3000,'Realtime p95 > 3s');assert.ok(report.projectionMaxMs<=5000,'Projection > 5s');
 assert.equal(stats.errors.source_write??0,0);assert.equal(stats.errors.projection_timeout??0,0);
 assert.equal(stats.errors.hud_read??0,0,'HUD HTTP failures are not excluded from acceptance');
 for(const kind of ['healthy_table_read','healthy_snapshot_read','clock_read','hud_not_ready','history_not_ready','health_read'])assert.equal(stats.errors[kind]??0,0,kind);
}
if(viewers===1000&&duration===1800){
 const seed=JSON.parse(readFileSync('output/hud-scale/seed.json','utf8'));
 assert.equal(seed.handsPerPlayer,1_000_000);
 assert.ok(seed.writer.p95OverheadPercent<=10,'Fixture source transaction marking overhead > 10%');
}
assert.equal(reports.length,2);save('passed');
