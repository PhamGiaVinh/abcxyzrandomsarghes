import { expect, test, type Page } from "@playwright/test";
import {readFileSync,writeFileSync} from 'node:fs';
import {availableParallelism,cpus,totalmem} from 'node:os';
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

async function selectDealerSwingClub(page:Page,name:string){
 const scope=page.getByRole('heading',{name:'Chọn CLB để vận hành Dealer Swing',exact:true}).locator('..');
 await expect(scope).toBeVisible();await scope.getByRole('combobox').click();
 await page.getByRole('option',{name,exact:true}).click();
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
   await selectDealerSwingClub(page,'Cashier Edge TEST');
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
 test.setTimeout(300_000);
 const token=await loginOwner(page),api=process.env.LOCAL_SUPABASE_URL!.replace(/\/$/,''),anon=process.env.LOCAL_SUPABASE_ANON_KEY!;
 const tourId='a3000000-0000-4000-8000-000000000001';
 const fixture=JSON.parse(readFileSync(process.env.LOCAL_OPERATIONS_DEALER_FILE!,'utf8')) as {floorTable:{id:string;tableNumber:number}};
 expect(fixture.floorTable?.id).toMatch(/^[a-f0-9-]{36}$/);expect(fixture.floorTable.tableNumber).toBeGreaterThanOrEqual(1);expect(fixture.floorTable.tableNumber).toBeLessThanOrEqual(100);
 const gameTableId=fixture.floorTable.id;
 const rpc=async(name:string,args:Record<string,unknown>)=>{
  const response=await fetch(`${api}/rest/v1/rpc/${name}`,{method:'POST',headers:{apikey:anon,Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(args),signal:AbortSignal.timeout(5000)});
  const payload=await response.json();expect(response.ok,name).toBe(true);return payload;
 };
 const rows:{operation:string;iteration:number;warmup:boolean;ackMs:number;writeToVisibleMs?:number;status:string}[]=[];
 let phase='screen-load',committedOpen=false,independentRosterConfirmed=false,rosterRpc='',postgresReady=false,channelJoined=false;
 const openedHints=new Set<string>(),closedHints=new Set<string>();
 page.on('websocket',socket=>socket.on('framereceived',frame=>{
  try{
   const decoded=JSON.parse(typeof frame.payload==='string'?frame.payload:frame.payload.toString());
   // The installed SDK defaults to Phoenix V2 [join_ref,ref,topic,event,payload].
   const message=Array.isArray(decoded)?{topic:decoded[2],event:decoded[3],payload:decoded[4]}:decoded;
   if(typeof message.topic!=='string'||!message.topic.startsWith('realtime:floor-map-v3:'))return;
   const payload=message.payload;
   if(message.event==='phx_reply'&&payload?.status==='ok')channelJoined=true;
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
  actors:1,concurrency:1,warmupPerOperation:2,gradedPerOperation:20,phase,committedOpen,independentRosterConfirmed,rosterRpc,postgresReady,channelJoined,rows,
  sourceSignals:'Production-matching publication: open/close session and tournament-table sources are absent;staff RPC fallback must reconcile without their CDC events',
  distributions:Object.fromEntries(['open','close'].map(operation=>{
   const samples=rows.filter(row=>row.operation===operation&&!row.warmup&&row.status==='visible').map(row=>row.writeToVisibleMs!).sort((a,b)=>a-b);
   return [operation,{samples:samples.length,p95Ms:samples.length===20?samples[18]:null,maxMs:samples.length?samples.at(-1):null}];
  })),
  fixtureBuild:{floorV3:'preview',floorUatEnvironment:'preview',redraw:'off'},
  qualification:false,limitations:'Twenty serial canonical open/close pairs after two warmups on one empty TEST table;one continuously open actual screen. Excludes seat-move,dealer handover and concurrent staff capacity. No manual refresh/reload after initial screen load.',
 },null,2));
 try{
  const loaded=page.waitForResponse(response=>/\/rpc\/get_floor_tournament_table_roster_v(?:3|6)$/.test(new URL(response.url()).pathname)&&response.status()===200);
  await page.goto(`/ops/floor/tournaments/${tourId}/tables?club=a2000000-0000-4000-8000-000000000001`);
  const initialReply=await loaded;rosterRpc=new URL(initialReply.url()).pathname.split('/').at(-1)!;
  expect(Array.isArray(await initialReply.json())).toBe(true);
  await expect(page.getByTestId('floor-table-map-v3')).toBeVisible();
  await expect.poll(()=>channelJoined,{timeout:15_000}).toBe(true);
  await expect(page.getByTestId('floor-table-map-v3').locator('[data-ops-action="floor.tables.refresh"]')).toBeEnabled();
  await expect(page.getByTestId('floor-table-map-v3').getByRole('alert')).toHaveCount(0);
  const card=page.locator(`[data-testid="floor-table-roster-card"][data-floor-table-number="${fixture.floorTable.tableNumber}"]`);
  for(let iteration=0;iteration<22;iteration++){
  await expect(card).toHaveCount(0);
  phase='open';const started=performance.now();
  const intent={p_tournament_id:tourId,p_game_table_id:gameTableId,p_control_mode:'manual',p_request_id:crypto.randomUUID()};
  const opened=await rpc('floor_open_tournament_table_v3',intent);expect(opened.ok).toBe(true);committedOpen=true;
  const openRow={operation:'open',iteration,warmup:iteration<2,ackMs:performance.now()-started,status:'committed',writeToVisibleMs:undefined as number|undefined};
  rows.push(openRow);report();
  expect(await rpc('floor_open_tournament_table_v3',intent)).toEqual(opened);
  const roster=await rpc(rosterRpc,{p_tournament_id:tourId});
  expect(Array.isArray(roster)).toBe(true);expect(roster.some((row:{table_session_id:string})=>row.table_session_id===opened.table_session_id)).toBe(true);
  independentRosterConfirmed=true;report();
  await expect(card).toBeVisible({timeout:Math.max(1,5000-(performance.now()-started))});
  expect(openedHints.has(opened.table_session_id),'Missing source publication must not be silently synthesized by the fixture').toBe(false);
  openRow.writeToVisibleMs=performance.now()-started;openRow.status='visible';report();
  phase='close';const closing=performance.now();
  const closeIntent={p_tournament_table_id:opened.tournament_table_id,p_expected_revision:opened.revision,p_request_id:crypto.randomUUID()};
  const closed=await rpc('close_tournament_table_v3',closeIntent);expect(closed.ok).toBe(true);
  const closeRow={operation:'close',iteration,warmup:iteration<2,ackMs:performance.now()-closing,status:'committed',writeToVisibleMs:undefined as number|undefined};
  rows.push(closeRow);report();
  expect(await rpc('close_tournament_table_v3',closeIntent)).toEqual(closed);
  await expect(card).toHaveCount(0,{timeout:Math.max(1,5000-(performance.now()-closing))});
  expect(closedHints.has(opened.table_session_id)).toBe(false);
  closeRow.writeToVisibleMs=performance.now()-closing;closeRow.status='visible';report();
  }
  expect(rows.filter(row=>!row.warmup&&row.status==='visible')).toHaveLength(40);
  for(const operation of ['open','close']){
   const samples=rows.filter(row=>row.operation===operation&&!row.warmup).map(row=>row.writeToVisibleMs!).sort((a,b)=>a-b);
   expect(samples[18],operation+' write-to-visible p95').toBeLessThanOrEqual(3000);
  }
  phase='passed';report();
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

test('canonical dealer handover HTTP latency, independent state and duplicate requests',async({page})=>{
 test.skip(process.env.LOCAL_OPERATIONS_CHECKIN_ENABLED!=='1','Contemporary isolated fixture only');
 test.setTimeout(180_000);
 const owner=await loginOwner(page),staff=await loginFixtureStaff();
 const api=process.env.LOCAL_SUPABASE_URL!.replace(/\/$/,''),anon=process.env.LOCAL_SUPABASE_ANON_KEY!;
 type Context={n:number;table_id:string;session_id:string;assignment_id:string;outgoing_attendance:string;incoming_attendance:string};
 const fixture=JSON.parse(readFileSync(process.env.LOCAL_OPERATIONS_DEALER_FILE!,'utf8')) as {handoverClubId:string;handovers:Context[]};
 expect(fixture.handoverClubId).toBe('ad500000-0000-4000-8000-000000000001');expect(fixture.handovers).toHaveLength(23);expect(staff).toHaveLength(20);
 const headers=(token:string)=>({apikey:anon,Authorization:`Bearer ${token}`,'Content-Type':'application/json'});
 const rpc=async(token:string,name:string,args:Record<string,unknown>)=>{
  const start=performance.now(),response=await fetch(api+'/rest/v1/rpc/'+name,{method:'POST',headers:headers(token),body:JSON.stringify(args),signal:AbortSignal.timeout(5000)});
  const data=await response.json();return {ok:response.ok,data,ms:performance.now()-start};
 };
 const read=async(table:string,path:string)=>{
  const response=await fetch(api+'/rest/v1/'+table+'?'+path,{headers:headers(owner),signal:AbortSignal.timeout(5000)});
  const data=await response.json();expect(response.ok).toBe(true);expect(Array.isArray(data)).toBe(true);return data;
 };
 const args=(context:Context,request=crypto.randomUUID())=>({p_table_id:context.table_id,p_table_session_id:context.session_id,p_assignment_id:context.assignment_id,p_expected_version:0,p_request_id:request});
 const rows:{iteration:number;warmup:boolean;actor:number;ackMs:number;retryMs:number;independentStateMs:number;writeToVisibleMs?:number;writeToRealtimeMs?:number}[]=[];
 const realtimeEnabled=process.env.LOCAL_OPERATIONS_REALTIME==='1',seen=new Map<string,number>();let postgresReady=false;
 page.on('websocket',socket=>socket.on('framereceived',frame=>{
  try{
   const decoded=JSON.parse(typeof frame.payload==='string'?frame.payload:frame.payload.toString());
   const message=Array.isArray(decoded)?{topic:decoded[2],event:decoded[3],payload:decoded[4]}:decoded;
   if(typeof message.topic!=='string'||!message.topic.startsWith('realtime:swing:')||!message.topic.includes('dealer_assignments'))return;
   if(message.event==='system'&&message.payload?.status==='ok'&&message.payload?.extension==='postgres_changes')postgresReady=true;
   const data=message.payload?.data,row=data?.record;
   if(message.event==='postgres_changes'&&data?.table==='dealer_assignments'&&row?.club_id===fixture.handoverClubId
    &&row.status==='assigned'&&row.released_at==null&&typeof row.attendance_id==='string'&&!seen.has(row.attendance_id))seen.set(row.attendance_id,performance.now());
  }catch{/* Never persist raw frames or tokens. */}
 }));
 let phase='start',race:{first:number;replays:number}|null=null;
 const summarize=(key:'ackMs'|'retryMs'|'independentStateMs'|'writeToVisibleMs'|'writeToRealtimeMs')=>{
  const samples=rows.filter(row=>!row.warmup).map(row=>row[key]).filter((value):value is number=>typeof value==='number').sort((a,b)=>a-b);
  return {samples:samples.length,p95Ms:samples.length===20?samples[18]:null,maxMs:samples.at(-1)??null};
 };
 const report=()=>writeFileSync(process.env.LOCAL_OPERATIONS_LATENCY_REPORT!.replace(/\.json$/,'-dealer-handover-http.json'),JSON.stringify({
  kind:'REAL_AUTH_HTTP_CANONICAL_DEALER_HANDOVER_WITH_INDEPENDENT_OWNER_READ',sha:process.env.LOCAL_OPERATIONS_SOURCE_SHA,phase,actors:20,concurrency:1,
  warmup:2,graded:20,rows,postgresReady,distributions:{ack:summarize('ackMs'),retry:summarize('retryMs'),independentState:summarize('independentStateMs'),
   ...(realtimeEnabled?{writeToVisible:summarize('writeToVisibleMs'),writeToRealtime:summarize('writeToRealtimeMs')}:{})},race,qualification:false,
  limitations:'Explicit synthetic dispatches initialize fixture only;actual handover uses canonical authenticated operator RPC. Independent owner reads verify one replacement and release markers. Realtime mode observes one continuously open actual Dealer Swing screen and its installed SDK channel;20serial graded handovers are not concurrent staff capacity. Excludes initial assignment Edge,arrival acknowledgement,rest expiry,checkout and payroll. Duplicate race uses20concurrent requests from one actor.',
 },null,2));
 try{
  if(realtimeEnabled){
   phase='screen-load';await page.goto('/dealer-swing');await selectDealerSwingClub(page,'Handover latency TEST');
   await expect(page.locator('#table-card-'+fixture.handovers[0].table_id)).toBeVisible({timeout:30_000});
   await expect.poll(()=>postgresReady,{timeout:15_000}).toBe(true);
  }
  const denied=await rpc(staff[0].token,'operator_perform_swing',{...args(fixture.handovers[0]),p_table_session_id:fixture.handovers[1].session_id});
  // Both sessions exist: exercise the canonical context fence, not a receipt FK.
  expect(denied.ok).toBe(false);expect(denied.data.message).toBe('TABLE_SESSION_STALE');
  for(let iteration=0;iteration<22;iteration++){
   phase='handover-'+iteration;const context=fixture.handovers[iteration],actor=iteration%staff.length,intent=args(context);
   const card=page.locator('#table-card-'+context.table_id);
   if(realtimeEnabled)await expect(card.getByText('Handover outgoing TEST '+context.n,{exact:true})).toBeVisible();
   const started=performance.now();
   const result=await rpc(staff[actor].token,'operator_perform_swing',intent);expect(result.ok).toBe(true);expect(result.data.outcome).toBe('swung');
   const active=await read('dealer_assignments','select=id,attendance_id,table_session_id,status,released_at&table_id=eq.'+context.table_id+'&released_at=is.null&status=eq.assigned');
   expect(active).toHaveLength(1);expect(active[0].attendance_id).toBe(context.incoming_attendance);expect(active[0].table_session_id).toBe(context.session_id);expect(active[0].id).not.toBe(context.assignment_id);
   const outgoing=await read('dealer_attendance','select=current_state,last_released_at&id=eq.'+context.outgoing_attendance);
   expect(outgoing).toHaveLength(1);expect(outgoing[0].current_state).toBe('available');expect(typeof outgoing[0].last_released_at).toBe('string');
   const observed=performance.now()-started;
   let writeToVisibleMs:number|undefined,writeToRealtimeMs:number|undefined;
   if(realtimeEnabled){
    await expect.poll(()=>seen.has(context.incoming_attendance),{timeout:Math.max(1,5000-(performance.now()-started))}).toBe(true);
    writeToRealtimeMs=seen.get(context.incoming_attendance)!-started;
    await expect(card.getByText('Handover outgoing TEST '+context.n,{exact:true})).toHaveCount(0,{timeout:Math.max(1,5000-(performance.now()-started))});
    await expect(card.getByText('Handover incoming TEST '+context.n,{exact:true})).toBeVisible({timeout:Math.max(1,5000-(performance.now()-started))});
    writeToVisibleMs=performance.now()-started;
   }
   const retry=await rpc(staff[actor].token,'operator_perform_swing',intent);
   expect(retry.ok).toBe(true);expect(retry.data.outcome).toBe('swung');expect(retry.data.idempotent).toBe(true);
   if(iteration===0){
    const otherActor=await rpc(staff[1].token,'operator_perform_swing',intent);
    expect(otherActor.ok).toBe(false);expect(otherActor.data.message).toBe('SWING_IDEMPOTENCY_CONFLICT');
   }
   const after=await read('dealer_assignments','select=id&table_id=eq.'+context.table_id+'&released_at=is.null&status=eq.assigned');expect(after).toEqual([{id:active[0].id}]);
   const stale=await rpc(staff[actor].token,'operator_perform_swing',args(context));expect(stale.ok).toBe(false);
   rows.push({iteration,warmup:iteration<2,actor,ackMs:result.ms,retryMs:retry.ms,independentStateMs:observed,writeToVisibleMs,writeToRealtimeMs});report();
  }
  phase='duplicate-race';const context=fixture.handovers[22],intent=args(context);
  const outcomes=await Promise.all(Array.from({length:20},()=>rpc(staff[0].token,'operator_perform_swing',intent)));
  for(const result of outcomes){expect(result.ok).toBe(true);expect(result.data.outcome).toBe('swung');}
  race={first:outcomes.filter(result=>result.data.idempotent!==true).length,replays:outcomes.filter(result=>result.data.idempotent===true).length};expect(race).toEqual({first:1,replays:19});
  const active=await read('dealer_assignments','select=attendance_id&table_id=eq.'+context.table_id+'&released_at=is.null&status=eq.assigned');expect(active).toEqual([{attendance_id:context.incoming_attendance}]);
  if(realtimeEnabled)expect(summarize('writeToVisibleMs').p95Ms).toBeLessThanOrEqual(3000);
  phase='passed';report();
 }catch(error){phase+='-failed';report();throw error;}
});

test('dealer arrival acknowledgement HTTP latency and immutable operational state',async({page})=>{
 test.skip(process.env.LOCAL_OPERATIONS_CHECKIN_ENABLED!=='1','Contemporary isolated fixture only');
 test.setTimeout(120_000);
 const owner=await loginOwner(page),staff=await loginFixtureStaff(),api=process.env.LOCAL_SUPABASE_URL!.replace(/\/$/,''),anon=process.env.LOCAL_SUPABASE_ANON_KEY!;
 type Context={table_id:string;session_id:string;incoming_dealer:string;incoming_attendance:string;incoming_actor:string};
 type Arrival={assignment_id:string;table_session_id:string;attendance_id:string;dispatch_at:string;acknowledged_at:string|null;incoming:boolean};
 const fixture=JSON.parse(readFileSync(process.env.LOCAL_OPERATIONS_DEALER_FILE!,'utf8')) as {handovers:Context[]};expect(fixture.handovers).toHaveLength(23);
 const headers=(token:string)=>({apikey:anon,Authorization:`Bearer ${token}`,'Content-Type':'application/json'});
 const rpc=async(token:string,name:string,args:Record<string,unknown>)=>{
  const started=performance.now(),response=await fetch(api+'/rest/v1/rpc/'+name,{method:'POST',headers:headers(token),body:JSON.stringify(args),signal:AbortSignal.timeout(5000)});
  const data=await response.json();return {ok:response.ok,data,ms:performance.now()-started};
 };
 const readFacts=async(context:Context)=>{
  const paths=[['dealer_assignments','select=id,attendance_id,table_session_id,status,version,assigned_at,swing_due_at,released_at,swing_processed_at&table_id=eq.'+context.table_id+'&status=eq.assigned&released_at=is.null'],
   ['dealer_attendance','select=id,status,current_state,last_released_at,check_in_time,check_out_time,total_worked_minutes_today,overtime_minutes&id=eq.'+context.incoming_attendance]];
  return Promise.all(paths.map(async([table,query])=>{const response=await fetch(api+'/rest/v1/'+table+'?'+query,{headers:headers(owner),signal:AbortSignal.timeout(5000)});const data=await response.json();expect(response.ok).toBe(true);expect(data).toHaveLength(1);return data;}));
 };
 const rows:{iteration:number;warmup:boolean;ackMs:number;retryMs:number;readMs:number}[]=[];let phase='start',raceIdentical=false;
 const distribution=(key:'ackMs'|'retryMs'|'readMs')=>{const values=rows.filter(row=>!row.warmup).map(row=>row[key]).sort((a,b)=>a-b);return {samples:values.length,p95Ms:values.length===20?values[18]:null,maxMs:values.at(-1)??null};};
 const report=()=>writeFileSync(process.env.LOCAL_OPERATIONS_LATENCY_REPORT!.replace(/\.json$/,'-dealer-arrival-http.json'),JSON.stringify({kind:'REAL_AUTH_HTTP_DEALER_ARRIVAL_ACKNOWLEDGEMENT_ONLY',sha:process.env.LOCAL_OPERATIONS_SOURCE_SHA,phase,
  warmup:2,graded:20,rows,distributions:{ack:distribution('ackMs'),retry:distribution('retryMs'),read:distribution('readMs')},raceIdentical,qualification:false,
  limitations:'Actual dealer-bound Auth identities and canonical arrival RPCs after handover;independent control-actor reads compare unchanged assignment and attendance facts. Excludes dealer-app rendering,scheduled handover,rest expiry,checkout and payroll totals. Duplicate race uses one dealer identity with20concurrent identical acknowledgements.',
 },null,2));
 const intent=(arrival:Arrival)=>({p_assignment_id:arrival.assignment_id,p_table_session_id:arrival.table_session_id,p_attendance_id:arrival.attendance_id,p_dispatch_at:arrival.dispatch_at});
 try{
  for(let iteration=0;iteration<22;iteration++){
   phase='arrival-'+iteration;const context=fixture.handovers[iteration],identity=staff.find(row=>row.userId===context.incoming_actor);expect(identity).toBeTruthy();
   const fetched=await rpc(identity!.token,'dealer_get_table_arrivals_v1',{p_dealer_id:context.incoming_dealer});expect(fetched.ok).toBe(true);expect(fetched.data).toHaveLength(1);
   const arrival=fetched.data[0] as Arrival;expect(arrival.table_session_id).toBe(context.session_id);expect(arrival.attendance_id).toBe(context.incoming_attendance);expect(arrival.incoming).toBe(false);expect(arrival.acknowledged_at).toBeNull();
   const before=await readFacts(context);expect(before[0][0].attendance_id).toBe(context.incoming_attendance);expect(before[1][0].current_state).toBe('assigned');
   if(iteration===0){
    const forbidden=await rpc(owner,'dealer_ack_table_arrival_v1',intent(arrival));expect(forbidden.ok).toBe(false);expect(forbidden.data.message).toBe('dealer_arrival_forbidden');
    const stale=await rpc(identity!.token,'dealer_ack_table_arrival_v1',{...intent(arrival),p_dispatch_at:new Date(Date.parse(arrival.dispatch_at)+1000).toISOString()});expect(stale.ok).toBe(false);expect(stale.data.message).toBe('dealer_arrival_stale_dispatch');
   }
   const ack=await rpc(identity!.token,'dealer_ack_table_arrival_v1',intent(arrival));expect(ack.ok).toBe(true);expect(typeof ack.data.acknowledged_at).toBe('string');expect(ack.data.assignment_id).toBe(arrival.assignment_id);
   const retry=await rpc(identity!.token,'dealer_ack_table_arrival_v1',intent(arrival));expect(retry.ok).toBe(true);expect(retry.data).toEqual(ack.data);
   const read=await rpc(identity!.token,'dealer_get_table_arrivals_v1',{p_dealer_id:context.incoming_dealer});expect(read.ok).toBe(true);expect(read.data).toHaveLength(1);expect(read.data[0].acknowledged_at).toBe(ack.data.acknowledged_at);
   expect(await readFacts(context)).toEqual(before);
   rows.push({iteration,warmup:iteration<2,ackMs:ack.ms,retryMs:retry.ms,readMs:read.ms});report();
  }
  phase='duplicate-race';const context=fixture.handovers[22],identity=staff.find(row=>row.userId===context.incoming_actor)!;
  const read=await rpc(identity.token,'dealer_get_table_arrivals_v1',{p_dealer_id:context.incoming_dealer});expect(read.ok).toBe(true);expect(read.data).toHaveLength(1);expect(read.data[0].acknowledged_at).toBeNull();const before=await readFacts(context);
  const outcomes=await Promise.all(Array.from({length:20},()=>rpc(identity.token,'dealer_ack_table_arrival_v1',intent(read.data[0]))));
  for(const result of outcomes){expect(result.ok).toBe(true);expect(typeof result.data.acknowledged_at).toBe('string');expect(result.data).toEqual(outcomes[0].data);}
  expect(await readFacts(context)).toEqual(before);raceIdentical=true;phase='passed';report();
 }catch(error){phase+='-failed';report();throw error;}
});

test('real dealer checkout Edge HTTP, open-screen latency and committed work conservation',async({page})=>{
 test.skip(process.env.LOCAL_OPERATIONS_CHECKIN_ENABLED!=='1','Contemporary isolated fixture only');test.setTimeout(180_000);
 const owner=await loginOwner(page),staff=await loginFixtureStaff(),api=process.env.LOCAL_SUPABASE_URL!.replace(/\/$/,''),anon=process.env.LOCAL_SUPABASE_ANON_KEY!;
 type Context={n:number;table_id:string;outgoing_attendance:string;incoming_attendance:string};
 const fixture=JSON.parse(readFileSync(process.env.LOCAL_OPERATIONS_DEALER_FILE!,'utf8')) as {handovers:Context[];otherAttendanceId:string};expect(fixture.handovers).toHaveLength(23);expect(fixture.otherAttendanceId).toMatch(/^[a-f0-9-]{36}$/);
 const realtimeEnabled=process.env.LOCAL_OPERATIONS_REALTIME==='1',seen=new Map<string,number>();let postgresReady=false;
 page.on('websocket',socket=>socket.on('framereceived',frame=>{try{
  const decoded=JSON.parse(typeof frame.payload==='string'?frame.payload:frame.payload.toString()),message=Array.isArray(decoded)?{topic:decoded[2],event:decoded[3],payload:decoded[4]}:decoded;
  if(typeof message.topic!=='string'||!message.topic.startsWith('realtime:swing:')||!message.topic.includes('dealer_attendance'))return;
  if(message.event==='system'&&message.payload?.extension==='postgres_changes'&&message.payload?.status==='ok')postgresReady=true;
  const data=message.payload?.data,row=data?.record;
  if(message.event==='postgres_changes'&&data?.table==='dealer_attendance'&&row?.status==='checked_out'&&typeof row.id==='string'&&!seen.has(row.id))seen.set(row.id,performance.now());
 }catch{/* No raw frames or tokens in artifacts. */}}));
 const headers=(token?:string)=>({apikey:anon,...(token?{Authorization:`Bearer ${token}`}:{}) ,'Content-Type':'application/json'});
 const call=async(token:string|undefined,body:Record<string,unknown>)=>{const started=performance.now(),response=await fetch(api+'/functions/v1/checkout-dealer',{method:'POST',headers:headers(token),body:JSON.stringify(body),signal:AbortSignal.timeout(10000)});const data=await response.json();return {ok:response.ok,status:response.status,data,ms:performance.now()-started};};
 const read=async(table:string,query:string)=>{const response=await fetch(api+'/rest/v1/'+table+'?'+query,{headers:headers(owner),signal:AbortSignal.timeout(5000)});const data=await response.json();expect(response.ok).toBe(true);expect(Array.isArray(data)).toBe(true);return data;};
 const attendance=(id:string)=>read('dealer_attendance','select=id,status,current_state,check_in_time,check_out_time,total_worked_minutes_today,overtime_minutes&id=eq.'+id);
 const active=(context:Context)=>read('dealer_assignments','select=id,attendance_id&table_id=eq.'+context.table_id+'&released_at=is.null&status=eq.assigned');
 const rows:{iteration:number;warmup:boolean;actor:number;ackMs:number;retryMs:number;writeToVisibleMs?:number;writeToRealtimeMs?:number}[]=[];
 const boundaryChecks:{kind:string;status:number;classification:string}[]=[];
 let phase='start',race:{first:number;replays:number}|null=null;
 const distribution=(key:'ackMs'|'retryMs'|'writeToVisibleMs'|'writeToRealtimeMs')=>{const values=rows.filter(row=>!row.warmup).map(row=>row[key]).filter((v):v is number=>typeof v==='number').sort((a,b)=>a-b);return {samples:values.length,p95Ms:values.length===20?values[18]:null,maxMs:values.at(-1)??null};};
 const report=()=>writeFileSync(process.env.LOCAL_OPERATIONS_LATENCY_REPORT!.replace(/\.json$/,'-dealer-checkout-edge-http.json'),JSON.stringify({kind:'REAL_AUTH_DEALER_CHECKOUT_EDGE_HTTP_AND_OPEN_SWING_SCREEN',sha:process.env.LOCAL_OPERATIONS_SOURCE_SHA,phase,actors:20,concurrency:1,warmup:2,graded:20,rows,postgresReady,race,
  distributions:{ack:distribution('ackMs'),retry:distribution('retryMs'),...(realtimeEnabled?{writeToVisible:distribution('writeToVisibleMs'),writeToRealtime:distribution('writeToRealtimeMs')}:{})},boundaryChecks,qualification:false,
  limitations:'Checkout of the already-released outgoing dealer after canonical handover;actual current handler,Auth,service-only289RPC and independent control-actor reads. Verifies retained worked minutes and unchanged incoming assignment. Excludes checkout replacement/active-table races,inactive-payroll closing and production Telegram;bot token absent and external networking denied. Duplicate race uses one actor with20identical requests.',
 },null,2));
 try{
  const first=fixture.handovers[0],before=await attendance(first.outgoing_attendance);expect(before).toHaveLength(1);expect(before[0].status).toBe('checked_in');
  for(const check of [{kind:'missing-auth',token:undefined,body:{attendance_id:first.outgoing_attendance},status:401},
   {kind:'mixed-tenant',token:staff[0].token,body:{attendance_ids:[first.outgoing_attendance,fixture.otherAttendanceId]},status:403},
   {kind:'foreign-tenant',token:staff[0].token,body:{attendance_id:fixture.otherAttendanceId},status:403}]){
   const result=await call(check.token,check.body);boundaryChecks.push({kind:check.kind,status:result.status,classification:result.data?.code==='BOOT_ERROR'?'BOOT_ERROR':result.status>=500?'SERVER_ERROR':result.data?.error==='Invalid token'?'AUTH_REJECTED':'EXPECTED_OR_OTHER'});report();expect(result.status).toBe(check.status);
  }
  expect(await attendance(first.outgoing_attendance)).toEqual(before);
  const direct=await fetch(api+'/rest/v1/rpc/operator_checkout_dealer_attendance_v1',{method:'POST',headers:headers(staff[0].token),body:JSON.stringify({p_actor_id:staff[0].userId,p_attendance_id:first.outgoing_attendance}),signal:AbortSignal.timeout(5000)});expect(direct.status).toBe(403);await direct.arrayBuffer();
  if(realtimeEnabled){phase='screen-load';await page.setViewportSize({width:1440,height:1000});await page.goto('/dealer-swing');await selectDealerSwingClub(page,'Handover latency TEST');await page.getByRole('button',{name:'ĐỘI HÌNH / CHECK-IN',exact:true}).click();await expect.poll(()=>postgresReady,{timeout:15_000}).toBe(true);}
  const roster=page.getByPlaceholder('Tìm dealer...',{exact:true}).locator('xpath=../..');
  for(let iteration=0;iteration<22;iteration++){
   phase='checkout-'+iteration;const context=fixture.handovers[iteration],actor=iteration%staff.length,old=await attendance(context.outgoing_attendance),assignment=await active(context);expect(old).toHaveLength(1);expect(old[0].current_state).toBe('available');expect(assignment).toHaveLength(1);expect(assignment[0].attendance_id).toBe(context.incoming_attendance);
   const currentName=roster.locator('span.text-foreground').filter({hasText:new RegExp('^Handover outgoing TEST '+context.n+'$')});
   if(realtimeEnabled){await page.getByPlaceholder('Tìm dealer...',{exact:true}).fill('Handover outgoing TEST '+context.n);await expect(currentName).toBeVisible();}
   const started=performance.now(),result=await call(staff[actor].token,{attendance_id:context.outgoing_attendance});expect(result.ok).toBe(true);expect(result.data.results).toHaveLength(1);const saved=result.data.results[0];expect(saved.success).toBe(true);expect(saved.attendance_id).toBe(context.outgoing_attendance);
   let writeToVisibleMs:number|undefined,writeToRealtimeMs:number|undefined;
   if(realtimeEnabled){await expect.poll(()=>seen.has(context.outgoing_attendance),{timeout:Math.max(1,5000-(performance.now()-started))}).toBe(true);writeToRealtimeMs=seen.get(context.outgoing_attendance)!-started;await expect(currentName).toHaveCount(0,{timeout:Math.max(1,5000-(performance.now()-started))});await expect(page.getByRole('button',{name:`Check-out (${45-iteration})`,exact:true})).toBeVisible({timeout:Math.max(1,5000-(performance.now()-started))});writeToVisibleMs=performance.now()-started;}
   const ended=await attendance(context.outgoing_attendance);expect(ended).toHaveLength(1);expect(ended[0].status).toBe('checked_out');expect(ended[0].current_state).toBe('checked_out');expect(ended[0].check_out_time).toBe(saved.check_out_time);
   const worked=Math.round((Date.parse(ended[0].check_out_time)-Date.parse(ended[0].check_in_time))/60000);expect(ended[0].total_worked_minutes_today).toBe(worked);expect(ended[0].overtime_minutes).toBe(0);expect(worked).toBeGreaterThanOrEqual(60);
   const retry=await call(staff[actor].token,{attendance_id:context.outgoing_attendance});expect(retry.ok).toBe(true);expect(retry.data.results).toHaveLength(1);expect(retry.data.results[0].success).toBe(true);expect(retry.data.results[0].idempotent).toBe(true);expect(retry.data.results[0].check_out_time).toBe(saved.check_out_time);
   expect(await attendance(context.outgoing_attendance)).toEqual(ended);expect(await active(context)).toEqual(assignment);rows.push({iteration,warmup:iteration<2,actor,ackMs:result.ms,retryMs:retry.ms,writeToVisibleMs,writeToRealtimeMs});report();
  }
  phase='duplicate-race';const context=fixture.handovers[22],assignment=await active(context),outcomes=await Promise.all(Array.from({length:20},()=>call(staff[0].token,{attendance_id:context.outgoing_attendance})));
  for(const result of outcomes){expect(result.ok).toBe(true);expect(result.data.results).toHaveLength(1);expect(result.data.results[0].success).toBe(true);expect(result.data.results[0].check_out_time).toBe(outcomes[0].data.results[0].check_out_time);}
  race={first:outcomes.filter(row=>row.data.results[0].idempotent!==true).length,replays:outcomes.filter(row=>row.data.results[0].idempotent===true).length};expect(race).toEqual({first:1,replays:19});expect(await active(context)).toEqual(assignment);
  if(realtimeEnabled)expect(distribution('writeToVisibleMs').p95Ms).toBeLessThanOrEqual(3000);phase='passed';report();
 }catch(error){phase+='-failed';report();throw error;}
});

test('twenty distinct Floor actors sustain the four-reader reconciliation cadence',async({page})=>{
 test.skip(process.env.LOCAL_OPERATIONS_CHECKIN_ENABLED!=='1','Contemporary isolated fixture only');test.setTimeout(180_000);
 const owner=await loginOwner(page),staff=await loginFixtureStaff(),api=process.env.LOCAL_SUPABASE_URL!.replace(/\/$/,''),anon=process.env.LOCAL_SUPABASE_ANON_KEY!;
 const target=new URL(api);expect(target.protocol).toBe('http:');expect(['localhost','127.0.0.1','cashier-api'].includes(target.hostname)||/^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(target.hostname)||/^supabase_kong_cashier-e2e-/.test(target.hostname)).toBe(true);
 const fixture=JSON.parse(readFileSync(process.env.LOCAL_OPERATIONS_DEALER_FILE!,'utf8')) as {floorReadLoad:{tournamentId:string;gameTableIds:string[]}};
 expect(fixture.floorReadLoad.tournamentId).toBe('af300000-0000-4000-8000-000000000001');expect(fixture.floorReadLoad.gameTableIds).toHaveLength(20);
 const tour=fixture.floorReadLoad.tournamentId,opened:{id:string;revision:number}[]=[],phases:unknown[]=[];
 const readers=['get_floor_tournament_table_roster_v3','get_floor_seatable_entries','get_floor_restorable_entries_v3','get_floor_pending_tracker_moves_v1'];
 const rpc=async(token:string,name:string,args:Record<string,unknown>)=>{const started=performance.now(),response=await fetch(api+'/rest/v1/rpc/'+name,{method:'POST',headers:{apikey:anon,Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(args),signal:AbortSignal.timeout(5000)});const data=await response.json();expect(response.ok,name).toBe(true);return {data,ms:performance.now()-started};};
 let phase='fixture-open',cleanupFailures=0;
 const report=()=>writeFileSync(process.env.LOCAL_OPERATIONS_LATENCY_REPORT!.replace(/\.json$/,'-floor-staff-cadence-http.json'),JSON.stringify({
  kind:'REAL_AUTH_HTTP_FLOOR_STAFF_RECONCILIATION_CADENCE',sha:process.env.LOCAL_OPERATIONS_SOURCE_SHA,phase,phases,cleanupFailures,
  machine:{logicalCpus:availableParallelism(),cpu:cpus()[0]?.model??null,memoryGiB:totalmem()/1024**3,node:process.version},
  fixture:{tables:20,players:0,readers,intervalAfterCompletionMs:2000,requestsPerCycle:4,warmupCycles:2,gradedCycles:15},
  nominalRequestsPerVisibleScreenSecond:2,qualification:false,
  limitations:'One-actor baseline then20independent Auth staff using the actual four Floor RPCs at the product fallback cadence for at least30seconds. HTTP concurrency,not20Chrome screens. Twenty canonical open tables have zero seated players;no mixed1000-viewer load,large roster or production quota/capacity claim. Read-window excludes canonical fixture open/close costs.',
 },null,2));
 try{
  for(const id of fixture.floorReadLoad.gameTableIds){const result=(await rpc(owner,'floor_open_tournament_table_v3',{p_tournament_id:tour,p_game_table_id:id,p_control_mode:'manual',p_request_id:crypto.randomUUID()})).data;expect(result.ok).toBe(true);opened.push({id:result.tournament_table_id,revision:result.revision});}
  for(const concurrency of [1,20]){
   phase='read-'+concurrency;const rows:{actor:number;cycle:number;rpc:string;ms:number;count:number}[]=[],starts:number[]=[],ends:number[]=[];
   await Promise.all(staff.slice(0,concurrency).map(async(identity,actor)=>{
    for(let cycle=0;cycle<17;cycle++){
     if(cycle===2)starts.push(performance.now());
     const replies=await Promise.all(readers.map(async(name)=>{const result=await rpc(identity.token,name,{p_tournament_id:tour});expect(Array.isArray(result.data),name).toBe(true);if(name===readers[0]){expect(result.data).toHaveLength(20);for(const row of result.data)expect(row.tournament_id).toBe(tour);}if(cycle>=2)rows.push({actor,cycle:cycle-2,rpc:name,ms:result.ms,count:result.data.length});return result;}));
     expect(replies).toHaveLength(4);await new Promise(resolve=>setTimeout(resolve,2000));
    }
    ends.push(performance.now());
   }));
   expect(rows).toHaveLength(concurrency*15*4);const durationMs=Math.max(...ends)-Math.min(...starts);expect(durationMs).toBeGreaterThanOrEqual(30000);
   const metrics=readers.map(name=>{const values=rows.filter(row=>row.rpc===name).map(row=>row.ms).sort((a,b)=>a-b);return {rpc:name,samples:values.length,p95Ms:values[Math.ceil(values.length*.95)-1],maxMs:values.at(-1),rowCounts:[...new Set(rows.filter(row=>row.rpc===name).map(row=>row.count))]};});
   phases.push({concurrency,durationMs,requests:rows.length,achievedRequestsPerSecond:rows.length/(durationMs/1000),rows,metrics,status:'measured'});report();
   for(const metric of metrics)expect(metric.p95Ms,metric.rpc+' staff HTTP p95').toBeLessThanOrEqual(1000);
  }
  phase='passed';report();
 }catch(error){phase+='-failed';report();throw error;}
 finally{
  for(const table of opened){try{const result=(await rpc(owner,'close_tournament_table_v3',{p_tournament_table_id:table.id,p_expected_revision:table.revision,p_request_id:crypto.randomUUID()})).data;if(result.ok!==true)cleanupFailures++;}catch{cleanupFailures++;}}
  if(cleanupFailures)phase='cleanup-failed';report();expect(cleanupFailures).toBe(0);
 }
});

test('current Cashier partial-cash intent HTTP, duplicate recovery and real browser journal',async({page})=>{
 test.skip(process.env.LOCAL_OPERATIONS_CHECKIN_ENABLED!=='1','Contemporary isolated contract only');test.setTimeout(180_000);
 const owner=await loginOwner(page),staff=await loginFixtureStaff(),api=process.env.LOCAL_SUPABASE_URL!.replace(/\/$/,''),anon=process.env.LOCAL_SUPABASE_ANON_KEY!;
 const club='a2000000-0000-4000-8000-000000000001',tour='a3000000-0000-4000-8000-000000000001';
 const headers=(token:string)=>({apikey:anon,Authorization:`Bearer ${token}`,'Content-Type':'application/json'});
 const rpc=async(token:string,name:string,args:Record<string,unknown>)=>{const started=performance.now(),response=await fetch(api+'/rest/v1/rpc/'+name,{method:'POST',headers:headers(token),body:JSON.stringify(args),signal:AbortSignal.timeout(5000)});const data=await response.json();expect(response.ok,name).toBe(true);return {data,ms:performance.now()-started};};
 const registrations:string[]=[],rows:{warmup:boolean;actor:number;ackMs:number;retryMs:number;independentReadMs:number}[]=[];
 const totals=Array(20).fill(0) as number[];let phase='register',uiMs:number|null=null,race:unknown=null;
 const distribution=(field:'ackMs'|'retryMs'|'independentReadMs')=>{const values=rows.filter(r=>!r.warmup).map(r=>r[field]).sort((a,b)=>a-b);return {samples:values.length,p95Ms:values.length===20?values[18]:null,maxMs:values.at(-1)??null};};
 const report=()=>writeFileSync(process.env.LOCAL_OPERATIONS_LATENCY_REPORT!.replace(/\.json$/,'-cash-intent-partial-http.json'),JSON.stringify({
  kind:'REAL_AUTH_CURRENT_CASHIER_PARTIAL_INTENT_HTTP_AND_BROWSER_JOURNAL',sha:process.env.LOCAL_OPERATIONS_SOURCE_SHA,phase,actors:20,warmup:2,graded:20,rows,
  distributions:{ack:distribution('ackMs'),retry:distribution('retryMs'),independentRead:distribution('independentReadMs')},ui:{samples:uiMs===null?0:1,clickToVerifiedRowMs:uiMs},race,
  qualification:false,limitations:'Actual112contract matches three read-only production function-body fingerprints. Server-priced registrations use the actual registration Edge. Twenty serial graded partial payments from distinct Auth cashiers;two warmups pay the first two registrations once more. One real browser journal payment,not20UI samples. Duplicate contenders may return busy and then recover by the same immutable intent. No full payment,seating,re-entry,undo,prize,close-buy,export or mixed1000-viewer capacity claim.',
 },null,2));
 const worklist=async()=>{const result=(await rpc(owner,'cashier_tour_worklist_v1',{p_club_id:club,p_tournament_id:tour,p_query:'',p_bucket:'all',p_page:0,p_limit:50})).data;expect(result.ok).toBe(true);expect(Array.isArray(result.rows)).toBe(true);return result.rows as {id:string;received:number;status:string;total_pay:number}[];};
 const verify=async(actor:number)=>{const row=(await worklist()).find(r=>r.id===registrations[actor]);expect(row).toBeTruthy();expect(Number(row!.received)).toBe(totals[actor]);expect(Number(row!.total_pay)).toBe(6600000);expect(row!.status).toBe('pending');};
 const intent=(actor:number)=>({actor_id:staff[actor].userId,club_id:club,tournament_id:tour,registration_id:registrations[actor],amount:1000,request_id:crypto.randomUUID()});
 try{
  for(const identity of staff){
   const response=await fetch(api+'/functions/v1/tournament-register',{method:'POST',headers:headers(identity.token),body:JSON.stringify({tournament_id:tour}),signal:AbortSignal.timeout(5000)});
   const result=await response.json();expect(response.ok).toBe(true);expect(result.success).toBe(true);expect(Number(result.total_pay)).toBe(6600000);expect(result.registration_id).toMatch(/^[a-f0-9-]{36}$/);registrations.push(result.registration_id);
  }
  expect(new Set(registrations).size).toBe(20);
  const shiftResponse=await fetch(api+'/rest/v1/cashier_till_shifts?select=id&club_id=eq.'+club+'&closed_at=is.null',{headers:headers(owner),signal:AbortSignal.timeout(5000)});
  expect(shiftResponse.ok).toBe(true);expect(await shiftResponse.json()).toEqual([{id:'a5000000-0000-4000-8000-000000000001'}]);
  phase='serial';
  for(let iteration=0;iteration<22;iteration++){
   const actor=iteration<2?iteration:iteration-2,payment=intent(actor);
   const first=await rpc(staff[actor].token,'resolve_cashier_cash_buyin_intent_v1',{p_intent:payment,p_action:'record'});
   expect(first.data.ok).toBe(true);expect(first.data.status).toBe('recorded');expect(first.data.result.payment_state).toBe('partial');totals[actor]+=1000;expect(Number(first.data.result.received)).toBe(totals[actor]);
   const retry=await rpc(staff[actor].token,'resolve_cashier_cash_buyin_intent_v1',{p_intent:payment,p_action:'record'});expect(retry.data).toEqual(first.data);
   const readStarted=performance.now();await verify(actor);rows.push({warmup:iteration<2,actor,ackMs:first.ms,retryMs:retry.ms,independentReadMs:performance.now()-readStarted});report();
  }
  phase='duplicate-race';const raced=intent(0);
  const responses=await Promise.all(Array.from({length:20},()=>rpc(staff[0].token,'resolve_cashier_cash_buyin_intent_v1',{p_intent:raced,p_action:'record'})));
  expect(responses.some(r=>r.data.status==='recorded')).toBe(true);
  for(const reply of responses)expect(reply.data.status==='recorded'||reply.data.error==='cash_intent_busy').toBe(true);
  const settled=(await rpc(staff[0].token,'resolve_cashier_cash_buyin_intent_v1',{p_intent:raced,p_action:'read'})).data;expect(settled.status).toBe('recorded');
  for(const reply of responses.filter(r=>r.data.status==='recorded'))expect(reply.data).toEqual(settled);
  const recovered=await Promise.all(Array.from({length:20},()=>rpc(staff[0].token,'resolve_cashier_cash_buyin_intent_v1',{p_intent:raced,p_action:'read'})));
  for(const reply of recovered)expect(reply.data).toEqual(settled);totals[0]+=1000;await verify(0);
  race={requests:20,initialRecorded:responses.filter(r=>r.data.status==='recorded').length,initialBusy:responses.filter(r=>r.data.error==='cash_intent_busy').length,recoveredIdentical:20,independentMoneyDelta:1000};
  const otherActor=(await rpc(staff[1].token,'resolve_cashier_cash_buyin_intent_v1',{p_intent:raced,p_action:'record'})).data;expect(otherActor.error).toBe('actor_not_allowed');
  const otherClub=(await rpc(staff[0].token,'resolve_cashier_cash_buyin_intent_v1',{p_intent:{...raced,club_id:'ad200000-0000-4000-8000-000000000002'},p_action:'record'})).data;expect(otherClub.error).toBe('actor_not_allowed');
  const cancelledIntent=intent(0),cancelled=(await rpc(staff[0].token,'resolve_cashier_cash_buyin_intent_v1',{p_intent:cancelledIntent,p_action:'cancel'})).data;expect(cancelled.status).toBe('cancelled');
  expect((await rpc(staff[0].token,'resolve_cashier_cash_buyin_intent_v1',{p_intent:cancelledIntent,p_action:'record'})).data).toEqual(cancelled);await verify(0);
  phase='browser-journal';await page.setViewportSize({width:1280,height:900});await page.goto('/ops/cashier/tour?club='+club);
  await page.getByRole('button',{name:/^Cashier Edge TEST Tour ·/}).first().click();await page.getByRole('button',{name:/^Chờ tại quầy/}).click();
  const participant=()=>page.getByRole('button',{name:/^Cashier latency TEST 1\b/});await participant().click();
  await page.getByLabel('Nhận tiền mặt (VND)',{exact:true}).fill('1000');const button=page.getByRole('button',{name:'Ghi nhận tiền mặt',exact:true});await expect(button).toBeEnabled();
  const paymentResponse=page.waitForResponse(r=>r.url().endsWith('/rpc/resolve_cashier_cash_buyin_intent_v1')&&r.request().postDataJSON()?.p_action==='record');
  const started=performance.now();await button.click();const response=await paymentResponse,result=await response.json();expect(response.ok()).toBe(true);expect(result.status).toBe('recorded');expect(result.intent.actor_id).not.toBe(staff[0].userId);expect(result.intent.registration_id).toBe(registrations[0]);
  totals[0]+=1000;await expect(participant()).toContainText('Đã xác minh 4.000 VND');uiMs=performance.now()-started;await verify(0);expect(uiMs).toBeLessThanOrEqual(3000);
  expect(rows.filter(row=>!row.warmup)).toHaveLength(20);expect(distribution('ackMs').p95Ms).toBeLessThanOrEqual(1000);expect(distribution('retryMs').p95Ms).toBeLessThanOrEqual(1000);
  phase='passed';report();
 }catch(error){phase+='-failed';report();throw error;}
});

test('current Cashier full payment commits canonical seats through real HTTP',async({page})=>{
 test.skip(process.env.LOCAL_OPERATIONS_PAID_SEATING_ENABLED!=='1','Second isolated stage after exact113/114/117/139');test.setTimeout(120_000);
 const owner=await loginOwner(page),staff=await loginFixtureStaff(),api=process.env.LOCAL_SUPABASE_URL!.replace(/\/$/,''),anon=process.env.LOCAL_SUPABASE_ANON_KEY!;
 const club='a2000000-0000-4000-8000-000000000001',tour='a3000000-0000-4000-8000-000000000001';
 const rpc=async(token:string,name:string,args:Record<string,unknown>)=>{const started=performance.now(),response=await fetch(api+'/rest/v1/rpc/'+name,{method:'POST',headers:{apikey:anon,Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(args),signal:AbortSignal.timeout(5000)});const data=await response.json();expect(response.ok,name).toBe(true);return {data,ms:performance.now()-started};};
 const worklist=async()=>{const {data}=await rpc(owner,'cashier_tour_worklist_v1',{p_club_id:club,p_tournament_id:tour,p_query:'',p_bucket:'all',p_page:0,p_limit:50});expect(data.ok).toBe(true);return data.rows as {id:string;player_id:string;received:number;total_pay:number;status:string}[];};
 const rows:{actor:number;ackMs:number;retryMs:number;independentReadMs:number}[]=[];let phase='open-canonical-tables';
 const distribution=(field:keyof Omit<typeof rows[number],'actor'>)=>{const values=rows.map(r=>r[field]).sort((a,b)=>a-b);return {samples:values.length,p95Ms:values.length===20?values[18]:null,maxMs:values.at(-1)??null};};
 const report=()=>writeFileSync(process.env.LOCAL_OPERATIONS_LATENCY_REPORT!.replace(/\.json$/,'-cash-full-seated-http.json'),JSON.stringify({kind:'REAL_AUTH_CURRENT_CASHIER_FULL_PAYMENT_CANONICAL_SEATING_HTTP',sha:process.env.LOCAL_OPERATIONS_SOURCE_SHA,phase,actors:20,concurrency:1,warmup:0,graded:20,rows,distributions:{ack:distribution('ackMs'),retry:distribution('retryMs'),independentRead:distribution('independentReadMs')},qualification:false,limitations:'Second disposable stage adds exact113/114/117/139 after the earlier partial-cash and refund conservation checks. Twenty distinct Auth cashiers complete their existing server-priced partial registrations;three empty physical tables are opened through canonical Floor RPC. No browser seating latency,re-entry,undo,prize or mixed1000-viewer capacity claim.'},null,2));
 try{
  for(let n=1;n<=3;n++){
   const intent={p_tournament_id:tour,p_game_table_id:`ac700000-0000-4000-8000-${String(n).padStart(12,'0')}`,p_control_mode:'manual',p_request_id:crypto.randomUUID()};
   const opened=await rpc(owner,'floor_open_tournament_table_v3',intent);expect(opened.data.ok).toBe(true);expect((await rpc(owner,'floor_open_tournament_table_v3',intent)).data).toEqual(opened.data);
  }
  phase='full-payment';const before=await worklist();
  for(let actor=0;actor<staff.length;actor++){
   const registration=before.find(r=>r.player_id===staff[actor].userId);expect(registration).toBeTruthy();expect(registration!.status).toBe('pending');
   const amount=Number(registration!.total_pay)-Number(registration!.received);expect(amount).toBeGreaterThan(0);
   const payment={actor_id:staff[actor].userId,club_id:club,tournament_id:tour,registration_id:registration!.id,amount,request_id:crypto.randomUUID()};
   const first=await rpc(staff[actor].token,'resolve_cashier_cash_buyin_intent_v1',{p_intent:payment,p_action:'record'});expect(first.data.ok).toBe(true);expect(first.data.status).toBe('recorded');expect(first.data.result.payment_state).toBe('paid');expect(first.data.result.seating_state).toBe('seated');
   const retry=await rpc(staff[actor].token,'resolve_cashier_cash_buyin_intent_v1',{p_intent:payment,p_action:'record'});expect(retry.data).toEqual(first.data);
   const started=performance.now(),after=(await worklist()).find(r=>r.id===registration!.id);expect(after).toBeTruthy();expect(Number(after!.received)).toBe(Number(registration!.total_pay));expect(after!.status).toBe('confirmed');
   rows.push({actor,ackMs:first.ms,retryMs:retry.ms,independentReadMs:performance.now()-started});report();
  }
  expect(rows).toHaveLength(20);expect(distribution('ackMs').p95Ms).toBeLessThanOrEqual(1000);expect(distribution('retryMs').p95Ms).toBeLessThanOrEqual(1000);phase='passed';report();
 }catch(error){phase+='-failed';report();throw error;}
});

test('current Floor bust and player reentry preserve separate paid entry generations',async({page})=>{
 test.skip(process.env.LOCAL_OPERATIONS_REENTRY_ENABLED!=='1','Third isolated stage after full seated-payment proof');test.setTimeout(180_000);
 const owner=await loginOwner(page),staff=await loginFixtureStaff(),api=process.env.LOCAL_SUPABASE_URL!.replace(/\/$/,''),anon=process.env.LOCAL_SUPABASE_ANON_KEY!;
 const club='a2000000-0000-4000-8000-000000000001',tour='a3000000-0000-4000-8000-000000000001';
 const headers=(token:string)=>({apikey:anon,Authorization:`Bearer ${token}`,'Content-Type':'application/json'});
 const rpc=async(token:string,name:string,args:Record<string,unknown>)=>{const started=performance.now(),response=await fetch(api+'/rest/v1/rpc/'+name,{method:'POST',headers:headers(token),body:JSON.stringify(args),signal:AbortSignal.timeout(5000)});const data=await response.json();expect(response.ok,name).toBe(true);return {data,ms:performance.now()-started};};
 type Seat={entry_id:string;player_id:string;entry_no:number;chip_count:number};
 type Table={session_revision:number;control_epoch:number;control_mode:string;seats:Seat[]};
 const roster=async()=>{const {data}=await rpc(owner,'get_floor_tournament_table_roster_v3',{p_tournament_id:tour});expect(Array.isArray(data)).toBe(true);return data as Table[];};
 const location=async(player:string)=>{const tables=await roster(),table=tables.find(t=>t.seats.some(s=>s.player_id===player));expect(table).toBeTruthy();return {table:table!,seat:table!.seats.find(s=>s.player_id===player)!};};
 const rows:{actor:number;bustMs:number;bustRetryMs:number;registrationMs:number;registrationRetryMs:number;paymentMs:number;paymentRetryMs:number;independentReadMs:number}[]=[];let phase='authorization';
 const dist=(key:keyof Omit<typeof rows[number],'actor'>)=>{const values=rows.map(r=>r[key]).sort((a,b)=>a-b);return {samples:values.length,p95Ms:values.length===20?values[18]:null,maxMs:values.at(-1)??null};};
 const report=()=>writeFileSync(process.env.LOCAL_OPERATIONS_LATENCY_REPORT!.replace(/\.json$/,'-bust-reentry-http.json'),JSON.stringify({kind:'REAL_AUTH_FLOOR_BUST_REENTRY_EDGE_AND_CANONICAL_CASH_SEATING',sha:process.env.LOCAL_OPERATIONS_SOURCE_SHA,phase,graded:20,warmup:0,rows,distributions:Object.fromEntries(['bustMs','bustRetryMs','registrationMs','registrationRetryMs','paymentMs','paymentRetryMs','independentReadMs'].map(key=>[key,dist(key as keyof Omit<typeof rows[number],'actor'>)])),qualification:false,limitations:'Twenty serial synthetic players with real Auth. Owner performs canonical manual-mode bust with explicit positive-chip override,then each player requests the actual reentry Edge and each cashier pays its immutable server price. Owner reads baseline382 roster for placement/revision;its body is not the current production roster projection. Bust/reentry/confirmation/allocator bodies are production-hash pinned. No tracker-mode zero-chip bust,browser latency,concurrent distinct-player seating or mixed1000-viewer capacity claim.'},null,2));
 const reenter=async(actor:number)=>{const started=performance.now(),response=await fetch(api+'/functions/v1/tournament-reentry',{method:'POST',headers:headers(staff[actor].token),body:JSON.stringify({tournament_id:tour}),signal:AbortSignal.timeout(5000)});const data=await response.json();expect(response.ok).toBe(true);expect(data.success).toBe(true);expect(data.reentry).toBe(true);expect(Number(data.total_pay)).toBe(6600000);expect(data.free_rake_applied).toBe(false);return {data,ms:performance.now()-started};};
 try{
  const denied=await fetch(api+'/rest/v1/rpc/cashier_create_app_reentry_v1',{method:'POST',headers:headers(staff[0].token),body:JSON.stringify({p_tournament_id:tour,p_player_id:staff[1].userId}),signal:AbortSignal.timeout(5000)});expect(denied.status).toBe(403);
  const unauthenticated=await fetch(api+'/functions/v1/tournament-reentry',{method:'POST',headers:{apikey:anon,'Content-Type':'application/json'},body:JSON.stringify({tournament_id:tour}),signal:AbortSignal.timeout(5000)});expect(unauthenticated.status).toBe(401);
  phase='serial';
  for(let actor=0;actor<staff.length;actor++){
   const before=await location(staff[actor].userId);expect(before.table.control_mode).toBe('manual');expect(before.seat.entry_no).toBe(1);expect(before.seat.chip_count).toBe(20000);
   const intent={p_entry_id:before.seat.entry_id,p_expected_revision:before.table.session_revision,p_expected_control_epoch:before.table.control_epoch,p_expected_chip_count:20000,p_request_id:crypto.randomUUID(),p_reason:'floor_v3_operator_bust'};
   if(actor===0){const stale=await rpc(owner,'floor_bust_player_v3',{...intent,p_expected_revision:intent.p_expected_revision+1,p_request_id:crypto.randomUUID()});expect(stale.data.error).toBe('STALE_STATE');}
   const busted=await rpc(owner,'floor_bust_player_v3',intent);expect(busted.data.ok).toBe(true);expect(busted.data.manual_nonzero_chip_override).toBe(true);expect(busted.data.payout_applied).toBe(false);
   const bustRetry=await rpc(owner,'floor_bust_player_v3',intent);expect(bustRetry.data).toEqual(busted.data);
   expect((await roster()).flatMap(t=>t.seats).some(s=>s.player_id===staff[actor].userId)).toBe(false);
   const registration=await reenter(actor),retryRegistration=await reenter(actor);expect(registration.data.already_registered).toBe(false);expect(retryRegistration.data.already_registered).toBe(true);expect(retryRegistration.data.registration_id).toBe(registration.data.registration_id);expect(retryRegistration.data.reference_code).toBe(registration.data.reference_code);
   const payment={actor_id:staff[actor].userId,club_id:club,tournament_id:tour,registration_id:registration.data.registration_id,amount:registration.data.total_pay,request_id:crypto.randomUUID()};
   const paid=await rpc(staff[actor].token,'resolve_cashier_cash_buyin_intent_v1',{p_intent:payment,p_action:'record'});expect(paid.data.status).toBe('recorded');expect(paid.data.result.payment_state).toBe('paid');expect(paid.data.result.seating_state).toBe('seated');
   const paymentRetry=await rpc(staff[actor].token,'resolve_cashier_cash_buyin_intent_v1',{p_intent:payment,p_action:'record'});expect(paymentRetry.data).toEqual(paid.data);
   const started=performance.now(),after=await location(staff[actor].userId);expect(after.seat.entry_id).not.toBe(before.seat.entry_id);expect(after.seat.entry_no).toBe(2);expect(after.seat.chip_count).toBe(20000);
   rows.push({actor,bustMs:busted.ms,bustRetryMs:bustRetry.ms,registrationMs:registration.ms,registrationRetryMs:retryRegistration.ms,paymentMs:paid.ms,paymentRetryMs:paymentRetry.ms,independentReadMs:performance.now()-started});report();
  }
  expect(rows).toHaveLength(20);for(const key of ['bustMs','registrationMs','paymentMs'] as const)expect(dist(key).p95Ms).toBeLessThanOrEqual(1000);
  phase='passed';report();
 }catch(error){phase+='-failed';report();throw error;}
});

test('current Floor exact movement conserves paid chips and retries through HTTP',async({page})=>{
 test.skip(process.env.LOCAL_OPERATIONS_EXACT_MOVE_ENABLED!=='1','Fifth isolated stage after revenue conservation');test.setTimeout(120_000);
 const owner=await loginOwner(page),staff=await loginFixtureStaff(),api=process.env.LOCAL_SUPABASE_URL!.replace(/\/$/,''),anon=process.env.LOCAL_SUPABASE_ANON_KEY!,tour='a3000000-0000-4000-8000-000000000001';
 const rpc=async(token:string,name:string,args:Record<string,unknown>)=>{const started=performance.now(),response=await fetch(api+'/rest/v1/rpc/'+name,{method:'POST',headers:{apikey:anon,Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(args),signal:AbortSignal.timeout(5000)});const data=await response.json();expect(response.ok,name).toBe(true);return {data,ms:performance.now()-started};};
 type Seat={entry_id:string;player_id:string;entry_no:number;chip_count:number;seat_number:number};
 type Table={tournament_table_id:string;table_session_id:string;session_revision:number;control_epoch:number;control_mode:string;seats:Seat[]};
 const roster=async()=>{const result=await rpc(owner,'get_floor_tournament_table_roster_v3',{p_tournament_id:tour});expect(Array.isArray(result.data)).toBe(true);return result.data as Table[];};
 const intentFor=async(player:string)=>{
  const tables=await roster(),source=tables.find(t=>t.seats.some(s=>s.player_id===player));expect(source).toBeTruthy();
  const seat=source!.seats.find(s=>s.player_id===player)!;expect(seat.entry_no).toBe(2);expect(seat.chip_count).toBe(20000);expect(source!.control_mode).toBe('manual');
  const destination=tables.find(t=>t.tournament_table_id!==source!.tournament_table_id&&t.control_mode==='manual'&&t.seats.length<9);expect(destination).toBeTruthy();
  const target=Array.from({length:9},(_,n)=>n+1).find(n=>!destination!.seats.some(s=>s.seat_number===n));expect(target).toBeTruthy();
  return {p_entry_id:seat.entry_id,p_from_tournament_table_id:source!.tournament_table_id,p_from_table_session_id:source!.table_session_id,p_to_tournament_table_id:destination!.tournament_table_id,p_to_table_session_id:destination!.table_session_id,p_to_seat_number:target!,p_expected_source_revision:source!.session_revision,p_expected_destination_revision:destination!.session_revision,p_expected_source_epoch:source!.control_epoch,p_expected_destination_epoch:destination!.control_epoch,p_reason:'isolated exact-move latency TEST',p_request_id:crypto.randomUUID()};
 };
 const rows:{ackMs:number;retryMs:number;independentReadMs:number}[]=[];let phase='authorization';let race:unknown=null;
 const dist=(values:number[])=>{const sorted=[...values].sort((a,b)=>a-b);return {samples:sorted.length,p95Ms:sorted.length===20?sorted[18]:null,maxMs:sorted.at(-1)??null};};
 const report=()=>writeFileSync(process.env.LOCAL_OPERATIONS_LATENCY_REPORT!.replace(/\.json$/,'-floor-exact-move-http.json'),JSON.stringify({kind:'REAL_AUTH_CURRENT_FLOOR_EXACT_MOVE_HTTP',sha:process.env.LOCAL_OPERATIONS_SOURCE_SHA,phase,actors:20,graded:20,warmup:0,rows,distributions:Object.fromEntries(['ackMs','retryMs','independentReadMs'].map(key=>[key,dist(rows.map(row=>row[key as keyof typeof row]))])),race,qualification:false,limitations:'Twenty serial moves of distinct paid entry2 players by20authorized cashier actors;manual-mode empty target seats in disposable9-max fixtures. Actual current v2/v3/v4/v5/queue writer bodies are production-hash pinned. Placement/independent owner reads use captured roster plus exact32 display patch,not the full current production reader. One21st move has20same-key concurrent requests from actor0. No browser move latency,active-hand deferred move,redraw,multiday-final runtime or mixed1000-viewer claim.'},null,2));
 try{
  // This identity is created only inside the isolated harness, and owns a
  // different fixture club. Cashiers of this tour are legitimately operators.
  const otherLogin=await fetch(api+'/auth/v1/token?grant_type=password',{method:'POST',headers:{apikey:anon,'Content-Type':'application/json'},body:JSON.stringify({email:'other-owner-latency@test.invalid',password:'OtherOwnerLatencyFixture-2026!'}),signal:AbortSignal.timeout(5000)});expect(otherLogin.ok).toBe(true);const otherSession=await otherLogin.json();expect(typeof otherSession.access_token).toBe('string');
  const initial=await intentFor(staff[0].userId);expect((await rpc(otherSession.access_token,'move_player_seat_v5',initial)).data.error).toBe('actor_not_allowed');
  expect((await rpc(owner,'move_player_seat_v5',{...initial,p_expected_source_epoch:initial.p_expected_source_epoch+1,p_request_id:crypto.randomUUID()})).data.error).toBe('STALE_CONTROL_EPOCH');
  expect((await rpc(owner,'move_player_seat_v5',{...initial,p_expected_source_revision:initial.p_expected_source_revision+1,p_request_id:crypto.randomUUID()})).data.error).toBe('STALE_STATE');
  phase='serial';
  for(const identity of staff){
   const intent=await intentFor(identity.userId),first=await rpc(identity.token,'move_player_seat_v5',intent);expect(first.data.ok).toBe(true);expect(first.data.reason).toBe(intent.p_reason);
   const retry=await rpc(identity.token,'move_player_seat_v5',intent);expect(retry.data).toEqual(first.data);
   const started=performance.now(),tables=await roster(),seats=tables.flatMap(t=>t.seats.filter(s=>s.entry_id===intent.p_entry_id).map(s=>({table:t,seat:s})));expect(seats).toHaveLength(1);expect(seats[0].table.tournament_table_id).toBe(intent.p_to_tournament_table_id);expect(seats[0].table.table_session_id).toBe(intent.p_to_table_session_id);expect(seats[0].seat.seat_number).toBe(intent.p_to_seat_number);expect(seats[0].seat.chip_count).toBe(20000);expect(seats[0].seat.entry_no).toBe(2);
   rows.push({ackMs:first.ms,retryMs:retry.ms,independentReadMs:performance.now()-started});report();
   expect((await rpc(identity.token,'move_player_seat_v5',{...intent,p_reason:intent.p_reason+' changed'})).data.error).toBe('IDEMPOTENCY_CONFLICT');
  }
  phase='same-key-race';const intent=await intentFor(staff[0].userId),results=await Promise.all(Array.from({length:20},()=>rpc(staff[0].token,'move_player_seat_v5',intent)));for(const result of results){expect(result.data.ok).toBe(true);expect(result.data).toEqual(results[0].data);}race={requests:20,identicalResults:true,latency:dist(results.map(r=>r.ms))};
  expect(rows).toHaveLength(20);expect(dist(rows.map(row=>row.ackMs)).p95Ms).toBeLessThanOrEqual(1000);phase='passed';report();
 }catch(error){phase+='-failed';report();throw error;}
});

test('active-table dealer checkout preserves work and reports an unstaffed table',async({page})=>{
 test.skip(process.env.LOCAL_OPERATIONS_ACTIVE_CHECKOUT_ENABLED!=='1','Sixth isolated stage after exact movement conservation');test.setTimeout(180_000);
 const owner=await loginOwner(page),staff=await loginFixtureStaff(),api=process.env.LOCAL_SUPABASE_URL!.replace(/\/$/,''),anon=process.env.LOCAL_SUPABASE_ANON_KEY!;
 type Context={n:number;table_id:string;session_id:string;incoming_attendance:string};
 const fixture=JSON.parse(readFileSync(process.env.LOCAL_OPERATIONS_DEALER_FILE!,'utf8')) as {handoverClubId:string;handovers:Context[]};expect(fixture.handovers).toHaveLength(23);
 const headers=(token:string)=>({apikey:anon,Authorization:`Bearer ${token}`,'Content-Type':'application/json'});
 const read=async(table:string,query:string)=>{const response=await fetch(api+'/rest/v1/'+table+'?'+query,{headers:headers(owner),signal:AbortSignal.timeout(5000)});expect(response.ok).toBe(true);const data=await response.json();expect(Array.isArray(data)).toBe(true);return data;};
 const attendance=(id:string)=>read('dealer_attendance','select=id,status,current_state,check_in_time,check_out_time,total_worked_minutes_today,overtime_minutes&id=eq.'+id);
 const assigned=(context:Context)=>read('dealer_assignments','select=id,attendance_id,table_session_id&table_id=eq.'+context.table_id+'&released_at=is.null&status=eq.assigned');
 const checkout=async(token:string,id:string)=>{const started=performance.now(),response=await fetch(api+'/functions/v1/checkout-dealer',{method:'POST',headers:headers(token),body:JSON.stringify({attendance_id:id}),signal:AbortSignal.timeout(10000)});expect(response.ok).toBe(true);const data=await response.json();expect(data.results).toHaveLength(1);expect(data.results[0].success).toBe(true);return {data:data.results[0],ms:performance.now()-started};};
 const realtime=process.env.LOCAL_OPERATIONS_REALTIME==='1',seen=new Map<string,number>();let postgresReady=false;
 page.on('websocket',socket=>socket.on('framereceived',frame=>{try{
  const decoded=JSON.parse(typeof frame.payload==='string'?frame.payload:frame.payload.toString()),message=Array.isArray(decoded)?{topic:decoded[2],event:decoded[3],payload:decoded[4]}:decoded;
  if(typeof message.topic!=='string'||!message.topic.startsWith('realtime:swing:')||!message.topic.includes('dealer_assignments'))return;
  if(message.event==='system'&&message.payload?.status==='ok'&&message.payload?.extension==='postgres_changes')postgresReady=true;
  const data=message.payload?.data,row=data?.record;
  if(message.event==='postgres_changes'&&data?.table==='dealer_assignments'&&row?.club_id===fixture.handoverClubId&&row.status==='completed'&&row.release_reason==='dealer_checkout'&&typeof row.attendance_id==='string'&&!seen.has(row.attendance_id))seen.set(row.attendance_id,performance.now());
 }catch{/* Never persist frames or credentials. */}}));
 const rows:{ackMs:number;retryMs:number;independentReadMs:number;writeToVisibleMs?:number;writeToRealtimeMs?:number}[]=[];let phase='preconditions',race:unknown=null;
 const dist=(key:keyof typeof rows[number])=>{const values=rows.map(r=>r[key]).filter((v):v is number=>typeof v==='number').sort((a,b)=>a-b);return {samples:values.length,p95Ms:values.length===20?values[18]:null,maxMs:values.at(-1)??null};};
 const report=()=>writeFileSync(process.env.LOCAL_OPERATIONS_LATENCY_REPORT!.replace(/\.json$/,'-active-dealer-checkout-http.json'),JSON.stringify({kind:'REAL_AUTH_ACTIVE_TABLE_CHECKOUT_SHORTAGE_AND_OPEN_SCREEN',sha:process.env.LOCAL_OPERATIONS_SOURCE_SHA,phase,actors:20,graded:20,warmup:0,rows,race,postgresReady,distributions:Object.fromEntries(['ackMs','retryMs','independentReadMs','writeToVisibleMs','writeToRealtimeMs'].map(key=>[key,dist(key as keyof typeof rows[number])])),qualification:false,limitations:'Twenty serial active cash-table checkouts plus one same-attendance20request race. All outgoing fixture dealers already checked out and all remaining incoming dealers assigned;no available replacement pool. Verifies canonical release/shortage/work retention and one continuously open actual Swing board. Does not qualify eligible-pool auto-replacement,rest expiry,inactive payroll,Telegram or mixed1000spectator load.'},null,2));
 try{
  expect(await read('dealer_attendance','select=id,dealers!inner(club_id)&status=eq.checked_in&current_state=eq.available&dealers.club_id=eq.'+fixture.handoverClubId)).toHaveLength(0);
  if(realtime){await page.goto('/dealer-swing');await selectDealerSwingClub(page,'Handover latency TEST');await expect(page.locator('#table-card-'+fixture.handovers[0].table_id)).toBeVisible({timeout:30_000});await expect.poll(()=>postgresReady,{timeout:15_000}).toBe(true);}
  for(let actor=0;actor<20;actor++){
   phase='checkout-'+actor;const context=fixture.handovers[actor],before=await attendance(context.incoming_attendance),active=await assigned(context);expect(before).toHaveLength(1);expect(before[0].status).toBe('checked_in');expect(before[0].current_state).toBe('assigned');expect(active).toHaveLength(1);expect(active[0].attendance_id).toBe(context.incoming_attendance);expect(active[0].table_session_id).toBe(context.session_id);
   const card=page.locator('#table-card-'+context.table_id);if(realtime)await expect(card.getByText('Handover incoming TEST '+context.n,{exact:true})).toBeVisible();
   const started=performance.now(),first=await checkout(staff[actor].token,context.incoming_attendance);expect(first.data.needs_replacement_table).toBe(context.table_id);expect(first.data.auto_assigned_dealer).toBeNull();
   let writeToVisibleMs:number|undefined,writeToRealtimeMs:number|undefined;
   if(realtime){await expect.poll(()=>seen.has(context.incoming_attendance),{timeout:Math.max(1,5000-(performance.now()-started))}).toBe(true);writeToRealtimeMs=seen.get(context.incoming_attendance)!-started;await expect(card.getByText('Chưa gán',{exact:true})).toBeVisible({timeout:Math.max(1,5000-(performance.now()-started))});writeToVisibleMs=performance.now()-started;}
   const readAt=performance.now(),ended=await attendance(context.incoming_attendance);expect(ended).toHaveLength(1);expect(ended[0].status).toBe('checked_out');expect(ended[0].current_state).toBe('checked_out');expect(ended[0].check_out_time).toBe(first.data.check_out_time);expect(ended[0].total_worked_minutes_today).toBe(Math.round((Date.parse(ended[0].check_out_time)-Date.parse(ended[0].check_in_time))/60000));expect(ended[0].total_worked_minutes_today).toBeGreaterThanOrEqual(60);expect(await assigned(context)).toHaveLength(0);
   const released=await read('dealer_assignments','select=id,status,release_reason,needs_replacement&id=eq.'+active[0].id);expect(released).toEqual([{id:active[0].id,status:'completed',release_reason:'dealer_checkout',needs_replacement:true}]);const independentReadMs=performance.now()-readAt;
   const retry=await checkout(staff[actor].token,context.incoming_attendance);expect(retry.data.idempotent).toBe(true);expect(retry.data.check_out_time).toBe(first.data.check_out_time);expect(await attendance(context.incoming_attendance)).toEqual(ended);expect(await assigned(context)).toHaveLength(0);
   rows.push({ackMs:first.ms,retryMs:retry.ms,independentReadMs,writeToVisibleMs,writeToRealtimeMs});report();
  }
  phase='duplicate-race';const context=fixture.handovers[22];expect(await assigned(context)).toHaveLength(1);const results=await Promise.all(Array.from({length:20},()=>checkout(staff[0].token,context.incoming_attendance)));for(const result of results){expect(result.data.check_out_time).toBe(results[0].data.check_out_time);expect(result.data.needs_replacement_table).toBe(context.table_id);expect(result.data.auto_assigned_dealer).toBeNull();}expect(results.filter(r=>r.data.idempotent!==true)).toHaveLength(1);expect(await assigned(context)).toHaveLength(0);race={requests:20,first:1,replays:19};
  for(const other of fixture.handovers.slice(20,22)){const active=await assigned(other);expect(active).toHaveLength(1);expect(active[0].attendance_id).toBe(other.incoming_attendance);}
  expect(dist('ackMs').p95Ms).toBeLessThanOrEqual(1000);if(realtime)expect(dist('writeToVisibleMs').p95Ms).toBeLessThanOrEqual(3000);phase='passed';report();
 }catch(error){phase+='-failed';report();throw error;}
});

test('active checkout respects automatic OFF and rested replacement eligibility',async({page})=>{
 const mode=process.env.LOCAL_OPERATIONS_REPLACEMENT_ENABLED;test.skip(mode!=='off'&&mode!=='on','Seventh isolated stage with exact current acquisition/rest/day contracts');test.setTimeout(60_000);
 const owner=await loginOwner(page),staff=await loginFixtureStaff(),api=process.env.LOCAL_SUPABASE_URL!.replace(/\/$/,''),anon=process.env.LOCAL_SUPABASE_ANON_KEY!;
 const fixture=JSON.parse(readFileSync(process.env.LOCAL_OPERATIONS_DEALER_FILE!,'utf8')) as {handoverClubId:string;handovers:{n:number;table_id:string;session_id:string;incoming_attendance:string}[]};
 const context=fixture.handovers[mode==='off'?20:21],headers=(token:string)=>({apikey:anon,Authorization:`Bearer ${token}`,'Content-Type':'application/json'});
 const read=async(table:string,query:string)=>{const response=await fetch(api+'/rest/v1/'+table+'?'+query,{headers:headers(owner),signal:AbortSignal.timeout(5000)});expect(response.ok).toBe(true);const data=await response.json();expect(Array.isArray(data)).toBe(true);return data;};
 const active=()=>read('dealer_assignments','select=id,attendance_id,table_session_id&table_id=eq.'+context.table_id+'&released_at=is.null&status=eq.assigned');
 const pool=()=>read('dealer_attendance','select=id,current_state,last_released_at,dealers!inner(full_name)&dealers.club_id=eq.'+fixture.handoverClubId+'&dealers.full_name=like.Replacement eligibility TEST *');
 const checkout=async()=>{const started=performance.now(),response=await fetch(api+'/functions/v1/checkout-dealer',{method:'POST',headers:headers(staff[0].token),body:JSON.stringify({attendance_id:context.incoming_attendance}),signal:AbortSignal.timeout(10000)});expect(response.ok).toBe(true);const result=await response.json();expect(result.results).toHaveLength(1);expect(result.results[0].success).toBe(true);return {data:result.results[0],ms:performance.now()-started};};
 let phase='preconditions';let observation:unknown=null;
 const report=()=>writeFileSync(process.env.LOCAL_OPERATIONS_LATENCY_REPORT!.replace(/\.json$/,'-dealer-replacement-'+mode+'.json'),JSON.stringify({kind:'REAL_AUTH_CHECKOUT_AUTOMATIC_POLICY_AND_ELIGIBILITY',sha:process.env.LOCAL_OPERATIONS_SOURCE_SHA,mode,phase,observation,qualification:false,limitations:'One actual checkout per OFF/ON mode;ON has20same-attendance concurrent requests. No p95/capacity claim. Two eligible synthetic attendance markers20minutes old and one recent1minute marker;current day/shift/commit guards restored with production hashes. No claim about every selection/commit race,rest expiry worker,payroll,Telegram or mixed1000spectator load.'},null,2));
 try{
  expect((await read('club_settings','select=auto_swing_enabled&club_id=eq.'+fixture.handoverClubId))[0].auto_swing_enabled).toBe(mode==='on');
  const candidates=await pool();expect(candidates).toHaveLength(3);expect(candidates.every((r:{current_state:string})=>r.current_state==='available')).toBe(true);
  const recent=candidates.find((r:{dealers:{full_name:string}})=>r.dealers.full_name==='Replacement eligibility TEST 3');expect(recent).toBeTruthy();const eligible=candidates.filter((r:{id:string})=>r.id!==recent.id);
  const before=await active();expect(before).toHaveLength(1);expect(before[0].attendance_id).toBe(context.incoming_attendance);
  await page.goto('/dealer-swing');await selectDealerSwingClub(page,'Handover latency TEST');const card=page.locator('#table-card-'+context.table_id);await expect(card.getByText('Handover incoming TEST '+context.n,{exact:true})).toBeVisible({timeout:30_000});
  phase='checkout';const started=performance.now(),results=mode==='off'?[await checkout()]:await Promise.all(Array.from({length:20},checkout));
  for(const result of results){expect(result.data.needs_replacement_table).toBe(context.table_id);expect(result.data.check_out_time).toBe(results[0].data.check_out_time);}
  const first=results.find(r=>r.data.idempotent!==true);expect(first).toBeTruthy();expect(results.filter(r=>r.data.idempotent!==true)).toHaveLength(1);
  if(mode==='off'){
   expect(first!.data.auto_assigned_dealer,'Automatic replacement must respect OFF although checkout itself is manual').toBeNull();expect(await active()).toHaveLength(0);await expect(card.getByText('Chưa gán',{exact:true})).toBeVisible({timeout:5000});expect(await pool()).toEqual(candidates);
  }else{
   expect(eligible.map((r:{dealers:{full_name:string}})=>r.dealers.full_name)).toContain(first!.data.auto_assigned_dealer);
   const assigned=await active();expect(assigned).toHaveLength(1);expect(eligible.map((r:{id:string})=>r.id)).toContain(assigned[0].attendance_id);expect(assigned[0].table_session_id).toBe(context.session_id);
   await expect(card.getByText(first!.data.auto_assigned_dealer,{exact:true})).toBeVisible({timeout:5000});
   const after=await pool();expect(after.find((r:{id:string})=>r.id===recent.id)).toEqual(recent);expect(after.filter((r:{current_state:string})=>r.current_state==='assigned')).toHaveLength(1);
  }
  const writeToVisibleMs=performance.now()-started,retry=await checkout();expect(retry.data.idempotent).toBe(true);expect(retry.data.check_out_time).toBe(results[0].data.check_out_time);observation={requests:results.length,first:1,replays:results.length-1,ackMs:first!.ms,retryMs:retry.ms,writeToVisibleMs};expect(writeToVisibleMs).toBeLessThanOrEqual(3000);phase='passed';report();
 }catch(error){phase+='-failed';report();throw error;}
});

test('current owner rake closes once and exports the immutable event-day snapshot',async({page})=>{
 test.skip(process.env.LOCAL_OPERATIONS_BUY_CLOSE_ENABLED!=='1','Fourth isolated stage after reentry conservation');test.setTimeout(120_000);
 const owner=await loginOwner(page),staff=await loginFixtureStaff(),api=process.env.LOCAL_SUPABASE_URL!.replace(/\/$/,''),anon=process.env.LOCAL_SUPABASE_ANON_KEY!,club='a2000000-0000-4000-8000-000000000001',tour='a3000000-0000-4000-8000-000000000001';
 const headers=(token:string)=>({apikey:anon,Authorization:`Bearer ${token}`,'Content-Type':'application/json'});
 const rpc=async(token:string,name:string,args:Record<string,unknown>)=>{const started=performance.now(),response=await fetch(api+'/rest/v1/rpc/'+name,{method:'POST',headers:headers(token),body:JSON.stringify(args),signal:AbortSignal.timeout(5000)});const data=await response.json();expect(response.ok,name).toBe(true);return {data,ms:performance.now()-started};};
 const finalReads:number[]=[],liveReads:number[]=[];let phase='open',closeRace:unknown=null,visibleMs:number|null=null,downloadMs:number|null=null;
 const dist=(values:number[])=>{const sorted=[...values].sort((a,b)=>a-b);return {samples:sorted.length,p95Ms:sorted.length===20?sorted[18]:null,maxMs:sorted.at(-1)??null};};
 const report=()=>writeFileSync(process.env.LOCAL_OPERATIONS_LATENCY_REPORT!.replace(/\.json$/,'-buy-close-rake-export-http.json'),JSON.stringify({kind:'REAL_AUTH_BUY_CLOSE_OWNER_RAKE_AND_BROWSER_CSV',sha:process.env.LOCAL_OPERATIONS_SOURCE_SHA,phase,liveReads:dist(liveReads),finalReads:dist(finalReads),closeRace,ui:{samples:downloadMs===null?0:1,closeToExportEnabledMs:visibleMs,clickToDownloadedCsvMs:downloadMs},qualification:false,limitations:'One populated tour closure with20concurrent authorized cashier requests,not20independent closures. Twenty serial owner reads each before/after closure;one actual Finance TourRevenuePanel CSV download. Exact current six-function revenue family;existing combined Finance wrapper remains the captured fixture version and is not qualified by this test. Production-matching absent tournament/registration CDC means the real5s panel reconciliation must observe closure. No mixed1000-viewer capacity claim.'},null,2));
 try{
  for(let n=0;n<20;n++){
   const live=await rpc(owner,'get_owner_tour_rake_live_v1',{p_club_id:club});const selected=live.data.tours.find((t:{tournamentId:string})=>t.tournamentId===tour);
   expect(selected).toMatchObject({buyState:'open',provisional:true,paidBuys:41,uniquePlayers:21,rake:24600000,collected:270600000,unavailableBuys:0,waitingSeatBuys:0});liveReads.push(live.ms);
  }
  const before=await rpc(owner,'get_tour_revenue_buy_close_v1',{p_tournament_id:tour});expect(before.data).toEqual({status:'buy_open',canExport:false});
  const forbidden=await fetch(api+'/rest/v1/rpc/get_owner_tour_rake_live_v1',{method:'POST',headers:headers(staff[0].token),body:JSON.stringify({p_club_id:club}),signal:AbortSignal.timeout(5000)});expect(forbidden.status).toBe(403);
  await page.setViewportSize({width:1280,height:900});await page.goto('/ops/finance?club='+club);
  const panel=page.getByRole('region',{name:'Rake theo giải'});await expect(panel).toBeVisible();await page.getByLabel('Giải cần xem',{exact:true}).selectOption(tour);
  const exportButton=panel.getByRole('button',{name:'Xuất báo cáo rake đã chốt',exact:true});await expect(exportButton).toBeDisabled();
  phase='close-race';const started=performance.now();const closed=await Promise.all(staff.map(identity=>rpc(identity.token,'close_tournament_buy_v1',{p_tournament_id:tour})));
  expect(closed.filter(r=>r.data.status==='closed')).toHaveLength(1);expect(closed.filter(r=>r.data.status==='already_closed')).toHaveLength(19);
  const closedAt=closed[0].data.registrationClosedAt;expect(Number.isFinite(Date.parse(closedAt))).toBe(true);for(const result of closed)expect(result.data.registrationClosedAt).toBe(closedAt);
  closeRace={requests:20,firstClosures:1,alreadyClosed:19,timingScope:'one first commit plus serialized same-tour retries',latency:dist(closed.map(r=>r.ms))};report();
  await expect(exportButton).toBeEnabled({timeout:7000});visibleMs=performance.now()-started;
  phase='final-reads';let saved:{snapshot:{eventDay:string}}|undefined;
  for(let n=0;n<20;n++){
   const final=await rpc(owner,'get_tour_revenue_buy_close_v1',{p_tournament_id:tour});expect(final.data.status).toBe('final');expect(final.data.canExport).toBe(true);expect(final.data.snapshot).toMatchObject({tournamentId:tour,provisional:false,paidBuys:41,uniquePlayers:21,rake:24600000,collected:270600000,registrationClosedAt:closedAt});if(saved)expect(final.data).toEqual(saved);saved=final.data;finalReads.push(final.ms);
  }
  phase='csv';const downloading=page.waitForEvent('download'),clickAt=performance.now();await exportButton.click();const file=await downloading;expect(file.suggestedFilename()).toBe('rake-'+tour+'.csv');const path=await file.path();expect(path).toBeTruthy();const csv=readFileSync(path!,'utf8');downloadMs=performance.now()-clickAt;
  expect(csv).toContain('"Ngày giải"');const fields=csv.split('\r\n')[1].split(',').map(v=>v.slice(1,-1).replace(/""/g,'"'));expect(fields).toHaveLength(11);expect(fields[0]).toBe(tour);expect(fields[2]).toBe(saved!.snapshot.eventDay);expect(fields[5]).toBe('41');expect(fields[6]).toBe('21');expect(fields[7]).toBe('24600000');expect(fields[10]).toBe('270600000');
  const blocked=await fetch(api+'/functions/v1/tournament-reentry',{method:'POST',headers:headers(staff[0].token),body:JSON.stringify({tournament_id:tour}),signal:AbortSignal.timeout(5000)});expect(blocked.status).toBe(400);expect((await blocked.json()).error).toBe('reentry_window_closed');
  expect(dist(liveReads).p95Ms).toBeLessThanOrEqual(1000);expect(dist(finalReads).p95Ms).toBeLessThanOrEqual(1000);phase='passed';report();
 }catch(error){phase+='-failed';report();throw error;}
});
