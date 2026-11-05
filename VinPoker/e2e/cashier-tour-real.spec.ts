import { expect, test, type Page } from "@playwright/test";
import {readFileSync,writeFileSync} from 'node:fs';
import {createClient} from '@supabase/supabase-js';

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
 test.setTimeout(120_000);
 expect(process.env.LOCAL_OPERATIONS_SOURCE_SHA).toMatch(/^[a-f0-9]{40}$/);
 const fixture=JSON.parse(readFileSync(process.env.LOCAL_OPERATIONS_DEALER_FILE!,'utf8')) as {
  clubId:string;shiftId:string;dealerIds:string[];otherClubId:string;otherShiftId:string;otherDealerId:string;otherAttendedDealerId:string;
 };
 expect(fixture.clubId).toBe('a2000000-0000-4000-8000-000000000001');
 const expectedCount=process.env.LOCAL_OPERATIONS_REALTIME==='1'?361:360;
 expect(fixture.dealerIds).toHaveLength(expectedCount);expect(new Set(fixture.dealerIds).size).toBe(expectedCount);
 for(const id of [fixture.clubId,fixture.shiftId,fixture.otherClubId,fixture.otherShiftId,fixture.otherDealerId,fixture.otherAttendedDealerId,...fixture.dealerIds])expect(id).toMatch(/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/);
 const identities=await loginFixtureStaff(),api=process.env.LOCAL_SUPABASE_URL!.replace(/\/$/,''),anon=process.env.LOCAL_SUPABASE_ANON_KEY!;
 const realtimeEnabled=process.env.LOCAL_OPERATIONS_REALTIME==='1';
 const seen=new Map<string,number>(),expectedDealers=new Set(fixture.dealerIds),realtimeErrors:string[]=[];
 const realtimeStatuses:string[]=[],systemEvents:{status:string;extension:string;category:string}[]=[];
 let observer:ReturnType<typeof createClient>|undefined,observing=false,duplicateEvents=0;
 let uiObservation:{writeToVisibleMs:number;samples:number;path:string}|null=null;
 try{
 if(realtimeEnabled){
  observer=createClient(api,anon,{accessToken:async()=>identities[19].token,auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
  await observer.realtime.setAuth(identities[19].token);
  await new Promise<void>((resolve,reject)=>{
   const timeout=setTimeout(()=>reject(Error('CHECKIN_REALTIME_JOIN_TIMEOUT')),15000);
   observer!.channel('isolated-checkin-observer').on('system',{},payload=>{
    // Persist only classifications, never raw server messages or JWTs.
    const message=String(payload.message??'').toLowerCase();
    systemEvents.push({status:String(payload.status??'').slice(0,40),extension:String(payload.extension??'').slice(0,40),category:
     /permission|privilege|denied/.test(message)?'permission':/publication/.test(message)?'publication':/connect|timeout/.test(message)?'connection':/subscribed/.test(message)?'subscribed':'other'});
   }).on('postgres_changes',{event:'INSERT',schema:'public',table:'dealer_attendance'},payload=>{
    const row=payload.new;
    if(!expectedDealers.has(row.dealer_id)||row.status!=='checked_in'||row.current_state!=='available'){realtimeErrors.push('unexpected_scope_or_state');return;}
    if(seen.has(row.dealer_id))duplicateEvents++;else seen.set(row.dealer_id,performance.now());
   }).subscribe(status=>{
    realtimeStatuses.push(status);
    if(status==='SUBSCRIBED'){clearTimeout(timeout);resolve();}
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
 const samples:{concurrency:number;graded:number;firstAckMs:number[];independentReadAfterAckMs:number[];writeToObservedMs:number[];retryAckMs:number[];writeToRealtimeMs:number[]}[]=[];
 const write=async()=>{
  const index=cursor++,identity=identities[index%identities.length],dealerId=fixture.dealerIds[index],requestId=crypto.randomUUID();
  expect(dealerId).toBeTruthy();
  const args={p_dealer_id:dealerId,p_club_id:fixture.clubId,p_shift_id:fixture.shiftId,p_request_id:requestId};
  let uiDealerName:string|null=null;
  if(realtimeEnabled&&index===360){
   // Observe one new check-in in the existing product screen. Never reload or
   // trigger a manual refresh after the write to manufacture synchronization.
   const response=await fetch(api+'/rest/v1/dealers?select=full_name&id=eq.'+dealerId,{headers:headers(identity.token),signal:AbortSignal.timeout(5000)});
   expect(response.ok).toBe(true);const names=await response.json();expect(names).toHaveLength(1);
   uiDealerName=names[0].full_name;expect(typeof uiDealerName).toBe('string');
   await loginOwner(page);await page.setViewportSize({width:1440,height:1000});
   const initialAttendance=page.waitForResponse(response=>{
    const url=new URL(response.url()),select=url.searchParams.get('select')??'';
    return response.request().method()==='GET'&&url.pathname==='/rest/v1/dealer_attendance'&&url.searchParams.get('status')==='eq.checked_in'&&select.includes('dealers!inner(')&&select.includes('worked_minutes_since_last_break');
   },{timeout:30_000});
   await page.goto('/dealer-swing');
   const initialResponse=await initialAttendance;expect(initialResponse.ok()).toBe(true);
   const initialRows=await initialResponse.json();expect(Array.isArray(initialRows)).toBe(true);
   expect(initialRows).toHaveLength(360);
   expect(initialRows.some((row:{dealer_id:string})=>row.dealer_id===dealerId)).toBe(false);
   const search=page.getByPlaceholder('Tìm dealer...');
   await expect(search).toBeVisible({timeout:30_000});
   await expect(page.getByText(initialRows[0].dealers.full_name,{exact:true})).toBeVisible();
   await search.fill(uiDealerName!);
   await expect(page.getByText(uiDealerName!,{exact:true})).toHaveCount(0);
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
   const deadline=performance.now()+5000;
   while(!seen.has(dealerId)&&performance.now()<deadline)await new Promise(resolve=>setTimeout(resolve,10));
   expect(seen.has(dealerId),'Every committed check-in must reach the independent authenticated WebSocket observer').toBe(true);
   writeToRealtimeMs=seen.get(dealerId)!-started;
   if(uiDealerName){
    await expect(page.getByText(uiDealerName,{exact:true})).toBeVisible({timeout:5000});
    uiObservation={writeToVisibleMs:performance.now()-started,samples:1,path:'/dealer-swing'};
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
 // The separate UI write starts only after all measured concurrent writers
 // finish. Its sample is excluded from the 1/5/20 HTTP/WS distributions.
 if(realtimeEnabled)await write();
 expect(cursor).toBe(expectedCount);
 expect(realtimeErrors).toEqual([]);if(realtimeEnabled)expect(seen.size).toBe(expectedCount);
 const summarize=(values:number[])=>{const ordered=[...values].sort((a,b)=>a-b);expect(ordered).toHaveLength(100);expect(ordered.every(v=>Number.isFinite(v)&&v>=0)).toBe(true);return {p50Ms:ordered[49],p95Ms:ordered[94],p99Ms:ordered[98],maxMs:ordered[99]};};
 writeFileSync(process.env.LOCAL_OPERATIONS_CHECKIN_REPORT!,JSON.stringify({kind:realtimeEnabled?'REAL_AUTH_HTTP_CHECKIN_AND_POSTGRES_CHANGES_WEBSOCKET_OBSERVATION':'REAL_AUTH_HTTP_CHECKIN_COMMIT_AND_INDEPENDENT_DATA_API_OBSERVATION',sha:process.env.LOCAL_OPERATIONS_SOURCE_SHA,actors:identities.length,actorScope:'Distinct local Auth users with actual club_dealer_controls membership;round-robin requests',fixtureSchemaAdditions:['exact14','exact51'],warmupPerScenario:20,gradedPerScenario:100,
  realtime:{enabled:realtimeEnabled,observers:realtimeEnabled?1:0,uniqueEvents:seen.size,duplicateEvents,errors:realtimeErrors,clock:'write-start and actual SDK callback use same monotonic client clock;not pure server-commit timing',postgresImage:realtimeEnabled?'17.6.1.155 pinned digest;see harness':'CLI default'},
  uiObservation,uiObservationLimitations:'One live Dealer Swing screen/new dealer sample;Node monotonic write-start to Playwright visible assertion upper bound;no p95 or concurrent screen capacity claim',
  scenarios:samples.map(row=>({...row,distributions:{firstAck:summarize(row.firstAckMs),independentReadAfterAck:summarize(row.independentReadAfterAckMs),writeToObserved:summarize(row.writeToObservedMs),retryAck:summarize(row.retryAckMs),writeToRealtime:realtimeEnabled?summarize(row.writeToRealtimeMs):null}})),crossTenantDenied:true,crossActorReceiptUnknown:true,exactRetryMatched:true,qualification:false,
  limitations:'360synthetic dealers;small fixture;HTTP acknowledgment and independent committed-state read;optional one real WS observer with20writers,not20observers or UI rendering;no production capacity claim;native SQL postcheck additionally verifies attendance/receipt cardinality.'},null,2));
 }catch(error){
  if(realtimeEnabled)writeFileSync(process.env.LOCAL_OPERATIONS_CHECKIN_REPORT!,JSON.stringify({kind:'CHECKIN_REALTIME_FAILED_DIAGNOSTIC',sha:process.env.LOCAL_OPERATIONS_SOURCE_SHA,qualification:false,realtimeStatuses,systemEvents,uniqueEvents:seen.size,duplicateEvents,errors:realtimeErrors,reason:'Actual check-in/observer assertions failed;see sanitized test assertion output'},null,2));
  throw error;
 }finally{observing=false;if(observer){await observer.removeAllChannels();await observer.realtime.disconnect();}}
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
