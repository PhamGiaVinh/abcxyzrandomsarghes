import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {randomUUID,webcrypto} from 'node:crypto';
import ts from 'typescript';
import {createPaidJourneyFixture} from './paidJourney.fixture.mjs';

export async function runSePayPullPagingNative(sql,{crash=false,loseCheckpointResponse=false,insertBackdated=false}={}){
 assert.equal(process.env.VINPOKER_NATIVE_PAYOUT,'1');
 const f=createPaidJourneyFixture(sql),account='TEST-'+randomUUID(),bank=randomUUID();
 const quote=value=>`'${String(value).replaceAll("'","''")}'`;
 sql(`INSERT INTO public.platform_bank_accounts(club_id,bank_name,account_number,account_holder,is_active)
  VALUES('${f.club}','LOCAL TEST BANK','${account}','NO REAL ACCOUNT',true);
  INSERT INTO public.club_payment_config(club_id,master_account_number,api_token_vault_key,is_active)
  VALUES('${f.club}','${account}','LOCAL_TEST_NOT_A_SECRET',true);`);
 const money=()=>sql(`SELECT md5(jsonb_build_object(
  'cash',(SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM public.cashier_buyin_movements m WHERE tournament_id='${f.tour}'),
  'entries',(SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM public.tournament_entries e WHERE tournament_id='${f.tour}'),
  'seats',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.tournament_seats s WHERE tournament_id='${f.tour}'),
  'receipts',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.seat_draw_receipts r WHERE tournament_id='${f.tour}'))::text);`);
 const before=money();
 const service=q=>JSON.parse(sql(`BEGIN;SET LOCAL request.jwt.claim.sub='';SET LOCAL request.jwt.claim.role='service_role';
  SET LOCAL request.jwt.claims='{"role":"service_role"}';SET LOCAL ROLE service_role;${q}COMMIT;`));
 const stamp=Date.now()-3600000;
 // Outgoing bank audit rows exercise ingestion paging, never buy-in settlement.
 const rows=Array.from({length:503},(_,i)=>({id:randomUUID(),account_number:account,bank_account_id:bank,
  transfer_type:'out',amount_out:1,amount_in:0,transaction_content:'UNMATCHED LOCAL PAGING TEST',
  transaction_date:new Date(stamp+i*1000+7*3600000).toISOString().slice(0,19).replace('T',' ')}));
 let handler,drop=crash||loseCheckpointResponse;const events=[],pages=[];
 const progress=()=>JSON.parse(sql(`SELECT to_jsonb(p) FROM private.sepay_pull_progress_v1 p WHERE club_id='${f.club}';`));
 const count=()=>Number(sql(`SELECT count(*) FROM public.bank_transactions WHERE provider='sepay' AND account_number='${account}';`));
 const bankFingerprint=()=>sql(`SELECT md5(jsonb_agg(to_jsonb(b) ORDER BY provider_txn_id)::text) FROM public.bank_transactions b WHERE provider='sepay' AND account_number='${account}';`);
 const admin={rpc:async(name,args)=>{
  events.push(name);
  if(name==='sepay_get_active_payment_clubs')return {data:[{club_id:f.club,master_account_number:account}],error:null};
  if(name==='sepay_get_club_api_token')return {data:'LOCAL_TEST_TOKEN',error:null};
  if(name==='sepay_claim_pull_v2'){
   assert.deepEqual(JSON.parse(JSON.stringify(args)),{p_club_id:f.club,p_bank_account_id:bank});
   return {data:service(`SELECT public.sepay_claim_pull_v2('${f.club}','${bank}');`),error:null};
  }
  if(name==='sepay_ingest_verified_transactions'){
   assert.ok(args.p_txns.length>0&&args.p_txns.length<=500);
   assert.ok(args.p_txns.every(row=>row.account_number===account&&row.transfer_type==='out'));
   return {data:service(`SELECT public.sepay_ingest_verified_transactions(${quote(JSON.stringify(args.p_txns))}::jsonb);`),error:null};
  }
  if(name==='sepay_checkpoint_pull_v2'){
   assert.equal(args.p_club_id,f.club);assert.match(args.p_lease_token,/^[a-f0-9-]{36}$/i);
   if(drop&&!loseCheckpointResponse){drop=false;return {data:null,error:{message:'LOCAL_CRASH_AFTER_INGEST_BEFORE_CHECKPOINT'}};}
   const data=service(`SELECT public.sepay_checkpoint_pull_v2('${f.club}','${args.p_lease_token}',${args.p_expected_page},${args.p_next_page},${args.p_complete},${args.p_provider_total});`);
   if(drop){drop=false;return {data:null,error:{message:'LOCAL_RESPONSE_LOST_AFTER_CHECKPOINT'}};}
   return {data,error:null};
  }
  if(name==='sepay_take_settlement_batch_v1'){
   const data=service(`SELECT coalesce(jsonb_agg(to_jsonb(q)),'[]'::jsonb) FROM public.sepay_take_settlement_batch_v1('${f.club}',500)q;`);
   assert.deepEqual(data,[],'outgoing rows must not enter incoming payment worklist');return {data,error:null};
  }
  if(name==='cashier_retry_paid_seating_v1')return {data:{ok:true,attempted:0,seated:0,needs_review:0},error:null};
  throw Error('Unexpected financial RPC '+name);
 },from:table=>{
  assert.ok(['cashier_tour_settings','club_payment_config'].includes(table));
  const b={select:()=>b,eq:(_key,value)=>{assert.equal(value,f.club);return b;},update:value=>{assert.equal('last_pull_at'in value,false);return b;},
   maybeSingle:async()=>({data:{enabled:true},error:null}),then:(resolve,reject)=>Promise.resolve({data:null,error:null}).then(resolve,reject)};return b;
 }};
 const source=readFileSync('supabase/functions/sepay-reconcile/index.ts','utf8')
  .replace(/import \{ createClient \} from "https:[^\n]+\n/,'').replace(/import \{ retryFetch \} from "[^\n]+\n/,'');
 runInNewContext(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{
  createClient:()=>admin,retryFetch:async input=>{
   const url=new URL(input);
   if(url.pathname==='/v2/bank-accounts')return new Response(JSON.stringify({data:[{id:bank,account_number:account,active:true}],meta:{pagination:{has_more:false}}}));
   assert.equal(url.pathname,'/v2/transactions');assert.equal(url.searchParams.get('bank_account_id'),bank);
   assert.equal(url.searchParams.get('per_page'),'100');const page=Number(url.searchParams.get('page'));
   assert.ok(page>=1&&page<=6);pages.push({page,from:url.searchParams.get('transaction_date_from'),to:url.searchParams.get('transaction_date_to')});
   return new Response(JSON.stringify({data:rows.slice((page-1)*100,page*100),meta:{pagination:{total:rows.length,current_page:page,last_page:6,has_more:page<6}}}));
  },Deno:{env:{get:key=>({SUPABASE_URL:'http://local.invalid',SUPABASE_SERVICE_ROLE_KEY:'LOCAL_TEST',SEPAY_RECONCILE_SECRET:'LOCAL_TEST',SEPAY_AUTO_CONFIRM:'false'}[key])},serve:fn=>{handler=fn;}},
  Request,Response,TextEncoder,crypto:webcrypto,console:{error:()=>{}},Date,Uint8Array,
 });
 const tick=async()=>{const res=await handler(new Request('http://local.invalid/reconcile',{method:'POST',headers:{'X-Reconcile-Secret':'LOCAL_TEST'}}));assert.equal(res.status,200);return res.json();};
 const first=await tick();assert.equal(first.ok,false);assert.equal(count(),500);const frozen=progress();
 assert.equal(sql(`SELECT last_pull_at IS NULL FROM public.club_payment_config WHERE club_id='${f.club}';`),'t');
 assert.ok(events.indexOf('sepay_ingest_verified_transactions')<events.indexOf('sepay_checkpoint_pull_v2'));
 if(crash){
  assert.equal(first.results[0].error,'sepay_pull_checkpoint_unverified');assert.equal(frozen.next_page,1);
  const bankBeforeReplay=bankFingerprint();
  sql(`UPDATE private.sepay_pull_progress_v1 SET lease_until=clock_timestamp()-interval '1 second' WHERE club_id='${f.club}';`);
  const replay=await tick();assert.equal(replay.results[0].pull_next_page,6);assert.equal(count(),500);
  assert.equal(bankFingerprint(),bankBeforeReplay,'replayed API pages cannot rewrite already-verified audit rows');
 }else{
  if(loseCheckpointResponse)assert.equal(first.results[0].error,'sepay_pull_checkpoint_unverified');
  else assert.equal(first.results[0].pull_next_page,6);
  assert.equal(frozen.next_page,6);
 }
 if(insertBackdated){
  assert.ok(!crash&&!loseCheckpointResponse,'independent insertion scenario only');
  rows.unshift({...rows[0],id:randomUUID(),transaction_date:new Date(stamp-1000+7*3600000).toISOString().slice(0,19).replace('T',' ')});
 }
 let final=await tick();
 if(insertBackdated){
  assert.equal(final.ok,false);assert.equal(final.results[0].error,'sepay_api_window_changed');
  assert.equal(progress().next_page,1);assert.equal(progress().completed,false);
  assert.equal(sql(`SELECT last_pull_at IS NULL FROM public.club_payment_config WHERE club_id='${f.club}';`),'t');
  const restart=await tick();assert.equal(restart.results[0].pull_next_page,6);
  final=await tick();
 }
 assert.equal(final.ok,true);const completed=progress();
 if(insertBackdated)console.log('SEPAY_INSERT_DURING_PROVIDER_PAGING_DIAGNOSTIC',JSON.stringify({tour:f.tour,providerRows:rows.length,persistedRows:count(),completed:completed.completed}));
 assert.equal(count(),rows.length,'every provider transaction in the frozen window must be retained');
 assert.equal(completed.completed,true);assert.equal(completed.window_from,frozen.window_from);assert.equal(completed.window_to,frozen.window_to);
 assert.equal(sql(`SELECT last_pull_at=window_to FROM public.club_payment_config c JOIN private.sepay_pull_progress_v1 p USING(club_id) WHERE club_id='${f.club}';`),'t');
 assert.equal(money(),before);assert.deepEqual(pages.map(row=>row.page),insertBackdated?[1,2,3,4,5,6,1,2,3,4,5,6]:crash?[1,2,3,4,5,1,2,3,4,5,6]:[1,2,3,4,5,6]);
 assert.deepEqual(JSON.parse(sql(`SELECT jsonb_agg(provider_txn_id ORDER BY provider_txn_id) FROM public.bank_transactions WHERE provider='sepay' AND account_number='${account}';`)),rows.map(row=>row.id).sort());
 assert.equal(new Set(pages.map(({from,to})=>JSON.stringify({from,to}))).size,1);
 console.log(insertBackdated?'SEPAY_BACKDATED_INSERT_RESTART_SAME_WINDOW_ALL504_NO_MONEY_DELTA_PASS':crash?'SEPAY_503_PROVIDER_REAL_INGEST_CRASH_RECLAIM_REPLAY_NO_DUPLICATE_PASS':loseCheckpointResponse?'SEPAY_503_PROVIDER_CHECKPOINT_COMMIT_LOST_RESPONSE_RESUME_PAGE6_PASS':'SEPAY_503_PROVIDER_TWO_TICKS_REAL_DB_INGEST_FIXED_WINDOW_NO_MONEY_DELTA_PASS',JSON.stringify({tour:f.tour,rows:rows.length,ticks:insertBackdated?4:crash?3:2}));
}
