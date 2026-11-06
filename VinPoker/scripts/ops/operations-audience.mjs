// Disposable operational-load companion. This is not the 1M-hand qualification.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,renameSync,readdirSync,existsSync,statSync} from 'node:fs';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {availableParallelism,totalmem,cpus} from 'node:os';
import {setMaxListeners} from 'node:events';
import {monitorEventLoopDelay,performance as nodePerformance} from 'node:perf_hooks';
import {build} from 'esbuild';
import {createClient} from '@supabase/supabase-js';
import {settleScopedFeltRead} from '../../tests/publicHud/scale.delivery.mjs';
import {createAudienceGenerationEvidence} from './operations-audience-generation.mjs';
import {createOperationalHandDeliveryEvidence,validateHandDeliverySelection,readHandDeliveryJournal} from './operations-audience-hand-delivery.mjs';
import {ownedAudienceCancellation,audienceClockSignal,selectedAudienceSections,audienceFailure,audienceFileLimits,audienceJoinFailure,audienceSocketDiagnostic,audienceWorkerFailure,audienceServerTiming,observeAudienceHandshake,observeAudienceSubscriptions,audienceSelectionReadiness,recordAudienceDetailEvent} from './operations-audience-scope.mjs';

assert.equal(process.env.CASHIER_SCHEMA_MODE,'current');
assert.equal(process.env.LOCAL_OPERATIONS_REALTIME,'1');
assert.equal(process.env.LOCAL_OPERATIONS_CANDIDATE_PROBE,'1');
assert.equal(process.env.LOCAL_CLOCK_CANDIDATE_PROBE??'0','0');
const viewers=Number(process.env.LOCAL_OPERATIONS_AUDIENCE);
assert.ok([10,1000].includes(viewers),'Explicit bounded isolated audience required');
const workloadModel=process.env.LOCAL_OPERATIONS_AUDIENCE_MODEL??'grid-detail-stress';
assert.ok(['selected-table','grid-detail-stress'].includes(workloadModel),'Explicit audience model required');
const selected=workloadModel==='selected-table',generationEvidence=createAudienceGenerationEvidence();
const statusFile=process.env.LOCAL_OPERATIONS_AUDIENCE_STATUS;
assert.match(statusFile??'',/^\/tmp\/cashier-e2e-[A-Za-z0-9]+\/isolated-status\.json$/);
const root=statusFile.slice(0,statusFile.lastIndexOf('/'));
const reportFile=process.env.LOCAL_OPERATIONS_AUDIENCE_REPORT;
assert.ok(reportFile?.endsWith('/output/operations-latency/operations-audience-http.json'));
const bridgeRoot=reportFile.slice(0,reportFile.lastIndexOf('/'));
const handEvidence=createOperationalHandDeliveryEvidence(viewers);
let handSelection=null;
const status=JSON.parse(readFileSync(statusFile,'utf8'));
assert.equal(status.API_URL,'http://127.0.0.1:54321');
assert.equal(typeof status.ANON_KEY,'string');assert.equal(typeof status.SERVICE_ROLE_KEY,'string');
assert.equal(process.platform,'linux');
const fdLimits=audienceFileLimits(readFileSync('/proc/self/limits','utf8'));
assert.ok(fdLimits,'Actual generator file limits required');
assert.ok(fdLimits.soft>=16384,'Generator must have the scale harness file descriptor budget');
const modules={
 observer:'src/components/cashier/tournament-live/viewer-hub/publicTournamentRealtime.ts',
 coordinator:'src/components/cashier/tournament-live/viewer-hub/publicSnapshotCoordinator.ts',
 table:'src/lib/publicTableTransport.ts',
 history:'src/components/cashier/tournament-live/viewer-hub/publicTableHistory.ts',
 worker:'supabase/functions/public-spectator-projector-v2/worker.ts',
};
const sourceRoot=fileURLToPath(new URL('../../',import.meta.url));
const loaded={};
for(const [name,entry] of Object.entries(modules)){
 const outfile=`${root}/operations-${name}.mjs`;
 await build({absWorkingDir:sourceRoot,entryPoints:[entry],outfile,bundle:true,platform:'node',format:'esm',target:'node22',logLevel:'silent'});
 loaded[name]=await import(pathToFileURL(outfile).href);
}
// Every virtual tab is visible. The actual observer owns its jitter/backoff;
// no DOM rendering or independent background-tab behavior is claimed here.
const visibility=new EventTarget();
setMaxListeners(0,visibility);
globalThis.document={visibilityState:'visible',addEventListener:visibility.addEventListener.bind(visibility),removeEventListener:visibility.removeEventListener.bind(visibility)};
const tour='a3000000-0000-4000-8000-000000000001';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const dist=values=>{const a=[...values].sort((x,y)=>x-y);return {samples:a.length,p50Ms:a.length?a[Math.ceil(a.length*.5)-1]:null,p95Ms:a.length?a[Math.ceil(a.length*.95)-1]:null,maxMs:a.at(-1)??null};};
const timings={snapshot:[],table:[],clock:[],sourceToSnapshot:[],markerToScopedDetail:generationEvidence.markerToDetailObservationMs,
 sourceToPublication:[],markerToPublication:generationEvidence.markerToPublicationMs};
const timingParts={},eventLoop=monitorEventLoopDelay({resolution:20}),utilizationStart=nodePerformance.eventLoopUtilization();eventLoop.enable();
const observeTiming=(kind,headers)=>{for(const [name,value]of Object.entries(audienceServerTiming(headers)))(timingParts[kind+':'+name]??=[]).push(value);};
const errors={},clients=[],pending=new Set();
const failureKinds={},failureSamples=[],subscriptionStatuses={},joinFailureKinds={};
const socketEvents={},socketFailureSamples=[];
const workerRpcFailures={},workerJobFailures={};
const requestCounts={snapshot:0,table:0,clock:0},snapshotSectionCounts={tables:0,ranking:0,payout:0};let maxSnapshotTableIds=0;
const handshakeEvents={},handshakeFailureSamples=[];
let stopping=false,phase='starting',readyAt=null,endedAt=null,connectedAtStop=null,checks=null,workerCalls=0,workerPublished=0,oracleReadCalls=0;
const stopHandshakeDiagnostics=observeAudienceHandshake(status.API_URL,value=>{
 if(stopping)return;
 const key=[value.event,value.httpStatus??'none',value.kind??'none'].join(':');handshakeEvents[key]=(handshakeEvents[key]??0)+1;
 if(value.httpStatus!==101&&handshakeFailureSamples.length<20)handshakeFailureSamples.push({at:Date.now(),...value});
});
const fail=name=>{errors[name]=(errors[name]??0)+1;};
const diagnostic=(phase,cause,status)=>{
 const value=audienceFailure(cause,status),key=phase+':'+value.kind;
 failureKinds[key]=(failureKinds[key]??0)+1;
 if(failureSamples.length<20)failureSamples.push({phase,at:Date.now(),...value});
};
const track=promise=>{pending.add(promise);void promise.finally(()=>pending.delete(promise)).catch(()=>{});return promise;};
const headers={apikey:status.ANON_KEY,Authorization:`Bearer ${status.ANON_KEY}`,'Content-Type':'application/json'};
const report=()=>{writeFileSync(reportFile+'.tmp',JSON.stringify({
 kind:'REAL_HTTP_WEBSOCKET_MIXED_OPERATIONAL_AUDIENCE',sha:process.env.LOCAL_OPERATIONS_SOURCE_SHA,workloadModel,
 generationEvidence:selected?generationEvidence.report():null,oracleReadCalls,
 handDelivery:selected?handEvidence.report():null,
 selectionNonce:handSelection?.nonce??null,
 selectionReady:selected&&handSelection?clients.filter(c=>c.online&&c.ready&&c.clockReady&&c.observedSession===handSelection.sessionId&&c.tableId===handSelection.tableId).length:0,
 selectionReadiness:selected?audienceSelectionReadiness(clients,handSelection):null,
 measurementStatus:selected?(handEvidence.report().complete?'TABLE_SPECIFIC_SOURCE_RECEIPTS_COMPLETE':'TABLE_SPECIFIC_SOURCE_PROOF_PENDING'):'GRID_DETAIL_STRESS',
 requestCounts,snapshotSectionCounts,maxSnapshotTableIds,
 phase,viewers,connected:clients.filter(c=>c.online).length,initialReady:clients.filter(c=>c.ready).length,
 observersWithLaterTableRevision:clients.filter(c=>c.changes>0).length,
 readyAt,activeDurationMs:readyAt?(endedAt??Date.now())-readyAt:0,connectedAtStop,checks,workerCalls,workerPublished,errors,failureKinds,failureSamples,subscriptionStatuses,joinFailureKinds,socketEvents,socketFailureSamples,handshakeEvents,handshakeFailureSamples,workerRpcFailures,workerJobFailures,
 admissionMaxNewViewersPerSecond:50,generatorFiles:{...fdLimits,open:readdirSync('/proc/self/fd').length},
 distributions:Object.fromEntries(Object.entries(timings).map(([name,values])=>[name,dist(values)])),
 serverTiming:Object.fromEntries(Object.entries(timingParts).map(([name,values])=>[name,dist(values)])),
 generator:{eventLoopP95Ms:eventLoop.percentile(95)/1e6,eventLoopMaxMs:eventLoop.max/1e6,utilization:nodePerformance.eventLoopUtilization(utilizationStart).utilization,scope:'Process-wide including admission;diagnostic only'},
 machine:{logicalCpus:availableParallelism(),cpu:cpus()[0]?.model??null,memoryBytes:totalmem(),node:process.version},
 productionChanged:false,qualification:false,
 limitations:(selected?'Selected-table consumer:catalog-only hidden hub;independent detail with scoped full clock reads. One additional200ms anonymous snapshot oracle supplies clocks only,never viewer data. ':'Combined grid+detail stress;not the selected-table page composition. ')+
  'Actual anonymous HTTP/WS with product observer,coordinator and table transport. All virtual tabs visible. Canonical spectator worker executes on host through real service HTTP,not hosted Edge/cron. Real operational suite runs separately in Chromium against this same isolated DB. No1Mhand HUD,1000DOM render,all-intermediate-write delivery,Telegram handset or production-capacity claim.',
},null,2));renameSync(reportFile+'.tmp',reportFile);};
const service=createClient(status.API_URL,status.SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const captureGeneration=async()=>{
 oracleReadCalls++;
 try{
  const response=await fetch(status.API_URL+'/rest/v1/rpc/get_public_tournament_viewer_snapshot_v2',{
   method:'POST',headers,body:JSON.stringify({p_tournament_id:tour,p_table_ids:[],p_sections:['tables'],p_known_revisions:{}}),signal:AbortSignal.timeout(5000),
  });
  assert.equal(response.status,200);const snapshot=await response.json();assert.equal(snapshot.tournamentId,tour);
  generationEvidence.observe(snapshot);
 }catch(cause){fail('generation_oracle');diagnostic('generation_oracle',cause);}
};
const oracle=selected?track((async()=>{while(!stopping){await captureGeneration();await sleep(200);}})()):Promise.resolve();
const worker=track((async()=>{
 while(!stopping){
  const start=Date.now(),deadline=start+5000;
  try{
   const result=await loaded.worker.processPublicSpectatorJobs({rpc:async(name,args)=>{
    const left=deadline-Date.now();if(left<=0)throw Error('worker_deadline');
    const result=await service.rpc(name,args).abortSignal(AbortSignal.timeout(left));
    if(result.error){
     diagnostic('worker_rpc',result.error,result.status);
     const value=audienceWorkerFailure(name,result.error),key=value.operation+':'+value.reason;
     workerRpcFailures[key]=(workerRpcFailures[key]??0)+1;
    }
    return result;
   }},deadline);
   workerCalls++;workerPublished+=result.results.filter(r=>r.published).length;
   for(const row of result.results)if(row.error){
    fail('worker_job');const kind=['source_failed','publish_failed','deadline_exceeded'].includes(row.error)?row.error:'unknown';
    workerJobFailures[kind]=(workerJobFailures[kind]??0)+1;
   }
  }catch(cause){fail('worker_transport');diagnostic('worker_transport',cause);}
  await sleep(Math.max(1,1000-(Date.now()-start)));
 }
})());
process.on('SIGTERM',()=>{stopping=true;});
const readBridge=()=>{
 if(!selected)return;
 const selectionPath=bridgeRoot+'/operations-hand-selection.json';
 if(!existsSync(selectionPath))return;
 assert.ok(statSync(selectionPath).size<=2048,'Oversized table selection');
 const next=validateHandDeliverySelection(JSON.parse(readFileSync(selectionPath,'utf8')),process.env.LOCAL_OPERATIONS_SOURCE_SHA);
 if(handSelection)assert.deepEqual(next,handSelection,'Selection changed during graded operations');
 else{
  handSelection=next;
  for(const state of clients){
   state.epoch++;state.controller?.abort();state.detailController?.abort();
   state.tableId=next.tableId;state.ready=false;state.clockReady=false;state.observedSession=null;state.revision=null;
   recordAudienceDetailEvent(state,'selection');state.detailFull=true;recordAudienceDetailEvent(state,'request');state.detailCoordinator.request();
  }
 }
 const journal=bridgeRoot+'/operations-hand-receipts.jsonl';
 if(existsSync(journal)){
  assert.ok(statSync(journal).size<=65536,'Oversized Finish journal');
  for(const receipt of readHandDeliveryJournal(readFileSync(journal,'utf8'),handSelection))handEvidence.receipt(receipt);
 }
};
const bridgeTimer=setInterval(()=>{
 try{readBridge();}catch(cause){fail('hand_delivery_bridge');diagnostic('hand_delivery_bridge',cause);stopping=true;process.exitCode=1;}
},100);
const timer=setInterval(report,1000);report();
try{
 if(viewers===1000){
  let confirmed=false;
  for(let i=0;i<30&&!confirmed;i++){
   const reply=await fetch(status.API_URL+'/rest/v1/rpc/get_public_tournament_clock_summary',{method:'POST',headers,body:JSON.stringify({p_tournament_id:tour}),signal:AbortSignal.timeout(5000)});
   await reply.arrayBuffer();confirmed=reply.ok&&Object.hasOwn(audienceServerTiming(reply.headers),'transaction');
   if(!confirmed)await sleep(200);
  }
  assert.ok(confirmed,'Actual isolated PostgREST Server-Timing header required');
 }
 for(let i=0;i<viewers&&!stopping;i++){
  const client=createClient(status.API_URL,status.ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false},realtime:{logger:(kind,message,data)=>{
   if(stopping)return;
   const value=audienceSocketDiagnostic(kind,message,data);if(!value)return;
   const key=[value.event,value.kind,value.joinKind,value.closeCode??'none'].join(':');socketEvents[key]=(socketEvents[key]??0)+1;
   if(value.event!=='transport_open'&&socketFailureSamples.length<20)socketFailureSamples.push({at:Date.now(),...value});
  }}});
  observeAudienceSubscriptions(client,(status,error)=>{
   if(stopping)return;
   const label=['SUBSCRIBED','CHANNEL_ERROR','TIMED_OUT','CLOSED'].includes(status)?status:'unknown';
   subscriptionStatuses[label]=(subscriptionStatuses[label]??0)+1;
   if(label!=='SUBSCRIBED'){
    const kind=audienceJoinFailure(error);joinFailureKinds[kind]=(joinFailureKinds[kind]??0)+1;
    if(readyAt)fail('unexpected_realtime_status');
   }
  });
  const state={client,online:false,ready:false,clockReady:false,changes:0,known:{},dirty:new Set(['tables','ranking','payout']),catalog:[],tableId:null,revision:null,epoch:0,controller:null,detailFull:true,detailController:null};
  clients.push(state);
  const refresh=async()=>{
   if(stopping||!state.dirty.size)return;
   const sections=[...state.dirty];state.dirty.clear();const epoch=state.epoch;
   const epochs=Object.fromEntries(sections.map(s=>[s,loaded.observer.publicReadEpoch(client,tour,s)]));
   const controller=new AbortController(),timeout=AbortSignal.timeout(5000);state.controller=controller;
   let requestType='snapshot';
   const start=Date.now();
  try{
    requestCounts.snapshot++;for(const section of sections)snapshotSectionCounts[section]++;
    const tableIds=!selected&&state.tableId?[state.tableId]:[];maxSnapshotTableIds=Math.max(maxSnapshotTableIds,tableIds.length);
    const response=await fetch(status.API_URL+'/rest/v1/rpc/get_public_tournament_viewer_snapshot_v2',{
     method:'POST',headers,body:JSON.stringify({p_tournament_id:tour,p_table_ids:tableIds,p_sections:sections,p_known_revisions:state.known}),signal:AbortSignal.any([controller.signal,timeout]),
    });
    if(response.status!==200)throw Object.assign(Error('AUDIENCE_HTTP_ERROR'),{audienceHttpStatus:response.status});
    const data=await response.json();
    observeTiming('snapshot',response.headers);
    if(epoch!==state.epoch||stopping){for(const s of sections)state.dirty.add(s);return;}
    assert.equal(data.ok,true);assert.equal(data.access,'public');assert.equal(data.tournamentId,tour);
    timings.snapshot.push(Date.now()-start);
    for(const section of sections){
     if((!selected||section!=='tables')&&!loaded.observer.publicReadEpochIsCurrent(client,tour,section,epochs[section])){delete data.sections[section];state.dirty.add(section);continue;}
     assert.ok(data.sections[section]?.freshness);state.known[section]=data.sections[section].revision;
    }
    const tables=data.sections.tables;
    if(tables){
     if(selected){
      // The hidden hub keeps catalog/metadata, but does not follow live hands.
      if(!tables.unchanged){assert.ok(Array.isArray(tables.catalog));state.catalog=tables.catalog;}
      if(!state.tableId&&state.catalog.length){state.tableId=state.catalog[0].tableId;state.detailCoordinator.request();}
     }else{
     const previous=state.revision;state.revision=tables.revision;
     if(!tables.unchanged){assert.ok(Array.isArray(tables.catalog));state.catalog=tables.catalog;}
     state.tableId=state.catalog.find(t=>t.tableId===state.tableId)?.tableId??state.catalog[0]?.tableId??null;
     if(readyAt&&previous!==null&&previous!==tables.revision){
      state.changes++;
      const changed=Date.parse(tables.freshness.sourceChangedAt),published=Date.parse(tables.freshness.publishedAt);
      if(Number.isFinite(changed)&&Number.isFinite(published)&&published>=changed){timings.sourceToSnapshot.push(Date.now()-changed);timings.sourceToPublication.push(published-changed);}
     }
     if(state.tableId){
      requestType='table';
      const readStart=Date.now();const result=await loaded.table.readPublicTableRequest(status.API_URL,status.ANON_KEY,tour,state.tableId,controller.signal,(url,init)=>{requestCounts.table++;return fetch(url,init);});
      if(epoch!==state.epoch||stopping||!loaded.observer.publicReadEpochIsCurrent(client,tour,'tables',epochs.tables)){state.dirty.add('tables');return;}
      assert.equal(result.data?.access,'public');assert.equal(result.data?.tableId,state.tableId);
      timings.table.push(Date.now()-readStart);
      if(tables.freshness.state==='current')state.ready=true;
     }
     }
    }
    state.observation.reportResult(true);
   }catch(cause){
    const cancelled=ownedAudienceCancellation(cause,controller,timeout,requestType==='table'?'table':'http');
    if(cancelled)for(const s of sections)state.dirty.add(s);
    else {fail('spectator_'+requestType+'_read');diagnostic('spectator_'+requestType,cause,cause?.audienceHttpStatus??cause?.publicTableHttpStatus);state.observation.reportResult(false);}
   }finally{
    if(!stopping&&state.dirty.size)state.coordinator.request();
   }
  };
  state.coordinator=loaded.coordinator.registerPublicTournamentRead(client,tour,()=>track(refresh()));
  state.detailCoordinator=selected?loaded.coordinator.registerPublicTournamentRead(client,tour,()=>track((async()=>{
   if(stopping||!state.tableId)return;
   const controller=new AbortController(),timeout=AbortSignal.timeout(5000),signal=AbortSignal.any([controller.signal,timeout]);
   state.detailController=controller;const epoch=state.epoch,tableEpoch=loaded.observer.publicReadEpoch(client,tour,'tables');
   const full=state.detailFull||!state.clockReady;state.detailFull=false;
   state.lastDetailFull=full;state.detailFullReads=(state.detailFullReads??0)+(full?1:0);recordAudienceDetailEvent(state,'dispatch');
   const started=Date.now();let physicalFailure=false;
   state.detailStartedAt=started;state.detailInFlight=true;state.detailStarted=(state.detailStarted??0)+1;
   // The table reader owns its physical5s deadline. Do not pass the clock's
   // timeout as a caller signal and misclassify a real table deadline as cancel.
   const physicalRead=loaded.table.readPublicTableRequest(status.API_URL,status.ANON_KEY,tour,state.tableId,controller.signal,async(url,init)=>{requestCounts.table++;const response=await fetch(url,init);observeTiming(full?'table-clock':'table',response.headers);return response;},full?'table-clock':'table');
   const tableRead=physicalRead.then(reply=>{
    if(full){assert.ok(reply.data?.table&&Array.isArray(reply.data.clock),'Canonical table-clock bundle required');reply={...reply,data:reply.data.table};}
    timings.table.push(Date.now()-started);return reply;
   }).catch(cause=>{
    physicalFailure=true;
    if(!ownedAudienceCancellation(cause,controller,timeout,'table')){fail('spectator_table_read');diagnostic('spectator_table',cause,cause?.publicTableHttpStatus);}
    throw cause;
   });
   const clockRead=full?(async()=>{
    const at=Date.now();
    try{
     const {data:bundle}=await physicalRead;
     if(bundle?.table?.access!=='public')return false;
     const data=bundle.clock;
     assert.ok(loaded.history.parsePublicClockSummary(data,tour));timings.clock.push(Date.now()-at);return true;
    }catch(cause){
     physicalFailure=true;
     if(!ownedAudienceCancellation(cause,controller,timeout)){fail('spectator_clock');diagnostic('spectator_clock',cause,cause?.audienceHttpStatus);}
     throw cause;
    }
   })():Promise.resolve(false);
   // Promise.all may reject before its sibling settles; preserve the physical drain.
   track(tableRead.catch(()=>{}));track(clockRead.catch(()=>{}));
   const current=reply=>epoch===state.epoch&&loaded.observer.publicReadEpochIsCurrent(client,tour,'tables',tableEpoch)&&reply.data?.access==='public';
   try{
    const reply=await settleScopedFeltRead(tableRead,clockRead,current,()=>{state.clockReady=true;state.clockCommits=(state.clockCommits??0)+1;recordAudienceDetailEvent(state,'clock-commit');});
    if(stopping||!current(reply)){state.detailFenced=(state.detailFenced??0)+1;recordAudienceDetailEvent(state,'fenced');return;}
    assert.equal(reply.data.tableId,state.tableId);assert.match(reply.data.sourceGeneration,/^\d+$/);
    state.ready=true;state.observedSession=reply.data.tableSessionId;
    state.detailAccepted=(state.detailAccepted??0)+1;recordAudienceDetailEvent(state,'accepted');
    // Consumer visibility requires both the table and any full clock read,
    // plus current scope/epoch fences. Transport completion alone is earlier.
    handEvidence.observe(i,{tournamentId:tour,tableId:state.tableId},reply.data,Date.now());
    if(state.revision!==reply.data.sourceGeneration){
     if(readyAt&&state.revision!==null){state.changes++;generationEvidence.record(i,reply.data.sourceGeneration,Date.now());}
     state.revision=reply.data.sourceGeneration;
    }
    state.observation.reportResult(true);
   }catch(cause){
    state.detailRejected=(state.detailRejected??0)+1;recordAudienceDetailEvent(state,'rejected');
    if(!physicalFailure){fail('spectator_detail_contract');diagnostic('spectator_detail_contract',cause);}
    state.observation.reportResult(false);
   }finally{state.detailInFlight=false;controller.abort();}
  })())):null;
  state.clockCoordinator=selected?{request(){state.detailFull=true;recordAudienceDetailEvent(state,'request');state.detailCoordinator.request();},stop(){}}:loaded.coordinator.registerPublicTournamentRead(client,tour,()=>track((async()=>{
   if(stopping)return;
   const started=Date.now(),epoch=loaded.observer.publicReadEpoch(client,tour,'clock');
   const controller=new AbortController(),timeout=AbortSignal.timeout(5000);state.clockController=controller;
   try{
    requestCounts.clock++;
    const response=await fetch(status.API_URL+'/rest/v1/rpc/get_public_tournament_clock_summary',{
     method:'POST',headers,body:JSON.stringify({p_tournament_id:tour}),signal:AbortSignal.any([controller.signal,timeout]),
    });
    if(response.status!==200)throw Object.assign(Error('AUDIENCE_HTTP_ERROR'),{audienceHttpStatus:response.status});
    const data=await response.json();
    observeTiming('clock',response.headers);
    if(stopping)return;
    if(!loaded.observer.publicReadEpochIsCurrent(client,tour,'clock',epoch)){state.clockCoordinator.request();return;}
    assert.ok(loaded.history.parsePublicClockSummary(data,tour));
    timings.clock.push(Date.now()-started);state.clockReady=true;
   }catch(cause){
    const cancelled=ownedAudienceCancellation(cause,controller,timeout);
    if(!cancelled){fail('spectator_clock');diagnostic('spectator_clock',cause,cause?.audienceHttpStatus);}
   }
  })()));
  state.observation=loaded.observer.observePublicTournament(client,tour,event=>{
   state.online=event.online;
   if(event.reason==='status')return;
   if(event.invalidatePending||event.components.includes('visibility')||event.components.includes('hand_visibility')){
    state.epoch++;state.controller?.abort();
    if(selected){
     if(event.invalidatePending){state.known={};state.dirty.clear();}
     else if(event.components.includes('visibility'))state.known={};
     else delete state.known.tables;
    }else{state.known={};state.dirty.add('tables');}
    state.detailController?.abort();if(event.components.includes('visibility')){state.clockReady=false;state.clockInvalidations=(state.clockInvalidations??0)+1;}recordAudienceDetailEvent(state,event.components.includes('visibility')?'visibility':'invalidate');
   }
   const clockSignal=audienceClockSignal(event);
   if(clockSignal.invalidate)state.clockController?.abort();
   if(selected){for(const c of selectedAudienceSections(event))state.dirty.add(c);}
   else for(const c of event.components)if(['tables','ranking','payout'].includes(c))state.dirty.add(c);
   if(event.components.includes('visibility'))for(const c of ['tables','ranking','payout'])state.dirty.add(c);
   if(state.dirty.size)state.coordinator.request();
   if(selected&&event.components.some(c=>['tables','hand_visibility','visibility'].includes(c))){recordAudienceDetailEvent(state,'request');state.detailCoordinator.request();}
   if(clockSignal.reload)state.clockCoordinator.request();
  });
  state.coordinator.request();state.clockCoordinator.request();
  // Same admission bound as the existing full HUD qualification. All1000
  // remain concurrent throughout the operational stages after readiness.
  if(i%25===24)await sleep(500);
 }
 const start=Date.now();
 while(!stopping&&!clients.every(c=>c.online&&c.ready&&c.clockReady)&&Date.now()-start<90000)await sleep(100);
 assert.equal(clients.length,viewers);assert.ok(clients.every(c=>c.online&&c.ready&&c.clockReady),'Audience did not become ready');
 assert.equal(Object.keys(errors).length,0,'Audience startup errors');
 readyAt=Date.now();phase='ready';report();
 while(!stopping)await sleep(100);
}catch(cause){fail('audience_lifecycle');diagnostic('audience_lifecycle',cause);stopping=true;process.exitCode=1;}
finally{
 eventLoop.disable();
 stopHandshakeDiagnostics();
 clearInterval(timer);clearInterval(bridgeTimer);stopping=true;
 try{readBridge();}catch(cause){fail('hand_delivery_bridge');diagnostic('hand_delivery_bridge',cause);}
 endedAt=Date.now();connectedAtStop=clients.filter(c=>c.online).length;
 for(const state of clients){state.controller?.abort();state.clockController?.abort();state.detailController?.abort();state.coordinator.stop();state.clockCoordinator.stop();state.detailCoordinator?.stop();state.observation?.unsubscribe();}
 await Promise.all(clients.map(async({client})=>{await client.removeAllChannels();client.realtime.disconnect();}));
 await worker;await oracle;await Promise.allSettled([...pending]);if(selected)await captureGeneration();
 checks={zeroErrors:Object.keys(errors).length===0,atLeast30Seconds:readyAt!==null&&endedAt-readyAt>=30000,allViewers:clients.length===viewers&&connectedAtStop===viewers,
  allSawLaterTableRevision:clients.every(c=>c.ready&&c.changes>0),tableP95Within3Seconds:timings.table.length>=viewers&&dist(timings.table).p95Ms<=3000,
  ...(selected?{
   markerToScopedDetailP95Within3Seconds:timings.markerToScopedDetail.length>=viewers&&dist(timings.markerToScopedDetail).p95Ms<=3000,
   // Tournament markers remain diagnostics. Exact verified Finish identities
   // replace the global-marker coverage denominator for this prospective run.
   // Every graded source hand must reach every viewer, including coalesced
   // later states backed by their own ordered canonical receipts.
   tableSpecificSourceDeliveryVerified:handEvidence.report().complete&&handEvidence.report().p95Ms<=3000,
  }:{sourceToSnapshotP95Within3Seconds:timings.sourceToSnapshot.length>=viewers&&dist(timings.sourceToSnapshot).p95Ms<=3000}),
  publicationMaxWithin5Seconds:(selected?timings.markerToPublication:timings.sourceToPublication).length>=viewers&&dist(selected?timings.markerToPublication:timings.sourceToPublication).maxMs<=5000};
 const passed=Object.values(checks).every(Boolean);
 phase=passed?'passed':'failed';if(!passed)process.exitCode=1;report();
}
