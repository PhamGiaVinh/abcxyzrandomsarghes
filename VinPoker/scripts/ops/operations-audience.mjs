// Disposable operational-load companion. This is not the 1M-hand qualification.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {availableParallelism,totalmem,cpus} from 'node:os';
import {setMaxListeners} from 'node:events';
import {build} from 'esbuild';
import {createClient} from '@supabase/supabase-js';
import {ownedAudienceCancellation,audienceClockSignal,audienceFailure,audienceFileLimits,audienceJoinFailure,observeAudienceSubscriptions} from './operations-audience-scope.mjs';

assert.equal(process.env.CASHIER_SCHEMA_MODE,'current');
assert.equal(process.env.LOCAL_OPERATIONS_REALTIME,'1');
assert.equal(process.env.LOCAL_OPERATIONS_CANDIDATE_PROBE,'1');
assert.equal(process.env.LOCAL_CLOCK_CANDIDATE_PROBE??'0','0');
const viewers=Number(process.env.LOCAL_OPERATIONS_AUDIENCE);
assert.ok([10,1000].includes(viewers),'Explicit bounded isolated audience required');
const statusFile=process.env.LOCAL_OPERATIONS_AUDIENCE_STATUS;
assert.match(statusFile??'',/^\/tmp\/cashier-e2e-[A-Za-z0-9]+\/isolated-status\.json$/);
const root=statusFile.slice(0,statusFile.lastIndexOf('/'));
const reportFile=process.env.LOCAL_OPERATIONS_AUDIENCE_REPORT;
assert.ok(reportFile?.endsWith('/output/operations-latency/operations-audience-http.json'));
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
const timings={snapshot:[],table:[],clock:[],sourceToSnapshot:[],sourceToPublication:[]};
const errors={},clients=[],pending=new Set();
const failureKinds={},failureSamples=[],subscriptionStatuses={},joinFailureKinds={};
let stopping=false,phase='starting',readyAt=null,endedAt=null,connectedAtStop=null,checks=null,workerCalls=0,workerPublished=0;
const fail=name=>{errors[name]=(errors[name]??0)+1;};
const diagnostic=(phase,cause,status)=>{
 const value=audienceFailure(cause,status),key=phase+':'+value.kind;
 failureKinds[key]=(failureKinds[key]??0)+1;
 if(failureSamples.length<20)failureSamples.push({phase,at:Date.now(),...value});
};
const track=promise=>{pending.add(promise);void promise.finally(()=>pending.delete(promise)).catch(()=>{});return promise;};
const headers={apikey:status.ANON_KEY,Authorization:`Bearer ${status.ANON_KEY}`,'Content-Type':'application/json'};
const report=()=>writeFileSync(reportFile,JSON.stringify({
 kind:'REAL_HTTP_WEBSOCKET_MIXED_OPERATIONAL_AUDIENCE',sha:process.env.LOCAL_OPERATIONS_SOURCE_SHA,
 phase,viewers,connected:clients.filter(c=>c.online).length,initialReady:clients.filter(c=>c.ready).length,
 observersWithLaterTableRevision:clients.filter(c=>c.changes>0).length,
 readyAt,activeDurationMs:readyAt?(endedAt??Date.now())-readyAt:0,connectedAtStop,checks,workerCalls,workerPublished,errors,failureKinds,failureSamples,subscriptionStatuses,joinFailureKinds,
 admissionMaxNewViewersPerSecond:50,generatorFiles:{...fdLimits,open:readdirSync('/proc/self/fd').length},
 distributions:Object.fromEntries(Object.entries(timings).map(([name,values])=>[name,dist(values)])),
 machine:{logicalCpus:availableParallelism(),cpu:cpus()[0]?.model??null,memoryBytes:totalmem(),node:process.version},
 productionChanged:false,qualification:false,
 limitations:'Actual anonymous HTTP/WS with product observer, coordinator and table transport. All virtual tabs visible. Canonical spectator worker executes on host through real service HTTP, not hosted Edge/cron. Real operational suite runs separately in Chromium against this same isolated DB. No1Mhand HUD,1000DOM render,all-intermediate-write delivery,Telegram handset or production-capacity claim. Revision-age observations do not count unchanged old publications as fresh writes.',
},null,2));
const service=createClient(status.API_URL,status.SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const worker=track((async()=>{
 while(!stopping){
  const start=Date.now(),deadline=start+5000;
  try{
   const result=await loaded.worker.processPublicSpectatorJobs({rpc:async(name,args)=>{
    const left=deadline-Date.now();if(left<=0)throw Error('worker_deadline');
    const result=await service.rpc(name,args).abortSignal(AbortSignal.timeout(left));
    if(result.error)diagnostic('worker_rpc',result.error,result.status);
    return result;
   }},deadline);
   workerCalls++;workerPublished+=result.results.filter(r=>r.published).length;
   for(const row of result.results)if(row.error)fail('worker_job');
  }catch(cause){fail('worker_transport');diagnostic('worker_transport',cause);}
  await sleep(Math.max(1,1000-(Date.now()-start)));
 }
})());
process.on('SIGTERM',()=>{stopping=true;});
const timer=setInterval(report,1000);report();
try{
 for(let i=0;i<viewers&&!stopping;i++){
  const client=createClient(status.API_URL,status.ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
  observeAudienceSubscriptions(client,(status,error)=>{
   if(stopping)return;
   const label=['SUBSCRIBED','CHANNEL_ERROR','TIMED_OUT','CLOSED'].includes(status)?status:'unknown';
   subscriptionStatuses[label]=(subscriptionStatuses[label]??0)+1;
   if(label!=='SUBSCRIBED'){
    const kind=audienceJoinFailure(error);joinFailureKinds[kind]=(joinFailureKinds[kind]??0)+1;
    if(readyAt)fail('unexpected_realtime_status');
   }
  });
  const state={client,online:false,ready:false,clockReady:false,changes:0,known:{},dirty:new Set(['tables','ranking','payout']),catalog:[],tableId:null,revision:null,epoch:0,controller:null};
  clients.push(state);
  const refresh=async()=>{
   if(stopping||!state.dirty.size)return;
   const sections=[...state.dirty];state.dirty.clear();const epoch=state.epoch;
   const epochs=Object.fromEntries(sections.map(s=>[s,loaded.observer.publicReadEpoch(client,tour,s)]));
   const controller=new AbortController(),timeout=AbortSignal.timeout(5000);state.controller=controller;
   let requestType='snapshot';
   const start=Date.now();
   try{
    const response=await fetch(status.API_URL+'/rest/v1/rpc/get_public_tournament_viewer_snapshot_v2',{
     method:'POST',headers,body:JSON.stringify({p_tournament_id:tour,p_table_ids:state.tableId?[state.tableId]:[],p_sections:sections,p_known_revisions:state.known}),signal:AbortSignal.any([controller.signal,timeout]),
    });
    if(response.status!==200)throw Object.assign(Error('AUDIENCE_HTTP_ERROR'),{audienceHttpStatus:response.status});
    const data=await response.json();
    if(epoch!==state.epoch||stopping){for(const s of sections)state.dirty.add(s);return;}
    assert.equal(data.ok,true);assert.equal(data.access,'public');assert.equal(data.tournamentId,tour);
    timings.snapshot.push(Date.now()-start);
    for(const section of sections){
     if(!loaded.observer.publicReadEpochIsCurrent(client,tour,section,epochs[section])){delete data.sections[section];state.dirty.add(section);continue;}
     assert.ok(data.sections[section]?.freshness);state.known[section]=data.sections[section].revision;
    }
    const tables=data.sections.tables;
    if(tables){
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
      const readStart=Date.now();const result=await loaded.table.readPublicTableRequest(status.API_URL,status.ANON_KEY,tour,state.tableId,controller.signal);
      if(epoch!==state.epoch||stopping||!loaded.observer.publicReadEpochIsCurrent(client,tour,'tables',epochs.tables)){state.dirty.add('tables');return;}
      assert.equal(result.data?.access,'public');assert.equal(result.data?.tableId,state.tableId);
      timings.table.push(Date.now()-readStart);
      if(tables.freshness.state==='current')state.ready=true;
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
  state.clockCoordinator=loaded.coordinator.registerPublicTournamentRead(client,tour,()=>track((async()=>{
   if(stopping)return;
   const started=Date.now(),epoch=loaded.observer.publicReadEpoch(client,tour,'clock');
   const controller=new AbortController(),timeout=AbortSignal.timeout(5000);state.clockController=controller;
   try{
    const response=await fetch(status.API_URL+'/rest/v1/rpc/get_public_tournament_clock_summary',{
     method:'POST',headers,body:JSON.stringify({p_tournament_id:tour}),signal:AbortSignal.any([controller.signal,timeout]),
    });
    if(response.status!==200)throw Object.assign(Error('AUDIENCE_HTTP_ERROR'),{audienceHttpStatus:response.status});
    const data=await response.json();
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
    state.epoch++;state.controller?.abort();state.known={};state.dirty.add('tables');
   }
   const clockSignal=audienceClockSignal(event);
   if(clockSignal.invalidate)state.clockController?.abort();
   for(const c of event.components)if(['tables','ranking','payout'].includes(c))state.dirty.add(c);
   if(event.components.includes('visibility'))for(const c of ['tables','ranking','payout'])state.dirty.add(c);
   if(state.dirty.size)state.coordinator.request();
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
 clearInterval(timer);stopping=true;
 endedAt=Date.now();connectedAtStop=clients.filter(c=>c.online).length;
 for(const state of clients){state.controller?.abort();state.clockController?.abort();state.coordinator.stop();state.clockCoordinator.stop();state.observation?.unsubscribe();}
 await Promise.all(clients.map(async({client})=>{await client.removeAllChannels();client.realtime.disconnect();}));
 await worker;await Promise.allSettled([...pending]);
 checks={zeroErrors:Object.keys(errors).length===0,atLeast30Seconds:readyAt!==null&&endedAt-readyAt>=30000,allViewers:clients.length===viewers&&connectedAtStop===viewers,
  allSawLaterTableRevision:clients.every(c=>c.ready&&c.changes>0),tableP95Within3Seconds:timings.table.length>=viewers&&dist(timings.table).p95Ms<=3000,
  sourceToSnapshotP95Within3Seconds:timings.sourceToSnapshot.length>=viewers&&dist(timings.sourceToSnapshot).p95Ms<=3000,
  publicationMaxWithin5Seconds:timings.sourceToPublication.length>=viewers&&dist(timings.sourceToPublication).maxMs<=5000};
 const passed=Object.values(checks).every(Boolean);
 phase=passed?'passed':'failed';if(!passed)process.exitCode=1;report();
}
