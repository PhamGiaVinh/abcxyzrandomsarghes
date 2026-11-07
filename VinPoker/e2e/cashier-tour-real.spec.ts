import { expect, test, type Page } from "@playwright/test";
import {readFileSync,writeFileSync,appendFileSync,renameSync,existsSync,statSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {availableParallelism,cpus,totalmem} from 'node:os';
import {createClient} from '@supabase/supabase-js';
import {financeBusinessToday,parseFinanceCore,assertFinanceCalendarScope} from '../src/lib/financeSummaryRead';
import {parseSeriesClubLivePulseV1} from '../src/lib/series-intelligence/seriesClubLivePulseV1';
import {parseOpsIntelligenceContextV1} from '../src/ops/intelligence/opsIntelligenceContextV1';
import {parseOpsIntelligenceTimelineV1} from '../src/ops/intelligence/opsIntelligenceTimelineV1';
import {clockBroadcastSignal,decodeClockWireFrame} from '../tests/publicHud/clockWireDiagnostics';
import {audienceServerTiming,reentryServerTiming,audienceFailure} from '../scripts/ops/operations-audience-scope.mjs';

const currentFloorRosterV6=process.env.LOCAL_OPERATIONS_FLOOR_ROSTER_V6_ENABLED==='1';
const floorRosterRpc=currentFloorRosterV6?'get_floor_tournament_table_roster_v6':'get_floor_tournament_table_roster_v3';

test('final current Floor seat locks and redraw conserve every paid entry over HTTP',async({page})=>{
 test.skip(process.env.LOCAL_OPERATIONS_REDRAW_ENABLED!=='1','Explicit final isolated redraw stage only');test.setTimeout(180_000);
 const owner=await loginOwner(page),api=process.env.LOCAL_SUPABASE_URL!.replace(/\/$/,''),anon=process.env.LOCAL_SUPABASE_ANON_KEY!,tour='a3000000-0000-4000-8000-000000000001';
 const headers={apikey:anon,Authorization:`Bearer ${owner}`,'Content-Type':'application/json'};
 type Seat={entry_id:string;player_id:string;entry_no:number;chip_count:number;seat_number:number};
 type Table={tournament_table_id:string;game_table_id:string;table_session_id:string;session_revision:number;control_epoch:number;seat_locks:{seat_number:number}[];seats:Seat[]};
 let phase='setup',failure:{operation:string;httpStatus:number;code:string;reason:string;messageSha256:string|null}|null=null;
 const locks:{lockMs:number;unlockMs:number;readMs:number}[]=[],redraws:{planMs:number;applyMs:number;retryMs:number;continueMs:number;readMs:number}[]=[];
 const dist=(values:number[])=>{const v=[...values].sort((a,b)=>a-b);return {samples:v.length,p95Ms:v.length===20?v[18]:null,maxMs:v.at(-1)??null};};
 const report=()=>writeFileSync(process.env.LOCAL_OPERATIONS_LATENCY_REPORT!.replace(/\.json$/,'-floor-redraw-http.json'),JSON.stringify({kind:'REAL_AUTH_CURRENT_FLOOR_LOCK_REDRAW_HTTP',sha:process.env.LOCAL_OPERATIONS_SOURCE_SHA,phase,failure,locks,redraws,distributions:{locks:Object.fromEntries(['lockMs','unlockMs','readMs'].map(k=>[k,dist(locks.map(r=>r[k as keyof typeof r]))])),redraws:Object.fromEntries(['planMs','applyMs','retryMs','continueMs','readMs'].map(k=>[k,dist(redraws.map(r=>r[k as keyof typeof r]))]))},qualification:false,productionChanged:false,limitations:'Final disposable stage after prior audience/HUD proofs and audience drain. One owner Auth actor;20lock/unlock pairs and20sequential redraws of the same20paid entries. Canonical captured writers and exact retries;not20independent tournaments,simultaneous staff writers,UI/Realtime latency,receipt-reader support or mixed1000spectator redraw proof.'},null,2));
 const rpc=async(name:string,args:Record<string,unknown>)=>{const at=performance.now(),response=await fetch(api+'/rest/v1/rpc/'+name,{method:'POST',headers,body:JSON.stringify(args),signal:AbortSignal.timeout(5000)}),data=await response.json();if(!response.ok||data.ok===false)failure={operation:name,httpStatus:response.status,code:typeof data.code==='string'&&/^[A-Z0-9]{5}$/.test(data.code)?data.code:'application_denial',reason:data.message==='CENTERPOINT_TOURNAMENT_OPS_RELEASE_CLOSED'?'release_closed':'unclassified',messageSha256:typeof data.message==='string'?createHash('sha256').update(data.message).digest('hex'):null};expect(response.ok,name).toBe(true);return {data,ms:performance.now()-at};};
 const read=async(path:string)=>{const response=await fetch(api+'/rest/v1/'+path,{headers,signal:AbortSignal.timeout(5000)});expect(response.ok,path.split('?')[0]).toBe(true);return response.json();};
 const roster=async()=>(await rpc(floorRosterRpc,{p_tournament_id:tour})).data as Table[];
 const identity=(tables:Table[])=>tables.flatMap(t=>t.seats.map(s=>({entry:s.entry_id,player:s.player_id,entryNo:s.entry_no,chips:s.chip_count}))).sort((a,b)=>a.entry.localeCompare(b.entry));
 try{
  const before=await roster(),frozen=identity(before);expect(frozen).toHaveLength(20);expect(new Set(frozen.map(s=>s.entry)).size).toBe(20);expect(frozen.reduce((n,s)=>n+s.chips,0)).toBe(400000);
  expect(await read('tournament_hands?select=id&tournament_id=eq.'+tour+'&status=eq.in_progress')).toHaveLength(0);
  phase='seat-locks';report();
  for(let n=0;n<20;n++){
   const tables=await roster(),target=tables.find(t=>t.seats.length<9)!;expect(target).toBeTruthy();const seat=Array.from({length:9},(_,i)=>i+1).find(i=>!target.seats.some(s=>s.seat_number===i))!;
   const intent={p_tournament_table_id:target.tournament_table_id,p_seat_number:seat,p_locked:true,p_reason:'isolated final lock TEST',p_expected_revision:target.session_revision,p_request_id:crypto.randomUUID()};
   const locked=await rpc('floor_set_table_seat_lock_v1',intent);expect(locked.data).toMatchObject({ok:true,locked:true,seat_number:seat});expect((await rpc('floor_set_table_seat_lock_v1',intent)).data).toEqual(locked.data);
   const at=performance.now(),rows=(await roster()).find(t=>t.table_session_id===target.table_session_id)!.seat_locks.filter(s=>s.seat_number===seat);expect(rows).toHaveLength(1);
   const readMs=performance.now()-at;expect(identity(await roster())).toEqual(frozen);
   const unlockIntent={...intent,p_locked:false,p_expected_revision:locked.data.revision,p_request_id:crypto.randomUUID()};const unlocked=await rpc('floor_set_table_seat_lock_v1',unlockIntent);expect(unlocked.data).toMatchObject({ok:true,locked:false});expect((await rpc('floor_set_table_seat_lock_v1',unlockIntent)).data).toEqual(unlocked.data);
   expect((await roster()).find(t=>t.table_session_id===target.table_session_id)!.seat_locks.filter(s=>s.seat_number===seat)).toHaveLength(0);
   locks.push({lockMs:locked.ms,unlockMs:unlocked.ms,readMs});report();
  }
  phase='redraws';report();
  for(let n=0;n<20;n++){
   const physical=(await roster()).sort((a,b)=>a.tournament_table_id.localeCompare(b.tournament_table_id));expect(physical.length).toBeGreaterThanOrEqual(3);
   const planIntent={p_tournament_id:tour,p_target_max_seats:9,p_game_table_ids:physical.slice(0,3).map(t=>t.game_table_id),p_request_id:crypto.randomUUID()};
   const planned=await rpc('floor_plan_tournament_redraw_v1',planIntent);expect(planned.data).toMatchObject({ok:true,status:'planned',player_count:20});expect((await rpc('floor_plan_tournament_redraw_v1',planIntent)).data).toEqual(planned.data);
   const applyIntent={p_batch_id:planned.data.batch_id,p_request_id:crypto.randomUUID()},applied=await rpc('floor_apply_tournament_redraw_v1',applyIntent);expect(applied.data).toMatchObject({ok:true,status:'applied',player_count:20});
   const retry=await rpc('floor_apply_tournament_redraw_v1',applyIntent);expect(retry.data).toEqual(applied.data);
   const at=performance.now(),after=await roster();expect(identity(after)).toEqual(frozen);expect(after.filter(t=>t.seats.length>0)).toHaveLength(3);const readMs=performance.now()-at;
   const hold=await rpc('get_public_tournament_redraw_v1',{p_tournament_id:tour});expect(hold.data.batch_id).toBe(planned.data.batch_id);expect(hold.data.redraw_revision).toBeGreaterThan(0);
   const continuedIntent={p_batch_id:planned.data.batch_id,p_expected_redraw_revision:hold.data.redraw_revision,p_request_id:crypto.randomUUID()},continued=await rpc('floor_continue_tournament_redraw_v1',continuedIntent);expect(continued.data.ok).toBe(true);expect(typeof continued.data.clock_resumed).toBe('boolean');expect((await rpc('floor_continue_tournament_redraw_v1',continuedIntent)).data).toEqual(continued.data);
   expect((await rpc('get_public_tournament_redraw_v1',{p_tournament_id:tour})).data.batch_id).toBeNull();
   redraws.push({planMs:planned.ms,applyMs:applied.ms,retryMs:retry.ms,continueMs:continued.ms,readMs});report();
  }
  expect(identity(await roster())).toEqual(frozen);expect(locks).toHaveLength(20);expect(redraws).toHaveLength(20);expect(failure).toBeNull();
  for(const values of [locks.map(r=>r.lockMs),locks.map(r=>r.unlockMs),redraws.map(r=>r.planMs),redraws.map(r=>r.applyMs),redraws.map(r=>r.continueMs)])expect(dist(values).p95Ms).toBeLessThanOrEqual(1000);
  phase='passed';report();
 }catch(error){phase+='-failed';report();throw error;}
});

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

const scopeReadFailures=new WeakMap<Page,{status:number;path:string;code?:string;gatewayClass?:string;observedAtMs?:number;requestStartedAtMs?:number}[]>();

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
  if(!scopeReadFailures.has(page)){
    const failures:{status:number;path:string;code?:string;gatewayClass?:string;observedAtMs?:number;requestStartedAtMs?:number}[]=[];scopeReadFailures.set(page,failures);
    page.on('response',response=>{
      const path=new URL(response.url()).pathname;
      if(response.status()<400||failures.length>=20||!['/rest/v1/rpc/dealer_control_club_ids','/rest/v1/rpc/get_my_floor_operator_scope'].includes(path))return;
      const row:{status:number;path:string;code?:string;gatewayClass?:string;observedAtMs?:number;requestStartedAtMs?:number}={status:response.status(),path,observedAtMs:Date.now(),requestStartedAtMs:response.request().timing().startTime};failures.push(row);
      void response.text().then(raw=>{
        try{const code=JSON.parse(raw)?.code;if(typeof code==='string'&&/^(?:PGRST\d{3}|[0-9A-Z]{5})$/.test(code))row.code=code;}catch{/* Gateway bodies may not be JSON. */}
        row.gatewayClass=/upstream.*tim(?:ed? ?out|eout)|timeout/i.test(raw)?'timeout':/connection refused/i.test(raw)?'connection-refused':/upstream.*(?:closed|reset)|connection reset/i.test(raw)?'connection-closed':/no healthy upstream/i.test(raw)?'no-healthy-upstream':'unclassified';
      }).catch(()=>{row.gatewayClass='body-unavailable';});
    });
  }
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
 try{await expect(scope).toBeVisible();}catch(error){
  if(process.env.LOCAL_OPERATIONS_LATENCY_REPORT)writeFileSync(process.env.LOCAL_OPERATIONS_LATENCY_REPORT.replace(/\.json$/,'-dealer-scope-failure-http.json'),JSON.stringify({kind:'ISOLATED_DEALER_SWING_SCOPE_FAILURE',sha:process.env.LOCAL_OPERATIONS_SOURCE_SHA,test:test.info().title,path:new URL(page.url()).pathname,scopeReadFailures:scopeReadFailures.get(page)??[],scopeErrorVisible:await page.getByRole('alert').filter({hasText:/phạm vi CLB/}).isVisible(),qualification:false,limitations:'First-load failure retained without retry,role fallback,raw response bodies or credentials.'},null,2));
  throw error;
 }
 await scope.getByRole('combobox').click();
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
 const uiFailedReads:{status:number;path:string;code?:string;gatewayClass?:string;observedAtMs?:number;requestStartedAtMs?:number}[]=[];
 page.on('response',response=>{
  if(response.status()<400||uiFailedReads.length>=20)return;
  const row:{status:number;path:string;code?:string;gatewayClass?:string;observedAtMs?:number;requestStartedAtMs?:number}={status:response.status(),path:new URL(response.url()).pathname};uiFailedReads.push(row);
  if(!['/rest/v1/rpc/dealer_control_club_ids','/rest/v1/rpc/get_my_floor_operator_scope'].includes(row.path))return;
  // Classifications only: never retain response bodies, credentials or SQL.
  void response.text().then(raw=>{
   try{const code=JSON.parse(raw)?.code;if(typeof code==='string'&&/^(?:PGRST\d{3}|[0-9A-Z]{5})$/.test(code))row.code=code;}catch{/* Gateway errors may be HTML/text. */}
   row.gatewayClass=/upstream.*tim(?:ed? ?out|eout)|timeout/i.test(raw)?'timeout':/connection refused/i.test(raw)?'connection-refused':/upstream.*(?:closed|reset)|connection reset/i.test(raw)?'connection-closed':/no healthy upstream/i.test(raw)?'no-healthy-upstream':'unclassified';
  }).catch(()=>{row.gatewayClass='body-unavailable';});
 });
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
  {rpc:currentFloorRosterV6?floorRosterRpc:'get_floor_tournament_table_roster_v5',args:{p_tournament_id:tourId},shape:'roster'},
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
  const failures:{status:number;code:string|null;elapsedMs:number}[]=[];
  const read=async()=>{
   const started=performance.now();
   const response=await fetch(`${api}/rest/v1/rpc/${operation.rpc}`,{
    method:'POST',headers:{apikey:anon,Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
    body:JSON.stringify(operation.args),signal:AbortSignal.timeout(5000),
   });
   const payload=await response.json().catch(()=>null),elapsed=performance.now()-started;
   if(!response.ok)failures.push({status:response.status,code:typeof payload?.code==='string'&&/^(?:[0-9A-Z]{5}|PGRST\d{3})$/.test(payload.code)?payload.code:null,elapsedMs:elapsed});
   expect(response.ok,operation.rpc).toBe(true);
   expect(payload,'HTTP response must contain valid JSON').not.toBeNull();
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
   const workers=await Promise.allSettled(Array.from({length:Math.min(concurrency,count)},async()=>{while(cursor<count){cursor++;samples.push(await read());}}));
   const failed=workers.find(worker=>worker.status==='rejected');if(failed?.status==='rejected')throw failed.reason;
   expect(samples).toHaveLength(count);return samples;
  };
  try{
   await batch(20);const samples=await batch(100),ordered=[...samples].sort((a,b)=>a-b);
   expect(ordered.every(value=>Number.isFinite(value)&&value>=0)).toBe(true);
   results.push({rpc:operation.rpc,concurrency,samplesMs:samples,rowCounts:[...cardinalities].sort((a,b)=>a-b),p50Ms:ordered[49],p95Ms:ordered[94],p99Ms:ordered[98],maxMs:ordered[99],status:'passed'});
   report();
  }catch(error){
   // Retain completed phases without leaking response bodies, tokens or claims.
   results.push({rpc:operation.rpc,concurrency,status:'failed',failures});report();throw error;
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
 const rows:{operation:string;iteration:number;warmup:boolean;ackMs:number;writeToVisibleMs?:number;writeToActionReadyMs?:number;status:string}[]=[];
 let phase='screen-load',committedOpen=false,independentRosterConfirmed=false,rosterRpc='',postgresReady=false,channelJoined=false,publicTableBroadcastHints=0;
 const openedHints=new Set<string>(),closedHints=new Set<string>();
 page.on('websocket',socket=>socket.on('framereceived',frame=>{
  try{
   const decoded=decodeClockWireFrame(frame.payload) as Record<string,any>|any[];
   const signal=clockBroadcastSignal(decoded,tourId);if(signal?.components.includes('tables'))publicTableBroadcastHints++;
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
  actors:1,concurrency:1,warmupPerOperation:2,gradedPerOperation:20,phase,committedOpen,independentRosterConfirmed,rosterRpc,postgresReady,channelJoined,publicTableBroadcastHints,rows,
  sourceSignals:'Production-matching CDC omits open/close session and tournament-table sources. Count actual scoped public table Broadcast hints separately;authorized staff RPCs remain the data source and fallback remains enabled. Hint count alone does not identify which hint caused a render.',
  distributions:Object.fromEntries(['open','close'].map(operation=>{
   const samples=rows.filter(row=>row.operation===operation&&!row.warmup&&row.status==='visible').map(row=>row.writeToVisibleMs!).sort((a,b)=>a-b);
   return [operation,{samples:samples.length,p95Ms:samples.length===20?samples[18]:null,maxMs:samples.length?samples.at(-1):null}];
  })),
  actionReadinessDistributions:Object.fromEntries(['open','close'].map(operation=>{
   const samples=rows.filter(row=>row.operation===operation&&!row.warmup&&typeof row.writeToActionReadyMs==='number').map(row=>row.writeToActionReadyMs!).sort((a,b)=>a-b);
   return [operation,{samples:samples.length,p95Ms:samples.length===20?samples[18]:null,maxMs:samples.length?samples.at(-1):null}];
  })),
  fixtureBuild:{floorV3:'preview',floorUatEnvironment:'preview',redraw:currentFloorRosterV6?'preview':'off'},
  qualification:false,limitations:'Twenty serial canonical open/close pairs after two warmups on one empty TEST table;one continuously open actual screen. Excludes seat-move,dealer handover and concurrent staff capacity. No manual refresh/reload after initial screen load.',
 },null,2));
 try{
  const loaded=page.waitForResponse(response=>/\/rpc\/get_floor_tournament_table_roster_v(?:3|6)$/.test(new URL(response.url()).pathname)&&response.status()===200);
  await page.goto(`/ops/floor/tournaments/${tourId}/tables?club=a2000000-0000-4000-8000-000000000001`);
  const initialReply=await loaded;rosterRpc=new URL(initialReply.url()).pathname.split('/').at(-1)!;
  expect(rosterRpc).toBe(floorRosterRpc);
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
  const openRow={operation:'open',iteration,warmup:iteration<2,ackMs:performance.now()-started,status:'committed',writeToVisibleMs:undefined as number|undefined,writeToActionReadyMs:undefined as number|undefined};
  rows.push(openRow);report();
  expect(await rpc('floor_open_tournament_table_v3',intent)).toEqual(opened);
  const roster=await rpc(rosterRpc,{p_tournament_id:tourId});
  expect(Array.isArray(roster)).toBe(true);expect(roster.some((row:{table_session_id:string})=>row.table_session_id===opened.table_session_id)).toBe(true);
  independentRosterConfirmed=true;report();
  await expect(card).toBeVisible({timeout:Math.max(1,5000-(performance.now()-started))});
  expect(openedHints.has(opened.table_session_id),'Missing source publication must not be silently synthesized by the fixture').toBe(false);
  openRow.writeToVisibleMs=performance.now()-started;openRow.status='visible';report();
  await page.locator('[data-testid="floor-table-map-v3"][aria-busy="false"]').waitFor({state:'attached',timeout:Math.max(1,5000-(performance.now()-started))});
  await expect(page.getByTestId('floor-table-map-v3').getByRole('alert')).toHaveCount(0);
  openRow.writeToActionReadyMs=performance.now()-started;report();
  phase='close';const closing=performance.now();
  const closeIntent={p_tournament_table_id:opened.tournament_table_id,p_expected_revision:opened.revision,p_request_id:crypto.randomUUID()};
  const closed=await rpc('close_tournament_table_v3',closeIntent);expect(closed.ok).toBe(true);
  const closeRow={operation:'close',iteration,warmup:iteration<2,ackMs:performance.now()-closing,status:'committed',writeToVisibleMs:undefined as number|undefined,writeToActionReadyMs:undefined as number|undefined};
  rows.push(closeRow);report();
  expect(await rpc('close_tournament_table_v3',closeIntent)).toEqual(closed);
  await expect(card).toHaveCount(0,{timeout:Math.max(1,5000-(performance.now()-closing))});
  expect(closedHints.has(opened.table_session_id)).toBe(false);
  closeRow.writeToVisibleMs=performance.now()-closing;closeRow.status='visible';report();
  await page.locator('[data-testid="floor-table-map-v3"][aria-busy="false"]').waitFor({state:'attached',timeout:Math.max(1,5000-(performance.now()-closing))});
  await expect(page.getByTestId('floor-table-map-v3').getByRole('alert')).toHaveCount(0);
  closeRow.writeToActionReadyMs=performance.now()-closing;report();
  }
  expect(rows.filter(row=>!row.warmup&&row.status==='visible')).toHaveLength(40);
  for(const operation of ['open','close']){
   const samples=rows.filter(row=>row.operation===operation&&!row.warmup).map(row=>row.writeToVisibleMs!).sort((a,b)=>a-b);
   expect(samples[18],operation+' write-to-visible p95').toBeLessThanOrEqual(3000);
   const ready=rows.filter(row=>row.operation===operation&&!row.warmup).map(row=>row.writeToActionReadyMs!).sort((a,b)=>a-b);
   expect(ready).toHaveLength(20);expect(ready.every(value=>Number.isFinite(value))).toBe(true);
   expect(ready[18],operation+' write-to-action-ready p95').toBeLessThanOrEqual(3000);
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
 test.setTimeout(1_000_000);
 const token=await loginOwner(page),api=process.env.LOCAL_SUPABASE_URL!.replace(/\/$/,''),anon=process.env.LOCAL_SUPABASE_ANON_KEY!;
 const tourId='ac300000-0000-4000-8000-000000000001';
 const context=await browser.newContext({baseURL:process.env.PLAYWRIGHT_BASE_URL});
 const viewer=await context.newPage();let phase='initial-public-read',ackMs:number|undefined,visibleMs:number|undefined,independentRunning=false;
 let realtimeJoined=false,websocketCloses=0,websocketErrors=0;
 const signals:{at:number;components:string[];clockRevision:string|null}[]=[];
 let controlState:{action:string;ackAt:number;verifiedAt:number;running:boolean;revisionChanged:boolean}|null=null;
 const publicReads:{rpc:string;status:number;code:string|null;rows:number|null;running:boolean|null;remaining:number|null;failure:string|null}[]=[];
 viewer.on('response',async response=>{
  const rpcName=new URL(response.url()).pathname.split('/').at(-1);
  if(!['get_public_tournament_clock_summary','get_public_tournament_results'].includes(rpcName??''))return;
  try{
   const value=await response.json(),row=Array.isArray(value)?value[0]:null;
   const code=typeof value?.code==='string'&&/^[A-Z0-9]{5,12}$/.test(value.code)?value.code:null;
   const message=typeof value?.message==='string'?value.message:'';
   const failure=/ambiguous/i.test(message)?'ambiguous_reference':/does not exist/i.test(message)?'missing_dependency':/permission denied/i.test(message)?'permission_denied':/public_payout_pending/.test(message)?'payout_pending':response.ok()?null:'other_rpc_failure';
   if(publicReads.length<64)publicReads.push({rpc:rpcName!,status:response.status(),code,rows:Array.isArray(value)?value.length:null,running:typeof row?.is_running==='boolean'?row.is_running:null,remaining:typeof row?.remaining_seconds==='number'?row.remaining_seconds:null,failure});
  }catch{if(publicReads.length<64)publicReads.push({rpc:rpcName!,status:response.status(),code:null,rows:null,running:null,remaining:null,failure:'unreadable_response'});}
 });
 viewer.on('websocket',socket=>{socket.on('close',()=>{websocketCloses++;});socket.on('socketerror',()=>{websocketErrors++;});socket.on('framereceived',frame=>{try{
  const wire=decodeClockWireFrame(frame.payload) as Record<string,any>|any[],event=Array.isArray(wire)?wire[3]:wire.event,topic=Array.isArray(wire)?wire[2]:wire.topic,payload=Array.isArray(wire)?wire[4]:wire.payload;
  if(event==='phx_reply'&&topic==='realtime:public:tournament-viewer-v2:'+tourId&&payload?.status==='ok')realtimeJoined=true;
  const signal=clockBroadcastSignal(wire,tourId);if(signal&&signals.length<128)signals.push({at:Date.now(),...signal});
 }catch{ /* No raw frames or credentials are retained. */ }});});
 const controls:{action:string;warmup:boolean;ackMs:number;writeToVisibleMs:number}[]=[];
 const grouped=()=>['pause','resume'].map(action=>{const values=controls.filter(row=>row.action===action&&!row.warmup).map(row=>row.writeToVisibleMs).sort((a,b)=>a-b);return {action,samples:values.length,p95Ms:values.length===20?values[18]:null,maxMs:values.at(-1)??null};});
 const report=()=>writeFileSync(process.env.LOCAL_OPERATIONS_LATENCY_REPORT!.replace(/\.json$/,'-clock-ui-http.json'),JSON.stringify({
  kind:'CANONICAL_CLOCK_RPC_START_TO_ANONYMOUS_PUBLIC_SCREEN',sha:process.env.LOCAL_OPERATIONS_SOURCE_SHA,
  phase,ackMs,writeToVisibleMs:visibleMs,independentRunning,realtimeJoined,websocketCloses,websocketErrors,signals,controlState,publicReads,actors:1,anonymousObservers:1,startSamples:ackMs===undefined?0:1,controlWarmupPairs:3,controlGradedPairs:20,controls,grouped:grouped(),qualification:false,
  limitations:'One start plus3warmup and20graded canonical pause/resume pairs through real HTTP on one continuously open anonymous screen. Start is a single observation,not p95. Realtime join is observed separately;join alone does not prove which signal caused each render.20s per transition is an observation timeout,not a newly approved latency target. No refresh/reload,Edge wrapper,next-level/automatic-break screen or mixed1000spectator claim. Separate control test covers CAS concurrency.',
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
  visibleMs=performance.now()-started;report();
  for(let index=0;index<23;index++)for(const action of ['pause','resume']){
   phase='screen-'+action;const before=await rpc('get_tournament_clock',{p_tournament_id:tourId});
   expect(before.is_running).toBe(action==='pause');expect(before.control_revision).toMatch(/^[a-f0-9]{32}$/);
   const began=performance.now(),changed=await rpc('floor_control_tournament_clock',{p_tournament_id:tourId,p_action:action,p_delta_seconds:null,p_expected_control_revision:before.control_revision}),ack=performance.now();
   expect(changed.ok).toBe(true);
   const after=await rpc('get_tournament_clock',{p_tournament_id:tourId});
   controlState={action,ackAt:Date.now()-Math.round(performance.now()-ack),verifiedAt:Date.now(),running:after.is_running,revisionChanged:after.control_revision!==before.control_revision};report();
   expect(after.is_running).toBe(action==='resume');expect(after.control_revision).not.toBe(before.control_revision);
   const marker=viewer.getByText('Đồng hồ đang dừng',{exact:true}),remaining=()=>Math.max(1,20000-(performance.now()-began));
   if(action==='pause')await expect(marker).toBeVisible({timeout:remaining()});else await expect(marker).toHaveCount(0,{timeout:remaining()});
   // Absence of the paused marker alone also matches an error/blank page.
   await expect(viewer.getByRole('heading',{name:'Operations clock TEST',exact:true})).toBeVisible({timeout:remaining()});
   await expect(viewer.getByText('Live',{exact:true})).toBeVisible({timeout:remaining()});
   await expect(viewer.getByText(/^\d{2}:\d{2}$/)).toBeVisible({timeout:remaining()});
   const observed=performance.now();expect(observed-began).toBeLessThanOrEqual(20000);
   controls.push({action,warmup:index<3,ackMs:ack-began,writeToVisibleMs:observed-began});report();
  }
  for(const row of grouped())expect(row.samples).toBe(20);phase='passed';report();
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
 let handoverFailure:{outcome:string;knownReasons:string[];responseSha256:string}|null=null;
 const summarize=(key:'ackMs'|'retryMs'|'independentStateMs'|'writeToVisibleMs'|'writeToRealtimeMs')=>{
  const samples=rows.filter(row=>!row.warmup).map(row=>row[key]).filter((value):value is number=>typeof value==='number').sort((a,b)=>a-b);
  return {samples:samples.length,p95Ms:samples.length===20?samples[18]:null,maxMs:samples.at(-1)??null};
 };
 const report=()=>writeFileSync(process.env.LOCAL_OPERATIONS_LATENCY_REPORT!.replace(/\.json$/,'-dealer-handover-http.json'),JSON.stringify({
  kind:'REAL_AUTH_HTTP_CANONICAL_DEALER_HANDOVER_WITH_INDEPENDENT_OWNER_READ',sha:process.env.LOCAL_OPERATIONS_SOURCE_SHA,phase,actors:20,concurrency:1,
  warmup:2,graded:20,rows,postgresReady,distributions:{ack:summarize('ackMs'),retry:summarize('retryMs'),independentState:summarize('independentStateMs'),
   ...(realtimeEnabled?{writeToVisible:summarize('writeToVisibleMs'),writeToRealtime:summarize('writeToRealtimeMs')}:{})},race,handoverFailure,qualification:false,
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
   const result=await rpc(staff[actor].token,'operator_perform_swing',intent);
   if(!result.ok||result.data.outcome!=='swung'){
    const serialized=JSON.stringify(result.data);
    handoverFailure={outcome:result.data.outcome==='error'?'error':'other',knownReasons:['DEALER_ACQUISITION_ATTENDANCE_STALE','DEALER_MANUAL_ACQUISITION_FORBIDDEN','DEALER_ACQUISITION_CLUB_MISMATCH','DEALER_AUTO_ASSIGN_OFF'].filter(reason=>serialized.includes(reason)),responseSha256:createHash('sha256').update(serialized).digest('hex')};report();
   }
   expect(result.ok).toBe(true);expect(result.data.outcome).toBe('swung');
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
  limitations:'Checkout of the already-released outgoing dealer after canonical handover;actual current handler,Auth,service-only289RPC and independent control-actor reads. Verifies retained worked minutes and unchanged incoming assignment. Excludes checkout replacement/active-table races,inactive-payroll closing and production Telegram;notification destinations are absent in this stage and external networking is denied. Duplicate race uses one actor with20identical requests.',
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
 const readers=[floorRosterRpc,'get_floor_seatable_entries','get_floor_restorable_entries_v3','get_floor_pending_tracker_moves_v1'];
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
 const rpc=async(token:string,name:string,args:Record<string,unknown>)=>{const started=performance.now(),response=await fetch(api+'/rest/v1/rpc/'+name,{method:'POST',headers:{apikey:anon,Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(args),signal:AbortSignal.timeout(5000)});const data=await response.json();expect(response.ok,name).toBe(true);return {data,ms:performance.now()-started,serverTiming:audienceServerTiming(response.headers)};};
 const worklist=async()=>{const {data}=await rpc(owner,'cashier_tour_worklist_v1',{p_club_id:club,p_tournament_id:tour,p_query:'',p_bucket:'all',p_page:0,p_limit:50});expect(data.ok).toBe(true);return data.rows as {id:string;player_id:string;received:number;total_pay:number;status:string}[];};
 const rows:{actor:number;ackMs:number;retryMs:number;independentReadMs:number;ackParts:Record<string,number>;retryParts:Record<string,number>}[]=[];let phase='open-canonical-tables';
 const distribution=(field:'ackMs'|'retryMs'|'independentReadMs')=>{const values=rows.map(r=>r[field]).sort((a,b)=>a-b);return {samples:values.length,p95Ms:values.length===20?values[18]:null,maxMs:values.at(-1)??null};};
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
   rows.push({actor,ackMs:first.ms,retryMs:retry.ms,independentReadMs:performance.now()-started,ackParts:first.serverTiming,retryParts:retry.serverTiming});report();
  }
  expect(rows).toHaveLength(20);expect(distribution('ackMs').p95Ms).toBeLessThanOrEqual(1000);expect(distribution('retryMs').p95Ms).toBeLessThanOrEqual(1000);phase='passed';report();
 }catch(error){phase+='-failed';report();throw error;}
});

test('pending reentry transport rejects ambiguous payment account before creation',async()=>{
 test.skip(process.env.LOCAL_REENTRY_BANK_PROBE_STAGE!=='1'||process.env.LOCAL_REENTRY_TRANSPORT_PROBE!=='1'||(process.env.LOCAL_REENTRY_FAULT_MODE??'failure-injection')!=='failure-injection','Dedicated disposable bank-fixture stage only');
 const staff=await loginFixtureStaff(),api=process.env.LOCAL_SUPABASE_URL!.replace(/\/$/,''),anon=process.env.LOCAL_SUPABASE_ANON_KEY!;
 const started=performance.now();
 const response=await fetch(api+'/functions/v1/tournament-reentry',{method:'POST',
  headers:{apikey:anon,Authorization:`Bearer ${staff[0].token}`,'Content-Type':'application/json'},
  body:JSON.stringify({tournament_id:'a3000000-0000-4000-8000-000000000001'}),signal:AbortSignal.timeout(5000)});
 const body=await response.json();
 const expectedError='SePay master account is not exclusive to this club';
 const canonicalErrors=new Set(['actor_not_allowed','invalid_request','tournament_not_found','cashier_tour_disabled','reentry_window_closed','source_entry_not_found','entry_not_reenterable','player_already_active','ambiguous_reentry_registration','registration_identity_mismatch','reentry_already_confirmed','legacy_reentry_price_requires_review']);
 const errorKind=body?.error===expectedError?'ambiguous_master_account':canonicalErrors.has(body?.error)?body.error:body?.error==='Invalid input'?'invalid_input':body?.error==='Invalid JSON body'?'invalid_json':body?.error==='CLB chưa cấu hình tài khoản nhận tiền.'?'missing_legacy_bank':body?.error==='Tournament has no club'?'tour_missing_club':'other';
 const errorSha256=typeof body?.error==='string'&&body.error.length<=256?createHash('sha256').update(body.error).digest('hex'):null;
 writeFileSync(process.env.LOCAL_OPERATIONS_LATENCY_REPORT!.replace(/\.json$/,'-reentry-bank-ambiguity-http.json'),JSON.stringify({
  kind:'REAL_AUTH_COMPOSITE_REENTRY_BANK_AMBIGUITY_DENIAL',sha:process.env.LOCAL_OPERATIONS_SOURCE_SHA,
  phase:response.status===503&&body?.error===expectedError?'denied':'unexpected-response',httpStatus:response.status,errorKind,errorSha256,elapsedMs:performance.now()-started,qualification:false,
  limitations:'Ambiguous active bank fixture only;source and money preservation require the separate native before/after check. Not bank-outage,closed-buy race or1000-viewer proof.',
 },null,2));
 expect(response.status).toBe(503);expect(body).toEqual({error:expectedError});
});

test('current Floor bust and player reentry preserve separate paid entry generations',async({page})=>{
 test.skip(process.env.LOCAL_OPERATIONS_REENTRY_ENABLED!=='1','Third isolated stage after full seated-payment proof');test.setTimeout(180_000);
 const owner=await loginOwner(page),staff=await loginFixtureStaff(),api=process.env.LOCAL_SUPABASE_URL!.replace(/\/$/,''),anon=process.env.LOCAL_SUPABASE_ANON_KEY!;
 const club='a2000000-0000-4000-8000-000000000001',tour='a3000000-0000-4000-8000-000000000001';
 const headers=(token:string)=>({apikey:anon,Authorization:`Bearer ${token}`,'Content-Type':'application/json'});
 let failure:Record<string,unknown>|null=null,currentActor:number|null=null;
 const rpc=async(token:string,name:string,args:Record<string,unknown>)=>{const started=performance.now(),startedAt=Date.now();let status:number|undefined;try{const response=await fetch(api+'/rest/v1/rpc/'+name,{method:'POST',headers:headers(token),body:JSON.stringify(args),signal:AbortSignal.timeout(5000)});status=response.status;const data=await response.json();expect(response.ok,name).toBe(true);return {data,ms:performance.now()-started};}catch(cause){failure={operation:[floorRosterRpc,'floor_bust_player_v3','resolve_cashier_cash_buyin_intent_v1'].includes(name)?name:'unknown',actorIndex:currentActor,startedAt,finishedAt:Date.now(),...audienceFailure(cause,status)};throw cause;}};
 type Seat={entry_id:string;player_id:string;entry_no:number;chip_count:number};
 type Table={session_revision:number;control_epoch:number;control_mode:string;seats:Seat[]};
 const roster=async()=>{const {data}=await rpc(owner,floorRosterRpc,{p_tournament_id:tour});expect(Array.isArray(data)).toBe(true);return data as Table[];};
 const location=async(player:string)=>{const tables=await roster(),table=tables.find(t=>t.seats.some(s=>s.player_id===player));expect(table).toBeTruthy();return {table:table!,seat:table!.seats.find(s=>s.player_id===player)!};};
 const rows:{actor:number;bustMs:number;bustRetryMs:number;registrationMs:number;registrationRetryMs:number;paymentMs:number;paymentRetryMs:number;independentReadMs:number;registrationTiming:ReturnType<typeof reentryServerTiming>;registrationRetryTiming:ReturnType<typeof reentryServerTiming>}[]=[];let phase='authorization';
 const transportCandidate=process.env.LOCAL_REENTRY_TRANSPORT_PROBE==='1',reentryFaultMode=transportCandidate?(process.env.LOCAL_REENTRY_FAULT_MODE??'failure-injection'):null;let concurrentCreation:Record<string,number>|null=null;
 const responseLoss={enabled:transportCandidate&&reentryFaultMode==='failure-injection',upstreamCommitted:false,clientDisconnected:false,socketDroppedAfterCommit:false,sameRegistrationRecovered:false,sourceEntryPreserved:false,elapsedMs:null as number|null};
 const dist=(key:'bustMs'|'bustRetryMs'|'registrationMs'|'registrationRetryMs'|'paymentMs'|'paymentRetryMs'|'independentReadMs')=>{const values=rows.map(r=>r[key]).sort((a,b)=>a-b);return {samples:values.length,p95Ms:values.length===20?values[18]:null,maxMs:values.at(-1)??null};};
 const report=()=>writeFileSync(process.env.LOCAL_OPERATIONS_LATENCY_REPORT!.replace(/\.json$/,'-bust-reentry-http.json'),JSON.stringify({kind:'REAL_AUTH_FLOOR_BUST_REENTRY_EDGE_AND_CANONICAL_CASH_SEATING',sha:process.env.LOCAL_OPERATIONS_SOURCE_SHA,phase,failure,transportCandidate,reentryFaultMode,concurrentCreation,responseLoss,rosterRpc:floorRosterRpc,graded:20,warmup:0,rows,distributions:Object.fromEntries(['bustMs','bustRetryMs','registrationMs','registrationRetryMs','paymentMs','paymentRetryMs','independentReadMs'].map(key=>[key,dist(key as 'bustMs'|'bustRetryMs'|'registrationMs'|'registrationRetryMs'|'paymentMs'|'paymentRetryMs'|'independentReadMs')])),qualification:false,limitations:'Twenty synthetic players with real Auth;the optional transport candidate adds one20-request same-player creation race. Notification mode is reported separately. Owner performs canonical manual-mode bust with explicit positive-chip override,then each player requests the actual reentry Edge and each cashier pays its immutable server price. Placement/revision observations use the reported roster RPC;full candidate uses canonicalV6,separate retained-schema mode uses capturedV3. Bust/reentry/confirmation/allocator bodies are production-hash pinned. No tracker-mode zero-chip bust,browser latency,concurrent distinct-player seating or mixed1000-viewer capacity claim.'},null,2));
 const reenter=async(actor:number)=>{const started=performance.now(),startedAt=Date.now();let status:number|undefined;try{const response=await fetch(api+'/functions/v1/tournament-reentry',{method:'POST',headers:headers(staff[actor].token),body:JSON.stringify({tournament_id:tour}),signal:AbortSignal.timeout(5000)});status=response.status;const data=await response.json();expect(response.ok).toBe(true);expect(data.success).toBe(true);expect(data.reentry).toBe(true);expect(Number(data.total_pay)).toBe(6600000);expect(data.free_rake_applied).toBe(false);return {data,ms:performance.now()-started,timing:reentryServerTiming(response.headers.get('server-timing'))};}catch(cause){failure={operation:'tournament-reentry',actorIndex:actor,startedAt,finishedAt:Date.now(),...audienceFailure(cause,status)};throw cause;}};
 const loseCommittedResponse=async(actor:number,sourceEntry:string)=>{
  expect(responseLoss.enabled).toBe(true);expect(api).toBe('http://cashier-api:8000');
  let requests=0,upstreamFailed=false,committed:{registration_id:string;reference_code:string}|null=null;
  const server=createServer(async(request,response)=>{
   try{
    expect(++requests).toBe(1);expect(request.method).toBe('POST');expect(request.url).toBe('/drop-once');
    expect(request.headers.authorization).toBe('Bearer '+staff[actor].token);expect(request.headers.apikey).toBe(anon);
    const chunks:Buffer[]=[];let bytes=0;for await(const chunk of request){bytes+=chunk.length;expect(bytes).toBeLessThanOrEqual(4096);chunks.push(Buffer.from(chunk));}
    expect(JSON.parse(Buffer.concat(chunks).toString('utf8'))).toEqual({tournament_id:tour});
    const upstream=await fetch(api+'/functions/v1/tournament-reentry',{method:'POST',headers:headers(staff[actor].token),body:JSON.stringify({tournament_id:tour}),redirect:'error',signal:AbortSignal.timeout(5000)});
    expect(upstream.ok).toBe(true);const data=await upstream.json();expect(data).toMatchObject({success:true,reentry:true,already_registered:false});expect(Number(data.total_pay)).toBe(6600000);
    expect(typeof data.registration_id).toBe('string');expect(typeof data.reference_code).toBe('string');committed={registration_id:data.registration_id,reference_code:data.reference_code};
   }catch{upstreamFailed=true;}finally{responseLoss.socketDroppedAfterCommit=committed!==null&&!upstreamFailed;response.destroy();}
  });
  const started=performance.now();
  try{
   await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
   const address=server.address();if(!address||typeof address==='string')throw Error('isolated_loss_listener_required');
   try{const unexpected=await fetch('http://127.0.0.1:'+address.port+'/drop-once',{method:'POST',headers:headers(staff[actor].token),body:JSON.stringify({tournament_id:tour}),signal:AbortSignal.timeout(7000)});await unexpected.arrayBuffer();}
   catch(cause){responseLoss.clientDisconnected=audienceFailure(cause).kind==='connection_lost';}
   expect(responseLoss.clientDisconnected).toBe(true);expect(responseLoss.socketDroppedAfterCommit).toBe(true);expect(upstreamFailed).toBe(false);expect(requests).toBe(1);expect(committed).not.toBeNull();
   // Verify the committed pending row independently before any client retry.
   const read=await fetch(api+'/rest/v1/tournament_registrations?select=id,status,source_entry_id&tournament_id=eq.'+tour+'&player_id=eq.'+staff[actor].userId+'&source_entry_id=eq.'+sourceEntry,{headers:headers(owner),signal:AbortSignal.timeout(5000)});
   expect(read.ok).toBe(true);expect(await read.json()).toEqual([{id:committed!.registration_id,status:'pending',source_entry_id:sourceEntry}]);responseLoss.upstreamCommitted=true;responseLoss.sourceEntryPreserved=true;
   const recovered=await reenter(actor);expect(recovered.data.already_registered).toBe(true);expect(recovered.data.registration_id).toBe(committed!.registration_id);expect(recovered.data.reference_code).toBe(committed!.reference_code);responseLoss.sameRegistrationRecovered=true;responseLoss.elapsedMs=performance.now()-started;
   return recovered;
  }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
 };
 try{
  const denied=await fetch(api+'/rest/v1/rpc/cashier_create_app_reentry_v1',{method:'POST',headers:headers(staff[0].token),body:JSON.stringify({p_tournament_id:tour,p_player_id:staff[1].userId}),signal:AbortSignal.timeout(5000)});expect(denied.status).toBe(403);
  const unauthenticated=await fetch(api+'/functions/v1/tournament-reentry',{method:'POST',headers:{apikey:anon,'Content-Type':'application/json'},body:JSON.stringify({tournament_id:tour}),signal:AbortSignal.timeout(5000)});expect(unauthenticated.status).toBe(401);
  if(transportCandidate){for(const token of [anon,staff[0].token]){
   const response=await fetch(api+'/rest/v1/rpc/cashier_app_reentry_transport_v1',{method:'POST',headers:headers(token),body:JSON.stringify({p_tournament_id:tour,p_player_id:staff[1].userId}),signal:AbortSignal.timeout(5000)});
   expect([401,403]).toContain(response.status);expect((await response.json()).code).toBe('42501');
  }}
  phase='serial';
  for(let actor=0;actor<staff.length;actor++){
   currentActor=actor;
   const before=await location(staff[actor].userId);expect(before.table.control_mode).toBe('manual');expect(before.seat.entry_no).toBe(1);expect(before.seat.chip_count).toBe(20000);
   const intent={p_entry_id:before.seat.entry_id,p_expected_revision:before.table.session_revision,p_expected_control_epoch:before.table.control_epoch,p_expected_chip_count:20000,p_request_id:crypto.randomUUID(),p_reason:'floor_v3_operator_bust'};
   if(actor===0){const stale=await rpc(owner,'floor_bust_player_v3',{...intent,p_expected_revision:intent.p_expected_revision+1,p_request_id:crypto.randomUUID()});expect(stale.data.error).toBe('STALE_STATE');}
   const busted=await rpc(owner,'floor_bust_player_v3',intent);expect(busted.data.ok).toBe(true);expect(busted.data.manual_nonzero_chip_override).toBe(true);expect(busted.data.payout_applied).toBe(false);
   const bustRetry=await rpc(owner,'floor_bust_player_v3',intent);expect(bustRetry.data).toEqual(busted.data);
   expect((await roster()).flatMap(t=>t.seats).some(s=>s.player_id===staff[actor].userId)).toBe(false);
   let registration:Awaited<ReturnType<typeof reenter>>;
   if(transportCandidate&&actor===0){
    const contenders=await Promise.all(Array.from({length:20},()=>reenter(actor)));
    expect(contenders.filter(r=>r.data.already_registered===false)).toHaveLength(1);
    expect(new Set(contenders.map(r=>r.data.registration_id)).size).toBe(1);
    expect(new Set(contenders.map(r=>r.data.reference_code)).size).toBe(1);
    for(const result of contenders)expect(result.data.breakdown).toEqual(contenders[0].data.breakdown);
    registration=contenders.find(r=>r.data.already_registered===false)!;
    concurrentCreation={requests:20,created:1,recovered:19};
   }else if(responseLoss.enabled&&actor===1)registration=await loseCommittedResponse(actor,before.seat.entry_id);
   else registration=await reenter(actor);
   const retryRegistration=await reenter(actor);expect(registration.data.already_registered).toBe(responseLoss.enabled&&actor===1);expect(retryRegistration.data.already_registered).toBe(true);expect(retryRegistration.data.registration_id).toBe(registration.data.registration_id);expect(retryRegistration.data.reference_code).toBe(registration.data.reference_code);
   const payment={actor_id:staff[actor].userId,club_id:club,tournament_id:tour,registration_id:registration.data.registration_id,amount:registration.data.total_pay,request_id:crypto.randomUUID()};
   const paid=await rpc(staff[actor].token,'resolve_cashier_cash_buyin_intent_v1',{p_intent:payment,p_action:'record'});expect(paid.data.status).toBe('recorded');expect(paid.data.result.payment_state).toBe('paid');expect(paid.data.result.seating_state).toBe('seated');
   const paymentRetry=await rpc(staff[actor].token,'resolve_cashier_cash_buyin_intent_v1',{p_intent:payment,p_action:'record'});expect(paymentRetry.data).toEqual(paid.data);
   const started=performance.now(),after=await location(staff[actor].userId);expect(after.seat.entry_id).not.toBe(before.seat.entry_id);expect(after.seat.entry_no).toBe(2);expect(after.seat.chip_count).toBe(20000);
   rows.push({actor,bustMs:busted.ms,bustRetryMs:bustRetry.ms,registrationMs:registration.ms,registrationRetryMs:retryRegistration.ms,paymentMs:paid.ms,paymentRetryMs:paymentRetry.ms,independentReadMs:performance.now()-started,registrationTiming:registration.timing,registrationRetryTiming:retryRegistration.timing});report();
  }
  expect(rows).toHaveLength(20);
  if(responseLoss.enabled){expect(responseLoss.upstreamCommitted&&responseLoss.clientDisconnected&&responseLoss.socketDroppedAfterCommit&&responseLoss.sameRegistrationRecovered&&responseLoss.sourceEntryPreserved).toBe(true);writeFileSync(process.env.LOCAL_OPERATIONS_LATENCY_REPORT!.replace(/\.json$/,'-reentry-response-loss-http.json'),JSON.stringify({kind:'REAL_EDGE_HTTP_COMMITTED_REENTRY_RESPONSE_LOSS_AND_RETRY',sha:process.env.LOCAL_OPERATIONS_SOURCE_SHA,...responseLoss,qualification:false,productionChanged:false,limitations:'Fault10only:one loopback HTTP proxy consumes an actual verified-player Edge committed200 then destroys the client socket without returning the body. Independent owner read proves pending creation before retry;client retry supplies payment data. Existing20paid/seated and money/notification conservation gates still apply. Fault actor1registration timing is recovery HTTP,not first-response success. Not mid-query connection termination,closed-buy race or1000capacity.'},null,2));}
  const failedLatencyGates=(['bustMs','registrationMs','paymentMs'] as const).filter(key=>dist(key).p95Ms!>1000);
  if(failedLatencyGates.length){phase='latency-failed';report();throw Error('OPERATIONAL_REENTRY_LATENCY_GATE_FAILED');}
  phase='passed';report();
 }catch(error){if(!(error instanceof Error&&error.message==='OPERATIONAL_REENTRY_LATENCY_GATE_FAILED'))phase+='-failed';report();throw error;}
});

test('current Floor exact movement conserves paid chips and retries through HTTP',async({page})=>{
 test.skip(process.env.LOCAL_OPERATIONS_EXACT_MOVE_ENABLED!=='1','Fifth isolated stage after revenue conservation');test.setTimeout(120_000);
 const owner=await loginOwner(page),staff=await loginFixtureStaff(),api=process.env.LOCAL_SUPABASE_URL!.replace(/\/$/,''),anon=process.env.LOCAL_SUPABASE_ANON_KEY!,tour='a3000000-0000-4000-8000-000000000001';
 const rpc=async(token:string,name:string,args:Record<string,unknown>)=>{const started=performance.now(),response=await fetch(api+'/rest/v1/rpc/'+name,{method:'POST',headers:{apikey:anon,Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(args),signal:AbortSignal.timeout(5000)});const data=await response.json();expect(response.ok,name).toBe(true);return {data,ms:performance.now()-started};};
 type Seat={entry_id:string;player_id:string;entry_no:number;chip_count:number;seat_number:number};
 type Table={tournament_table_id:string;table_session_id:string;session_revision:number;control_epoch:number;control_mode:string;seats:Seat[]};
 const roster=async()=>{const result=await rpc(owner,floorRosterRpc,{p_tournament_id:tour});expect(Array.isArray(result.data)).toBe(true);return result.data as Table[];};
 const intentFor=async(player:string)=>{
  const tables=await roster(),source=tables.find(t=>t.seats.some(s=>s.player_id===player));expect(source).toBeTruthy();
  const seat=source!.seats.find(s=>s.player_id===player)!;expect(seat.entry_no).toBe(2);expect(seat.chip_count).toBe(20000);expect(source!.control_mode).toBe('manual');
  const destination=tables.find(t=>t.tournament_table_id!==source!.tournament_table_id&&t.control_mode==='manual'&&t.seats.length<9);expect(destination).toBeTruthy();
  const target=Array.from({length:9},(_,n)=>n+1).find(n=>!destination!.seats.some(s=>s.seat_number===n));expect(target).toBeTruthy();
  return {p_entry_id:seat.entry_id,p_from_tournament_table_id:source!.tournament_table_id,p_from_table_session_id:source!.table_session_id,p_to_tournament_table_id:destination!.tournament_table_id,p_to_table_session_id:destination!.table_session_id,p_to_seat_number:target!,p_expected_source_revision:source!.session_revision,p_expected_destination_revision:destination!.session_revision,p_expected_source_epoch:source!.control_epoch,p_expected_destination_epoch:destination!.control_epoch,p_reason:'isolated exact-move latency TEST',p_request_id:crypto.randomUUID()};
 };
 const rows:{ackMs:number;retryMs:number;independentReadMs:number}[]=[];let phase='authorization';let race:unknown=null;
 const dist=(values:number[])=>{const sorted=[...values].sort((a,b)=>a-b);return {samples:sorted.length,p95Ms:sorted.length===20?sorted[18]:null,maxMs:sorted.at(-1)??null};};
 const report=()=>writeFileSync(process.env.LOCAL_OPERATIONS_LATENCY_REPORT!.replace(/\.json$/,'-floor-exact-move-http.json'),JSON.stringify({kind:'REAL_AUTH_CURRENT_FLOOR_EXACT_MOVE_HTTP',sha:process.env.LOCAL_OPERATIONS_SOURCE_SHA,phase,actors:20,graded:20,warmup:0,rows,distributions:Object.fromEntries(['ackMs','retryMs','independentReadMs'].map(key=>[key,dist(rows.map(row=>row[key as keyof typeof row]))])),race,qualification:false,limitations:'Twenty serial moves of distinct paid entry2 players by20authorized cashier actors;manual-mode empty target seats in disposable9-max fixtures. Actual current v2/v3/v4/v5/queue writer bodies are production-hash pinned. Placement/independent reads use rosterV6 in full candidate mode and the capturedV3 reader in the separate retained-schema mode. One21st move has20same-key concurrent requests from actor0. No browser move latency,active-hand deferred move,redraw,multiday-final runtime or mixed1000-viewer claim.'},null,2));
 try{
  // With20players on3nine-seat tables, the other two tables can both fill
  // while a source still contains2players. Open one explicit spare fixture
  // through the real Floor intent, after all paid-seating/revenue proofs.
  // Four tables guarantee a legal empty destination for this positive case.
  phase='spare-capacity';
  const fixture=JSON.parse(readFileSync(process.env.LOCAL_OPERATIONS_DEALER_FILE!,'utf8')) as {floorReadLoad:{gameTableIds:string[]}};
  expect(fixture.floorReadLoad.gameTableIds).toHaveLength(20);
  const spare=await rpc(owner,'floor_open_tournament_table_v3',{p_tournament_id:tour,p_game_table_id:fixture.floorReadLoad.gameTableIds[0],p_control_mode:'manual',p_request_id:crypto.randomUUID()});expect(spare.data.ok).toBe(true);
  const opened=(await roster()).find(t=>t.tournament_table_id===spare.data.tournament_table_id);expect(opened).toBeTruthy();expect(opened!.table_session_id).toBe(spare.data.table_session_id);expect(opened!.control_mode).toBe('manual');expect(opened!.seats).toHaveLength(0);
  phase='authorization';
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
 const mode=process.env.LOCAL_OPERATIONS_REPLACEMENT_ENABLED;test.skip(mode!=='off'&&mode!=='on'&&mode!=='rest-race'&&mode!=='off-race','Seventh isolated stage with exact current acquisition/rest/day contracts');test.setTimeout(60_000);
 const owner=await loginOwner(page),staff=await loginFixtureStaff(),api=process.env.LOCAL_SUPABASE_URL!.replace(/\/$/,''),anon=process.env.LOCAL_SUPABASE_ANON_KEY!;
 const fixture=JSON.parse(readFileSync(process.env.LOCAL_OPERATIONS_DEALER_FILE!,'utf8')) as {handoverClubId:string;handovers:{n:number;table_id:string;session_id:string;incoming_attendance:string}[]};
 const context=fixture.handovers[mode==='off'?20:21],headers=(token:string)=>({apikey:anon,Authorization:`Bearer ${token}`,'Content-Type':'application/json'});
 const read=async(table:string,query:string)=>{const response=await fetch(api+'/rest/v1/'+table+'?'+query,{headers:headers(owner),signal:AbortSignal.timeout(5000)});expect(response.ok).toBe(true);const data=await response.json();expect(Array.isArray(data)).toBe(true);return data;};
 const active=()=>read('dealer_assignments','select=id,attendance_id,table_session_id&table_id=eq.'+context.table_id+'&released_at=is.null&status=eq.assigned');
 const pool=()=>read('dealer_attendance','select=id,current_state,last_released_at,dealers!inner(full_name)&dealers.club_id=eq.'+fixture.handoverClubId+'&dealers.full_name=like.Replacement eligibility TEST *');
 let checkoutAttendance=context.incoming_attendance;
 const checkout=async()=>{const started=performance.now(),response=await fetch(api+'/functions/v1/checkout-dealer',{method:'POST',headers:headers(staff[0].token),body:JSON.stringify({attendance_id:checkoutAttendance}),signal:AbortSignal.timeout(10000)});expect(response.ok).toBe(true);const result=await response.json();expect(result.results).toHaveLength(1);expect(result.results[0].success).toBe(true);return {data:result.results[0],ms:performance.now()-started};};
 let phase='preconditions';let observation:unknown=null;
 const report=()=>writeFileSync(process.env.LOCAL_OPERATIONS_LATENCY_REPORT!.replace(/\.json$/,'-dealer-replacement-'+mode+'-http.json'),JSON.stringify({kind:'REAL_AUTH_CHECKOUT_AUTOMATIC_POLICY_AND_ELIGIBILITY',sha:process.env.LOCAL_OPERATIONS_SOURCE_SHA,mode,phase,observation,qualification:false,limitations:'One actual checkout per OFF/ON mode;ON has20same-attendance concurrent requests. No p95/capacity claim. Two eligible synthetic attendance markers20minutes old and one recent1minute marker;current day/shift/commit guards restored with production hashes. Rest-race mode is a deliberately held actual PostgreSQL row lock with a fresh rest marker committed after observing worker blocking; it is not a normal-latency sample or proof of the full canonical concurrent work/release path. OFF-race uses a real held settings UPDATE committed after the worker blocks; a synthetic canonical assignment initializes its outgoing dealer. No claim about rest expiry worker,payroll,Telegram or mixed1000spectator load.'},null,2));
 try{
  expect((await read('club_settings','select=auto_swing_enabled&club_id=eq.'+fixture.handoverClubId))[0].auto_swing_enabled).toBe(mode!=='off');
  const candidates=await pool();expect(candidates).toHaveLength(mode==='off-race'?4:3);expect(candidates.filter((r:{current_state:string})=>r.current_state==='available')).toHaveLength(mode!=='off'&&mode!=='on'?2:3);
  const recent=candidates.find((r:{dealers:{full_name:string}})=>r.dealers.full_name==='Replacement eligibility TEST 3');expect(recent).toBeTruthy();const eligible=candidates.filter((r:{id:string})=>r.id!==recent.id);
  const before=await active();expect(before).toHaveLength(1);if(mode==='rest-race'||mode==='off-race')checkoutAttendance=before[0].attendance_id;else expect(before[0].attendance_id).toBe(context.incoming_attendance);
  await page.goto('/dealer-swing');await selectDealerSwingClub(page,'Handover latency TEST');const card=page.locator('#table-card-'+context.table_id);if(mode==='off'||mode==='on')await expect(card.getByText('Handover incoming TEST '+context.n,{exact:true})).toBeVisible({timeout:30_000});else await expect(card.getByText(/Replacement eligibility TEST [12]/)).toBeVisible({timeout:30_000});
  phase='checkout';const started=performance.now(),results=mode!=='on'?[await checkout()]:await Promise.all(Array.from({length:20},checkout));
  for(const result of results){expect(result.data.needs_replacement_table).toBe(context.table_id);expect(result.data.check_out_time).toBe(results[0].data.check_out_time);}
  const first=results.find(r=>r.data.idempotent!==true);expect(first).toBeTruthy();expect(results.filter(r=>r.data.idempotent!==true)).toHaveLength(1);
  if(mode!=='on'){
   expect(first!.data.auto_assigned_dealer,'Automatic replacement must respect OFF although checkout itself is manual').toBeNull();expect(await active()).toHaveLength(0);await expect(card.getByText('Chưa gán',{exact:true})).toBeVisible({timeout:5000});if(mode==='off')expect(await pool()).toEqual(candidates);else{const after=await pool();expect(after.filter((r:{current_state:string})=>r.current_state==='available')).toHaveLength(2);expect(after.find((r:{id:string})=>r.id===checkoutAttendance)?.current_state).toBe('checked_out');expect(after.find((r:{id:string})=>r.id===recent.id)).toEqual(recent);}
  }else{
   expect(eligible.map((r:{dealers:{full_name:string}})=>r.dealers.full_name)).toContain(first!.data.auto_assigned_dealer);
   const assigned=await active();expect(assigned).toHaveLength(1);expect(eligible.map((r:{id:string})=>r.id)).toContain(assigned[0].attendance_id);expect(assigned[0].table_session_id).toBe(context.session_id);
   await expect(card.getByText(first!.data.auto_assigned_dealer,{exact:true})).toBeVisible({timeout:5000});
   const after=await pool();expect(after.find((r:{id:string})=>r.id===recent.id)).toEqual(recent);expect(after.filter((r:{current_state:string})=>r.current_state==='assigned')).toHaveLength(1);
  }
  const writeToVisibleMs=performance.now()-started,retry=await checkout();expect(retry.data.idempotent).toBe(true);expect(retry.data.check_out_time).toBe(results[0].data.check_out_time);observation={requests:results.length,first:1,replays:results.length-1,ackMs:first!.ms,retryMs:retry.ms,writeToVisibleMs};if(mode==='off'||mode==='on')expect(writeToVisibleMs).toBeLessThanOrEqual(3000);phase='passed';report();
 }catch(error){phase+='-failed';report();throw error;}
});

test('current Floor deferred move reserves and cancels without joining an active hand',async({page})=>{
 test.skip(process.env.LOCAL_OPERATIONS_DEFERRED_MOVE_ENABLED!=='1','Isolated stage after existing operational conservation proofs');test.setTimeout(120_000);
 let failedRpc:{name:string;status:number;code:string;messageSha256:string|null;classification:string}|null=null;
 const owner=await loginOwner(page),staff=await loginFixtureStaff(),api=process.env.LOCAL_SUPABASE_URL!.replace(/\/$/,''),anon=process.env.LOCAL_SUPABASE_ANON_KEY!,tour='a3000000-0000-4000-8000-000000000001';
 const headers={apikey:anon,Authorization:`Bearer ${owner}`,'Content-Type':'application/json'};
 const rpc=async(token:string,name:string,args:Record<string,unknown>)=>{const started=performance.now(),response=await fetch(api+'/rest/v1/rpc/'+name,{method:'POST',headers:{...headers,Authorization:`Bearer ${token}`},body:JSON.stringify(args),signal:AbortSignal.timeout(5000)});const data=await response.json();if(!response.ok){const code=typeof data?.code==='string'&&/^(?:[0-9A-Z]{5}|PGRST\d{3})$/.test(data.code)?data.code:'unclassified';failedRpc={name,status:response.status,code,messageSha256:typeof data?.message==='string'?createHash('sha256').update(data.message).digest('hex'):null,classification:code==='42883'?'missing_function':code==='42703'?'missing_column':code==='42P01'?'missing_relation':code==='42501'?'permission':code.startsWith('23')?'integrity':'other'};}expect(response.ok,name).toBe(true);return {data,ms:performance.now()-started};};
 type Seat={entry_id:string;player_id:string;entry_no:number;chip_count:number;seat_number:number};
 type Table={tournament_table_id:string;table_session_id:string;session_revision:number;control_epoch:number;control_mode:string;seats:Seat[]};
 const roster=async()=>{const r=await rpc(owner,floorRosterRpc,{p_tournament_id:tour});expect(Array.isArray(r.data)).toBe(true);return r.data as Table[];};
 const seats=(tables:Table[])=>tables.flatMap(t=>t.seats.map(s=>({...s,table:t.tournament_table_id,session:t.table_session_id}))).sort((a,b)=>a.entry_id.localeCompare(b.entry_id));
 const intent=async(player:string,destinationId:string)=>{const tables=await roster(),source=tables.find(t=>t.seats.some(s=>s.player_id===player))!,destination=tables.find(t=>t.tournament_table_id===destinationId)!;expect(source).toBeTruthy();expect(destination).toBeTruthy();expect(source.control_mode).toBe('manual');const seat=source.seats.find(s=>s.player_id===player)!;expect(seat.entry_no).toBe(2);return {p_entry_id:seat.entry_id,p_from_tournament_table_id:source.tournament_table_id,p_from_table_session_id:source.table_session_id,p_to_tournament_table_id:destination.tournament_table_id,p_to_table_session_id:destination.table_session_id,p_to_seat_number:Array.from({length:9},(_,n)=>n+1).find(n=>!destination.seats.some(s=>s.seat_number===n))!,p_expected_source_revision:source.session_revision,p_expected_destination_revision:destination.session_revision,p_expected_source_epoch:source.control_epoch,p_expected_destination_epoch:destination.control_epoch,p_reason:'isolated deferred queue/cancel TEST',p_request_id:crypto.randomUUID()};};
 const readHand=async(handId:string)=>{const response=await fetch(api+'/rest/v1/hand_players?select=player_id,entry_number,seat_number,starting_stack&hand_id=eq.'+handId+'&order=seat_number',{headers,signal:AbortSignal.timeout(5000)});expect(response.ok).toBe(true);return response.json();};
 const rows:{queueMs:number;retryMs:number;pendingReadMs:number;cancelMs:number}[]=[];let phase='setup',race:unknown=null;
 const dist=(values:number[])=>{const sorted=[...values].sort((a,b)=>a-b);return {samples:sorted.length,p95Ms:sorted.length===20?sorted[18]:null,maxMs:sorted.at(-1)??null};};
 const report=()=>writeFileSync(process.env.LOCAL_OPERATIONS_LATENCY_REPORT!.replace(/\.json$/,'-floor-deferred-queue-http.json'),JSON.stringify({kind:'REAL_AUTH_FLOOR_DEFERRED_MOVE_QUEUE_CANCEL_HTTP',sha:process.env.LOCAL_OPERATIONS_SOURCE_SHA,phase,failedRpc,rows,distributions:Object.fromEntries(['queueMs','retryMs','pendingReadMs','cancelMs'].map(k=>[k,dist(rows.map(r=>r[k as keyof typeof r]))])),race,qualification:false,limitations:'Twenty serial queue/cancel cycles by20real Auth operators against one canonical in-progress hand. Two paid players enter a fresh Tracker table before its exact session/epoch start. Every pending move retains source seats/chips and cannot join the active hand. Captured roster plus exact32 display patch is not full current reader qualification. This test does not finish/void a hand,apply a deferred move,measure UI/Realtime,or prove mixed1000viewer capacity.'},null,2));
 try{
  const fixture=JSON.parse(readFileSync(process.env.LOCAL_OPERATIONS_DEALER_FILE!,'utf8')) as {floorReadLoad:{gameTableIds:string[]}};
  const opened=await rpc(owner,'floor_open_tournament_table_v3',{p_tournament_id:tour,p_game_table_id:fixture.floorReadLoad.gameTableIds[1],p_control_mode:'tracker',p_request_id:crypto.randomUUID()});expect(opened.data.ok).toBe(true);const tableId=opened.data.tournament_table_id;
  for(const identity of staff.slice(0,2)){const move=await intent(identity.userId,tableId);expect((await rpc(owner,'move_player_seat_v5',move)).data.ok).toBe(true);}
  const target=(await roster()).find(t=>t.tournament_table_id===tableId)!;expect(target.control_mode).toBe('tracker');expect(target.seats).toHaveLength(2);
  const identityResponse=await fetch(api+'/auth/v1/user',{headers,signal:AbortSignal.timeout(5000)});expect(identityResponse.ok).toBe(true);const ownerIdentity=await identityResponse.json();expect(typeof ownerIdentity.id).toBe('string');
  const start={p_tournament_id:tour,p_tournament_table_id:tableId,p_table_session_id:target.table_session_id,p_control_epoch:target.control_epoch,p_hand_number:9001,p_hand_time:new Date().toISOString(),p_created_by:ownerIdentity.id,p_button_seat:1};
  expect((await rpc(owner,'start_tracker_hand_v3',{...start,p_control_epoch:target.control_epoch+1})).data.error).toBe('STALE_TRACKER_CONTEXT');
  const started=await rpc(owner,'start_tracker_hand_v3',start);expect(started.data.status).toBe('success');const handId=started.data.hand_id;expect(typeof handId).toBe('string');
  expect((await rpc(owner,'start_tracker_hand_v3',start)).data.error).toBe('table_has_active_hand');
  const before=seats(await roster()),handBefore=await readHand(handId);const paid=before.filter(s=>staff.some(identity=>identity.userId===s.player_id));expect(paid).toHaveLength(20);expect(paid.reduce((sum,s)=>sum+s.chip_count,0)).toBe(400000);expect(handBefore).toHaveLength(2);
  phase='serial';
  for(let n=0;n<20;n++){
   const actor=staff[n],player=staff[2+n%18],move=await intent(player.userId,tableId),queued=await rpc(actor.token,'move_player_seat_v5',move);expect(queued.data.ok).toBe(true);expect(queued.data.queued).toBe(true);
   const retry=await rpc(actor.token,'move_player_seat_v5',move);expect(retry.data).toEqual(queued.data);
   const pending=await rpc(owner,'get_floor_pending_tracker_moves_v1',{p_tournament_id:tour});expect(pending.data).toHaveLength(1);expect(pending.data[0]).toMatchObject({pending_move_id:queued.data.pending_move_id,entry_id:move.p_entry_id,status:'pending',destination_tournament_table_id:tableId});
   expect(seats(await roster())).toEqual(before);expect(await readHand(handId)).toEqual(handBefore);
   const cancelled=await rpc(actor.token,'floor_cancel_pending_tracker_move_v1',{p_pending_move_id:queued.data.pending_move_id});expect(cancelled.data.status).toBe('cancelled');
   expect((await rpc(actor.token,'floor_cancel_pending_tracker_move_v1',{p_pending_move_id:queued.data.pending_move_id})).data).toMatchObject({ok:true,status:'cancelled',already_resolved:true});
   expect((await rpc(owner,'get_floor_pending_tracker_moves_v1',{p_tournament_id:tour})).data).toEqual([]);rows.push({queueMs:queued.ms,retryMs:retry.ms,pendingReadMs:pending.ms,cancelMs:cancelled.ms});report();
  }
  phase='same-key-race';const move=await intent(staff[2].userId,tableId),answers=await Promise.all(Array.from({length:20},()=>rpc(staff[0].token,'move_player_seat_v5',move)));for(const answer of answers)expect(answer.data).toEqual(answers[0].data);expect(answers[0].data.queued).toBe(true);
  race={requests:20,identicalResults:true,latency:dist(answers.map(r=>r.ms))};expect((await rpc(owner,'get_floor_pending_tracker_moves_v1',{p_tournament_id:tour})).data).toHaveLength(1);
  expect((await rpc(owner,'floor_cancel_pending_tracker_move_v1',{p_pending_move_id:answers[0].data.pending_move_id})).data.status).toBe('cancelled');expect(seats(await roster())).toEqual(before);expect(await readHand(handId)).toEqual(handBefore);
  for(const key of ['queueMs','retryMs','pendingReadMs','cancelMs'] as const)expect(dist(rows.map(r=>r[key])).p95Ms).toBeLessThanOrEqual(1000);phase='passed';report();
 }catch(error){phase+='-failed';report();throw error;}
});

test('canonical zero-pot Finish applies a pending move only after the hand',async({page})=>{
 test.skip(process.env.LOCAL_OPERATIONS_MANUAL_FINISH_ENABLED!=='1','Current Finish contracts after queue/cancel proof');test.setTimeout(120_000);
 const owner=await loginOwner(page),staff=await loginFixtureStaff(),api=process.env.LOCAL_SUPABASE_URL!.replace(/\/$/,''),anon=process.env.LOCAL_SUPABASE_ANON_KEY!,tour='a3000000-0000-4000-8000-000000000001';
 const headers={apikey:anon,Authorization:`Bearer ${owner}`,'Content-Type':'application/json'};
 let phase='setup',failure:unknown=null,evidence:unknown=null;
 const timings:Record<string,number>={};
 const report=()=>writeFileSync(process.env.LOCAL_OPERATIONS_LATENCY_REPORT!.replace(/\.json$/,'-floor-finish-apply-http.json'),JSON.stringify({kind:'REAL_AUTH_CANONICAL_ZERO_POT_FINISH_DEFERRED_APPLY',sha:process.env.LOCAL_OPERATIONS_SOURCE_SHA,phase,failure,timings,evidence,qualification:false,limitations:'One canonical two-player zero-pot/no-action hand completes through the current authenticated Finish wrapper;one queued paid entry joins only the next hand. Twenty same-intent contenders may receive canonical busy responses and must recover the exact receipt. This is lifecycle/conservation proof,not ordinary Finish p95,contested-pot/payout/recorded-action coverage,UI/Realtime or mixed1000viewer capacity.'},null,2));
 const rpc=async(token:string,name:string,args:Record<string,unknown>)=>{const start=performance.now(),response=await fetch(api+'/rest/v1/rpc/'+name,{method:'POST',headers:{...headers,Authorization:`Bearer ${token}`},body:JSON.stringify(args),signal:AbortSignal.timeout(5000)}),data=await response.json();if(!response.ok)failure={name,status:response.status,code:typeof data?.code==='string'&&/^(?:[0-9A-Z]{5}|PGRST\d{3})$/.test(data.code)?data.code:'unclassified',messageSha256:typeof data?.message==='string'?createHash('sha256').update(data.message).digest('hex'):null};expect(response.ok,name).toBe(true);return {data,ms:performance.now()-start};};
 const read=async(path:string)=>{const response=await fetch(api+'/rest/v1/'+path,{headers,signal:AbortSignal.timeout(5000)});expect(response.ok,path.split('?')[0]).toBe(true);return response.json();};
 type Seat={entry_id:string;player_id:string;entry_no:number;chip_count:number;seat_number:number};
 type Table={tournament_table_id:string;table_session_id:string;session_revision:number;control_epoch:number;control_mode:string;seats:Seat[]};
 const roster=async()=>(await rpc(owner,floorRosterRpc,{p_tournament_id:tour})).data as Table[];
 const seats=(tables:Table[])=>tables.flatMap(t=>t.seats.map(s=>({...s,table:t.tournament_table_id,session:t.table_session_id}))).sort((a,b)=>a.entry_id.localeCompare(b.entry_id));
 const handPlayers=(hand:string)=>read('hand_players?select=player_id,entry_number,seat_number,starting_stack,ending_stack&hand_id=eq.'+hand+'&order=seat_number');
 try{
  const identity=await fetch(api+'/auth/v1/user',{headers,signal:AbortSignal.timeout(5000)});expect(identity.ok).toBe(true);const actor=(await identity.json()).id;expect(typeof actor).toBe('string');
  const hands=await read('tournament_hands?select=id,hand_time,source_revision,tournament_table_id,table_session_id,status&tournament_id=eq.'+tour+'&hand_number=eq.9001');expect(hands).toHaveLength(1);const hand=hands[0];expect(hand.status).toBe('in_progress');
  const before=seats(await roster()),tables=await roster(),target=tables.find(t=>t.tournament_table_id===hand.tournament_table_id)!,source=tables.find(t=>t.seats.some(s=>s.player_id===staff[2].userId))!;
  expect(target.control_mode).toBe('tracker');expect(source.control_mode).toBe('manual');const moving=source.seats.find(s=>s.player_id===staff[2].userId)!;expect(moving.entry_no).toBe(2);
  const move={p_entry_id:moving.entry_id,p_from_tournament_table_id:source.tournament_table_id,p_from_table_session_id:source.table_session_id,p_to_tournament_table_id:target.tournament_table_id,p_to_table_session_id:target.table_session_id,p_to_seat_number:Array.from({length:9},(_,n)=>n+1).find(n=>!target.seats.some(s=>s.seat_number===n))!,p_expected_source_revision:source.session_revision,p_expected_destination_revision:target.session_revision,p_expected_source_epoch:source.control_epoch,p_expected_destination_epoch:target.control_epoch,p_reason:'isolated deferred apply TEST',p_request_id:crypto.randomUUID()};
  phase='queue';const queued=await rpc(owner,'move_player_seat_v5',move);expect(queued.data).toMatchObject({ok:true,queued:true});timings.queueMs=queued.ms;expect(seats(await roster())).toEqual(before);
  const frozen=await handPlayers(hand.id);expect(frozen).toHaveLength(2);expect(frozen.some((p:{player_id:string})=>p.player_id===moving.player_id)).toBe(false);
  const payload={players:frozen.map((p:{player_id:string;entry_number:number;seat_number:number;starting_stack:number})=>({...p,ending_stack:p.starting_stack,is_eliminated:false,side_pots:[],hole_cards:[]})),actions:[],community_cards:[],side_pots:[],hand_time:hand.hand_time,pot_size:0};
  const intent={actor_id:actor,request_id:crypto.randomUUID(),tournament_id:tour,tournament_table_id:target.tournament_table_id,hand_id:hand.id,table_session_id:target.table_session_id,control_epoch:target.control_epoch,source_revision:hand.source_revision,payload};
  phase='fences';expect((await rpc(staff[3].token,'record_tracker_manual_hand_v1',{p_intent:intent})).data.error).toBe('actor_not_allowed');
  expect((await rpc(owner,'record_tracker_manual_hand_v1',{p_intent:{...intent,request_id:crypto.randomUUID(),source_revision:hand.source_revision+1}})).data.error).toBe('stale_manual_finish_context');
  expect((await rpc(owner,'record_tracker_manual_hand_v1',{p_intent:{...intent,request_id:crypto.randomUUID(),tournament_id:'ac300000-0000-4000-8000-000000000001'}})).data.error).toBe('stale_manual_finish_context');
  const bare=await fetch(api+'/rest/v1/rpc/record_hand',{method:'POST',headers,body:JSON.stringify({p_tournament_id:tour,p_table_id:target.tournament_table_id,p_hand_number:9001,p_hand_time:hand.hand_time,p_players:payload.players,p_actions:[],p_side_pots:[],p_community_cards:[],p_pot_size:0,p_created_by:actor}),signal:AbortSignal.timeout(5000)});expect(bare.status).toBe(403);
  expect(seats(await roster())).toEqual(before);expect(await handPlayers(hand.id)).toEqual(frozen);expect((await rpc(owner,'get_tracker_manual_finish_receipt_v1',{p_intent:intent})).data.error).toBe('receipt_not_found');
  phase='finish-race';const answers=await Promise.all(Array.from({length:20},()=>rpc(owner,'record_tracker_manual_hand_v1',{p_intent:intent}))),committed=answers.find(r=>r.data.ok===true);expect(committed).toBeTruthy();
  for(const answer of answers)if(answer.data.ok===true)expect(answer.data).toEqual(committed!.data);else expect(answer.data.error).toBe('manual_finish_busy');
  timings.finishAckMs=committed!.ms;const replay=await rpc(owner,'record_tracker_manual_hand_v1',{p_intent:intent});expect(replay.data).toEqual(committed!.data);timings.retryMs=replay.ms;
  const receipt=await rpc(owner,'get_tracker_manual_finish_receipt_v1',{p_intent:intent});expect(receipt.data).toEqual(committed!.data);timings.receiptReadMs=receipt.ms;
  phase='observe-applied';const observedAt=performance.now(),after=seats(await roster()),moved=after.find(s=>s.entry_id===moving.entry_id)!;expect(moved).toMatchObject({table:target.tournament_table_id,session:target.table_session_id,seat_number:move.p_to_seat_number,chip_count:moving.chip_count});
  expect(after.filter(s=>s.entry_id!==moving.entry_id)).toEqual(before.filter(s=>s.entry_id!==moving.entry_id));expect(after.filter(s=>staff.some(u=>u.userId===s.player_id)).reduce((n,s)=>n+s.chip_count,0)).toBe(400000);
  expect((await rpc(owner,'get_floor_pending_tracker_moves_v1',{p_tournament_id:tour})).data).toEqual([]);const finished=await read('tournament_hands?select=id,status,source_revision&id=eq.'+hand.id);expect(finished).toHaveLength(1);expect(finished[0].status).toBe('completed');
  const ended=await handPlayers(hand.id);expect(ended).toHaveLength(2);expect(ended.map((p:{player_id:string;entry_number:number;seat_number:number;starting_stack:number;ending_stack:number})=>({...p,ending_stack:null}))).toEqual(frozen);for(const p of ended)expect(p.ending_stack).toBe(p.starting_stack);timings.independentObservationMs=performance.now()-observedAt;
  phase='next-hand';const nextTarget=(await roster()).find(t=>t.tournament_table_id===target.tournament_table_id)!;const next=await rpc(owner,'start_tracker_hand_v3',{p_tournament_id:tour,p_tournament_table_id:nextTarget.tournament_table_id,p_table_session_id:nextTarget.table_session_id,p_control_epoch:nextTarget.control_epoch,p_hand_number:9002,p_hand_time:new Date().toISOString(),p_created_by:actor,p_button_seat:1});expect(next.data.status).toBe('success');
  const nextPlayers=await handPlayers(next.data.hand_id);expect(nextPlayers).toHaveLength(3);expect(nextPlayers.find((p:{player_id:string})=>p.player_id===moving.player_id)).toMatchObject({entry_number:2,starting_stack:moving.chip_count});
  evidence={concurrentRequests:20,successReplies:answers.filter(r=>r.data.ok===true).length,busyReplies:answers.filter(r=>r.data.error==='manual_finish_busy').length,exactReplay:true,receiptMatched:true,oldHandPlayers:2,nextHandPlayers:3,paidPlayerChips:400000,unchangedOtherSeats:true};phase='passed';report();
 }catch(error){phase+='-failed';report();throw error;}
});

test('twenty current manual Finish hands preserve supplied actions and payouts',async({page})=>{
 test.skip(process.env.LOCAL_OPERATIONS_MANUAL_ACTION_FINISH_ENABLED!=='1','Current contracts after zero-pot lifecycle proof');test.setTimeout(120_000);
 const owner=await loginOwner(page),staff=await loginFixtureStaff(),api=process.env.LOCAL_SUPABASE_URL!.replace(/\/$/,''),anon=process.env.LOCAL_SUPABASE_ANON_KEY!,tour='a3000000-0000-4000-8000-000000000001';
 const headers={apikey:anon,Authorization:`Bearer ${owner}`,'Content-Type':'application/json'};
 const audienceCount=Number(process.env.LOCAL_OPERATIONS_AUDIENCE??0);
 const bridgeEnabled=audienceCount>0&&process.env.LOCAL_OPERATIONS_AUDIENCE_MODEL==='selected-table';
 const bridgeRoot=process.env.LOCAL_OPERATIONS_LATENCY_REPORT!.replace(/\/[^/]+$/,'');
 const selectionNonce=crypto.randomUUID();
 let startEvidence:{startIntentAt:number;startAckAt:number}|null=null;
 const selectAudience=async(hand:Hand)=>{
  if(!bridgeEnabled)return;
  expect([10,1000]).toContain(audienceCount);
  const selection={kind:'select-operational-table-v1',sha:process.env.LOCAL_OPERATIONS_SOURCE_SHA,nonce:selectionNonce,tournamentId:tour,tableId:hand.tournament_table_id,sessionId:hand.table_session_id};
  const target=bridgeRoot+'/operations-hand-selection.json';
  writeFileSync(target+'.tmp',JSON.stringify(selection));renameSync(target+'.tmp',target);
  const deadline=Date.now()+15000;
  while(Date.now()<deadline){
   const path=bridgeRoot+'/operations-audience-http.json';
   if(existsSync(path)){
    expect(statSync(path).size).toBeLessThanOrEqual(1048576);
    // Report replacement is atomic in the companion; no partial JSON retry.
    const report=JSON.parse(readFileSync(path,'utf8'));
    expect(report.sha).toBe(process.env.LOCAL_OPERATIONS_SOURCE_SHA);
    if(report.selectionNonce===selectionNonce&&report.selectionReady===audienceCount)return;
   }
   await new Promise(resolve=>setTimeout(resolve,100));
  }
  throw Error('Actual selected-table audience readiness deadline');
 };
 type Player={player_id:string;entry_number:number;seat_number:number;starting_stack:number;ending_stack:number|null};
 type Hand={id:string;hand_number:number;hand_time:string;source_revision:number;tournament_table_id:string;table_session_id:string;status:string;tracker_sb_position:number;tracker_bb_position:number;tracker_small_blind:number;tracker_big_blind:number;tracker_bba:number};
 const rows:{handNumber:number;startMs:number;finishMs:number;retryMs:number;receiptMs:number;independentReadMs:number;independentReads:{resource:string;ms:number}[]}[]=[];let phase='setup',failure:unknown=null,warmupCompleted=false;
 let independentReads:{resource:string;ms:number}[]|null=null;
 const dist=(values:number[])=>{const sorted=[...values].sort((a,b)=>a-b);return {samples:sorted.length,p95Ms:sorted.length===20?sorted[18]:null,maxMs:sorted.at(-1)??null};};
 const report=()=>writeFileSync(process.env.LOCAL_OPERATIONS_LATENCY_REPORT!.replace(/\.json$/,'-manual-action-finish-http.json'),JSON.stringify({kind:'REAL_AUTH_TWENTY_MANUAL_SUPPLIED_ACTION_FINISH_HTTP',sha:process.env.LOCAL_OPERATIONS_SOURCE_SHA,phase,failure,warmupCompleted,actors:20,rows,distributions:Object.fromEntries((['startMs','finishMs','retryMs','receiptMs','independentReadMs'] as const).map(k=>[k,dist(rows.map(r=>r[k]))])),qualification:false,limitations:'One owner warmup then20distinct Auth Tracker actors complete20three-player hands serially on one isolated table. Each supplies3blind/ante actions and2folds,with canonical uncalled-return/one-eligible-player pot and exact payout. Negatives preserve source;replay/receipt/conflicting intent and committed actions/stacks are checked. Not pre-recorded-action merge,showdown/cards/side-pot matrix,standalone UI/Realtime or production capacity. Selected-table audience bridge and its separate artifact determine actual mixed viewer count and delivery coverage. Per-resource independent-read timing is diagnostic; aggregate1s gate remains unchanged.'},null,2));
 const rpc=async(token:string,name:string,args:Record<string,unknown>)=>{const requestAt=Date.now(),at=performance.now(),response=await fetch(api+'/rest/v1/rpc/'+name,{method:'POST',headers:{...headers,Authorization:`Bearer ${token}`},body:JSON.stringify(args),signal:AbortSignal.timeout(5000)}),data=await response.json();if(!response.ok)failure={name,status:response.status,code:typeof data?.code==='string'&&/^(?:[0-9A-Z]{5}|PGRST\d{3})$/.test(data.code)?data.code:'unclassified',messageSha256:typeof data?.message==='string'?createHash('sha256').update(data.message).digest('hex'):null};expect(response.ok,name).toBe(true);return {data,ms:performance.now()-at,requestAt,ackAt:Date.now()};};
 const read=async(path:string)=>{const at=performance.now(),resource=path.split('?')[0];const response=await fetch(api+'/rest/v1/'+path,{headers,signal:AbortSignal.timeout(5000)});expect(response.ok,resource).toBe(true);const data=await response.json();if(independentReads){expect(['tournament_hands','hand_actions','hand_players']).toContain(resource);independentReads.push({resource,ms:performance.now()-at});}return data;};
 const readHand=async(number:number)=>{const result=await read('tournament_hands?select=id,hand_number,hand_time,source_revision,tournament_table_id,table_session_id,status,tracker_sb_position,tracker_bb_position,tracker_small_blind,tracker_big_blind,tracker_bba&tournament_id=eq.'+tour+'&hand_number=eq.'+number);expect(result).toHaveLength(1);return result[0] as Hand;};
 const players=(id:string)=>read('hand_players?select=player_id,entry_number,seat_number,starting_stack,ending_stack&hand_id=eq.'+id+'&order=seat_number') as Promise<Player[]>;
 const actions=(id:string)=>read('hand_actions?select=player_id,entry_number,street,action_type,action_amount,action_order&hand_id=eq.'+id+'&order=action_order');
 const roster=async()=>(await rpc(owner,floorRosterRpc,{p_tournament_id:tour})).data as {tournament_table_id:string;table_session_id:string;control_epoch:number;seats:{entry_id:string;player_id:string;chip_count:number;seat_number:number}[]}[];
 const finish=async(hand:Hand,token:string,actor:string,startMs:number,graded:boolean)=>{
  expect(hand.status).toBe('in_progress');expect(hand.tracker_small_blind).toBe(100);expect(hand.tracker_big_blind).toBe(200);expect(hand.tracker_bba).toBe(200);
  const frozen=await players(hand.id);expect(frozen).toHaveLength(3);const sb=frozen.find(p=>p.seat_number===hand.tracker_sb_position)!,bb=frozen.find(p=>p.seat_number===hand.tracker_bb_position)!;expect(sb).toBeTruthy();expect(bb).toBeTruthy();expect(sb.player_id).not.toBe(bb.player_id);for(const p of frozen){expect(p.entry_number).toBe(2);expect(p.starting_stack).toBeGreaterThan(400);}
  const ordered=[{player:bb,type:'post_ante',amount:200},{player:sb,type:'post_sb',amount:100},{player:bb,type:'post_bb',amount:200},...frozen.filter(p=>p.player_id!==bb.player_id).sort((a,b)=>(a.seat_number-bb.seat_number+9)%9-(b.seat_number-bb.seat_number+9)%9).map(player=>({player,type:'fold',amount:0}))];
  const supplied=ordered.map((a,n)=>({player_id:a.player.player_id,entry_number:2,street:'preflop',action_type:a.type,action_amount:a.amount,action_order:n+1}));expect(supplied).toHaveLength(5);
  const payload={players:frozen.map(p=>({...p,ending_stack:p.starting_stack+(p.player_id===sb.player_id?-100:p.player_id===bb.player_id?100:0),is_eliminated:false,side_pots:[],hole_cards:[]})),actions:supplied,community_cards:[],side_pots:[{amount:200,eligible_player_ids:[bb.player_id]}],hand_time:hand.hand_time,pot_size:200};
  const table=(await roster()).find(t=>t.tournament_table_id===hand.tournament_table_id)!;const intent={actor_id:actor,request_id:crypto.randomUUID(),tournament_id:tour,tournament_table_id:table.tournament_table_id,hand_id:hand.id,table_session_id:table.table_session_id,control_epoch:table.control_epoch,source_revision:hand.source_revision,payload};
  const beforeActions=await actions(hand.id);expect(beforeActions).toEqual([]);const other=staff.find(s=>s.userId!==actor)!;
  expect((await rpc(other.token,'record_tracker_manual_hand_v1',{p_intent:{...intent,actor_id:other.userId,request_id:crypto.randomUUID()}})).data.error).toBe('lock_not_held');
  expect((await rpc(token,'record_tracker_manual_hand_v1',{p_intent:{...intent,request_id:crypto.randomUUID(),payload:{...payload,pot_size:201}}})).data.error).toBe('SIDE_POTS_TAMPERED');
  const badPlayers=payload.players.map(p=>({...p,ending_stack:p.starting_stack+(p.player_id===sb.player_id?100:p.player_id===bb.player_id?-100:0)}));
  expect((await rpc(token,'record_tracker_manual_hand_v1',{p_intent:{...intent,request_id:crypto.randomUUID(),payload:{...payload,players:badPlayers}}})).data.error).toBe('PAYOUT_POTS_MISMATCH');
  expect(await readHand(hand.hand_number)).toEqual(hand);expect(await players(hand.id)).toEqual(frozen);expect(await actions(hand.id)).toEqual([]);
  const committed=await rpc(token,'record_tracker_manual_hand_v1',{p_intent:intent});expect(committed.data.ok).toBe(true);expect(committed.data.hand_id).toBe(hand.id);expect(committed.data.starting_total).toBe(committed.data.ending_total);
  const retry=await rpc(token,'record_tracker_manual_hand_v1',{p_intent:intent}),receipt=await rpc(token,'get_tracker_manual_finish_receipt_v1',{p_intent:intent});expect(retry.data).toEqual(committed.data);expect(receipt.data).toEqual(committed.data);
  expect((await rpc(token,'record_tracker_manual_hand_v1',{p_intent:{...intent,payload:{...payload,pot_size:201}}})).data.error).toBe('IDEMPOTENCY_CONFLICT');
  independentReads=[];
  const at=performance.now();expect((await readHand(hand.hand_number)).status).toBe('completed');expect(await actions(hand.id)).toEqual(supplied);const ended=await players(hand.id);expect(ended).toEqual(payload.players.map(({is_eliminated,side_pots,hole_cards,...p})=>p));
  const rosterAt=performance.now(),tables=await roster();independentReads.push({resource:'floor-roster-rpc',ms:performance.now()-rosterAt});const paid=tables.flatMap(t=>t.seats).filter(p=>staff.some(s=>s.userId===p.player_id));expect(paid).toHaveLength(20);expect(paid.reduce((n,p)=>n+p.chip_count,0)).toBe(400000);for(const p of ended)expect(paid.find(s=>s.player_id===p.player_id)!.chip_count).toBe(p.ending_stack);
  if(graded&&bridgeEnabled){expect(startEvidence).not.toBeNull();appendFileSync(bridgeRoot+'/operations-hand-receipts.jsonl',JSON.stringify({sha:process.env.LOCAL_OPERATIONS_SOURCE_SHA,nonce:selectionNonce,receipt:{kind:'verified-canonical-finish-v1',tournamentId:tour,tableId:hand.tournament_table_id,sessionId:hand.table_session_id,handId:hand.id,handNumber:hand.hand_number,...startEvidence,intentAt:committed.requestAt,ackAt:committed.ackAt,verifiedAt:Date.now()}})+'\n');}
  if(graded)rows.push({handNumber:hand.hand_number,startMs,finishMs:committed.ms,retryMs:retry.ms,receiptMs:receipt.ms,independentReadMs:performance.now()-at,independentReads});independentReads=null;report();
 };
 try{
  const identity=await fetch(api+'/auth/v1/user',{headers,signal:AbortSignal.timeout(5000)});expect(identity.ok).toBe(true);const actor=(await identity.json()).id;expect(typeof actor).toBe('string');phase='warmup';await finish(await readHand(9002),owner,actor,0,false);warmupCompleted=true;await selectAudience(await readHand(9002));
  phase='graded';for(let n=0;n<20;n++){const current=(await roster()).find(t=>t.seats.length===3&&t.seats.some(p=>p.player_id===staff[2].userId))!;expect(current).toBeTruthy();const button=[...current.seats].sort((a,b)=>a.seat_number-b.seat_number)[n%3].seat_number;expect(await read('tournament_hands?select=id&tournament_id=eq.'+tour+'&tournament_table_id=eq.'+current.tournament_table_id+'&table_session_id=eq.'+current.table_session_id+'&status=eq.in_progress')).toEqual([]);const started=await rpc(staff[n].token,'start_tracker_hand_v3',{p_tournament_id:tour,p_tournament_table_id:current.tournament_table_id,p_table_session_id:current.table_session_id,p_control_epoch:current.control_epoch,p_hand_number:9003+n,p_hand_time:new Date().toISOString(),p_created_by:staff[n].userId,p_button_seat:button});expect(started.data.status).toBe('success');const hand=await readHand(9003+n);expect(hand.tournament_table_id).toBe(current.tournament_table_id);expect(hand.table_session_id).toBe(current.table_session_id);expect(hand.id).toBe(started.data.hand_id);startEvidence={startIntentAt:started.requestAt,startAckAt:started.ackAt};await finish(hand,staff[n].token,staff[n].userId,started.ms,true);}
  expect(rows).toHaveLength(20);for(const key of ['startMs','finishMs','retryMs','receiptMs','independentReadMs'] as const)expect(dist(rows.map(r=>r[key])).p95Ms).toBeLessThanOrEqual(1000);phase='passed';report();
 }catch(error){phase+='-failed';report();throw error;}
});

test('recorded actions enforce budget and merge once through canonical Finish',async({page})=>{
 test.skip(process.env.LOCAL_OPERATIONS_RECORDED_ACTION_FINISH_ENABLED!=='1','Current action guards after supplied-action Finish proof');test.setTimeout(120_000);
 const owner=await loginOwner(page),staff=await loginFixtureStaff(),actor=staff[0],other=staff[1],api=process.env.LOCAL_SUPABASE_URL!.replace(/\/$/,''),anon=process.env.LOCAL_SUPABASE_ANON_KEY!,tour='a3000000-0000-4000-8000-000000000001';
 const headers={apikey:anon,Authorization:`Bearer ${owner}`,'Content-Type':'application/json'};let phase='setup',failure:unknown=null,evidence:unknown=null;const timings:Record<string,unknown>={};
 const undoEnabled=process.env.LOCAL_CORRECTION_UNDO_PROBE==='1';
 const dist=(values:number[])=>{const sorted=[...values].sort((a,b)=>a-b);return {samples:sorted.length,p95Ms:sorted.length===20?sorted[18]:null,maxMs:sorted.at(-1)??null};};
 const undoRows:{recordActionMs:number;ackMs:number;retryMs:number;independentReadMs:number}[]=[];
 let undoPhase='not-started',undoRace:{contenders:number;mutations:number;duplicates:number;stale:number}|null=null;
 const undoErrors:Record<string,number>={};
 const rememberUndoError=(data:{ok?:boolean;error?:unknown})=>{if(data.ok===true)return;const code=typeof data.error==='string'&&['uat_capability_disabled','stale_tracker_context','stale_source_revision','last_action_changed','actor_not_allowed','dealer_assignment_not_unique','tracker_lock_not_owned','invalid_request','request_key_conflict','undo_boundary_blind','undo_boundary_board'].includes(data.error)?data.error:'unclassified';undoErrors[code]=(undoErrors[code]??0)+1;};
 const undoReport=()=>writeFileSync(process.env.LOCAL_OPERATIONS_LATENCY_REPORT!.replace(/\.json$/,'-correction-undo-http.json'),JSON.stringify({kind:'REAL_AUTH_CAPTURED_UNDO_WITH_CORRECTION33_HTTP',sha:process.env.LOCAL_OPERATIONS_SOURCE_SHA,phase:undoPhase,actors:1,graded:undoRows.length,rows:undoRows,race:undoRace,applicationDenials:undoErrors,distributions:Object.fromEntries((['recordActionMs','ackMs','retryMs','independentReadMs'] as const).map(k=>[k,dist(undoRows.map(r=>r[k]))])),qualification:false,productionChanged:false,limitations:'One real Auth Tracker actor,20 measured restorations of the same preflop fold and20 serial Undo intents,20same-key HTTP contenders and exact writer retries on one paid three-player hand. HTTP concurrency does not prove20overlapping PostgreSQL sessions;separate native barrier test does. No UI/receipt-reader/cancellation or production capacity claim. Finish conservation follows in the parent test.'},null,2));
 const report=()=>writeFileSync(process.env.LOCAL_OPERATIONS_LATENCY_REPORT!.replace(/\.json$/,'-recorded-action-finish-http.json'),JSON.stringify({kind:'REAL_AUTH_RECORDED_ACTION_BUDGET_DECIDED_AND_FINISH_HTTP',sha:process.env.LOCAL_OPERATIONS_SOURCE_SHA,phase,failure,timings,evidence,qualification:false,limitations:'One three-player hand through current record_action RPC then exact Finish wrapper,real Auth/HTTP/current budget189 and decided301 guards. Tests budget before/after commitments,negative amount,actor/lock binding,20same-key first-action contenders,decided denial and idempotent action replay,omitted-action Finish rejection and no reinsertion of5existing action IDs. Not ordinary action p95,Edge/browser/Realtime,showdown/multiplepots,mixed1000viewer or production capacity.'},null,2));
 const rpc=async(token:string,name:string,args:Record<string,unknown>)=>{const at=performance.now(),response=await fetch(api+'/rest/v1/rpc/'+name,{method:'POST',headers:{...headers,Authorization:`Bearer ${token}`},body:JSON.stringify(args),signal:AbortSignal.timeout(5000)}),data=await response.json();if(!response.ok)failure={name,status:response.status,code:typeof data?.code==='string'&&/^(?:[0-9A-Z]{5}|PGRST\d{3})$/.test(data.code)?data.code:'unclassified',messageSha256:typeof data?.message==='string'?createHash('sha256').update(data.message).digest('hex'):null};expect(response.ok,name).toBe(true);return {data,ms:performance.now()-at};};
 const read=async(path:string)=>{const response=await fetch(api+'/rest/v1/'+path,{headers,signal:AbortSignal.timeout(5000)});expect(response.ok,path.split('?')[0]).toBe(true);return response.json();};
 type Player={player_id:string;entry_number:number;seat_number:number;starting_stack:number;ending_stack:number|null};
 const roster=async()=>(await rpc(owner,floorRosterRpc,{p_tournament_id:tour})).data as {tournament_table_id:string;table_session_id:string;control_epoch:number;seats:{player_id:string;chip_count:number;seat_number:number}[]}[];
 try{
  const target=(await roster()).find(t=>t.seats.length===3&&t.seats.some(p=>p.player_id===staff[2].userId))!;expect(target).toBeTruthy();const started=await rpc(actor.token,'start_tracker_hand_v3',{p_tournament_id:tour,p_tournament_table_id:target.tournament_table_id,p_table_session_id:target.table_session_id,p_control_epoch:target.control_epoch,p_hand_number:9023,p_hand_time:new Date().toISOString(),p_created_by:actor.userId,p_button_seat:1});expect(started.data.status).toBe('success');const handId=started.data.hand_id;
  const readHand=async()=>{const result=await read('tournament_hands?select=id,hand_time,status,source_revision,tracker_sb_position,tracker_bb_position,tracker_small_blind,tracker_big_blind,tracker_bba&id=eq.'+handId);expect(result).toHaveLength(1);return result[0];};
  const readPlayers=()=>read('hand_players?select=player_id,entry_number,seat_number,starting_stack,ending_stack&hand_id=eq.'+handId+'&order=seat_number') as Promise<Player[]>;
  const readActions=()=>read('hand_actions?select=id,player_id,entry_number,street,action_type,action_amount,action_order&hand_id=eq.'+handId+'&order=action_order');
  const hand=await readHand(),frozen=await readPlayers();expect(frozen).toHaveLength(3);expect(hand.tracker_small_blind).toBe(100);expect(hand.tracker_big_blind).toBe(200);expect(hand.tracker_bba).toBe(200);const sb=frozen.find(p=>p.seat_number===hand.tracker_sb_position)!,bb=frozen.find(p=>p.seat_number===hand.tracker_bb_position)!;expect(sb).toBeTruthy();expect(bb).toBeTruthy();for(const p of frozen){expect(p.entry_number).toBe(2);expect(p.starting_stack).toBeGreaterThan(400);}
  const ordered=[{player:bb,type:'post_ante',amount:200},{player:sb,type:'post_sb',amount:100},{player:bb,type:'post_bb',amount:200},...frozen.filter(p=>p.player_id!==bb.player_id).sort((a,b)=>(a.seat_number-bb.seat_number+9)%9-(b.seat_number-bb.seat_number+9)%9).map(player=>({player,type:'fold',amount:0}))];
  const supplied=ordered.map((a,n)=>({player_id:a.player.player_id,entry_number:2,street:'preflop',action_type:a.type,action_amount:a.amount,action_order:n+1}));
  const args=(action:typeof supplied[number],key=crypto.randomUUID())=>({p_hand_id:handId,p_player_id:action.player_id,p_action_type:action.action_type,p_action_order:action.action_order,p_entry_number:2,p_street:action.street,p_action_amount:action.action_amount,p_idempotency_key:key,p_trace_id:'isolated-recorded-action',p_user_id:actor.userId});
  phase='boundary-denials';expect((await rpc(actor.token,'record_action',{...args(supplied[0]),p_user_id:other.userId})).data.error).toBe('actor_mismatch');expect((await rpc(other.token,'record_action',{...args(supplied[0]),p_user_id:other.userId})).data.error).toBe('tracker_lock_owned_by_another');
  expect((await rpc(actor.token,'record_action',args({...supplied[0],action_type:'bet',action_amount:bb.starting_stack+1}))).data.error).toBe('tracker_action_stack_exceeded');expect((await rpc(actor.token,'record_action',args({...supplied[0],action_type:'bet',action_amount:-1}))).data.error).toBe('tracker_action_negative_amount');expect(await readActions()).toEqual([]);expect(await readHand()).toEqual(hand);
  phase='first-action-race';const firstArgs=args(supplied[0]),contenders=await Promise.all(Array.from({length:20},()=>rpc(actor.token,'record_action',firstArgs)));for(const r of contenders)expect(r.data.status).toBe('success');expect(contenders.filter(r=>r.data.duplicate===false)).toHaveLength(1);expect(contenders.filter(r=>r.data.duplicate===true)).toHaveLength(19);expect(new Set(contenders.map(r=>r.data.action_id)).size).toBe(1);expect(await readActions()).toHaveLength(1);timings.firstActionContenderMs=contenders.map(r=>r.ms);
  phase='remaining-actions';const actionWrites:number[]=[];for(let n=1;n<supplied.length;n++){
   if(n===3){const before=await readActions(),beforeHand=await readHand();expect((await rpc(actor.token,'record_action',args({...supplied[0],action_type:'bet',action_order:4,action_amount:bb.starting_stack-399}))).data.error).toBe('tracker_action_stack_exceeded');expect(await readActions()).toEqual(before);expect(await readHand()).toEqual(beforeHand);}
   const request=args(supplied[n]),written=await rpc(actor.token,'record_action',request);expect(written.data).toMatchObject({status:'success',duplicate:false});actionWrites.push(written.ms);const beforeRetry=await readHand(),retry=await rpc(actor.token,'record_action',request);expect(retry.data).toMatchObject({status:'success',duplicate:true,action_id:written.data.action_id});expect(await readHand()).toEqual(beforeRetry);
   if(n===3&&undoEnabled){
    undoPhase='boundary-denials';undoReport();
    const intent=(actionId:string,revision:number,key=crypto.randomUUID())=>({p_tournament_id:tour,p_tournament_table_id:target.tournament_table_id,p_hand_id:handId,p_expected_action_id:actionId,p_expected_source_revision:revision,p_idempotency_key:key});
    const originalActions=await readActions(),originalHand=await readHand();
    const originalIntent=intent(written.data.action_id,originalHand.source_revision);
    expect((await rpc(other.token,'undo_tracker_last_action_v1',originalIntent)).data.error).toBe('uat_capability_disabled');
    expect((await rpc(actor.token,'undo_tracker_last_action_v1',{...originalIntent,p_tournament_id:'00000000-0000-4000-8000-000000000001'})).data.error).toBe('stale_tracker_context');
    expect((await rpc(actor.token,'undo_tracker_last_action_v1',{...originalIntent,p_expected_source_revision:originalHand.source_revision+1})).data.error).toBe('stale_source_revision');
    expect(await readActions()).toEqual(originalActions);expect(await readHand()).toEqual(originalHand);
    undoPhase='same-key-race';undoReport();
    const raced=await Promise.all(Array.from({length:20},()=>rpc(actor.token,'undo_tracker_last_action_v1',originalIntent)));
    const mutations=raced.filter(r=>r.data.ok===true&&r.data.duplicate===false);
    for(const r of raced)rememberUndoError(r.data);
    undoRace={contenders:20,mutations:mutations.length,duplicates:raced.filter(r=>r.data.duplicate===true).length,stale:raced.filter(r=>r.data.ok!==true).length};
    undoReport();expect(mutations).toHaveLength(1);
    for(const r of raced)expect(r.data.ok===true||['stale_source_revision','last_action_changed'].includes(r.data.error)).toBe(true);
    const receipt=mutations[0].data;
    const recovered=await Promise.all(Array.from({length:20},()=>rpc(actor.token,'undo_tracker_last_action_v1',originalIntent)));
    for(const r of recovered)expect(r.data).toEqual({...receipt,duplicate:true});
    expect((await readActions()).map(({id,...a}:{id:string})=>a)).toEqual(supplied.slice(0,3));
    const afterRace=await readHand();expect(afterRace.source_revision).toBeGreaterThan(originalHand.source_revision);
    expect((await rpc(actor.token,'undo_tracker_last_action_v1',{...originalIntent,p_expected_source_revision:originalIntent.p_expected_source_revision+1})).data.error).toBe('request_key_conflict');
    expect(await readHand()).toEqual(afterRace);
    undoPhase='graded';undoReport();
    for(let sample=0;sample<20;sample++){
     const restored=await rpc(actor.token,'record_action',args(supplied[n]));expect(restored.data.status).toBe('success');
     const current=await readHand(),undoIntent=intent(restored.data.action_id,current.source_revision);
     const undone=await rpc(actor.token,'undo_tracker_last_action_v1',undoIntent);rememberUndoError(undone.data);expect(undone.data).toMatchObject({ok:true,duplicate:false});
     expect(undone.data.undone_action_id).toBe(restored.data.action_id);
     const replay=await rpc(actor.token,'undo_tracker_last_action_v1',undoIntent);expect(replay.data).toEqual({...undone.data,duplicate:true});
     const at=performance.now(),actions=await readActions(),after=await readHand();
     expect(actions.map(({id,...a}:{id:string})=>a)).toEqual(supplied.slice(0,3));
     expect(after.source_revision).toBe(undone.data.source_revision);expect(after.status).toBe('in_progress');
     undoRows.push({recordActionMs:restored.ms,ackMs:undone.ms,retryMs:replay.ms,independentReadMs:performance.now()-at});undoReport();
    }
    expect((await rpc(actor.token,'record_action',args(supplied[n]))).data.status).toBe('success');
    undoPhase='awaiting-finish-conservation';undoReport();
   }
  }timings.remainingActionWriteMs=actionWrites;
  const recorded=await readActions();expect(recorded).toHaveLength(5);expect(recorded.map(({id,...a}:{id:string})=>a)).toEqual(supplied);phase='decided-fence';const decidedHand=await readHand();expect((await rpc(actor.token,'record_action',args({...supplied[0],action_type:'check',action_order:6,action_amount:0}))).data.error).toBe('tracker_hand_already_decided');expect((await rpc(actor.token,'record_action',firstArgs)).data).toMatchObject({status:'success',duplicate:true,action_id:contenders[0].data.action_id});expect(await readActions()).toEqual(recorded);expect(await readHand()).toEqual(decidedHand);
  const payload={players:frozen.map(p=>({...p,ending_stack:p.starting_stack+(p.player_id===sb.player_id?-100:p.player_id===bb.player_id?100:0),is_eliminated:false,side_pots:[],hole_cards:[]})),actions:supplied,community_cards:[],side_pots:[{amount:200,eligible_player_ids:[bb.player_id]}],hand_time:hand.hand_time,pot_size:200};
  const intent={actor_id:actor.userId,request_id:crypto.randomUUID(),tournament_id:tour,tournament_table_id:target.tournament_table_id,hand_id:handId,table_session_id:target.table_session_id,control_epoch:target.control_epoch,source_revision:decidedHand.source_revision,payload};
  phase='finish-merge';const omitted=payload.actions.filter(a=>!(a.action_type==='fold'&&a.player_id!==sb.player_id));expect(omitted).toHaveLength(4);expect((await rpc(actor.token,'record_tracker_manual_hand_v1',{p_intent:{...intent,request_id:crypto.randomUUID(),payload:{...payload,actions:omitted}}})).data.error).toBe('action_conflict');expect(await readHand()).toEqual(decidedHand);expect(await readActions()).toEqual(recorded);
  const committed=await rpc(actor.token,'record_tracker_manual_hand_v1',{p_intent:intent});expect(committed.data.ok).toBe(true);timings.finishMs=committed.ms;expect((await rpc(actor.token,'record_tracker_manual_hand_v1',{p_intent:intent})).data).toEqual(committed.data);expect((await rpc(actor.token,'get_tracker_manual_finish_receipt_v1',{p_intent:intent})).data).toEqual(committed.data);expect(await readActions()).toEqual(recorded);expect((await readHand()).status).toBe('completed');expect(await readPlayers()).toEqual(payload.players.map(({is_eliminated,side_pots,hole_cards,...p})=>p));
  expect((await rpc(actor.token,'record_action',args({...supplied[0],action_type:'check',action_order:6,action_amount:0}))).data.error).toBe('Hand is not in progress');expect(await readActions()).toEqual(recorded);const paid=(await roster()).flatMap(t=>t.seats).filter(p=>staff.some(s=>s.userId===p.player_id));expect(paid).toHaveLength(20);expect(paid.reduce((n,p)=>n+p.chip_count,0)).toBe(400000);for(const p of payload.players)expect(paid.find(s=>s.player_id===p.player_id)!.chip_count).toBe(p.ending_stack);
  evidence={sameKeyRequests:20,firstWrites:1,duplicateReplies:19,stableActionRows:5,stableActionIds:true,overStackDenials:2,negativeAmountDenials:1,decidedHandDenied:true,decidedActionReplaySucceeded:true,omittedActionFinishDenied:true,exactFinishReplayAndReceipt:true,paidPlayerChips:400000};
  if(undoEnabled){expect(undoRows).toHaveLength(20);for(const k of ['recordActionMs','ackMs','retryMs','independentReadMs'] as const)expect(dist(undoRows.map(r=>r[k])).p95Ms,k).toBeLessThanOrEqual(1000);undoPhase='passed';undoReport();}
  phase='passed';report();
 }catch(error){phase+='-failed';report();if(undoEnabled){undoPhase+='-failed';undoReport();}throw error;}
});

test('owner historical preview verifies the canonical recorded hand over real HTTP',async({page})=>{
 test.skip(process.env.LOCAL_OPERATIONS_HISTORICAL_PREVIEW_ENABLED!=='1'||process.env.LOCAL_OPERATIONS_RECORDED_ACTION_FINISH_ENABLED!=='1'||!['0','10'].includes(process.env.LOCAL_OPERATIONS_AUDIENCE??'0'),
  'Small isolated preview diagnostic only;not a1000-viewer claim');test.setTimeout(45_000);
 const original=await loginOwner(page),staff=await loginFixtureStaff(),api=process.env.LOCAL_SUPABASE_URL!.replace(/\/$/,''),anon=process.env.LOCAL_SUPABASE_ANON_KEY!;
 const tour='a3000000-0000-4000-8000-000000000001',club='a2000000-0000-4000-8000-000000000001';
 const headers=(token:string)=>({apikey:anon,Authorization:`Bearer ${token}`,'Content-Type':'application/json'});
 let phase='owner',previewMs:number|null=null,lastHttpStatus:number|null=null;
 const checks={verifiedOwner:false,actorChangeDenied:false,positivePreview:false,validFingerprints:false,selectedSourceFieldsUnchanged:false};
 const report=()=>writeFileSync(process.env.LOCAL_OPERATIONS_LATENCY_REPORT!.replace(/\.json$/,'-historical-preview-http.json'),JSON.stringify({
  kind:'REAL_AUTH_OWNER_HISTORICAL_PREVIEW_CANONICAL_RECORDED_HAND',sha:process.env.LOCAL_OPERATIONS_SOURCE_SHA,
  phase,checks,previewMs,lastHttpStatus,qualification:false,
  limitations:'Read-only preview on canonical recorded hand9023;selected source columns compared,not whole-source immutability. Actor409 proves context binding;positive200proves owner authorization/verifier. Does not persist proof,verify stack dots,commit receipt,showdown/sidepots or1000-viewer latency.',
 },null,2));
 const get=async(token:string,path:string)=>{const response=await fetch(api+path,{headers:headers(token),signal:AbortSignal.timeout(5000)});expect(response.ok).toBe(true);return response.json();};
 try{
  const originalUser=await get(original,'/auth/v1/user'),clubs=await get(original,'/rest/v1/clubs?select=owner_id&id=eq.'+club);
  expect(clubs.length).toBe(1);const ownerId=clubs[0].owner_id;
  const identity=originalUser.id===ownerId?{userId:ownerId,token:original}:staff.find(s=>s.userId===ownerId);
  expect(Boolean(identity)).toBe(true);const owner=identity!;
  expect((await get(owner.token,'/auth/v1/user')).id).toBe(ownerId);checks.verifiedOwner=true;
  const hands=await get(owner.token,'/rest/v1/tournament_hands?select=id,source_revision,status,pot_size&tournament_id=eq.'+tour+'&hand_number=eq.9023');
  expect(hands.length).toBe(1);expect(hands[0].status).toBe('completed');const hand=hands[0];
  const source=async()=>({hand:await get(owner.token,'/rest/v1/tournament_hands?select=id,source_revision,status,pot_size&id=eq.'+hand.id),
   players:await get(owner.token,'/rest/v1/hand_players?select=id,starting_stack,ending_stack,is_eliminated,entry_number&hand_id=eq.'+hand.id+'&order=id'),
   actions:await get(owner.token,'/rest/v1/hand_actions?select=id,street,action_type,action_amount,action_order&hand_id=eq.'+hand.id+'&order=id')});
  const before=await source(),intent={mode:'preview',expected_actor_id:owner.userId,tournament_id:tour,hand_id:hand.id};
  const post=async(body:Record<string,unknown>)=>{const response=await fetch(api+'/functions/v1/tournament-historical-settlement',{
   method:'POST',headers:headers(owner.token),body:JSON.stringify(body),signal:AbortSignal.timeout(5000)});return {response,data:await response.json()};};
  phase='actor-denial';const other=staff.find(s=>s.userId!==owner.userId)!;
  const denied=await post({...intent,expected_actor_id:other.userId});expect(denied.response.status).toBe(409);expect(denied.data.code).toBe('actor_context_changed');checks.actorChangeDenied=true;
  phase='preview';const started=performance.now(),result=await post(intent);previewMs=performance.now()-started;lastHttpStatus=result.response.status;report();
  expect(result.response.status).toBe(200);expect(result.data.ok).toBe(true);expect(result.data.status).toBe('preview');checks.positivePreview=true;
  expect(result.data.source_revision).toBe(hand.source_revision);
  expect(/^[0-9a-f]{64}$/.test(result.data.source_chain_hash)).toBe(true);expect(/^[0-9a-f]{64}$/.test(result.data.outcome_hash)).toBe(true);checks.validFingerprints=true;
  expect(await source()).toEqual(before);checks.selectedSourceFieldsUnchanged=true;phase='passed';report();
 }catch(error){phase+='-failed';report();throw error;}
});

test('anonymous public replay reads the recorded hand through actual HTTP',async({page,browser})=>{
 test.skip(process.env.LOCAL_OPERATIONS_RECORDED_ACTION_FINISH_ENABLED!=='1','Requires the preceding canonical recorded-action Finish');test.setTimeout(45_000);
 const owner=await loginOwner(page),api=process.env.LOCAL_SUPABASE_URL!.replace(/\/$/,''),anon=process.env.LOCAL_SUPABASE_ANON_KEY!,tour='a3000000-0000-4000-8000-000000000001';
 const headers={apikey:anon,Authorization:`Bearer ${owner}`,'Content-Type':'application/json'};
 let phase='source',navigationToReadyMs:number|null=null,anonymousHttpReads=0,pageErrorCount=0;
 const replayHttp:Record<string,{statuses:Record<string,number>;sqlStates:Record<string,number>;aborted:number;otherFailures:number}>={};
 const diagnosticReads:Promise<void>[]=[];
 const navigationSamplesMs:number[]=[];
 let replayPage:Page|undefined,uiState:Record<string,boolean|number>|null=null;
 const evidence={sourceHandVerified:false,anonymousHandVerified:false,crossTourDenied:false,actualBrowserRpc:false,sliderAdvanced:false,sliderRewound:false,anonymousStorage:true};
 const report=()=>writeFileSync(process.env.LOCAL_OPERATIONS_LATENCY_REPORT!.replace(/\.json$/,'-public-replay-ui-http.json'),JSON.stringify({kind:'REAL_ANONYMOUS_PUBLIC_REPLAY_CANONICAL_RECORDED_HAND',sha:process.env.LOCAL_OPERATIONS_SOURCE_SHA,phase,evidence,anonymousHttpReads,pageErrorCount,navigationToReadyMs,navigationSamplesMs,replayHttp,uiState,samples:navigationSamplesMs.length,requiredNavigations:5,qualification:false,limitations:'Five sequential real anonymous Chromium navigations through public HTTP for the preceding canonical five-action fold hand. No route interception/dev fixtures/derived-HUD activation. Verifies source identity,table/tour scoping and action scrubbing. Five navigations are a bounded repeatability probe,not p95 or1000DOM capacity. Does not qualify showdown,sidepots,HUD freeze or history-dot navigation. Diagnostics retain only known RPC names,HTTP status/SQLSTATE counters and fixed UI booleans/counts;no DOM text,payloads,URLs or credentials.'},null,2));
 let context:Awaited<ReturnType<typeof browser.newContext>>|undefined;
 try{
 const response=await fetch(api+'/rest/v1/tournament_hands?select=id,tournament_table_id,table_session_id,status&tournament_id=eq.'+tour+'&hand_number=eq.9023',{headers,signal:AbortSignal.timeout(5000)});
 expect(response.ok).toBe(true);const rows=await response.json();expect(rows).toHaveLength(1);const hand=rows[0];expect(hand.status).toBe('completed');evidence.sourceHandVerified=true;
 const publicRead=async(tournamentId:string)=>{
  const response=await fetch(api+'/rest/v1/rpc/get_public_tournament_table_hand_v2',{method:'POST',headers:{...headers,Authorization:`Bearer ${anon}`},body:JSON.stringify({p_tournament_id:tournamentId,p_tournament_table_id:hand.tournament_table_id,p_hand_id:hand.id}),signal:AbortSignal.timeout(5000)});
  anonymousHttpReads++;expect(response.ok).toBe(true);return response.json();
 };
 const verify=(data:{id:string;tableId:string;tableSessionId:string;handNumber:number;status:string;actions:unknown[];players:unknown[]})=>{
  expect(data.id).toBe(hand.id);expect(data.tableId).toBe(hand.tournament_table_id);expect(data.tableSessionId).toBe(hand.table_session_id);
  expect(data.handNumber).toBe(9023);expect(data.status).toBe('completed');expect(data.actions).toHaveLength(5);expect(data.players).toHaveLength(3);
 };
  phase='anonymous-api';verify(await publicRead(tour));evidence.anonymousHandVerified=true;
  const denied=await publicRead('a3000000-0000-4000-8000-000000000099');
  expect(denied?.id??null).not.toBe(hand.id);expect(denied?.actions??[]).toHaveLength(0);expect(denied?.players??[]).toHaveLength(0);evidence.crossTourDenied=true;
  context=await browser.newContext({baseURL:process.env.PLAYWRIGHT_BASE_URL,locale:'vi-VN',viewport:{width:1366,height:900}});
  const viewer=await context.newPage();replayPage=viewer;viewer.on('pageerror',()=>pageErrorCount++);
  const knownRpc=(url:string)=>{const name=new URL(url).pathname.split('/').at(-1)??'';return ['get_public_tournament_table_hand_v2','get_public_tournament_hand_v2','get_public_tournament_table_history_v2','get_public_tournament_hand_catalog_v2','get_public_tournament_settlement','get_public_tournament_viewer_snapshot_v2','get_public_tournament_table_clock_v1'].includes(name)?name:null;};
  const bucket=(name:string)=>replayHttp[name]??(replayHttp[name]={statuses:{},sqlStates:{},aborted:0,otherFailures:0});
  viewer.on('response',response=>{const name=knownRpc(response.url());if(!name)return;const row=bucket(name),status=String(response.status());row.statuses[status]=(row.statuses[status]??0)+1;if(!response.ok()&&diagnosticReads.length<100)diagnosticReads.push((async()=>{try{const value=await response.json(),code=typeof value?.code==='string'&&/^(?:[0-9A-Z]{5}|PGRST\d{3})$/.test(value.code)?value.code:'unknown';row.sqlStates[code]=(row.sqlStates[code]??0)+1;}catch{row.sqlStates.nonJson=(row.sqlStates.nonJson??0)+1;}})());});
  viewer.on('requestfailed',request=>{const name=knownRpc(request.url());if(!name)return;const row=bucket(name);if(request.failure()?.errorText==='net::ERR_ABORTED')row.aborted++;else row.otherFailures++;});
  const publicResponse=viewer.waitForResponse(response=>{
   if(!new URL(response.url()).pathname.endsWith('/rest/v1/rpc/get_public_tournament_table_hand_v2'))return false;
   const args=response.request().postDataJSON();return args?.p_tournament_id===tour&&args?.p_hand_id===hand.id;
  },{timeout:10000});
  // Keep the response waiter observed even when navigation itself fails.
  void publicResponse.catch(()=>{});
  phase='browser';const at=performance.now();
  await viewer.goto('/live/'+tour+'?handId='+hand.id+'&tableId='+hand.tournament_table_id+'&tab=hands');
  const actual=await publicResponse;expect(actual.ok()).toBe(true);verify(await actual.json());evidence.actualBrowserRpc=true;
  const rail=viewer.getByTestId('replay-action-rail');await expect(rail).toBeVisible();navigationToReadyMs=performance.now()-at;navigationSamplesMs.push(navigationToReadyMs);
  const slider=rail.getByRole('slider',{name:'Tua lại ván'});await expect(slider).toHaveAttribute('aria-valuemax','5');
  await rail.getByTitle('Về đầu',{exact:true}).click();await expect(slider).toHaveAttribute('aria-valuenow','0');
  await rail.getByTitle('Tiến 1 bước',{exact:true}).click();await expect(slider).toHaveAttribute('aria-valuenow','1');evidence.sliderAdvanced=true;
  await rail.getByTitle('Về đầu',{exact:true}).click();await expect(slider).toHaveAttribute('aria-valuenow','0');evidence.sliderRewound=true;
  // Independent document loads under the same operational audience. No retry:
  // the first failed scoped response or missing rail fails the entire test.
  for(let iteration=1;iteration<5;iteration++){
   phase='browser-reload-'+iteration;
   const response=viewer.waitForResponse(response=>{
    if(!new URL(response.url()).pathname.endsWith('/rest/v1/rpc/get_public_tournament_table_hand_v2'))return false;
    const args=response.request().postDataJSON();return args?.p_tournament_id===tour&&args?.p_hand_id===hand.id;
   },{timeout:10000});void response.catch(()=>{});
   const started=performance.now();await viewer.reload();
   const actual=await response;expect(actual.ok()).toBe(true);verify(await actual.json());
   await expect(rail).toBeVisible();await expect(slider).toHaveAttribute('aria-valuemax','5');
   navigationSamplesMs.push(performance.now()-started);
   await rail.getByTitle('Về đầu',{exact:true}).click();await expect(slider).toHaveAttribute('aria-valuenow','0');
   await rail.getByTitle('Tiến 1 bước',{exact:true}).click();await expect(slider).toHaveAttribute('aria-valuenow','1');
  }
  expect(navigationSamplesMs).toHaveLength(5);

  const storage=await context.storageState();evidence.anonymousStorage=!storage.origins.some(origin=>origin.localStorage.some(item=>item.name.endsWith('-auth-token')));expect(evidence.anonymousStorage).toBe(true);expect(pageErrorCount).toBe(0);
  await Promise.allSettled(diagnosticReads);phase='passed';report();
 }catch(error){phase+='-failed';if(replayPage&&!replayPage.isClosed()){try{uiState=await replayPage.evaluate(()=>{const text=document.body.textContent??'';return {rail:!!document.querySelector('[data-testid="replay-action-rail"]'),rptShell:!!document.querySelector('[data-testid="viewer-rpt-shell"]'),selectCount:document.querySelectorAll('select').length,queryError:text.includes('Không thể truy vấn hand.'),targetLoading:text.includes('Đang tìm hand từ đường dẫn'),notFound:text.includes('Không tìm thấy hand'),listError:text.includes('Không tải được lịch sử hand'),replayDataError:text.includes('Không thể tải dữ liệu replay'),withdrawn:text.includes('Giải này không còn được công khai'),watchClose:!!document.querySelector('[aria-label="Đóng trình xem"]')};});}catch{uiState={inspectionFailed:true};}}await Promise.allSettled(diagnosticReads);report();throw error;}finally{await context?.close();}
});

test('anonymous prepared HUD reads canonical operational history and replay',async({page,browser})=>{
 test.skip(process.env.LOCAL_OPERATIONS_HUD_BROWSER_ENABLED!=='1','Requires actual backfill and independent raw-source shadow after load stops');test.setTimeout(120_000);
 const owner=await loginOwner(page),api=process.env.LOCAL_SUPABASE_URL!.replace(/\/$/,''),anon=process.env.LOCAL_SUPABASE_ANON_KEY!,tour='a3000000-0000-4000-8000-000000000001';
 const headers={apikey:anon,Authorization:`Bearer ${owner}`};
 const read=async(path:string)=>{const response=await fetch(api+'/rest/v1/'+path,{headers,signal:AbortSignal.timeout(5000)});expect(response.ok).toBe(true);return response.json();};
 let phase='source',pageErrors=0,summaryReads=0,historyReads=0,historyCount=0,unknownStacks=0,observedHands:number|null=null,revision:string|null=null,revocationFrames=0,visibilityFrames=0,sourceToReadyMs:number|null=null;
 let failureKind:string|null=null,teardown='pending';const tableUi={catalogCount:0,targetIndex:-1,snapshotReads:0,lastStatus:0,lastAccess:'unknown',targetItem:false};
 const settlementEvidence={receipt:false,sourcePreserved:false,workerRevision:false,frozen:false,reopenedDot:false,readyMs:null as number|null};
 const checks={canonicalTourStart:false,actualTableOpen:false,actualSeatClick:false,anonymousSummary:false,independentHistory:false,help:false,idleNoPolling:false,tourReplayLink:false,actualReplayRpc:false,anonymousStorage:false,canonicalNewHand:false,frozenDuringNewHand:false,reopenNewRevision:false,revocationBroadcast:false,revocationCleared:false,definitiveDenials:false,restored:false};
 const report=()=>writeFileSync(process.env.LOCAL_OPERATIONS_LATENCY_REPORT!.replace(/\.json$/,'-public-hud-ui-http.json'),JSON.stringify({kind:'REAL_ANONYMOUS_PREPARED_HUD_CANONICAL_OPERATIONAL_FIXTURE',sha:process.env.LOCAL_OPERATIONS_SOURCE_SHA,phase,checks,failureKind,teardown,tableUi,observedHands,revision,historyCount,unknownStacks,summaryReads,historyReads,settlementEvidence,pageErrors,revocationFrames,visibilityFrames,sourceToReadyMs,qualification:false,limitations:'One anonymous Chromium HUD with canonical start/Finish,new-source frozen HUD,reopen,actual Broadcast and definitive API withdrawal/restore. Host private controls mutate only fixed TEST tour deleted_at through real triggers;not operator withdrawal authorization/UI proof. Original shadow runs before reads and after worker drain. Settlement-only9023proof uses owner Edge and canonical receipt;source hand/player/action and current-seat hashes must remain unchanged. No cross-tour aggregation,all-chart-shapes,production Edge/cron or1000capacity proof. No routes/responses intercepted.'},null,2));
 let context:Awaited<ReturnType<typeof browser.newContext>>|undefined;
 try{
  const hands=await read('tournament_hands?select=id,tournament_table_id,table_session_id,status&tournament_id=eq.'+tour+'&hand_number=eq.9023');expect(hands).toHaveLength(1);const hand=hands[0];expect(hand.status).toBe('completed');
  const players=await read('hand_players?select=player_id,seat_number&hand_id=eq.'+hand.id+'&order=seat_number');expect(players).toHaveLength(3);const player=players[0].player_id as string;
  // The cashier fixture starts in registering. Public verified stack evidence
  // deliberately requires an actually started tour; use the existing Floor
  // writer before opening any HUD instead of weakening that proof gate.
  phase='tour-start';const beforeStart=await read('tournaments?select=status,clock_started_at&id=eq.'+tour);expect(beforeStart).toHaveLength(1);expect(beforeStart[0]).toMatchObject({status:'registering',clock_started_at:null});
  const startResponse=await fetch(api+'/rest/v1/rpc/floor_start_tournament_clock',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({p_tournament_id:tour}),signal:AbortSignal.timeout(5000)});expect(startResponse.ok).toBe(true);expect(await startResponse.json()).toMatchObject({ok:true,outcome:'clock_started'});
  const startedTour=await read('tournaments?select=status,clock_started_at&id=eq.'+tour);expect(startedTour).toHaveLength(1);expect(startedTour[0].status).toBe('live');expect(typeof startedTour[0].clock_started_at).toBe('string');
  await expect.poll(async()=>{const response=await fetch(api+'/rest/v1/rpc/get_public_player_hud_summary_v1',{method:'POST',headers:{apikey:anon,Authorization:`Bearer ${anon}`,'Content-Type':'application/json'},body:JSON.stringify({p_tournament_id:tour,p_player_id:player}),signal:AbortSignal.timeout(5000)});expect(response.ok).toBe(true);const value=await response.json();return value.access==='public'&&value.state==='current';},{timeout:5000,intervals:[100,250]}).toBe(true);checks.canonicalTourStart=true;
  const source=await read('tournament_hands?select=id&tournament_id=eq.'+tour),sourceIds=new Set(source.map((row:{id:string})=>row.id));
  const catalogResponse=await fetch(api+'/rest/v1/rpc/get_public_tournament_viewer_snapshot_v2',{method:'POST',headers:{...headers,Authorization:`Bearer ${anon}`,'Content-Type':'application/json'},body:JSON.stringify({p_tournament_id:tour,p_table_ids:[],p_sections:['tables'],p_known_revisions:{}}),signal:AbortSignal.timeout(5000)});expect(catalogResponse.ok).toBe(true);
  const catalog=(await catalogResponse.json()).sections.tables.catalog as {tableId:string;name:string}[],tableName=catalog.find(row=>row.tableId===hand.tournament_table_id)?.name;expect(typeof tableName).toBe('string');expect(catalog.filter(row=>row.name===tableName)).toHaveLength(1);
  tableUi.catalogCount=catalog.length;tableUi.targetIndex=catalog.findIndex(row=>row.tableId===hand.tournament_table_id);
  context=await browser.newContext({baseURL:process.env.PLAYWRIGHT_BASE_URL,locale:'vi-VN',viewport:{width:1366,height:900}});const viewer=await context.newPage();viewer.on('pageerror',()=>pageErrors++);
  viewer.on('websocket',socket=>socket.on('framereceived',frame=>{try{
   const wire=decodeClockWireFrame(typeof frame.payload==='string'?frame.payload:new Uint8Array(frame.payload)) as Record<string,unknown>|unknown[];
   if(clockBroadcastSignal(wire,tour)?.components.includes('visibility'))visibilityFrames++;
   const event=Array.isArray(wire)?wire[3]:wire.event,topic=Array.isArray(wire)?wire[2]:wire.topic,outer=(Array.isArray(wire)?wire[4]:wire.payload) as {event?:string;payload?:{scope?:string}};
   if(event==='broadcast'&&topic==='realtime:public:player-hud-access-v1'&&outer?.event==='revoked'&&outer.payload?.scope==='all-public-player-hud')revocationFrames++;
  }catch{/* Count only decoded fixed events;never export frames. */}}));
  viewer.on('request',request=>{const path=new URL(request.url()).pathname;if(path.endsWith('/rest/v1/rpc/get_public_player_hud_summary_v1'))summaryReads++;if(path.endsWith('/rest/v1/rpc/get_public_player_hud_history_v1'))historyReads++;});
  viewer.on('response',async response=>{if(!new URL(response.url()).pathname.endsWith('/rest/v1/rpc/get_public_tournament_viewer_snapshot_v2'))return;tableUi.snapshotReads++;tableUi.lastStatus=response.status();try{const value=await response.json();tableUi.lastAccess=['public','revoked'].includes(value.access)?value.access:'other';tableUi.targetItem=Array.isArray(value.sections?.tables?.items)&&value.sections.tables.items.some((row:{tableId:string})=>row.tableId===hand.tournament_table_id);}catch{/* Diagnostic counters only; UI expectations retain actual failures. */}});
  const openTable=async()=>{
   phase='felt-filter';await viewer.getByPlaceholder('Tìm bàn hoặc người chơi',{exact:true}).fill(tableName!,{timeout:10000});
   const button=viewer.getByRole('article',{name:tableName!,exact:true}).getByRole('button',{name:'Xem '+tableName,exact:true});phase='felt-open';await expect(button).toBeVisible({timeout:10000});
   const response=viewer.waitForResponse(value=>{if(!new URL(value.url()).pathname.endsWith('/rest/v1/rpc/get_public_tournament_table_clock_v1'))return false;const args=value.request().postDataJSON();return args?.p_tournament_id===tour&&args?.p_tournament_table_id===hand.tournament_table_id;},{timeout:10000});void response.catch(()=>{});
   await button.click({timeout:5000});phase='felt-read';const actual=await response;expect(actual.ok()).toBe(true);expect((await actual.json()).table.tableId).toBe(hand.tournament_table_id);
  };
  phase='felt';await viewer.goto('/live/'+tour+'?tableId='+hand.tournament_table_id+'&tab=hands');
  await openTable();checks.actualTableOpen=true;
  const seat=viewer.getByRole('button').filter({has:viewer.getByTestId('felt-stack-'+player)});await expect(seat).toBeVisible({timeout:15000});
  const responseFor=(name:string)=>viewer.waitForResponse(response=>{if(!new URL(response.url()).pathname.endsWith('/rest/v1/rpc/'+name))return false;const args=response.request().postDataJSON();return args?.p_tournament_id===tour&&args?.p_player_id===player;},{timeout:10000});
  const summaryResponse=responseFor('get_public_player_hud_summary_v1'),historyResponse=responseFor('get_public_player_hud_history_v1');void summaryResponse.catch(()=>{});void historyResponse.catch(()=>{});
  await seat.click();checks.actualSeatClick=true;phase='hud';
  const actualSummary=await summaryResponse;expect(actualSummary.ok()).toBe(true);const summary=await actualSummary.json();expect(summary.access).toBe('public');expect(summary.coverageComplete).toBe(true);expect(summary.playerId).toBe(player);expect(summary.tournamentId).toBe(tour);
  observedHands=summary.counters.handsObserved;revision=summary.revision;expect(observedHands).toBeGreaterThanOrEqual(21);checks.anonymousSummary=true;
  const dialog=viewer.getByRole('dialog').filter({has:viewer.getByRole('button',{name:'Giải thích HANDS',exact:true})});
  await expect(dialog.getByRole('button',{name:'Giải thích HANDS',exact:true}).locator('strong')).toHaveText(observedHands!.toLocaleString('vi-VN'));await expect(dialog.getByText(/Bản thống kê lúc mở/)).toBeVisible();
  const actualHistory=await historyResponse;expect(actualHistory.ok()).toBe(true);const history=await actualHistory.json();expect(history.tournamentId).toBe(tour);expect(history.playerId).toBe(player);expect(Array.isArray(history.handHistory)).toBe(true);expect(history.handHistory.length).toBeLessThanOrEqual(50);
  expect(history.handHistory.every((row:{handId:string})=>sourceIds.has(row.handId))).toBe(true);expect(history.handHistory.some((row:{handId:string})=>row.handId===hand.id)).toBe(true);historyCount=history.handHistory.length;unknownStacks=history.handHistory.filter((row:{endingStack:number|null})=>row.endingStack===null).length;checks.independentHistory=true;
  const region=dialog.getByRole('region',{name:'Lịch sử hand của người chơi'}),link=region.getByRole('link',{name:'Mở replay hand #9023',exact:true});await expect(link).toBeVisible();const href=new URL((await link.getAttribute('href'))!,process.env.PLAYWRIGHT_BASE_URL);expect(href.pathname).toBe('/live/'+tour);expect(href.searchParams.get('handId')).toBe(hand.id);expect(href.searchParams.get('tableId')).toBe(hand.tournament_table_id);checks.tourReplayLink=true;
  const current=history.handHistory.find((row:{handId:string})=>row.handId===hand.id);if(current.endingStack===null){await expect(region.getByRole('link',{name:/^Replay hand #9023,/})).toHaveCount(0);await expect(link.getByText('Stack chưa xác minh')).toBeVisible();}
  await dialog.getByRole('button',{name:'Giải thích HANDS',exact:true}).click();const help=viewer.getByRole('dialog',{name:'Giải thích chỉ số HUD'});await expect(help).toBeVisible();await help.getByRole('button',{name:'Close',exact:true}).click();checks.help=true;
  // Allow the one initial access-subscription verification, then observe an
  // actual idle window. This does not simulate a source revision change.
  await viewer.waitForTimeout(11000);const before=summaryReads;await viewer.waitForTimeout(3500);expect(summaryReads).toBe(before);checks.idleNoPolling=true;
  phase='new-source';const actor=(await loginFixtureStaff())[0];
  const rpc=async(token:string,name:string,args:Record<string,unknown>)=>{const response=await fetch(api+'/rest/v1/rpc/'+name,{method:'POST',headers:{...headers,Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(args),signal:AbortSignal.timeout(5000)});expect(response.ok,name).toBe(true);return response.json();};
  const roster=await rpc(owner,floorRosterRpc,{p_tournament_id:tour}),target=roster.find((row:{tournament_table_id:string})=>row.tournament_table_id===hand.tournament_table_id);expect(target).toBeTruthy();
  const paidBefore=roster.flatMap((row:{seats:{player_id:string;chip_count:number}[]})=>row.seats) as {player_id:string;chip_count:number}[];
  const started=await rpc(actor.token,'start_tracker_hand_v3',{p_tournament_id:tour,p_tournament_table_id:target.tournament_table_id,p_table_session_id:target.table_session_id,p_control_epoch:target.control_epoch,p_hand_number:9024,p_hand_time:new Date().toISOString(),p_created_by:actor.userId,p_button_seat:1});expect(started.status).toBe('success');
  const fresh=(await read('tournament_hands?select=id,hand_time,status,source_revision,tracker_sb_position,tracker_bb_position,tracker_small_blind,tracker_big_blind,tracker_bba&id=eq.'+started.hand_id))[0];expect(fresh.status).toBe('in_progress');expect([fresh.tracker_small_blind,fresh.tracker_big_blind,fresh.tracker_bba]).toEqual([100,200,200]);
  type HudPlayer={player_id:string;entry_number:number;seat_number:number;starting_stack:number;ending_stack:number|null};
  const frozen=await read('hand_players?select=player_id,entry_number,seat_number,starting_stack,ending_stack&hand_id=eq.'+fresh.id+'&order=seat_number') as HudPlayer[];expect(frozen).toHaveLength(3);expect(frozen.some(p=>p.player_id===player)).toBe(true);
  const sb=frozen.find(p=>p.seat_number===fresh.tracker_sb_position)!,bb=frozen.find(p=>p.seat_number===fresh.tracker_bb_position)!;expect(sb).toBeTruthy();expect(bb).toBeTruthy();for(const p of frozen){expect(p.entry_number).toBe(2);expect(p.starting_stack).toBeGreaterThan(400);}
  const ordered=[{player:bb,type:'post_ante',amount:200},{player:sb,type:'post_sb',amount:100},{player:bb,type:'post_bb',amount:200},...frozen.filter(p=>p.player_id!==bb.player_id).sort((a,b)=>(a.seat_number-bb.seat_number+9)%9-(b.seat_number-bb.seat_number+9)%9).map(p=>({player:p,type:'fold',amount:0}))];
  const payload={players:frozen.map(p=>({...p,ending_stack:p.starting_stack+(p.player_id===sb.player_id?-100:p.player_id===bb.player_id?100:0),is_eliminated:false,side_pots:[],hole_cards:[]})),actions:ordered.map((a,n)=>({player_id:a.player.player_id,entry_number:a.player.entry_number,street:'preflop',action_type:a.type,action_amount:a.amount,action_order:n+1})),community_cards:[],side_pots:[{amount:200,eligible_player_ids:[bb.player_id]}],hand_time:fresh.hand_time,pot_size:200};
  const intent={actor_id:actor.userId,request_id:crypto.randomUUID(),tournament_id:tour,tournament_table_id:target.tournament_table_id,hand_id:fresh.id,table_session_id:target.table_session_id,control_epoch:target.control_epoch,source_revision:fresh.source_revision,payload};
  const sourceAt=performance.now(),finished=await rpc(actor.token,'record_tracker_manual_hand_v1',{p_intent:intent});expect(finished.ok).toBe(true);expect(await rpc(actor.token,'record_tracker_manual_hand_v1',{p_intent:intent})).toEqual(finished);
  expect((await read('tournament_hands?select=status&id=eq.'+fresh.id))[0].status).toBe('completed');
  expect(await read('hand_players?select=player_id,entry_number,seat_number,starting_stack,ending_stack&hand_id=eq.'+fresh.id+'&order=seat_number')).toEqual(payload.players.map(({is_eliminated,side_pots,hole_cards,...p})=>p));
  expect((await read('hand_actions?select=player_id,entry_number,street,action_type,action_amount,action_order&hand_id=eq.'+fresh.id+'&order=action_order'))).toEqual(payload.actions);
  expect(payload.players.reduce((n,p)=>n+p.ending_stack,0)).toBe(frozen.reduce((n,p)=>n+p.starting_stack,0));
  const paidAfter=(await rpc(owner,floorRosterRpc,{p_tournament_id:tour})).flatMap((row:{seats:{player_id:string;chip_count:number}[]})=>row.seats) as {player_id:string;chip_count:number}[];
  expect(paidAfter).toHaveLength(paidBefore.length);expect(paidAfter.reduce((n,p)=>n+p.chip_count,0)).toBe(paidBefore.reduce((n,p)=>n+p.chip_count,0));for(const p of payload.players)expect(paidAfter.find(row=>row.player_id===p.player_id)!.chip_count).toBe(p.ending_stack);checks.canonicalNewHand=true;
  let nextSummary=summary;await expect.poll(async()=>{nextSummary=await rpc(anon,'get_public_player_hud_summary_v1',{p_tournament_id:tour,p_player_id:player});return nextSummary.counters?.handsObserved;},{timeout:Math.max(1,5000-(performance.now()-sourceAt)),intervals:[100,250]}).toBe(observedHands!+1);sourceToReadyMs=performance.now()-sourceAt;expect(sourceToReadyMs).toBeLessThanOrEqual(5000);expect(nextSummary.revision).not.toBe(revision);
  await expect(dialog.getByRole('button',{name:'Giải thích HANDS',exact:true}).locator('strong')).toHaveText(observedHands!.toLocaleString('vi-VN'));expect(summaryReads).toBe(before);checks.frozenDuringNewHand=true;
  const reopenedAccess=viewer.waitForResponse(response=>{if(!new URL(response.url()).pathname.endsWith('/rest/v1/rpc/get_public_player_hud_summary_v1'))return false;const args=response.request().postDataJSON();return args?.p_tournament_id===tour&&args?.p_player_id===player&&typeof args?.p_access_snapshot==='string';},{timeout:25000});void reopenedAccess.catch(()=>{});
  await dialog.getByRole('button',{name:'Close',exact:true}).click();const reopened=responseFor('get_public_player_hud_summary_v1'),reopenedHistory=responseFor('get_public_player_hud_history_v1');void reopened.catch(()=>{});void reopenedHistory.catch(()=>{});await seat.click();const reopenedResponse=await reopened;expect(reopenedResponse.ok()).toBe(true);const reopenedSummary=await reopenedResponse.json();expect(reopenedSummary.revision).toBe(nextSummary.revision);expect(reopenedSummary.counters.handsObserved).toBe(observedHands!+1);await expect(dialog.getByRole('button',{name:'Giải thích HANDS',exact:true}).locator('strong')).toHaveText((observedHands!+1).toLocaleString('vi-VN'));checks.reopenNewRevision=true;const openedHistory=await (await reopenedHistory).json();expect(openedHistory.handHistory.find((row:{handId:string})=>row.handId===hand.id).endingStack).toBeNull();
  // Drain the one initial access verification before measuring frozen updates.
  const accessVerification=await reopenedAccess;expect(accessVerification.request().postDataJSON().p_access_snapshot).toBe(reopenedSummary.accessSnapshot);expect(accessVerification.ok()).toBe(true);expect((await accessVerification.json()).access).toBe('public');
  // Canonical settlement-only proof: source revision and HANDS stay unchanged.
  phase='settlement-only';expect(process.env.LOCAL_OPERATIONS_HISTORICAL_PREVIEW_ENABLED).toBe('1');
  const club=(await read('clubs?select=owner_id&id=eq.a2000000-0000-4000-8000-000000000001'))[0];
  const authResponse=await fetch(api+'/auth/v1/user',{headers,signal:AbortSignal.timeout(5000)});expect(authResponse.ok).toBe(true);const authUser=await authResponse.json();
  const proofOwner=authUser.id===club.owner_id?{userId:club.owner_id,token:owner}:(await loginFixtureStaff()).find(s=>s.userId===club.owner_id);expect(proofOwner).toBeTruthy();
  const historical=async(body:Record<string,unknown>)=>{const response=await fetch(api+'/functions/v1/tournament-historical-settlement',{method:'POST',headers:{apikey:anon,Authorization:'Bearer '+proofOwner!.token,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(5000)});expect(response.status).toBe(200);return response.json();};
  const fingerprint=async()=>createHash('sha256').update(JSON.stringify(await Promise.all([read('tournament_hands?select=*&id=eq.'+hand.id),read('hand_players?select=*&hand_id=eq.'+hand.id+'&order=id'),read('hand_actions?select=*&hand_id=eq.'+hand.id+'&order=id'),read('tournament_seats?select=*&tournament_id=eq.'+tour+'&order=id')]))).digest('hex');
  const sourceBefore=await fingerprint(),rawHand=(await read('tournament_hands?select=source_revision&id=eq.'+hand.id))[0],rawPlayer=(await read('hand_players?select=starting_stack,ending_stack&hand_id=eq.'+hand.id+'&player_id=eq.'+player))[0];expect(Number.isSafeInteger(rawPlayer.ending_stack)).toBe(true);
  const priorHistory=await rpc(anon,'get_public_player_hud_history_v1',{p_tournament_id:tour,p_player_id:player});expect(priorHistory.handHistory.find((row:{handId:string})=>row.handId===hand.id).endingStack).toBeNull();
  const preview=await historical({mode:'preview',expected_actor_id:proofOwner!.userId,tournament_id:tour,hand_id:hand.id});expect(preview.ok).toBe(true);expect(preview.status).toBe('preview');expect(preview.source_revision).toBe(rawHand.source_revision);
  const proofIntent={mode:'commit',expected_actor_id:proofOwner!.userId,tournament_id:tour,hand_id:hand.id,idempotency_key:'ops-hud-proof-'+crypto.randomUUID(),expected_source_revision:preview.source_revision,expected_source_chain_hash:preview.source_chain_hash,expected_outcome_hash:preview.outcome_hash};
  const readsBeforeProof={summary:summaryReads,history:historyReads},proofAt=performance.now(),committed=await historical(proofIntent);expect(committed.ok).toBe(true);expect(committed.status).toBe('verified');expect(committed.receipt.ok).toBe(true);expect(committed.receipt.settlement_revision).toBeGreaterThanOrEqual(1);
  const repeated=await historical(proofIntent);expect(repeated.receipt.idempotent).toBe(true);expect(repeated.receipt.settlement_revision).toBe(committed.receipt.settlement_revision);
  const receipt=await historical({...proofIntent,mode:'receipt'});expect(receipt.status).toBe('receipt_found');expect(receipt.receipt.settlement_revision).toBe(committed.receipt.settlement_revision);settlementEvidence.receipt=true;
  let settledSummary=reopenedSummary;await expect.poll(async()=>{settledSummary=await rpc(anon,'get_public_player_hud_summary_v1',{p_tournament_id:tour,p_player_id:player});return settledSummary.access==='public'&&settledSummary.state==='current'&&typeof settledSummary.revision==='string'&&settledSummary.revision!==reopenedSummary.revision;},{timeout:Math.max(1,5000-(performance.now()-proofAt)),intervals:[100,250]}).toBe(true);
  settlementEvidence.readyMs=performance.now()-proofAt;expect(settlementEvidence.readyMs).toBeLessThanOrEqual(5000);expect(settledSummary.counters.handsObserved).toBe(reopenedSummary.counters.handsObserved);settlementEvidence.workerRevision=true;
  const settledHistory=await rpc(anon,'get_public_player_hud_history_v1',{p_tournament_id:tour,p_player_id:player}),verified=settledHistory.handHistory.find((row:{handId:string})=>row.handId===hand.id);expect(verified.endingStack).toBe(rawPlayer.ending_stack);expect(verified.netDelta).toBe(rawPlayer.ending_stack-rawPlayer.starting_stack);
  expect(await fingerprint()).toBe(sourceBefore);expect((await read('tournament_hands?select=source_revision&id=eq.'+hand.id))[0].source_revision).toBe(rawHand.source_revision);
  settlementEvidence.sourcePreserved=true;await expect(dialog.getByRole('button',{name:'Giải thích HANDS',exact:true}).locator('strong')).toHaveText(reopenedSummary.counters.handsObserved.toLocaleString('vi-VN'));expect({summary:summaryReads,history:historyReads}).toEqual(readsBeforeProof);await expect(region.getByRole('link',{name:/^Replay hand #9023,/})).toHaveCount(0);settlementEvidence.frozen=true;
  await dialog.getByRole('button',{name:'Close',exact:true}).click();const verifiedSummaryResponse=responseFor('get_public_player_hud_summary_v1'),verifiedHistoryResponse=responseFor('get_public_player_hud_history_v1');void verifiedSummaryResponse.catch(()=>{});void verifiedHistoryResponse.catch(()=>{});await seat.click();
  expect((await (await verifiedSummaryResponse).json()).revision).toBe(settledSummary.revision);expect((await (await verifiedHistoryResponse).json()).handHistory.find((row:{handId:string})=>row.handId===hand.id).endingStack).toBe(rawPlayer.ending_stack);await expect(region.getByRole('link',{name:/^Replay hand #9023,/})).toBeVisible();settlementEvidence.reopenedDot=true;
  phase='withdrawal';const control=process.env.LOCAL_OPERATIONS_HUD_CONTROL!,nonce=process.env.LOCAL_OPERATIONS_HUD_CONTROL_NONCE!;expect(control).toBe('/fixtures/hud-control');
  const command=async(action:'withdraw'|'restore')=>{const request={sha:process.env.LOCAL_OPERATIONS_SOURCE_SHA,nonce,requestId:crypto.randomUUID(),action};writeFileSync(control+'/requests/request.next',JSON.stringify(request));renameSync(control+'/requests/request.next',control+'/requests/request.json');await expect.poll(()=>{const file=control+'/receipts/receipt.json';if(!existsSync(file))return false;const receipt=JSON.parse(readFileSync(file,'utf8'));return receipt.requestId===request.requestId&&receipt.sha===request.sha&&receipt.nonce===nonce&&receipt.action===action&&receipt.applied===true&&Number.isFinite(receipt.sourceWrittenAt);},{timeout:5000,intervals:[100,250]}).toBe(true);};
  const broadcasts=revocationFrames+visibilityFrames;await command('withdraw');await expect.poll(()=>revocationFrames+visibilityFrames,{timeout:5000}).toBeGreaterThan(broadcasts);checks.revocationBroadcast=true;
  await expect(viewer.getByRole('button',{name:'Giải thích HANDS',exact:true})).toHaveCount(0);await expect(viewer.getByRole('region',{name:'Lịch sử hand của người chơi'})).toHaveCount(0);checks.revocationCleared=true;
  expect((await rpc(anon,'get_public_player_hud_summary_v1',{p_tournament_id:tour,p_player_id:player})).access).toBe('revoked');expect((await rpc(anon,'get_public_player_hud_history_v1',{p_tournament_id:tour,p_player_id:player})).access).toBe('revoked');
  const denied=await rpc(anon,'get_public_tournament_table_hand_v2',{p_tournament_id:tour,p_tournament_table_id:hand.tournament_table_id,p_hand_id:hand.id});expect(denied===null||denied.access==='revoked').toBe(true);expect(denied?.id??null).toBeNull();expect(denied?.actions??[]).toHaveLength(0);checks.definitiveDenials=true;
  await viewer.waitForTimeout(500);await expect(viewer.getByRole('button',{name:'Giải thích HANDS',exact:true})).toHaveCount(0);
  phase='restore';await command('restore');await expect.poll(async()=>{const value=await rpc(anon,'get_public_player_hud_summary_v1',{p_tournament_id:tour,p_player_id:player});return value.counters?.handsObserved;},{timeout:15000,intervals:[100,250]}).toBe(observedHands!+1);
  await viewer.goto('/live/'+tour+'?tableId='+hand.tournament_table_id+'&tab=hands');await openTable();await seat.click();await expect(dialog.getByRole('button',{name:'Giải thích HANDS',exact:true}).locator('strong')).toHaveText((observedHands!+1).toLocaleString('vi-VN'));checks.restored=true;
  phase='history-replay';const replay=viewer.waitForResponse(response=>{if(!new URL(response.url()).pathname.endsWith('/rest/v1/rpc/get_public_tournament_table_hand_v2'))return false;return response.request().postDataJSON()?.p_hand_id===hand.id;},{timeout:10000});void replay.catch(()=>{});
  await region.getByRole('link',{name:/^Replay hand #9023,/}).click();const actualReplay=await replay;expect(actualReplay.ok()).toBe(true);expect((await actualReplay.json()).id).toBe(hand.id);await expect(viewer.getByTestId('replay-action-rail')).toBeVisible();checks.actualReplayRpc=true;
  checks.anonymousStorage=!(await context.storageState()).origins.some(origin=>origin.localStorage.some(item=>item.name.endsWith('-auth-token')));expect(checks.anonymousStorage).toBe(true);expect(pageErrors).toBe(0);phase='passed';report();
  }catch(error){failureKind=error instanceof Error&&['Error','AssertionError','TimeoutError'].includes(error.name)?error.name:'other';phase+='-failed';report();throw error;}finally{
   if(context){let timer:ReturnType<typeof setTimeout>|undefined;const closed=await Promise.race([context.close().then(()=>true,()=>false),new Promise<false>(resolve=>{timer=setTimeout(()=>resolve(false),5000);})]);clearTimeout(timer);teardown=closed?'closed':'failed';if(!closed&&phase==='passed'){phase='cleanup-failed';report();throw Error('HUD browser teardown failed');}report();}
  }
});

test('checkout notifications reach the isolated HTTP sink once with dealer tags',async({page})=>{
 test.skip(process.env.LOCAL_OPERATIONS_TELEGRAM_SINK_ENABLED!=='1','Explicit isolated provider transport stage');test.setTimeout(150_000);
 const owner=await loginOwner(page),staff=await loginFixtureStaff(),api=process.env.LOCAL_SUPABASE_URL!.replace(/\/$/,''),anon=process.env.LOCAL_SUPABASE_ANON_KEY!,club='a2000000-0000-4000-8000-000000000001';
 const sink='http://telegram-test-sink:8788',headers=(token:string)=>({apikey:anon,Authorization:`Bearer ${token}`,'Content-Type':'application/json'});
 type Message={chatId:string;text:string;parseMode:string;accepted:boolean;receivedAt:number};
 const rows:{checkoutMs:number;groupFromCheckoutTimestampMs:number;dmFromCheckoutTimestampMs:number}[]=[];let phase='setup',race:unknown=null,providerFailure:unknown=null;
 const distribution=(values:number[])=>{const sorted=[...values].sort((a,b)=>a-b);return {samples:values.length,p95Ms:values.length===20?sorted[18]:null,maxMs:sorted.at(-1)??null};};
 const report=()=>writeFileSync(process.env.LOCAL_OPERATIONS_LATENCY_REPORT!.replace(/\.json$/,'-telegram-sink-http.json'),JSON.stringify({kind:'REAL_AUTH_CHECKOUT_TO_SYNTHETIC_PROVIDER_HTTP',sha:process.env.LOCAL_OPERATIONS_SOURCE_SHA,phase,actors:20,rows,distributions:Object.fromEntries(['checkoutMs','groupFromCheckoutTimestampMs','dmFromCheckoutTimestampMs'].map(key=>[key,distribution(rows.map(r=>r[key as keyof typeof r]))])),race,providerFailure,qualification:false,limitations:'Real Auth/Edge/current DB checkout and production Telegram formatting/retry code. Test-only temporary global-fetch endpoint adapter routes only the fixed invalid Telegram token to a real HTTP sink on fenced Docker networks;responses are not mocked. Measures checkout HTTP and canonical checkout timestamp to synthetic provider receive,not DB commit timestamp,real Telegram TLS/delivery,handset delivery or1000spectator contention. Only checkout group/DM path;other notification flows still require coverage.'},null,2));
 const snapshot=async()=>{const response=await fetch(sink+'/snapshot',{signal:AbortSignal.timeout(5000)});expect(response.ok).toBe(true);return (await response.json()).messages as Message[];};
 const rpc=async(token:string,name:string,args:Record<string,unknown>)=>{const response=await fetch(api+'/rest/v1/rpc/'+name,{method:'POST',headers:headers(token),body:JSON.stringify(args),signal:AbortSignal.timeout(5000)});expect(response.ok,name).toBe(true);return response.json();};
 const checkin=async(n:number)=>{
  const response=await fetch(api+'/rest/v1/dealers?select=id,full_name,telegram_user_id&club_id=eq.'+club+'&telegram_username=eq.notify_test_'+n,{headers:headers(owner),signal:AbortSignal.timeout(5000)});expect(response.ok).toBe(true);const dealers=await response.json();expect(dealers).toHaveLength(1);expect(dealers[0].telegram_user_id).toBe(9900000000000+n);
  const receipt=await rpc(staff[(n-1)%20].token,'operator_check_in_dealer_v1',{p_dealer_id:dealers[0].id,p_club_id:club,p_shift_id:'ad300000-0000-4000-8000-000000000001',p_request_id:crypto.randomUUID()});expect(receipt.outcome).toBe('checked_in');return receipt.attendance_id as string;
 };
 const checkout=async(n:number,id:string)=>{const started=performance.now(),response=await fetch(api+'/functions/v1/checkout-dealer',{method:'POST',headers:headers(staff[(n-1)%20].token),body:JSON.stringify({attendance_id:id}),signal:AbortSignal.timeout(10000)});expect(response.ok).toBe(true);const value=await response.json();expect(value.results).toHaveLength(1);expect(value.results[0].success).toBe(true);return {value:value.results[0],ms:performance.now()-started};};
 const verifyAttendance=async(id:string,time:string)=>{const response=await fetch(api+'/rest/v1/dealer_attendance?select=status,current_state,check_out_time,total_worked_minutes_today&id=eq.'+id,{headers:headers(owner),signal:AbortSignal.timeout(5000)});expect(response.ok).toBe(true);const data=await response.json();expect(data).toHaveLength(1);expect(data[0]).toMatchObject({status:'checked_out',current_state:'checked_out',check_out_time:time});expect(data[0].total_worked_minutes_today).toBeGreaterThanOrEqual(0);};
 const verifyMessages=(messages:Message[],n:number)=>{
  expect(messages).toHaveLength(2);const group=messages.find(m=>m.chatId==='-1000000000001')!,dm=messages.find(m=>m.chatId===String(9900000000000+n))!;expect(group).toBeTruthy();expect(dm).toBeTruthy();expect(group.text).toContain(`Notification TEST &lt;${n}&gt; &amp; Dealer @notify_test_${n}`);expect(dm.text).toContain('<b>check-out</b>');expect(messages.every(m=>m.accepted&&m.parseMode==='HTML')).toBe(true);return {group,dm};
 };
 try{
  expect(await snapshot()).toEqual([]);phase='graded';
  for(let n=1;n<=20;n++){
   const id=await checkin(n),before=(await snapshot()).length,result=await checkout(n,id),messages=(await snapshot()).slice(before),{group,dm}=verifyMessages(messages,n),at=Date.parse(result.value.check_out_time);
   expect(Number.isFinite(at)).toBe(true);expect(group.receivedAt-at).toBeGreaterThanOrEqual(0);expect(dm.receivedAt-at).toBeGreaterThanOrEqual(0);await verifyAttendance(id,result.value.check_out_time);
   const repeated=await checkout(n,id);expect(repeated.value.idempotent).toBe(true);expect(await snapshot()).toHaveLength(before+2);
   rows.push({checkoutMs:result.ms,groupFromCheckoutTimestampMs:group.receivedAt-at,dmFromCheckoutTimestampMs:dm.receivedAt-at});report();
  }
  phase='same-attendance-race';const id=await checkin(21),before=(await snapshot()).length,contenders=await Promise.all(Array.from({length:20},()=>checkout(21,id)));expect(contenders.filter(r=>r.value.idempotent===true)).toHaveLength(19);verifyMessages((await snapshot()).slice(before),21);await verifyAttendance(id,contenders[0].value.check_out_time);race={requests:20,first:1,replays:19,groupMessages:1,dmMessages:1};report();
  phase='provider-failure';const control=await fetch(sink+'/control',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({failGroup:true})});expect(control.ok).toBe(true);
  const faultId=await checkin(22),faultBefore=(await snapshot()).length,fault=await checkout(22,faultId),attempts=(await snapshot()).slice(faultBefore);expect(attempts.filter(m=>m.chatId==='-1000000000001'&&!m.accepted)).toHaveLength(3);expect(attempts.filter(m=>m.chatId==='9900000000022'&&m.accepted)).toHaveLength(1);await verifyAttendance(faultId,fault.value.check_out_time);expect((await checkout(22,faultId)).value.idempotent).toBe(true);expect(await snapshot()).toHaveLength(faultBefore+4);
  providerFailure={group503Attempts:3,dmAccepted:1,checkoutCommitted:true,replayDidNotResend:true,checkoutMs:fault.ms};expect(rows).toHaveLength(20);phase='passed';report();
 }catch(error){phase+='-failed';report();throw error;}finally{await fetch(sink+'/control',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({failGroup:false})}).catch(()=>{});}
});

test('owner Intelligence reads match confirmed registration identities over real HTTP',async({page})=>{
 test.skip(process.env.LOCAL_OPERATIONS_INTELLIGENCE_ENABLED!=='1','Owner read-only Intelligence stage');test.setTimeout(120_000);
 const owner=await loginOwner(page),staff=await loginFixtureStaff(),api=process.env.LOCAL_SUPABASE_URL!.replace(/\/$/,''),anon=process.env.LOCAL_SUPABASE_ANON_KEY!,club='a2000000-0000-4000-8000-000000000001',tour='a3000000-0000-4000-8000-000000000001';
 const headers=(token:string)=>({apikey:anon,Authorization:`Bearer ${token}`,'Content-Type':'application/json'}),samples:Record<string,number[]>={pulse:[],context:[],timeline:[]};let phase='setup',failure:unknown=null,evidence:unknown=null;
 const report=()=>writeFileSync(process.env.LOCAL_OPERATIONS_LATENCY_REPORT!.replace(/\.json$/,'-intelligence-http.json'),JSON.stringify({kind:'REAL_AUTH_OWNER_INTELLIGENCE_PULSE_CONTEXT_TIMELINE_HTTP',sha:process.env.LOCAL_OPERATIONS_SOURCE_SHA,phase,failure,evidence,distributions:Object.fromEntries(Object.entries(samples).map(([key,values])=>{const sorted=[...values].sort((a,b)=>a-b);return [key,{samples:values.length,p95Ms:values.length===20?sorted[18]:null,maxMs:sorted.at(-1)??null}];})),qualification:false,limitations:'One actual owner session,20cycles of3parallel real PostgREST RPCs after3warmups. Production client parsers retained. Pulse confirmed event-day registrations/unique canonical identities independently compared with owner source reads;confirmed entries are not assumed to equal paid buys or financial rake. Context/timeline transport+parse,not chart render,source-to-Intelligence propagation latency,fullLiveOps adapter,AI provider or mixed1000spectator load. Partial source states remain partial.'},null,2));
 const names={pulse:'get_series_club_live_pulse_v1',context:'get_ops_intelligence_context_v1',timeline:'get_ops_intelligence_timeline_v1'} as const;
 const args=(key:keyof typeof names,clubId=club)=>key==='timeline'?{p_club_id:clubId,p_tournament_id:tour}:{p_club_id:clubId};
 const call=async(key:keyof typeof names,token=owner,clubId=club)=>{const started=performance.now(),response=await fetch(api+'/rest/v1/rpc/'+names[key],{method:'POST',headers:headers(token),body:JSON.stringify(args(key,clubId)),signal:AbortSignal.timeout(5000)});const value=await response.json();return {response,value,ms:performance.now()-started};};
 const accepted=async(key:keyof typeof names,graded:boolean)=>{const result=await call(key);if(!result.response.ok)failure={rpc:names[key],status:result.response.status,code:typeof result.value?.code==='string'&&/^(?:[0-9A-Z]{5}|PGRST\d{3})$/.test(result.value.code)?result.value.code:null,messageSha256:typeof result.value?.message==='string'?createHash('sha256').update(result.value.message).digest('hex'):null};expect(result.response.ok,names[key]).toBe(true);const value=key==='pulse'?parseSeriesClubLivePulseV1(result.value):key==='context'?parseOpsIntelligenceContextV1(result.value,club):parseOpsIntelligenceTimelineV1(result.value,club,tour);if(graded)samples[key].push(result.ms);return value;};
 const read=async(path:string)=>{const response=await fetch(api+'/rest/v1/'+path,{headers:headers(owner),signal:AbortSignal.timeout(5000)});expect(response.ok,path.split('?')[0]).toBe(true);return response.json();};
 try{
  phase='authority';for(const key of ['pulse','context','timeline'] as const){expect((await call(key,staff[0].token)).response.status).toBe(403);expect((await call(key,owner,'ad200000-0000-4000-8000-000000000002')).response.status).toBe(403);}
  phase='source-comparison';const pulse=parseSeriesClubLivePulseV1((await call('pulse')).value);expect(pulse.clubId).toBe(club);expect(pulse.timezone).toBeTruthy();expect(pulse.clubLocalDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  const dayOf=(value:string)=>{const parts=new Intl.DateTimeFormat('en',{timeZone:pulse.timezone!,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(value));return ['year','month','day'].map(type=>parts.find(part=>part.type===type)!.value).join('-');};
  const tours=(await read('tournaments?select=id,start_time,status,deleted_at&club_id=eq.'+club)).filter((row:{start_time:string|null;status:string;deleted_at:string|null})=>row.deleted_at===null&&row.status!=='cancelled'&&row.start_time!==null&&dayOf(row.start_time)===pulse.clubLocalDate);expect(tours.length).toBeGreaterThan(0);
  const registrations=await read('tournament_registrations?select=id,player_id,tournament_id,status&tournament_id=in.('+tours.map((t:{id:string})=>t.id).join(',')+')&status=eq.confirmed');expect(registrations.length).toBeGreaterThanOrEqual(40);
  type Entry={id:string;registration_id:string;tournament_id:string;member_id:string|null;created_at:string|null};
  const entries=await read('tournament_entries?select=id,registration_id,tournament_id,member_id,created_at&registration_id=in.('+registrations.map((r:{id:string})=>r.id).join(',')+')') as Entry[];
  let usedFallback=false;const identities=registrations.map((registration:{id:string;tournament_id:string;player_id:string})=>{const matching=entries.filter(e=>e.registration_id===registration.id&&e.tournament_id===registration.tournament_id).sort((a,b)=>{const at=a.created_at===null?Infinity:Date.parse(a.created_at),bt=b.created_at===null?Infinity:Date.parse(b.created_at);return (at===bt?0:at-bt)||a.id.localeCompare(b.id);});const member=matching[0]?.member_id;if(!member)usedFallback=true;return member??registration.player_id;});
  const unique=new Set(identities).size;expect(unique).toBeGreaterThanOrEqual(20);expect(pulse.entriesToday.value).toBe(registrations.length);expect(pulse.entriesToday.availability).toBe('exact');expect(pulse.uniquePlayersToday.value).toBe(unique);expect(pulse.uniquePlayersToday.availability).toBe(usedFallback?'partial':'exact');
  const context=parseOpsIntelligenceContextV1((await call('context')).value,club);expect(context.dailyTournaments.some(t=>t.tournamentId===tour)).toBe(true);const timeline=parseOpsIntelligenceTimelineV1((await call('timeline')).value,club,tour);
  evidence={confirmedRegistrations:registrations.length,uniqueCanonicalIdentities:unique,usedFallbackIdentity:usedFallback,clubLocalDate:pulse.clubLocalDate,timezone:pulse.timezone,entriesAvailability:pulse.entriesToday.availability,uniqueAvailability:pulse.uniquePlayersToday.availability,contextTourPresent:true,timelineAvailability:{entries:timeline.entries.availability,tables:timeline.tables.availability,dealers:timeline.dealers.availability},ownerOnlyAndCrossTenantDenied:true};report();
  phase='warmup';for(let n=0;n<3;n++)await Promise.all((['pulse','context','timeline'] as const).map(key=>accepted(key,false)));
  phase='graded';for(let n=0;n<20;n++)await Promise.all((['pulse','context','timeline'] as const).map(key=>accepted(key,true)));for(const values of Object.values(samples))expect(values).toHaveLength(20);phase='passed';report();
 }catch(error){phase+='-failed';report();throw error;}
});

test('inactive earned staff salary HTTP preserves approved period roster',async({page})=>{
 test.skip(process.env.LOCAL_OPERATIONS_STAFF_SALARY_ENABLED!=='1','Exact current salary contracts after all existing operational proofs');test.setTimeout(120_000);
 const lateActor=await loginOwner(page),staff=await loginFixtureStaff(),owner=staff[19].token,api=process.env.LOCAL_SUPABASE_URL!.replace(/\/$/,''),anon=process.env.LOCAL_SUPABASE_ANON_KEY!;
 const club='af200000-0000-4000-8000-000000000001',id=(n:number)=>'af100000-0000-4000-8000-'+String(n).padStart(12,'0');
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Ho_Chi_Minh',year:'numeric',month:'numeric'}).formatToParts(new Date());
 const period={p_club_id:club,p_year:Number(parts.find(p=>p.type==='year')!.value),p_month:Number(parts.find(p=>p.type==='month')!.value)};
 const headers=(token:string)=>({apikey:anon,Authorization:`Bearer ${token}`,'Content-Type':'application/json'});
 const timings:Record<string,number[]>={};let phase='preconditions';let evidence:Record<string,unknown>={};
 const report=()=>writeFileSync(process.env.LOCAL_OPERATIONS_LATENCY_REPORT!.replace(/\.json$/,'-staff-salary-http.json'),JSON.stringify({kind:'REAL_AUTH_STAFF_SALARY_HTTP_INACTIVE_AND_FROZEN_ROSTER',sha:process.env.LOCAL_OPERATIONS_SOURCE_SHA,phase,evidence,timings:Object.fromEntries(Object.entries(timings).map(([key,values])=>{const sorted=[...values].sort((a,b)=>a-b);return [key,{samples:values.length,p95Ms:values.length===20?sorted[18]:null,maxMs:sorted.at(-1)??null}];})),qualification:false,limitations:'Twenty real Auth staff self-checkins/checkouts and owner offboarding/reads in one synthetic month;one freeze/submit/approval and20concurrent post-approval freeze attempts. Direct authenticated HTTP and independent table reads;not UI/Realtime/provider/payroll payment/mixed1000viewer capacity. Exact current production salary definitions restored,including existing period lock,post-wait authority and submitted/approved guards;no substitute implementation used.'},null,2));
 const rpc=async(token:string,name:string,args:Record<string,unknown>,metric?:string,expectedStatus=200)=>{
  const started=performance.now(),response=await fetch(api+'/rest/v1/rpc/'+name,{method:'POST',headers:headers(token),body:JSON.stringify(args),signal:AbortSignal.timeout(10000)});
  const data=await response.json();if(metric)(timings[metric]??=[]).push(performance.now()-started);expect(response.status,name).toBe(expectedStatus);return data;
 };
 const upsert=(n:number,status:string,metric?:string)=>rpc(owner,'staff_upsert',{p_club_id:club,p_staff_id:id(n),p_full_name:'Staff salary HTTP TEST '+n,p_department:'service',p_employment_type:'full_time',p_monthly_salary_vnd:2600000,p_manual_bhxh_vnd:0,p_manual_tax_vnd:0,p_status:status},n<=20?metric:undefined);
 const runs=async()=>{const response=await fetch(api+'/rest/v1/staff_salary_runs?select=*&club_id=eq.'+club+'&period_year=eq.'+period.p_year+'&period_month=eq.'+period.p_month+'&order=id',{headers:headers(owner),signal:AbortSignal.timeout(5000)});expect(response.ok).toBe(true);const data=await response.json();expect(Array.isArray(data)).toBe(true);return data;};
 const periodSnapshot=async()=>{const response=await fetch(api+'/rest/v1/staff_salary_periods?select=*&club_id=eq.'+club+'&period_year=eq.'+period.p_year+'&period_month=eq.'+period.p_month,{headers:headers(owner),signal:AbortSignal.timeout(5000)});expect(response.ok).toBe(true);const data=await response.json();expect(data).toHaveLength(1);expect(data[0].status).toBe('approved');return data;};
 try{
  await rpc(staff[0].token,'get_staff_salary_month',period,undefined,403);
  phase='attendance-and-inactive';
  for(let n=1;n<=20;n++){
   expect((await rpc(staff[n-1].token,'staff_check_in',{p_staff_id:id(n)},'selfCheckin')).outcome).toBe('checked_in');
   expect((await upsert(n,'inactive','blockedOffboard')).error).toBe('STAFF_CHECKOUT_REQUIRED');
   if(n===1)await rpc(owner,'staff_check_out',{p_staff_id:id(n)},undefined,403);
   expect((await rpc(staff[n-1].token,'staff_check_out',{p_staff_id:id(n)},'selfCheckout')).outcome).toBe('checked_out');
   expect((await upsert(n,'inactive','offboard')).status).toBe('ok');
  }
  phase='earned-preview';
  for(let n=0;n<20;n++){
   const month=await rpc(owner,'get_staff_salary_month',period,'earnedMonthRead');expect(month.staff).toHaveLength(20);
   expect(month.staff.every((s:{worked_days:number;net_vnd:number})=>s.worked_days===1&&s.net_vnd===100000)).toBe(true);
  }
  phase='freeze-and-approve';
  const frozen=await rpc(owner,'chot_staff_salary_month',period);expect(frozen.locked_now).toBe(20);expect(frozen.total_net_vnd).toBe(2000000);
  expect((await rpc(owner,'chot_staff_salary_month',period)).locked_now).toBe(0);
  expect((await rpc(owner,'submit_staff_salary_month',{...period,p_note:'Synthetic HTTP qualification;no provider'})).status).toBe('submitted');
  expect((await rpc(owner,'approve_staff_salary_month',period)).status).toBe('approved');
  const before=await runs();expect(before).toHaveLength(20);expect(before.reduce((sum:number,r:{net_vnd:number})=>sum+r.net_vnd,0)).toBe(2000000);
  const approvedPeriodBefore=await periodSnapshot();
  phase='late-earned-after-approval';
  expect((await upsert(21,'active')).status).toBe('ok');
  expect((await rpc(lateActor,'staff_check_in',{p_staff_id:id(21)})).outcome).toBe('checked_in');
  expect((await rpc(lateActor,'staff_check_out',{p_staff_id:id(21)})).outcome).toBe('checked_out');
  expect((await upsert(21,'inactive')).status).toBe('ok');
  phase='approved-roster-concurrent-freeze';
  const repeated=await Promise.all(Array.from({length:20},()=>rpc(owner,'chot_staff_salary_month',period,'approvedFreeze')));
  const after=await runs();evidence={beforeRuns:before.length,afterRuns:after.length,beforeNet:before.reduce((sum:number,r:{net_vnd:number})=>sum+r.net_vnd,0),afterNet:after.reduce((sum:number,r:{net_vnd:number})=>sum+r.net_vnd,0),lockedNow:repeated.map(r=>r.locked_now),checkoutBeforeInactive:true};report();
  const approvedPeriodAfter=await periodSnapshot();expect(approvedPeriodAfter).toEqual(approvedPeriodBefore);
  expect(repeated.every(r=>r.locked_now===0),'Approved period must refuse roster extension').toBe(true);expect(after).toEqual(before);
  phase='passed';report();
 }catch(error){phase+='-failed';report();throw error;}
});

test('current owner rake closes once and exports the immutable event-day snapshot',async({page})=>{
 test.skip(process.env.LOCAL_OPERATIONS_BUY_CLOSE_ENABLED!=='1','Fourth isolated stage after reentry conservation');test.setTimeout(120_000);
 const owner=await loginOwner(page),staff=await loginFixtureStaff(),api=process.env.LOCAL_SUPABASE_URL!.replace(/\/$/,''),anon=process.env.LOCAL_SUPABASE_ANON_KEY!,club='a2000000-0000-4000-8000-000000000001',tour='a3000000-0000-4000-8000-000000000001';
 const headers=(token:string)=>({apikey:anon,Authorization:`Bearer ${token}`,'Content-Type':'application/json'});
 let rpcFailure:{operation:string;kind:string;httpStatus:number|null;serverCode:string|null}|null=null;
 const rpc=async(token:string,name:string,args:Record<string,unknown>)=>{const started=performance.now();let status:number|undefined;try{const response=await fetch(api+'/rest/v1/rpc/'+name,{method:'POST',headers:headers(token),body:JSON.stringify(args),signal:AbortSignal.timeout(5000)});status=response.status;const data=await response.json();if(!response.ok)rpcFailure??={operation:name,...audienceFailure(data,status)};expect(response.ok,name).toBe(true);return {data,ms:performance.now()-started};}catch(cause){rpcFailure??={operation:name,...audienceFailure(cause,status)};throw cause;}};
 const finalReads:number[]=[],liveReads:number[]=[];let phase='open',closeRace:unknown=null,visibleMs:number|null=null,downloadMs:number|null=null;
 const dist=(values:number[])=>{const sorted=[...values].sort((a,b)=>a-b);return {samples:sorted.length,p95Ms:sorted.length===20?sorted[18]:null,maxMs:sorted.at(-1)??null};};
 const report=()=>writeFileSync(process.env.LOCAL_OPERATIONS_LATENCY_REPORT!.replace(/\.json$/,'-buy-close-rake-export-http.json'),JSON.stringify({kind:'REAL_AUTH_BUY_CLOSE_OWNER_RAKE_AND_BROWSER_CSV',sha:process.env.LOCAL_OPERATIONS_SOURCE_SHA,phase,rpcFailure,liveReads:dist(liveReads),finalReads:dist(finalReads),closeRace,ui:{samples:downloadMs===null?0:1,closeToExportEnabledMs:visibleMs,clickToDownloadedCsvMs:downloadMs},qualification:false,limitations:'One populated tour closure with20concurrent authorized cashier requests,not20independent closures. Twenty serial owner reads each before/after closure;one actual Finance TourRevenuePanel CSV download. Exact current six-function revenue family;existing combined Finance wrapper remains the captured fixture version and is not qualified by this test. Production-matching absent tournament/registration CDC means the real5s panel reconciliation must observe closure. No mixed1000-viewer capacity claim.'},null,2));
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
  phase='close-race';const started=performance.now();const outcomes=await Promise.allSettled(staff.map(identity=>rpc(identity.token,'close_tournament_buy_v1',{p_tournament_id:tour})));
  // Drain every real request before reporting a failed race or leaving this test.
  const closed=outcomes.map(result=>{if(result.status==='rejected')throw Error('BUY_CLOSE_CONCURRENT_RPC_FAILED');return result.value;});
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
