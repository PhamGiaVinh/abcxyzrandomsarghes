import { expect, test, type Page } from "@playwright/test";
import {readFileSync,writeFileSync} from 'node:fs';
import {createClient} from '@supabase/supabase-js';
import {financeBusinessToday,parseFinanceCore,assertFinanceCalendarScope} from '../src/lib/financeSummaryRead';

const required = [
  "LOCAL_SUPABASE_URL",
  "LOCAL_SUPABASE_ANON_KEY",
  "LOCAL_OWNER_EMAIL",
  "LOCAL_OWNER_PASSWORD",
  "LOCAL_SUPABASE_STORAGE_KEY",
  "LOCAL_REFUND_REGISTRATION_ID",
  "LOCAL_REFUND_REFERENCE_CODE",
];
for (const name of required) {
  if (!process.env[name]) throw new Error(`missing ${name}`);
}

async function loginOwner(page: Page) {
  const api = process.env.LOCAL_SUPABASE_URL!.replace(/\/$/, "");
  const anon = process.env.LOCAL_SUPABASE_ANON_KEY!;
  const response = await fetch(`${api}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: anon, "Content-Type": "application/json" },
    body: JSON.stringify({
      email: process.env.LOCAL_OWNER_EMAIL,
      password: process.env.LOCAL_OWNER_PASSWORD,
    }),
  });
  const session = await response.json();
  expect(response.ok).toBe(true);
  expect(session.access_token).toBeTruthy();

  await page.addInitScript(({ key, value }) => {
    localStorage.setItem(key, JSON.stringify(value));
  }, { key: process.env.LOCAL_SUPABASE_STORAGE_KEY!, value: session });
  return session.access_token as string;
}

async function loginFixtureStaff(){
 const staff=JSON.parse(readFileSync(process.env.LOCAL_OPERATIONS_STAFF_FILE!,'utf8')) as {email:string;password:string}[];
 expect(staff).toHaveLength(20);expect(new Set(staff.map(row=>row.email)).size).toBe(20);
 const identities=await Promise.all(staff.map(async row=>{
  const response=await fetch(process.env.LOCAL_SUPABASE_URL!.replace(/\/$/,'')+'/auth/v1/token?grant_type=password',{
   method:'POST',headers:{apikey:process.env.LOCAL_SUPABASE_ANON_KEY!,'Content-Type':'application/json'},body:JSON.stringify(row),signal:AbortSignal.timeout(10000),
  });
  const session=await response.json();expect(response.ok).toBe(true);expect(typeof session.access_token).toBe('string');expect(typeof session.user?.id).toBe('string');
  return {token:session.access_token as string,userId:session.user.id as string};
 }));
 expect(new Set(identities.map(row=>row.userId)).size).toBe(20);
 return identities;
}

test('authenticated Cashier worklist HTTP latency on isolated fixture',async()=>{
 test.skip(!process.env.LOCAL_OPERATIONS_LATENCY_REPORT,'Latency output is enabled only by the isolated stack');
 test.setTimeout(120_000);
 expect(process.env.LOCAL_OPERATIONS_SOURCE_SHA).toMatch(/^[a-f0-9]{40}$/);
 const identities=await loginFixtureStaff();
 let identityCursor=0;
 const scenarios:{concurrency:number;samplesMs:number[];p50Ms:number;p95Ms:number;p99Ms:number;maxMs:number}[]=[];
 const read=async()=>{
  const token=identities[identityCursor++%identities.length].token;
  const started=performance.now();
  const response=await fetch(process.env.LOCAL_SUPABASE_URL!.replace(/\/$/,'')+'/rest/v1/rpc/cashier_tour_worklist_v1',{
   method:'POST',headers:{apikey:process.env.LOCAL_SUPABASE_ANON_KEY!,Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
   body:JSON.stringify({p_club_id:'a2000000-0000-4000-8000-000000000001',p_tournament_id:'a3000000-0000-4000-8000-000000000001',p_query:'',p_bucket:'all',p_page:0,p_limit:50}),signal:AbortSignal.timeout(5000),
  });
  const result=await response.json(),elapsed=performance.now()-started;
  expect(response.ok).toBe(true);expect(result.ok).toBe(true);expect(result.error).toBeUndefined();
  expect(Array.isArray(result.rows)).toBe(true);expect(result.rows.length).toBeGreaterThan(0);
  return elapsed;
 };
 for(const concurrency of [1,5,20]){
  const batch=async(count:number)=>{
   let cursor=0;const samples:number[]=[];
   await Promise.all(Array.from({length:Math.min(concurrency,count)},async()=>{
    while(cursor<count){cursor++;samples.push(await read());}
   }));
   expect(samples).toHaveLength(count);return samples;
  };
  await batch(20);
  const samples=await batch(100),ordered=[...samples].sort((a,b)=>a-b);
  scenarios.push({concurrency,samplesMs:samples,p50Ms:ordered[49],p95Ms:ordered[94],p99Ms:ordered[98],maxMs:ordered[99]});
 }
 writeFileSync(process.env.LOCAL_OPERATIONS_LATENCY_REPORT!,JSON.stringify({kind:'REAL_AUTHENTICATED_POSTGREST_CASHIER_READ_LATENCY',sha:process.env.LOCAL_OPERATIONS_SOURCE_SHA,operation:'cashier_tour_worklist_v1',actors:identities.length,actorScope:'Distinct local Auth users with actual Cashier membership;round-robin requests',warmupPerScenario:20,gradedPerScenario:100,scenarios,transport:'Actual HTTP through isolated gateway; complete JSON body; excludes login',qualification:false,limitations:'Small fixed TEST tour,no Realtime,no concurrent writers; not production capacity or screen render latency'},null,2));
});

test('real check-in HTTP commit, independent observation, exact retry and tenant boundary',async({page})=>{
 test.skip(process.env.LOCAL_OPERATIONS_CHECKIN_ENABLED!=='1','Contemporary isolated check-in fixture only');
 test.setTimeout(180_000);
 expect(process.env.LOCAL_OPERATIONS_SOURCE_SHA).toMatch(/^[a-f0-9]{40}$/);
 const fixture=JSON.parse(readFileSync(process.env.LOCAL_OPERATIONS_DEALER_FILE!,'utf8')) as {
  clubId:string;shiftId:string;dealerIds:string[];otherClubId:string;otherShiftId:string;otherDealerId:string;otherAttendedDealerId:string;
 };
 expect(fixture.clubId).toBe('a2000000-0000-4000-8000-000000000001');
 const uiWarmup=2,uiGraded=20;
 const expectedCount=process.env.LOCAL_OPERATIONS_REALTIME==='1'?360+uiWarmup+uiGraded:360;
 expect(fixture.dealerIds).toHaveLength(expectedCount);expect(new Set(fixture.dealerIds).size).toBe(expectedCount);
 for(const id of [fixture.clubId,fixture.shiftId,fixture.otherClubId,fixture.otherShiftId,fixture.otherDealerId,fixture.otherAttendedDealerId,...fixture.dealerIds])expect(id).toMatch(/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/);
 const identities=await loginFixtureStaff(),api=process.env.LOCAL_SUPABASE_URL!.replace(/\/$/,''),anon=process.env.LOCAL_SUPABASE_ANON_KEY!;
 const realtimeEnabled=process.env.LOCAL_OPERATIONS_REALTIME==='1';
 const seen=new Map<string,number>(),expectedDealers=new Set(fixture.dealerIds),realtimeErrors:string[]=[];
 const realtimeStatuses:string[]=[],systemEvents:{status:string;extension:string;category:string}[]=[];
 const wireFrames:{idTypes:string[];idsCount:number;bindingMatch:boolean;eventType:string;errorCount:number}[]=[];
 let bindingIds:unknown[]=[];
 let observer:ReturnType<typeof createClient>|undefined,observing=false,duplicateEvents=0;
 const uiObservations:{writeToVisibleMs:number;warmup:boolean}[]=[];
 // The same available dealer can also appear in the staffing/prediction cards.
 // Observe the actual searched roster, not an arbitrary duplicate elsewhere.
 const uiRoster=page.getByPlaceholder('Tìm dealer...',{exact:true}).locator('xpath=../..');
 const uiFailedReads:{status:number;path:string}[]=[];
 page.on('response',response=>{if(response.status()>=400&&uiFailedReads.length<20)uiFailedReads.push({status:response.status(),path:new URL(response.url()).pathname});});
 const samples:{concurrency:number;graded:number;firstAckMs:number[];independentReadAfterAckMs:number[];writeToObservedMs:number[];retryAckMs:number[];writeToRealtimeMs:number[]}[]=[];
 try{
 if(realtimeEnabled){
  observer=createClient(api,anon,{accessToken:async()=>identities[19].token,auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},realtime:{logger:(kind,message,payload)=>{
   if(kind!=='receive')return;
   if(Array.isArray(payload?.response?.postgres_changes))bindingIds=payload.response.postgres_changes.map((row:{id:unknown})=>row.id);
   if(!/\bpostgres_changes\b/.test(message))return;
   const ids=Array.isArray(payload?.ids)?payload.ids:[],type=payload?.data?.type;
   // Observe before SDK channel filtering, but retain no record, token or ID.
   wireFrames.push({idTypes:[...new Set(ids.map((id:unknown)=>typeof id))] as string[],idsCount:ids.length,bindingMatch:ids.some((id:unknown)=>bindingIds.includes(id)),eventType:['INSERT','UPDATE','DELETE'].includes(type)?type:'other',errorCount:Array.isArray(payload?.data?.errors)?payload.data.errors.length:0});
  }}});
  await observer.realtime.setAuth(identities[19].token);
  await new Promise<void>((resolve,reject)=>{
   let channelJoined=false,postgresReady=false;
   const timeout=setTimeout(()=>reject(Error('CHECKIN_REALTIME_JOIN_TIMEOUT')),15000);
   const ready=()=>{if(channelJoined&&postgresReady){clearTimeout(timeout);resolve();}};
   observer!.channel('isolated-checkin-observer').on('system',{},payload=>{
    // Persist only classifications, never raw server messages or JWTs.
    const message=String(payload.message??'').toLowerCase();
    systemEvents.push({status:String(payload.status??'').slice(0,40),extension:String(payload.extension??'').slice(0,40),category:
     /permission|privilege|denied/.test(message)?'permission':/publication/.test(message)?'publication':/connect|timeout/.test(message)?'connection':/subscribed/.test(message)?'subscribed':'other'});
    if(payload.extension==='postgres_changes'){
     if(payload.status==='ok'){postgresReady=true;ready();}
     else if(payload.status==='error'){clearTimeout(timeout);reject(Error('CHECKIN_REALTIME_POSTGRES_SUBSCRIBE_FAILED'));}
    }
   }).on('postgres_changes',{event:'INSERT',schema:'public',table:'dealer_attendance'},payload=>{
    const row=payload.new;
    if(!expectedDealers.has(row.dealer_id)||row.status!=='checked_in'||row.current_state!=='available'){realtimeErrors.push('unexpected_scope_or_state');return;}
    if(seen.has(row.dealer_id))duplicateEvents++;else seen.set(row.dealer_id,performance.now());
   }).subscribe(status=>{
    realtimeStatuses.push(status);
    if(status==='SUBSCRIBED'){channelJoined=true;ready();}
    else if(status==='CHANNEL_ERROR'||status==='TIMED_OUT'){clearTimeout(timeout);reject(Error('CHECKIN_REALTIME_JOIN_FAILED'));}
    if(observing&&status!=='SUBSCRIBED')realtimeErrors.push('observer_disconnected');
   });
  });
  observing=true;
 }
 const headers=(token:string)=>({apikey:anon,Authorization:`Bearer ${token}`,'Content-Type':'application/json'});
 const rpc=async(token:string,name:string,args:Record<string,unknown>)=>{
  const response=await fetch(api+'/rest/v1/rpc/'+name,{method:'POST',headers:headers(token),body:JSON.stringify(args),signal:AbortSignal.timeout(5000)});
  const body=await response.json();expect(response.ok).toBe(true);return body;
 };
 const read=async(token:string,dealerId:string)=>{
  const response=await fetch(api+'/rest/v1/dealer_attendance?select=id,dealer_id,status,current_state&dealer_id=eq.'+dealerId,{headers:headers(token),signal:AbortSignal.timeout(5000)});
  const body=await response.json();expect(response.ok).toBe(true);expect(Array.isArray(body)).toBe(true);return body;
 };
 const denied=await rpc(identities[0].token,'operator_check_in_dealer_v1',{
  p_dealer_id:fixture.otherDealerId,p_club_id:fixture.otherClubId,p_shift_id:fixture.otherShiftId,p_request_id:crypto.randomUUID(),
 });
 expect(denied).toEqual({ok:false,error:'actor_not_allowed'});
 expect(await read(identities[0].token,fixture.otherDealerId)).toEqual([]);
 // The privileged fixture asserts this second attendance really exists.
 // Empty output here therefore exercises RLS, not an absent row.
 expect(await read(identities[0].token,fixture.otherAttendedDealerId)).toEqual([]);
 let cursor=0;
 const write=async()=>{
  const index=cursor++,identity=identities[index%identities.length],dealerId=fixture.dealerIds[index],requestId=crypto.randomUUID();
  expect(dealerId).toBeTruthy();
  const args={p_dealer_id:dealerId,p_club_id:fixture.clubId,p_shift_id:fixture.shiftId,p_request_id:requestId};
  let uiDealerName:string|null=null;
  if(realtimeEnabled&&index>=360){
   // Observe each new check-in in the same product screen. Never reload or
   // trigger a manual refresh after the write to manufacture synchronization.
   const response=await fetch(api+'/rest/v1/dealers?select=full_name&id=eq.'+dealerId,{headers:headers(identity.token),signal:AbortSignal.timeout(5000)});
   expect(response.ok).toBe(true);const names=await response.json();expect(names).toHaveLength(1);
   uiDealerName=names[0].full_name;expect(typeof uiDealerName).toBe('string');
   if(index===360){
   await loginOwner(page);await page.setViewportSize({width:1440,height:1000});
   const initialAttendance=page.waitForResponse(response=>{
    const url=new URL(response.url()),select=url.searchParams.get('select')??'';
    return response.request().method()==='GET'&&url.pathname==='/rest/v1/dealer_attendance'&&url.searchParams.get('status')==='eq.checked_in'&&select.includes('dealers!inner(')&&url.searchParams.has('dealers.club_id');
   },{timeout:30_000});
   await page.goto('/ops/dealer-swing?club='+fixture.clubId);
   expect(await page.evaluate(()=>window.isSecureContext&&typeof crypto.randomUUID==='function'),
    'Isolated operational browser must supply the secure-context API available on production HTTPS').toBe(true);
   const initialResponse=await initialAttendance;expect(initialResponse.ok()).toBe(true);
   const initialRows=await initialResponse.json();expect(Array.isArray(initialRows)).toBe(true);
   expect(initialRows).toHaveLength(360);
   expect(initialRows.some((row:{dealer_id:string})=>row.dealer_id===dealerId)).toBe(false);
   // The Ops gate deliberately crosses into the full operational document.
   // Do not measure the unmounted read-only workspace behind that gate.
   await expect(page).toHaveURL(/\/dealer-swing$/);
   await page.getByRole('button',{name:'ĐỘI HÌNH / CHECK-IN',exact:true}).click();
   }
   await expect(page.getByRole('button',{name:`Check-out (${index})`,exact:true})).toBeVisible();
   await page.getByPlaceholder('Tìm dealer...',{exact:true}).fill(uiDealerName!);
   await expect(uiRoster.getByText(uiDealerName!,{exact:true})).toHaveCount(0);
  }
  const started=performance.now(),receipt=await rpc(identity.token,'operator_check_in_dealer_v1',args),ack=performance.now();
  expect(receipt.ok).toBe(true);expect(receipt.outcome).toBe('checked_in');
  const rows=await read(identity.token,dealerId),observed=performance.now();
  expect(rows).toHaveLength(1);expect(rows[0]).toMatchObject({id:receipt.attendance_id,dealer_id:dealerId,status:'checked_in',current_state:'available'});
  const retryStarted=performance.now(),repeated=await rpc(identity.token,'operator_check_in_dealer_v1',args),retried=performance.now();
  expect(repeated).toEqual(receipt);
  if(index===0){
   const otherActor=await rpc(identities[1].token,'get_dealer_checkin_receipt_v1',args);
   expect(otherActor).toEqual({ok:true,status:'unknown'});
  }
  let writeToRealtimeMs:number|null=null;
  if(realtimeEnabled){
   expect(await read(identities[19].token,dealerId),'WebSocket observer must independently have actual RLS read access').toHaveLength(1);
   const deadline=started+5000;
   while(!seen.has(dealerId)&&performance.now()<deadline)await new Promise(resolve=>setTimeout(resolve,10));
   expect(seen.has(dealerId),'Every committed check-in must reach the independent authenticated WebSocket observer').toBe(true);
   writeToRealtimeMs=seen.get(dealerId)!-started;
   expect(writeToRealtimeMs).toBeLessThanOrEqual(5000);
   if(uiDealerName){
    await expect(page.getByRole('button',{name:`Check-out (${index+1})`,exact:true})).toBeVisible({timeout:Math.max(1,5000-(performance.now()-started))});
    await expect(uiRoster.getByText(uiDealerName,{exact:true})).toBeVisible({timeout:Math.max(1,5000-(performance.now()-started))});
    const writeToVisibleMs=performance.now()-started;
    expect(writeToVisibleMs).toBeLessThanOrEqual(5000);
    uiObservations.push({writeToVisibleMs,warmup:index<360+uiWarmup});
   }
  }
  return {firstAckMs:ack-started,independentReadAfterAckMs:observed-ack,writeToObservedMs:observed-started,retryAckMs:retried-retryStarted,writeToRealtimeMs};
 };
 for(const concurrency of [1,5,20]){
  const batch=async(count:number)=>{
   let launched=0;const rows:Awaited<ReturnType<typeof write>>[]=[];
   await Promise.all(Array.from({length:Math.min(concurrency,count)},async()=>{while(launched<count){launched++;rows.push(await write());}}));
   expect(rows).toHaveLength(count);return rows;
  };
  await batch(20);const rows=await batch(100);
  samples.push({concurrency,graded:rows.length,firstAckMs:rows.map(r=>r.firstAckMs),independentReadAfterAckMs:rows.map(r=>r.independentReadAfterAckMs),writeToObservedMs:rows.map(r=>r.writeToObservedMs),retryAckMs:rows.map(r=>r.retryAckMs),writeToRealtimeMs:rows.map(r=>r.writeToRealtimeMs).filter((value):value is number=>value!==null)});
 }
 // UI writes start only after all measured concurrent writers finish. Keep
 // this one open screen mounted; exclude its serial writes from 1/5/20 samples.
 if(realtimeEnabled)for(let sample=0;sample<uiWarmup+uiGraded;sample++)await write();
 expect(cursor).toBe(expectedCount);
 expect(realtimeErrors).toEqual([]);if(realtimeEnabled)expect(seen.size).toBe(expectedCount);
 const summarize=(values:number[])=>{const ordered=[...values].sort((a,b)=>a-b);expect(ordered).toHaveLength(100);expect(ordered.every(v=>Number.isFinite(v)&&v>=0)).toBe(true);return {p50Ms:ordered[49],p95Ms:ordered[94],p99Ms:ordered[98],maxMs:ordered[99]};};
 const uiTimings=uiObservations.filter(row=>!row.warmup).map(row=>row.writeToVisibleMs).sort((a,b)=>a-b);
 if(realtimeEnabled)expect(uiTimings).toHaveLength(uiGraded);
 writeFileSync(process.env.LOCAL_OPERATIONS_CHECKIN_REPORT!,JSON.stringify({kind:realtimeEnabled?'REAL_AUTH_HTTP_CHECKIN_AND_POSTGRES_CHANGES_WEBSOCKET_OBSERVATION':'REAL_AUTH_HTTP_CHECKIN_COMMIT_AND_INDEPENDENT_DATA_API_OBSERVATION',sha:process.env.LOCAL_OPERATIONS_SOURCE_SHA,actors:identities.length,actorScope:'Distinct local Auth users with actual club_dealer_controls membership;round-robin requests',fixtureSchemaAdditions:['exact14','exact51'],warmupPerScenario:20,gradedPerScenario:100,
  realtime:{enabled:realtimeEnabled,observers:realtimeEnabled?1:0,uniqueEvents:seen.size,duplicateEvents,errors:realtimeErrors,clock:'write-start and actual SDK callback use same monotonic client clock;not pure server-commit timing',postgresImage:realtimeEnabled?'17.6.1.155 pinned digest;see harness':'CLI default'},
  uiObservation:realtimeEnabled?{path:'/dealer-swing',actors:1,concurrency:1,warmup:uiWarmup,graded:uiGraded,rows:uiObservations,distribution:{p50Ms:uiTimings[9],p95Ms:uiTimings[18],p99Ms:uiTimings[19],maxMs:uiTimings[19]}}:null,
  uiObservationLimitations:'One actual open Dealer Swing screen,serial check-ins;Node monotonic intent to Playwright count+named-roster assertion upper bound;20graded samples give coarse p95,not concurrent screen capacity',
  scenarios:samples.map(row=>({...row,distributions:{firstAck:summarize(row.firstAckMs),independentReadAfterAck:summarize(row.independentReadAfterAckMs),writeToObserved:summarize(row.writeToObservedMs),retryAck:summarize(row.retryAckMs),writeToRealtime:realtimeEnabled?summarize(row.writeToRealtimeMs):null}})),crossTenantDenied:true,crossActorReceiptUnknown:true,exactRetryMatched:true,qualification:false,
  limitations:'360HTTP-phase synthetic dealers plus optional22serial UI-phase dealers;small fixture;one SDK WS observer with20writers and one actual UI screen,not20screens;no production capacity claim;native SQL postcheck verifies attendance/receipt cardinality.'},null,2));
 }catch(error){
  let uiDiagnostics:unknown=null;
  if(realtimeEnabled){
   try{const path=new URL(page.url()).pathname;uiDiagnostics={path,fixtureBody:['/ops/dealer-swing','/dealer-swing'].includes(path)?(await page.locator('body').innerText()).slice(0,2000):null,failedReads:uiFailedReads};}catch{uiDiagnostics={status:'fixture_page_unavailable',failedReads:uiFailedReads};}
  }
  if(realtimeEnabled)writeFileSync(process.env.LOCAL_OPERATIONS_CHECKIN_REPORT!,JSON.stringify({kind:'CHECKIN_REALTIME_FAILED_DIAGNOSTIC',sha:process.env.LOCAL_OPERATIONS_SOURCE_SHA,qualification:false,realtimeStatuses,systemEvents,wireFrames:wireFrames.slice(0,10),wireFrameCount:wireFrames.length,bindingIdTypes:bindingIds.map(id=>typeof id),uniqueEvents:seen.size,duplicateEvents,errors:realtimeErrors,completedScenarios:samples,completedUiObservations:uiObservations,uiDiagnostics,reason:'Actual check-in/observer assertions failed;completed phase samples do not override the failure'},null,2));
  throw error;
 }finally{observing=false;if(observer){await observer.removeAllChannels();await observer.realtime.disconnect();}}
});

test('Floor and Dealer Swing authenticated HTTP read latency after check-in',async({page})=>{
 test.skip(process.env.LOCAL_OPERATIONS_CHECKIN_ENABLED!=='1','Contemporary isolated operation fixture only');
 test.setTimeout(180_000);
 const token=await loginOwner(page),api=process.env.LOCAL_SUPABASE_URL!.replace(/\/$/,''),anon=process.env.LOCAL_SUPABASE_ANON_KEY!;
 const clubId='a2000000-0000-4000-8000-000000000001',tourId='a3000000-0000-4000-8000-000000000001';
 const operations=[
  {rpc:'get_floor_tournament_table_inventory_v1',args:{p_tournament_id:tourId},shape:'inventory'},
  {rpc:'get_floor_tournament_table_roster_v5',args:{p_tournament_id:tourId},shape:'roster'},
  {rpc:'list_tracker_floor_alerts',args:{p_tournament_id:tourId,p_status:null},shape:'alerts'},
  {rpc:'get_table_assignments_with_next',args:{p_club_id:clubId},shape:'assignments'},
  {rpc:'get_dealer_swing_health',args:{p_club_ids:[clubId]},shape:'health'},
 ] as const;
 const results:unknown[]=[];
 const report=()=>writeFileSync(process.env.LOCAL_OPERATIONS_LATENCY_REPORT!.replace(/\.json$/,'-operations-http.json'),JSON.stringify({
  kind:'REAL_AUTHENTICATED_POSTGREST_OPERATION_READ_LATENCY',sha:process.env.LOCAL_OPERATIONS_SOURCE_SHA,
  fixture:{clubId,tourId,phase:'after canonical check-in; no initial dealer assignment'},
  actors:1,actorScope:'Actual local Auth club owner; concurrent requests share this identity,not independent staff',
  warmupPerScenario:20,gradedPerScenario:100,results,qualification:false,
  limitations:'Small isolated tour; complete HTTP JSON bodies; excludes login,rendering,concurrent writers and cross-screen propagation. Empty alert/assignment/roster results are explicitly counted,not populated-workload proof.',
 },null,2));
 for(const operation of operations)for(const concurrency of [1,5,20]){
  const cardinalities=new Set<number>();
  const read=async()=>{
   const started=performance.now();
   const response=await fetch(`${api}/rest/v1/rpc/${operation.rpc}`,{
    method:'POST',headers:{apikey:anon,Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
    body:JSON.stringify(operation.args),signal:AbortSignal.timeout(5000),
   });
   const payload=await response.json(),elapsed=performance.now()-started;
   expect(response.ok,operation.rpc).toBe(true);
   if(operation.shape==='alerts'){
    expect(payload.ok).toBe(true);expect(payload.error).toBeUndefined();expect(Array.isArray(payload.alerts)).toBe(true);
    cardinalities.add(payload.alerts.length);
   }else{
    expect(Array.isArray(payload),operation.rpc).toBe(true);cardinalities.add(payload.length);
    if(operation.shape==='inventory'){
     expect(payload.some((row:{game_table_id:string})=>row.game_table_id==='a7000000-0000-4000-8000-000000000001')).toBe(true);
    }
    if(operation.shape==='health'){
     expect(payload).toHaveLength(1);expect(payload[0].club_id).toBe(clubId);
     expect(typeof payload[0].overdue_now).toBe('number');expect(typeof payload[0].lock?.held).toBe('boolean');
    }
   }
   return elapsed;
  };
  const batch=async(count:number)=>{
   let cursor=0;const samples:number[]=[];
   await Promise.all(Array.from({length:Math.min(concurrency,count)},async()=>{while(cursor<count){cursor++;samples.push(await read());}}));
   expect(samples).toHaveLength(count);return samples;
  };
  try{
   await batch(20);const samples=await batch(100),ordered=[...samples].sort((a,b)=>a-b);
   expect(ordered.every(value=>Number.isFinite(value)&&value>=0)).toBe(true);
   results.push({rpc:operation.rpc,concurrency,samplesMs:samples,rowCounts:[...cardinalities].sort((a,b)=>a-b),p50Ms:ordered[49],p95Ms:ordered[94],p99Ms:ordered[98],maxMs:ordered[99],status:'passed'});
   report();
  }catch(error){
   // Retain completed phases without leaking response bodies, tokens or claims.
   results.push({rpc:operation.rpc,concurrency,status:'failed'});report();throw error;
  }
 }
});

test('canonical Floor open and close propagate into one continuously open screen',async({page})=>{
 test.skip(process.env.LOCAL_OPERATIONS_REALTIME!=='1','Contemporary isolated Realtime operation fixture only');
 test.setTimeout(60_000);
 const token=await loginOwner(page),api=process.env.LOCAL_SUPABASE_URL!.replace(/\/$/,''),anon=process.env.LOCAL_SUPABASE_ANON_KEY!;
 const tourId='a3000000-0000-4000-8000-000000000001';
 const fixture=JSON.parse(readFileSync(process.env.LOCAL_OPERATIONS_DEALER_FILE!,'utf8')) as {floorTable:{id:string;tableNumber:number}};
 expect(fixture.floorTable?.id).toMatch(/^[a-f0-9-]{36}$/);expect(fixture.floorTable.tableNumber).toBeGreaterThanOrEqual(1);expect(fixture.floorTable.tableNumber).toBeLessThanOrEqual(100);
 const gameTableId=fixture.floorTable.id;
 const rpc=async(name:string,args:Record<string,unknown>)=>{
  const response=await fetch(`${api}/rest/v1/rpc/${name}`,{method:'POST',headers:{apikey:anon,Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(args),signal:AbortSignal.timeout(5000)});
  const payload=await response.json();expect(response.ok,name).toBe(true);return payload;
 };
 const rows:{operation:string;ackMs:number;writeToVisibleMs?:number;status:string}[]=[];
 let phase='screen-load',committedOpen=false,independentRosterConfirmed=false,rosterRpc='',postgresReady=false;
 const openedHints=new Set<string>(),closedHints=new Set<string>();
 page.on('websocket',socket=>socket.on('framereceived',frame=>{
  try{
   const decoded=JSON.parse(typeof frame.payload==='string'?frame.payload:frame.payload.toString());
   // The installed SDK defaults to Phoenix V2 [join_ref,ref,topic,event,payload].
   const message=Array.isArray(decoded)?{topic:decoded[2],event:decoded[3],payload:decoded[4]}:decoded;
   if(typeof message.topic!=='string'||!message.topic.startsWith('realtime:floor-map-v3:'))return;
   const payload=message.payload;
   if(message.event==='system'&&payload?.status==='ok'&&payload?.extension==='postgres_changes')postgresReady=true;
   const data=payload?.data,row=data?.record;
   if(message.event!=='postgres_changes'||!row)return;
   const session=data.table==='table_sessions'?row.id:data.table==='tournament_tables'?row.table_session_id:null;
   if(typeof session!=='string')return;
   if((data.table==='table_sessions'&&row.closed_at!=null)||(data.table==='tournament_tables'&&row.status==='closed'))closedHints.add(session);
   else openedHints.add(session);
  }catch{/* Do not retain raw frames, claims or row payloads in artifacts. */}
 }));
 const report=()=>writeFileSync(process.env.LOCAL_OPERATIONS_LATENCY_REPORT!.replace(/\.json$/,'-floor-session-ui-http.json'),JSON.stringify({
  kind:'ACTUAL_FLOOR_SESSION_WRITE_AND_OPEN_SCREEN_OBSERVATION',sha:process.env.LOCAL_OPERATIONS_SOURCE_SHA,
  actors:1,concurrency:1,gradedPerOperation:1,phase,committedOpen,independentRosterConfirmed,rosterRpc,postgresReady,rows,
  fixtureBuild:{floorV3:'preview',floorUatEnvironment:'preview',redraw:'off'},
  qualification:false,limitations:'Single canonical open/close pair on an empty TEST table. One observation has no meaningful p95;not seat-move/dealer handover or concurrent operational acceptance. No manual refresh/reload after initial screen load.',
 },null,2));
 try{
  const loaded=page.waitForResponse(response=>/\/rpc\/get_floor_tournament_table_roster_v(?:3|6)$/.test(new URL(response.url()).pathname)&&response.status()===200);
  await page.goto(`/ops/floor/tournaments/${tourId}/tables?club=a2000000-0000-4000-8000-000000000001`);
  const initialReply=await loaded;rosterRpc=new URL(initialReply.url()).pathname.split('/').at(-1)!;
  expect(Array.isArray(await initialReply.json())).toBe(true);
  await expect(page.getByTestId('floor-table-map-v3')).toBeVisible();
  await expect.poll(()=>postgresReady,{timeout:15_000}).toBe(true);
  await expect(page.getByTestId('floor-table-map-v3').locator('[data-ops-action="floor.tables.refresh"]')).toBeEnabled();
  await expect(page.getByTestId('floor-table-map-v3').getByRole('alert')).toHaveCount(0);
  const card=page.locator(`[data-testid="floor-table-roster-card"][data-floor-table-number="${fixture.floorTable.tableNumber}"]`);
  await expect(card).toHaveCount(0);
  phase='open';const started=performance.now();
  const intent={p_tournament_id:tourId,p_game_table_id:gameTableId,p_control_mode:'manual',p_request_id:crypto.randomUUID()};
  const opened=await rpc('floor_open_tournament_table_v3',intent);expect(opened.ok).toBe(true);committedOpen=true;
  rows.push({operation:'open',ackMs:performance.now()-started,status:'committed'});report();
  expect(await rpc('floor_open_tournament_table_v3',intent)).toEqual(opened);
  const roster=await rpc(rosterRpc,{p_tournament_id:tourId});
  expect(Array.isArray(roster)).toBe(true);expect(roster.some((row:{table_session_id:string})=>row.table_session_id===opened.table_session_id)).toBe(true);
  independentRosterConfirmed=true;report();
  await expect.poll(()=>openedHints.has(opened.table_session_id),{timeout:Math.max(1,5000-(performance.now()-started))}).toBe(true);
  await expect(card).toBeVisible({timeout:Math.max(1,5000-(performance.now()-started))});
  rows[0].writeToVisibleMs=performance.now()-started;rows[0].status='visible';report();
  phase='close';const closing=performance.now();
  const closeIntent={p_tournament_table_id:opened.tournament_table_id,p_expected_revision:opened.revision,p_request_id:crypto.randomUUID()};
  const closed=await rpc('close_tournament_table_v3',closeIntent);expect(closed.ok).toBe(true);
  rows.push({operation:'close',ackMs:performance.now()-closing,status:'committed'});report();
  expect(await rpc('close_tournament_table_v3',closeIntent)).toEqual(closed);
  await expect.poll(()=>closedHints.has(opened.table_session_id),{timeout:Math.max(1,5000-(performance.now()-closing))}).toBe(true);
  await expect(card).toHaveCount(0,{timeout:Math.max(1,5000-(performance.now()-closing))});
  rows[1].writeToVisibleMs=performance.now()-closing;rows[1].status='visible';phase='passed';report();
 }catch(error){phase+='-failed';report();throw error;}
});

test('Cashier browser navigation and populated tour render latency',async({page})=>{
 test.skip(!process.env.LOCAL_OPERATIONS_LATENCY_REPORT,'Isolated stack measurement only');
 test.setTimeout(180_000);
 await loginOwner(page);
 await page.setViewportSize({width:375,height:844});
 const errors:string[]=[];
 page.on('pageerror',error=>errors.push(error.message));
 const rows:{navigationToTourListMs:number;selectionToPopulatedWorklistMs:number}[]=[];
 // Two warm navigations and ten measured navigations; each uses the real UI,
 // Auth session and backend. These are serial staff reads, not viewer capacity.
 for(let index=0;index<12;index++){
  const navigationStarted=performance.now();
  await page.goto('/ops/cashier/tour?club=a2000000-0000-4000-8000-000000000001');
  await expect(page.getByText('ACTIVE',{exact:true})).toBeVisible({timeout:30_000});
  const tour=page.getByRole('button',{name:/^Cashier Edge TEST Tour ·/}).first();
  await expect(tour).toBeVisible();
  const listRendered=performance.now();
  const selectionStarted=performance.now();
  await tour.click();
  await page.getByRole('button',{name:/Đã tự hoàn tất/}).click();
  await expect(page.getByRole('button',{name:/Người chơi Edge TEST/})).toBeVisible();
  await expect(page.getByText(/Phiếu đã cấp: bàn 1, ghế \d+/u)).toBeVisible();
  const worklistRendered=performance.now();
  if(index>=2)rows.push({navigationToTourListMs:listRendered-navigationStarted,selectionToPopulatedWorklistMs:worklistRendered-selectionStarted});
 }
 expect(errors).toEqual([]);expect(rows).toHaveLength(10);
 const summarize=(values:number[])=>{
  const ordered=[...values].sort((a,b)=>a-b);
  expect(ordered.every(value=>Number.isFinite(value)&&value>=0)).toBe(true);
  return {samples:ordered.length,p50Ms:ordered[4],p95Ms:ordered[9],maxMs:ordered[9]};
 };
 writeFileSync(process.env.LOCAL_OPERATIONS_LATENCY_REPORT!.replace(/\.json$/,'-ui-http.json'),JSON.stringify({
  kind:'REAL_CHROMIUM_AUTHENTICATED_CASHIER_RENDER_LATENCY',sha:process.env.LOCAL_OPERATIONS_SOURCE_SHA,
  viewport:{width:375,height:844},actors:1,concurrency:1,warmup:2,graded:10,rows,
  distributions:{navigationToTourList:summarize(rows.map(row=>row.navigationToTourListMs)),selectionToPopulatedWorklist:summarize(rows.map(row=>row.selectionToPopulatedWorklistMs))},
  qualification:false,limitations:'Small isolated populated fixture;serial owner navigation;Playwright visibility observation includes browser automation overhead;ten samples give coarse p95 equal to max;not cross-screen Realtime,concurrent staff or production capacity',
 },null,2));
});

test("real Auth and Cashier backend render the completed seated buy-in", async ({ page }) => {
  await loginOwner(page);
  const cashierReads: string[] = [];
  page.on("response", async (response) => {
    if (response.url().includes("/rpc/cashier_tour_worklist_v1")) {
      cashierReads.push(`${response.status()} ${(await response.text()).slice(0, 700)}`);
    }
  });

  const pageErrors: string[] = [];
  const requestFailures: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("requestfailed", (request) => {
    requestFailures.push(`${request.method()} ${request.url()} ${request.failure()?.errorText ?? "failed"}`);
  });
  await page.setViewportSize({ width: 375, height: 844 });
  await page.goto("/ops/cashier/tour?club=a2000000-0000-4000-8000-000000000001");

  try {
    await expect(page.getByText("ACTIVE", { exact: true })).toBeVisible({ timeout: 30_000 });
  } catch (error) {
    console.error(JSON.stringify({
      browser_url: page.url(),
      body: (await page.locator("body").innerText()).slice(0, 2_000),
      page_errors: pageErrors,
      request_failures: requestFailures,
    }, null, 2));
    throw error;
  }
  await page.getByRole("button", { name: /^Cashier Edge TEST Tour ·/ }).first().click();
  await page.getByRole("button", { name: /Đã tự hoàn tất/ }).click();
  try {
    await expect(page.getByRole("button", { name: /Người chơi Edge TEST/ })).toBeVisible();
  } catch (error) {
    console.error(JSON.stringify({ body: (await page.locator("body").innerText()).slice(0, 2_000), cashierReads }));
    throw error;
  }
  await expect(page.getByText(/Phiếu đã cấp: bàn 1, ghế \d+/u)).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(pageErrors).toEqual([]);
});

test("real Cashier UI refunds a waiting Tour B registration while serving Tour A", async ({ page }) => {
  const token = await loginOwner(page);
  const lookupReads: string[] = [];
  page.on("response", async (response) => {
    if (response.url().includes("/rpc/cashier_lookup_tour_v1")) {
      lookupReads.push(`${response.status()} ${(await response.text()).slice(0, 700)}`);
    }
  });
  const registrationId = process.env.LOCAL_REFUND_REGISTRATION_ID!;
  const referenceCode = process.env.LOCAL_REFUND_REFERENCE_CODE!;
  await page.setViewportSize({ width: 375, height: 844 });
  await page.goto("/ops/cashier/tour?club=a2000000-0000-4000-8000-000000000001");
  await expect(page.getByText("ACTIVE", { exact: true })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: /^Cashier Edge TEST Tour ·/ }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: "Cashier Edge TEST Tour" })).toBeVisible();
  await page.getByPlaceholder("Quét QR, thẻ hội viên, mã CK; hoặc tìm tên, số điện thoại").fill(referenceCode);
  try {
    await page.getByRole("button", { name: "Xem đăng ký tour này" }).waitFor({ state: "visible", timeout: 10_000 });
  } catch (error) {
    console.error(JSON.stringify({ body: (await page.locator("body").innerText()).slice(0, 2_000), lookupReads }));
    throw error;
  }
  await page.getByRole("button", { name: "Xem đăng ký tour này" }).click();
  await expect(page.getByRole("dialog", { name: /Chi tiết buy-in/ })
    .getByText("Tour của lượt này: Cashier Edge TEST Tour B")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Cashier Edge TEST Tour" })).toBeVisible();

  const detail = page.getByRole("dialog", { name: /Chi tiết buy-in/ });
  await detail.getByLabel("Lý do").fill("TEST refund before seating");
  const requestResponse = page.waitForResponse((response) => response.url().endsWith("/rpc/cashier_request_refund_v1"));
  await detail.getByRole("button", { name: "Yêu cầu hoàn tiền" }).click();
  const requested = await requestResponse;
  expect(requested.request().postDataJSON().p_registration_id).toBe(registrationId);
  expect((await requested.json()).ok).toBe(true);
  await detail.getByLabel("Tiền mặt").fill("6600000");
  await detail.getByLabel("Chuyển khoản").fill("0");
  await detail.getByLabel("Bằng chứng chi hoàn").fill("TEST paid in isolated cashier E2E");
  page.once("dialog", (dialog) => dialog.accept());
  const payoutResponse = page.waitForResponse((response) => response.url().endsWith("/rpc/cashier_complete_refund_v1"));
  await detail.getByRole("button", { name: "Ghi nhận đã chi hoàn" }).click();
  const payout = await payoutResponse;
  expect((await payout.json()).ok).toBe(true);

  const retry = await page.evaluate(async ({ api, anon, accessToken, refundId }) => {
    const response = await fetch(`${api}/rest/v1/rpc/cashier_complete_refund_v1`, {
      method: "POST",
      headers: { apikey: anon, Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ p_refund_id: refundId, p_cash_amount: 6600000,
        p_bank_amount: 0, p_bank_reference: "", p_evidence: "TEST retry in isolated cashier E2E" }),
    });
    return { status: response.status, body: await response.json() };
  }, { api: process.env.LOCAL_SUPABASE_URL!, anon: process.env.LOCAL_SUPABASE_ANON_KEY!,
    accessToken: token, refundId: (await requested.json()).refund_id as string });
  expect(retry.status).toBe(200);
  expect(retry.body.already_paid).toBe(true);
});


test('Finance, Cashier cashflow and F&B actual authenticated HTTP report latency',async({page})=>{
 test.skip(process.env.LOCAL_OPERATIONS_CHECKIN_ENABLED!=='1','Contemporary isolated operation fixture only');
 test.setTimeout(180_000);
 const token=await loginOwner(page),api=process.env.LOCAL_SUPABASE_URL!.replace(/\/$/,''),anon=process.env.LOCAL_SUPABASE_ANON_KEY!;
 const clubId='a2000000-0000-4000-8000-000000000001',day=financeBusinessToday();
 const from=day+'T00:00:00+07:00',to=new Date(Date.parse(from)+86400000).toISOString();
 const operations=[
  {rpc:'get_club_finance_summary_v2',args:{p_from_date:day,p_to_date:day,p_club_id:clubId}},
  {rpc:'cashier_cashflow_range_v1',args:{p_club_id:clubId,p_from:from,p_to:to}},
  {rpc:'fnb_get_report',args:{p_club_id:clubId,p_from:from,p_to:to}},
 ];
 const results:unknown[]=[];
 const report=()=>writeFileSync(process.env.LOCAL_OPERATIONS_LATENCY_REPORT!.replace(/\.json$/,'-finance-fnb-http.json'),JSON.stringify({
  kind:'ACTUAL_AUTHENTICATED_FINANCE_FNB_HTTP_READS',sha:process.env.LOCAL_OPERATIONS_SOURCE_SHA,
  clubId,businessDay:day,actors:1,warmupPerScenario:20,gradedPerScenario:100,results,qualification:false,
  limitations:'One real Auth owner,concurrent requests share identity. Small existing isolated fixture; F&B may be empty. Complete JSON response and canonical contract validation; no render/propagation/concurrent writer or production capacity proof.',
 },null,2));
 for(const operation of operations)for(const concurrency of [1,5,20]){
  const observedCounts=new Set<number>();
  const read=async()=>{
   const started=performance.now();
   const response=await fetch(api+'/rest/v1/rpc/'+operation.rpc,{
    method:'POST',headers:{apikey:anon,Authorization:'Bearer '+token,'Content-Type':'application/json'},
    body:JSON.stringify(operation.args),signal:AbortSignal.timeout(5000),
   });
   const payload=await response.json(),elapsed=performance.now()-started;
   expect(response.ok,operation.rpc).toBe(true);expect(payload?.error).toBeUndefined();
   if(operation.rpc==='get_club_finance_summary_v2'){
    const {data}=parseFinanceCore(payload);assertFinanceCalendarScope(data,{from:day,to:day,clubId});
    expect(Array.isArray(data.perClub)).toBe(true);observedCounts.add((data.perClub as unknown[]).length);
   }else if(operation.rpc==='cashier_cashflow_range_v1'){
    expect(payload.ok).toBe(true);expect(payload.club_id).toBe(clubId);
    for(const key of ['cash_in','cash_out','bank_in','bank_out','unallocated_bank'])expect(Number.isFinite(payload.cash_flow?.[key]),key).toBe(true);
    // This isolated suite has already committed and retried the real 6.6M refund.
    expect(payload.cash_flow.cash_out).toBeGreaterThanOrEqual(6600000);
    expect(Number.isSafeInteger(payload.entry_allocation?.unclassified_entries)).toBe(true);
    observedCounts.add(payload.entry_allocation.unclassified_entries);
   }else{
    for(const key of ['revenue','cogs','grossProfit','orderCount','compCount','compCogs'])expect(Number.isFinite(payload?.[key]),key).toBe(true);
    for(const key of ['topItems','lowStock','dailyTrend','byTable','byPlayer'])expect(Array.isArray(payload?.[key]),key).toBe(true);
    expect(Number.isSafeInteger(payload.orderCount)&&payload.orderCount>=0).toBe(true);observedCounts.add(payload.orderCount);
   }
   return elapsed;
  };
  const batch=async(count:number)=>{
   let cursor=0;const samples:number[]=[];
   await Promise.all(Array.from({length:Math.min(count,concurrency)},async()=>{while(cursor<count){cursor++;samples.push(await read());}}));
   expect(samples).toHaveLength(count);return samples;
  };
  try{
   await batch(20);const samples=await batch(100),ordered=[...samples].sort((a,b)=>a-b);
   results.push({rpc:operation.rpc,concurrency,observedCounts:[...observedCounts],samplesMs:samples,p50Ms:ordered[49],p95Ms:ordered[94],p99Ms:ordered[98],maxMs:ordered[99],status:'passed'});report();
  }catch(error){results.push({rpc:operation.rpc,concurrency,status:'failed'});report();throw error;}
 }
});


test('canonical clock start reaches an already-open anonymous clock screen',async({page,browser})=>{
 test.skip(process.env.LOCAL_OPERATIONS_CHECKIN_ENABLED!=='1','Contemporary isolated operation fixture only');
 test.setTimeout(60_000);
 const token=await loginOwner(page),api=process.env.LOCAL_SUPABASE_URL!.replace(/\/$/,''),anon=process.env.LOCAL_SUPABASE_ANON_KEY!;
 const tourId='ac300000-0000-4000-8000-000000000001';
 const context=await browser.newContext({baseURL:process.env.PLAYWRIGHT_BASE_URL});
 const viewer=await context.newPage();let phase='initial-public-read',ackMs:number|undefined,visibleMs:number|undefined,independentRunning=false;
 const report=()=>writeFileSync(process.env.LOCAL_OPERATIONS_LATENCY_REPORT!.replace(/\.json$/,'-clock-ui-http.json'),JSON.stringify({
  kind:'CANONICAL_CLOCK_RPC_START_TO_ANONYMOUS_PUBLIC_SCREEN',sha:process.env.LOCAL_OPERATIONS_SOURCE_SHA,
  phase,ackMs,writeToVisibleMs:visibleMs,independentRunning,actors:1,anonymousObservers:1,gradedSamples:1,qualification:false,
  limitations:'Single start through the canonical RPC invoked by the Edge handler; not the Edge transport or pause/resume/next-level/CAS concurrency. Public screen uses its existing 15s polling;20s is an observation timeout,not a newly approved latency target. No refresh/reload after initial screen load.',
 },null,2));
 const rpc=async(name:string,args:unknown)=>{
  const response=await fetch(api+'/rest/v1/rpc/'+name,{method:'POST',headers:{apikey:anon,Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(args),signal:AbortSignal.timeout(5000)});
  const data=await response.json();expect(response.ok,name).toBe(true);return data;
 };
 try{
  await viewer.goto('/clock/'+tourId);
  await expect(viewer.getByRole('heading',{name:'Operations clock TEST',exact:true})).toBeVisible();
  await expect(viewer.getByText('Đồng hồ đang dừng',{exact:true})).toBeVisible();
  phase='start';const started=performance.now();
  const result=await rpc('floor_start_tournament_clock',{p_tournament_id:tourId});ackMs=performance.now()-started;expect(result.ok).toBe(true);report();
  const clock=await rpc('get_tournament_clock',{p_tournament_id:tourId});
  expect(clock.tournament_id).toBe(tourId);expect(clock.is_running).toBe(true);expect(clock.remaining_seconds).toBeGreaterThan(1100);independentRunning=true;report();
  await expect(viewer.getByText('Đồng hồ đang dừng',{exact:true})).toHaveCount(0,{timeout:Math.max(1,20000-(performance.now()-started))});
  await expect(viewer.getByRole('heading',{name:'Operations clock TEST',exact:true})).toBeVisible();
  await expect(viewer.getByText('Live',{exact:true})).toBeVisible();
  visibleMs=performance.now()-started;phase='passed';report();
 }catch(error){phase+='-failed';report();throw error;}finally{await context.close();}
});


test('real clock control HTTP latency and concurrent revision fencing',async()=>{
 test.skip(process.env.LOCAL_OPERATIONS_CHECKIN_ENABLED!=='1','Contemporary isolated operation fixture only');
 test.setTimeout(120_000);
 const staff=await loginFixtureStaff(),api=process.env.LOCAL_SUPABASE_URL!.replace(/\/$/,''),anon=process.env.LOCAL_SUPABASE_ANON_KEY!;
 const tourId='ac300000-0000-4000-8000-000000000001';
 const samples:{action:string;ackMs:number;observedMs:number;warmup:boolean}[]=[];let phase='initial',raceSuccesses=0,raceConflicts=0;
 const rpc=async(token:string,name:string,args:unknown)=>{
  const response=await fetch(api+'/rest/v1/rpc/'+name,{method:'POST',headers:{apikey:anon,Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(args),signal:AbortSignal.timeout(5000)});
  const data=await response.json();expect(response.ok,name).toBe(true);return data;
 };
 const read=async()=>{
  const value=await rpc(staff[19].token,'get_tournament_clock',{p_tournament_id:tourId});
  expect(value.tournament_id).toBe(tourId);expect(value.control_revision).toMatch(/^[a-f0-9]{32}$/);return value;
 };
 const report=()=>{
  const grouped=['pause','resume','next_level','previous_level','adjust_minus_30','adjust_plus_30'].map(action=>{
   const values=samples.filter(row=>row.action===action&&!row.warmup).map(row=>row.ackMs).sort((a,b)=>a-b);
   return {action,count:values.length,p50Ms:values.length?values[Math.ceil(values.length*.5)-1]:null,p95Ms:values.length?values[Math.ceil(values.length*.95)-1]:null,maxMs:values.at(-1)??null};
  });
  writeFileSync(process.env.LOCAL_OPERATIONS_LATENCY_REPORT!.replace(/\.json$/,'-clock-controls-http.json'),JSON.stringify({
   kind:'ACTUAL_AUTHENTICATED_CLOCK_RPC_CONTROLS',sha:process.env.LOCAL_OPERATIONS_SOURCE_SHA,phase,actors:staff.length,
   warmupPairs:5,gradedPairs:20,levelAdjustmentWarmupCycles:5,levelAdjustmentGradedCycles:20,samples,grouped,raceSuccesses,raceConflicts,qualification:false,
   limitations:'Canonical control RPC over real HTTP and actual Auth Cashier memberships; excludes Edge wrapper and screen rendering. Serial pause/resume pairs, paused next/previous level and minus/plus30s cycles, plus one20-actor same-revision race; not broad tour-load, automatic break/advance or screen acceptance.',
  },null,2));
 };
 try{
  expect((await read()).is_running).toBe(true);
  for(let index=0;index<25;index++)for(const action of ['pause','resume']){
   phase=action;const clock=await read(),args={p_tournament_id:tourId,p_action:action,p_delta_seconds:null,p_expected_control_revision:clock.control_revision};
   const started=performance.now(),result=await rpc(staff[index%staff.length].token,'floor_control_tournament_clock',args),ack=performance.now();
   expect(result.ok).toBe(true);const observed=await read();expect(observed.is_running).toBe(action==='resume');
   expect(observed.control_revision).not.toBe(clock.control_revision);const observedAt=performance.now();
   const retry=await rpc(staff[index%staff.length].token,'floor_control_tournament_clock',args);
   expect(retry.ok).toBe(false);expect(retry.error).toBe('stale_clock_state');
   samples.push({action,ackMs:ack-started,observedMs:observedAt-started,warmup:index<5});report();
  }
  phase='same-revision-race';const clock=await read();
  const replies=await Promise.all(staff.map(identity=>rpc(identity.token,'floor_control_tournament_clock',{
   p_tournament_id:tourId,p_action:'pause',p_delta_seconds:null,p_expected_control_revision:clock.control_revision,
  })));
  raceSuccesses=replies.filter(row=>row.ok===true).length;raceConflicts=replies.filter(row=>row.ok===false&&row.error==='stale_clock_state').length;
  expect(raceSuccesses).toBe(1);expect(raceConflicts).toBe(19);expect((await read()).is_running).toBe(false);report();
  for(let index=0;index<25;index++)for(const operation of [
   {action:'next_level',label:'next_level',delta:null,level:2,remaining:1200},
   {action:'previous_level',label:'previous_level',delta:null,level:1,remaining:1200},
   {action:'adjust_time',label:'adjust_minus_30',delta:-30,level:1,remaining:1170},
   {action:'adjust_time',label:'adjust_plus_30',delta:30,level:1,remaining:1200},
  ]){
   phase=operation.label;const before=await read();expect(before.is_running).toBe(false);
   const args={p_tournament_id:tourId,p_action:operation.action,p_delta_seconds:operation.delta,p_expected_control_revision:before.control_revision};
   const started=performance.now(),result=await rpc(staff[index%staff.length].token,'floor_control_tournament_clock',args),ack=performance.now();
   expect(result.ok).toBe(true);const observed=await read();expect(observed.is_running).toBe(false);
   expect(observed.current_level?.level_number).toBe(operation.level);expect(observed.remaining_seconds).toBe(operation.remaining);
   expect(observed.control_revision).not.toBe(before.control_revision);const observedAt=performance.now();
   const retry=await rpc(staff[(index+1)%staff.length].token,'floor_control_tournament_clock',args);
   expect(retry.ok).toBe(false);expect(retry.error).toBe('stale_clock_state');
   samples.push({action:operation.label,ackMs:ack-started,observedMs:observedAt-started,warmup:index<5});report();
  }
  phase='passed';report();
 }catch(error){phase+='-failed';report();throw error;}
});

test('populated F&B HTTP orders, duplicate payment and owner finance reconciliation',async({page})=>{
 test.skip(process.env.LOCAL_OPERATIONS_CHECKIN_ENABLED!=='1','Contemporary isolated operation fixture only');
 test.setTimeout(180_000);
 const token=await loginOwner(page),staff=await loginFixtureStaff(),api=process.env.LOCAL_SUPABASE_URL!.replace(/\/$/,''),anon=process.env.LOCAL_SUPABASE_ANON_KEY!;
 const club='a2000000-0000-4000-8000-000000000001',menu='afb20000-0000-4000-8000-000000000001',ingredient='afb10000-0000-4000-8000-000000000001';
 const day=financeBusinessToday(),from=day+'T00:00:00+07:00',to=new Date(Date.parse(from)+86400000).toISOString();
 const samples:{operation:string;ms:number;warmup:boolean}[]=[];let phase='baseline',raceAccepted=0,raceReplays=0;
 const rpc=async(actor:string,name:string,args:unknown)=>{
  const started=performance.now(),response=await fetch(api+'/rest/v1/rpc/'+name,{
   method:'POST',headers:{apikey:anon,Authorization:'Bearer '+actor,'Content-Type':'application/json'},body:JSON.stringify(args),signal:AbortSignal.timeout(5000),
  });
  const data=await response.json(),ms=performance.now()-started;expect(response.ok,name).toBe(true);return {data,ms};
 };
 const report=()=>{
  const grouped=['create','create_retry','pay','pay_retry','owner_report'].map(operation=>{
   const rows=samples.filter(row=>row.operation===operation&&!row.warmup).map(row=>row.ms).sort((a,b)=>a-b);
   return {operation,count:rows.length,p95Ms:rows.length?rows[Math.ceil(rows.length*.95)-1]:null,maxMs:rows.at(-1)??null};
  });
  writeFileSync(process.env.LOCAL_OPERATIONS_LATENCY_REPORT!.replace(/\.json$/,'-fnb-paid-http.json'),JSON.stringify({
   kind:'ACTUAL_AUTHENTICATED_FNB_ORDER_PAYMENT_STOCK_AND_FINANCE_HTTP',sha:process.env.LOCAL_OPERATIONS_SOURCE_SHA,phase,
   businessDay:day,ownerActors:1,warmupOrders:5,gradedOrders:20,additionalRaceOrders:1,raceRequests:20,raceAccepted,raceReplays,samples,grouped,
   fixture:{openingStock:1000,unitSale:20000,unitCost:5000,quantityPerOrder:2,fnbInClubNet:true},qualification:false,
   limitations:'Small isolated fixture,one real Auth owner with20concurrent same-owner payment requests; not20independent F&B staff,render/Realtime propagation or production capacity. Canonical server amounts and immutable sale movements are checked through independent authenticated reads.',
  },null,2));
 };
 const fnbReport=async()=>{
  const result=await rpc(token,'fnb_get_report',{p_club_id:club,p_from:from,p_to:to});
  expect(result.data.error).toBeUndefined();return result;
 };
 const finance=async()=>{
  const result=await rpc(token,'get_club_finance_summary_v2',{p_from_date:day,p_to_date:day,p_club_id:club});
  const parsed=parseFinanceCore(result.data);assertFinanceCalendarScope(parsed.data,{from:day,to:day,clubId:club});
  expect(parsed.revenue.fnb).toBeDefined();expect(parsed.cost.fnbCogs).toBeDefined();return parsed;
 };
 const intent=(requestId:string)=>({p_club_id:club,p_source:'counter',p_table_label:'Operations TEST',p_customer_name:'Operations TEST',p_note:'isolated latency fixture',
  p_lines:[{menu_item_id:menu,qty:2}],p_client_request_id:requestId,p_table_ref:null,p_player_ref:null});
 try{
  const settingsResponse=await fetch(api+'/rest/v1/fnb_settings?select=fnb_in_club_net&club_id=eq.'+club,
   {headers:{apikey:anon,Authorization:'Bearer '+token},signal:AbortSignal.timeout(5000)});
  expect(settingsResponse.ok).toBe(true);expect(await settingsResponse.json()).toEqual([{fnb_in_club_net:true}]);
  const baseline=(await fnbReport()).data,beforeFinance=await finance();
  phase='authority';
  const denied=await rpc(staff[0].token,'fnb_create_order',intent(crypto.randomUUID()));expect(denied.data.error).toBe('Forbidden');
  const crossClub=await rpc(token,'fnb_create_order',{...intent(crypto.randomUUID()),p_club_id:'ad200000-0000-4000-8000-000000000002'});
  expect(crossClub.data.error).toBe('Forbidden');
  for(let index=0;index<25;index++){
   phase='create';const args=intent(crypto.randomUUID()),created=await rpc(token,'fnb_create_order',args);
   expect(created.data.status).toBe('ok');expect(created.data.idempotent).toBe(false);expect(created.data.subtotal_vnd).toBe(40000);
   const repeated=await rpc(token,'fnb_create_order',args);expect(repeated.data.order_id).toBe(created.data.order_id);expect(repeated.data.idempotent).toBe(true);
   phase='pay';const payment={p_order_id:created.data.order_id,p_client_request_id:crypto.randomUUID()},paid=await rpc(token,'fnb_mark_paid',payment);
   expect(paid.data.status).toBe('ok');expect(paid.data.idempotent).toBe(false);expect(paid.data.subtotal_vnd).toBe(40000);expect(paid.data.cogs_vnd).toBe(10000);
   const retry=await rpc(token,'fnb_mark_paid',payment);expect(retry.data.order_id).toBe(created.data.order_id);expect(retry.data.idempotent).toBe(true);
   phase='owner-report';const observed=await fnbReport();
   expect(observed.data.orderCount-baseline.orderCount).toBe(index+1);expect(observed.data.revenue-baseline.revenue).toBe((index+1)*40000);
   expect(observed.data.cogs-baseline.cogs).toBe((index+1)*10000);
   for(const [operation,ms] of [['create',created.ms],['create_retry',repeated.ms],['pay',paid.ms],['pay_retry',retry.ms],['owner_report',observed.ms]] as [string,number][])
    samples.push({operation,ms,warmup:index<5});report();
  }
  phase='same-order-payment-race';const created=await rpc(token,'fnb_create_order',intent(crypto.randomUUID()));expect(created.data.status).toBe('ok');
  const replies=await Promise.all(Array.from({length:20},()=>rpc(token,'fnb_mark_paid',{p_order_id:created.data.order_id,p_client_request_id:crypto.randomUUID()})));
  expect(replies.every(row=>row.data.status==='ok')).toBe(true);raceAccepted=replies.filter(row=>row.data.idempotent===false).length;raceReplays=replies.filter(row=>row.data.idempotent===true).length;
  expect(raceAccepted).toBe(1);expect(raceReplays).toBe(19);report();
  phase='stock-and-finance';
  const readTable=async(path:string)=>{
   const response=await fetch(api+'/rest/v1/'+path,{headers:{apikey:anon,Authorization:'Bearer '+token},signal:AbortSignal.timeout(5000)});
   const data=await response.json();expect(response.ok,path).toBe(true);expect(Array.isArray(data)).toBe(true);return data;
  };
  const stock=await readTable('fnb_ingredients?select=id,on_hand&id=eq.'+ingredient);expect(stock).toHaveLength(1);expect(Number(stock[0].on_hand)).toBe(948);
  const movements=await readTable('fnb_stock_movements?select=delta,unit_cost,ref_id&ingredient_id=eq.'+ingredient+'&reason=eq.sale');
  expect(movements).toHaveLength(26);expect(new Set(movements.map((row:{ref_id:string})=>row.ref_id)).size).toBe(26);
  for(const row of movements){expect(Number(row.delta)).toBe(-2);expect(Number(row.unit_cost)).toBe(5000);}
  const finalReport=(await fnbReport()).data,afterFinance=await finance();
  expect(finalReport.orderCount-baseline.orderCount).toBe(26);expect(finalReport.revenue-baseline.revenue).toBe(1040000);expect(finalReport.cogs-baseline.cogs).toBe(260000);
  expect(afterFinance.revenue.fnb-beforeFinance.revenue.fnb).toBe(1040000);expect(afterFinance.cost.fnbCogs-beforeFinance.cost.fnbCogs).toBe(260000);
  phase='passed';report();
 }catch(error){phase+='-failed';report();throw error;}
});
