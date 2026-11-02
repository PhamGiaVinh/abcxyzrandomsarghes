import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {randomUUID,webcrypto} from 'node:crypto';
import ts from 'typescript';
import {createPaidJourneyFixture} from './paidJourney.fixture.mjs';

export async function runSePayReconcileNative(sql,{backlog=false,webhook=false,waiting=false,session,until}={}) {
 assert.equal(process.env.VINPOKER_NATIVE_PAYOUT,'1');
 const f=createPaidJourneyFixture(sql,{reuseExistingPool714:true}),player=randomUUID();let failed=randomUUID();
 assert.equal(sql(`SELECT count(*) FROM public.club_settings WHERE club_id='${f.club}';`),'0');
 sql(`INSERT INTO public.club_settings(club_id,auto_swing_enabled) VALUES('${f.club}',false);`);
 let waitingScope=null;
 if(waiting){assert.equal(webhook,true);const {prepareSePayWaitingNative}=await import('./sepayWaiting.native.mjs');waitingScope=prepareSePayWaitingNative(sql,f,{session,until});}
 let first=randomUUID(),second=randomUUID();const failedIds=new Set([failed]);
 const account='TEST-'+randomUUID(),quote=value=>`'${String(value).replaceAll("'","''")}'`;
 const beforeSettings=JSON.parse(sql("SELECT coalesce(jsonb_agg(to_jsonb(s)),'[]'::jsonb) FROM public.sepay_system_settings s;"));
 assert.ok(beforeSettings.length<=1);
 const authDefinition=sql("SELECT pg_get_functiondef('auth.uid()'::regprocedure);");
 const role='sepay_test_'+randomUUID().replaceAll('-','');
 sql(`CREATE ROLE ${role} NOLOGIN INHERIT BYPASSRLS;GRANT service_role TO ${role};`);
 // Model only managed auth.uid's claims fallback transactionally, restoring it
 // before commit. Never put a human subject in service worker claims.
 const service=(q,{rollback=false}={})=>JSON.parse(sql(`BEGIN;CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid $$;
  SET LOCAL request.jwt.claim.role='service_role';SET LOCAL request.jwt.claims='{"role":"service_role"}';SET LOCAL ROLE ${role};
  ${q}RESET ROLE;${authDefinition};${rollback?'ROLLBACK':'COMMIT'};`));
 try {
  if(sql("SELECT to_regprocedure('public.sepay_take_settlement_batch_v1(uuid,integer)') IS NULL;")==='t')
   sql(readFileSync('supabase/migrations/20270128000142_sepay_settlement_fair_batch_v1.sql','utf8'));
  sql(`INSERT INTO auth.users(id) VALUES('${player}');
   INSERT INTO public.platform_bank_accounts(club_id,bank_name,account_number,account_holder,is_active)
   VALUES('${f.club}','LOCAL TEST BANK','${account}','NO REAL ACCOUNT',true);
   INSERT INTO public.sepay_system_settings(id,system_actor_id,auto_confirm_enabled) VALUES(true,'${f.actor}',true)
   ON CONFLICT(id) DO UPDATE SET system_actor_id=excluded.system_actor_id,auto_confirm_enabled=true;`);
  const reg=service(`SELECT public.cashier_create_app_registration_v1('${f.tour}','${player}');`);assert.equal(reg.ok,true);
  const reference=sql(`SELECT reference_code FROM public.tournament_registrations WHERE id='${reg.registration_id}';`);
  const bankRows=backlog?Array.from({length:502},()=>[randomUUID(),50000]):[[failed,1],[first,40000],[second,60000]];
  let providerRows=[];
  if(webhook){
   assert.equal(backlog,false);
   const {ingestSePayWebhookNative}=await import('./sepayWebhook.native.mjs');
   const ingested=await ingestSePayWebhookNative(sql,service,{fixture:f,account,bankRows,reference,failed});
   providerRows=ingested.apiRows;
   failed=ingested.ids.get('local-'+failed);first=ingested.ids.get('local-'+first);second=ingested.ids.get('local-'+second);
   assert.ok(failed&&first&&second);failedIds.clear();failedIds.add(failed);
  }else sql(`INSERT INTO public.bank_transactions
   (id,provider,provider_txn_id,account_number,amount,transfer_type,content,status,api_verified_at,raw_payload)
   VALUES ${bankRows.map(([id,amount])=>`('${id}','sepay','local-${id}','${account}',${amount},'in',${quote(id===failed?'UNMATCHED_TEST':reference)},'unmatched',now(),'{}')`).join(',')};`);
  sql(`INSERT INTO public.club_payment_config(club_id,master_account_number,api_token_vault_key,is_active)
   VALUES('${f.club}','${account}','LOCAL_TEST_NOT_A_VAULT_SECRET',true);`);
  assert.equal(sql(`SELECT has_function_privilege('anon','public.sepay_take_settlement_batch_v1(uuid,integer)','EXECUTE')
   OR has_function_privilege('authenticated','public.sepay_take_settlement_batch_v1(uuid,integer)','EXECUTE');`),'f');
  for(const limit of [0,501])assert.throws(()=>service(`SELECT * FROM public.sepay_take_settlement_batch_v1('${f.club}',${limit});`),/invalid_settlement_batch/);
  assert.throws(()=>service(`SELECT * FROM public.sepay_take_settlement_batch_v1('${randomUUID()}',500);`),/active_payment_account_required/);
  assert.throws(()=>service(`SET LOCAL request.jwt.claim.sub='${f.actor}';
   SELECT * FROM public.sepay_take_settlement_batch_v1('${f.club}',500);`),/service_role_required/);
  const excludedIds=Array.from({length:4},()=>randomUUID());
  sql(`INSERT INTO public.bank_transactions
   (id,provider,provider_txn_id,account_number,amount,transfer_type,content,status,api_verified_at,raw_payload)
   VALUES ${excludedIds.map((id,i)=>`('${id}','sepay','local-${id}','${i===0?'OTHER-'+account:account}',1,
    '${i===1?'out':'in'}','EXCLUDED_TEST','${i===2?'matched':'unmatched'}',${i===3?'NULL':'now()'},'{}')`).join(',')};`);
  const selection=`SELECT coalesce(jsonb_agg(jsonb_build_object('id',t.id)),'[]'::jsonb)
   FROM public.sepay_take_settlement_batch_v1('${f.club}',500) t;`;
  const rolledBack=service(selection,{rollback:true});
  assert.equal(rolledBack.length,webhook?0:Math.min(500,bankRows.length),
   'webhook events remain ineligible until independent API verification');
  assert.ok(rolledBack.every(row=>!excludedIds.includes(row.id)));
  assert.equal(sql(`SELECT count(*) FROM private.sepay_settlement_attempts a JOIN public.bank_transactions b
   ON b.id=a.bank_transaction_id WHERE b.account_number='${account}';`),'0');
  assert.deepEqual(service(selection,{rollback:true}),rolledBack,'aborted selection must not consume attempts');
  if(backlog){
   // Replace the local fixture auth stub once, not per worker: otherwise CREATE
   // FUNCTION's DDL lock would serialize the test before the advisory lock.
   sql(`CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
    SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;`);
   const name='sepay_overlap_'+randomUUID().replaceAll('-','');
   const a=session(name+'_a'),b=session(name+'_b');
   const one=`BEGIN;SET LOCAL request.jwt.claim.role='service_role';SET LOCAL ROLE ${role};
    SELECT jsonb_build_object('batch_id',id) FROM public.sepay_take_settlement_batch_v1('${f.club}',1);
    SELECT 'BATCH_READY';`;
   try {
    a.child.stdin.write(one+'\n');await until(()=>a.output().includes('BATCH_READY'));
    b.child.stdin.write(one+'\n');
    await until(()=>sql(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='${name}_b'
     AND wait_event_type='Lock' AND wait_event='advisory');`)==='t');
    a.child.stdin.end('COMMIT;\n');const outA=await a.closed;
    await until(()=>b.output().includes('BATCH_READY'));
    b.child.stdin.end('ROLLBACK;\n');const outB=await b.closed;
    const idOf=out=>JSON.parse(out.split('\n').find(line=>line.startsWith('{'))).batch_id;
    assert.notEqual(idOf(outA),idOf(outB),'second selector must observe committed attempt after waiting');
    assert.equal(sql(`SELECT count(*) FROM private.sepay_settlement_attempts a JOIN public.bank_transactions b
     ON b.id=a.bank_transaction_id WHERE b.account_number='${account}';`),'1');
    // Remove only this newly-created fixture's selection marker, no bank data.
    sql(`DELETE FROM private.sepay_settlement_attempts a USING public.bank_transactions b
     WHERE a.bank_transaction_id=b.id AND b.account_number='${account}';`);
    console.log('SEPAY_REAL_TWO_SESSION_ADVISORY_WAIT_FRESH_SELECTION_ROLLBACK_PASS');
   } finally {
    a.child.stdin.end();b.child.stdin.end();
    await Promise.allSettled([a.closed,b.closed]);sql(authDefinition);
   }
  }
  const worklist=limit=>service(`SELECT coalesce(jsonb_agg(t),'[]'::jsonb) FROM(SELECT id FROM public.bank_transactions
   WHERE provider='sepay' AND account_number='${account}' AND status='unmatched' AND transfer_type='in'
    AND api_verified_at IS NOT NULL ORDER BY id LIMIT ${limit}) t;`);
  if(backlog){
   failedIds.clear();for(const row of worklist(500))failedIds.add(row.id);
   const tail=bankRows.map(([id])=>id).filter(id=>!failedIds.has(id));assert.equal(tail.length,2);
   [first,second]=tail;
  }
  let handler;const calls=[],updates=[];
  // Provider/token/config are modeled; payment RPCs and commit results are real.
  const admin={rpc:async(name,args)=>{
   calls.push(name);
   if(name==='sepay_get_active_payment_clubs')return {data:[{club_id:f.club,master_account_number:account}],error:null};
   if(name==='sepay_get_club_api_token')return {data:'LOCAL_TEST_PROVIDER_TOKEN',error:null};
   if(name==='sepay_claim_pull_v2'){
    assert.deepEqual(JSON.parse(JSON.stringify(args)),{p_club_id:f.club,p_bank_account_id:'51100000-0000-4000-8000-000000000001'});
    return {data:service(`SELECT public.sepay_claim_pull_v2('${f.club}','${args.p_bank_account_id}');`),error:null};
   }
   if(name==='sepay_checkpoint_pull_v2'){
    assert.equal(args.p_club_id,f.club);assert.match(args.p_lease_token,/^[a-f0-9-]{36}$/i);
    assert.equal(args.p_expected_page,1);assert.equal(args.p_next_page,2);assert.equal(args.p_complete,true);
    assert.equal(args.p_provider_total,providerRows.length);
    return {data:service(`SELECT public.sepay_checkpoint_pull_v2('${f.club}','${args.p_lease_token}',1,2,true,${args.p_provider_total});`),error:null};
   }
   if(name==='sepay_ingest_verified_transactions'){
    assert.equal(webhook,true);assert.equal(args.p_txns.length,3);
    return {data:service(`SELECT public.sepay_ingest_verified_transactions('${JSON.stringify(args.p_txns).replaceAll("'","''")}'::jsonb);`),error:null};
   }
   if(name==='sepay_take_settlement_batch_v1'){
    assert.equal(args.p_club_id,f.club);assert.equal(args.p_limit,500);
    const data=service(`SELECT coalesce(jsonb_agg(jsonb_build_object('id',t.id)),'[]'::jsonb) FROM public.sepay_take_settlement_batch_v1('${f.club}',500) t;`);
    assert.ok(Array.isArray(data)&&data.length<=500&&data.every(row=>typeof row.id==='string'),JSON.stringify(data).slice(0,300));
    return {data,error:null};
   }
   if(name==='cashier_retry_paid_seating_v1')return {data:waiting?await waitingScope.retry(service,args):{ok:true,attempted:0,seated:0,needs_review:0},error:null};
   assert.equal(name,'cashier_record_verified_bank_v1');assert.equal(args.p_auto_confirm,true);
   assert.ok(failedIds.has(args.p_bank_transaction_id)||[first,second].includes(args.p_bank_transaction_id));
   if(failedIds.has(args.p_bank_transaction_id))return {data:null,error:{message:'LOCAL injected persistent unavailable'}};
   return {data:service(`SELECT public.cashier_record_verified_bank_v1('${args.p_bank_transaction_id}',true);`),error:null};
  },from:table=>{
   let writing=false,limit=0;const filters={};let verifiedFilter=false;
   const b={select:columns=>{if(table==='bank_transactions')assert.equal(columns,'id');return b;},
    eq:(key,value)=>{if(table==='bank_transactions')filters[key]=value;return b;},
    not:(key,operator,value)=>{if(table==='bank_transactions'){
      assert.equal(key,'api_verified_at');assert.equal(operator,'is');assert.equal(value,null);verifiedFilter=true;
     }return b;},limit:value=>{limit=value;return b;},
    update:value=>{assert.equal(table,'club_payment_config');updates.push(value);writing=true;return b;},
    maybeSingle:async()=>({data:table==='cashier_tour_settings'?{enabled:true}:{last_pull_at:null},error:null}),
    then:(resolve,reject)=>Promise.resolve().then(()=>{
     if(writing)return {data:null,error:null};assert.equal(table,'bank_transactions');
     assert.deepEqual(filters,{provider:'sepay',account_number:account,status:'unmatched',transfer_type:'in'});
     assert.equal(verifiedFilter,true);assert.equal(limit,500);return {data:worklist(limit),error:null};
    }).then(resolve,reject)};return b;}};
  const source=readFileSync('supabase/functions/sepay-reconcile/index.ts','utf8')
   .replace(/import \{ createClient \} from "https:[^\n]+\n/,'').replace(/import \{ retryFetch \} from "[^\n]+\n/,'');
  runInNewContext(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{
   createClient:()=>admin,retryFetch:async url=>{
    const target=new URL(url),bankId='51100000-0000-4000-8000-000000000001';
    if(target.pathname==='/v2/bank-accounts'){
     assert.equal(target.searchParams.get('q'),account);
     return new Response(JSON.stringify({data:[{id:bankId,account_number:account,active:true}],meta:{pagination:{has_more:false}}}),{status:200});
    }
    assert.equal(target.pathname,'/v2/transactions');assert.equal(target.searchParams.get('bank_account_id'),bankId);
    assert.equal(target.searchParams.get('per_page'),'100');assert.equal(target.searchParams.has('account_number'),false);
    assert.ok(target.searchParams.get('transaction_date_from'));assert.ok(target.searchParams.get('transaction_date_to'));
    return new Response(JSON.stringify({data:providerRows.map(row=>({...row,bank_account_id:bankId})),meta:{pagination:{total:providerRows.length,current_page:1,last_page:1,has_more:false}}}),{status:200});
   },
   Deno:{env:{get:key=>({SUPABASE_URL:'http://local.invalid',SUPABASE_SERVICE_ROLE_KEY:'LOCAL_TEST',SEPAY_RECONCILE_SECRET:'LOCAL_TEST',SEPAY_AUTO_CONFIRM:'true'}[key])},serve:fn=>{handler=fn;}},
   Request,Response,TextEncoder,crypto:webcrypto,console:{error:()=>{}},Date,Uint8Array,
  });
  const request=()=>new Request('http://local.invalid/reconcile',{method:'POST',headers:{'X-Reconcile-Secret':'LOCAL_TEST'}});
  const response=await handler(request());
  const body=await response.json();assert.equal(response.status,200);assert.equal(body.ok,false);
  if(backlog){
   const next=await handler(request()),nextBody=await next.json();assert.equal(next.status,200);
   assert.ok(body.results[0].attempted!==undefined,JSON.stringify(body));
   assert.ok(nextBody.results[0].attempted!==undefined,JSON.stringify(nextBody));
   assert.ok(body.results[0].attempted<=500&&nextBody.results[0].attempted<=500);
   console.log('SEPAY_BACKLOG_TWO_BOUNDED_TICKS_OBSERVED',JSON.stringify({first:body.results[0],second:nextBody.results[0]}));
  }else{
   assert.equal(body.settled,waiting?0:1,JSON.stringify(body));assert.equal(body.results[0].attempted,3);assert.equal(body.results[0].failed,1);
   assert.equal(body.results[0].partial,1);assert.equal(body.results[0].status,'partial');assert.equal(updates[0].last_pull_status,'error');
  }
  const readFacts=()=>JSON.parse(sql(`SELECT jsonb_build_object('movements',(SELECT count(*) FROM public.cashier_buyin_movements WHERE registration_id='${reg.registration_id}'),
   'amount',(SELECT sum(applied_amount) FROM public.cashier_buyin_movements WHERE registration_id='${reg.registration_id}'),
   'entries',(SELECT count(*) FROM public.tournament_entries WHERE registration_id='${reg.registration_id}'),
   'seats',(SELECT count(*) FROM public.tournament_seats s JOIN public.tournament_entries e ON e.id=s.entry_id WHERE e.registration_id='${reg.registration_id}' AND s.is_active),
   'receipts',(SELECT count(*) FROM public.seat_draw_receipts WHERE registration_id='${reg.registration_id}' AND status='issued'),
   'notifications',(SELECT count(*) FROM public.notifications WHERE user_id='${player}' AND data->>'registration_id'='${reg.registration_id}' AND data ? 'receipt_code'));`));
  if(waiting){
   assert.deepEqual(readFacts(),{movements:2,amount:100000,entries:0,seats:0,receipts:0,notifications:0});
   assert.deepEqual(waitingScope.retries,[{ok:true,attempted:1,seated:0,needs_review:0}]);
   waitingScope.open();const tick=await handler(request());assert.equal(tick.status,200);await tick.json();
   assert.deepEqual(waitingScope.retries.at(-1),{ok:true,attempted:1,seated:1,needs_review:0});
  }
  const facts=readFacts();
  assert.deepEqual(facts,{movements:2,amount:100000,entries:1,seats:1,receipts:1,notifications:1});
  const identities=JSON.parse(sql(`SELECT jsonb_agg(jsonb_build_object('entry',e.id,'player',e.player_id,'seat_entry',s.entry_id,
   'receipt_entry',r.entry_id,'receipt_code',r.receipt_code,'notice_receipt',n.data->>'receipt_code'))
   FROM public.tournament_entries e JOIN public.tournament_seats s ON s.entry_id=e.id AND s.is_active
   JOIN public.seat_draw_receipts r ON r.registration_id=e.registration_id AND r.status='issued'
   JOIN public.notifications n ON n.user_id='${player}' AND n.data->>'registration_id'=e.registration_id::text
    AND n.data->>'receipt_code'=r.receipt_code WHERE e.registration_id='${reg.registration_id}';`));
  assert.equal(identities.length,1);const identity=identities[0];assert.equal(identity.player,player);
  assert.equal(identity.seat_entry,identity.entry);assert.equal(identity.receipt_entry,identity.entry);
  assert.ok(identity.receipt_code);assert.equal(identity.notice_receipt,identity.receipt_code);
  if(webhook){
   const replay=await handler(request()),replayed=await replay.json();
   assert.equal(replay.status,200);assert.equal(replayed.ok,false);assert.equal(replayed.settled,0);
   assert.deepEqual(readFacts(),facts,'API ingest/reconcile replay must not duplicate payment, seat or notification');
   assert.equal(calls.filter(name=>name==='sepay_ingest_verified_transactions').length,waiting?3:2);
  }
  for(const id of [first,second])service(`SELECT public.cashier_record_verified_bank_v1('${id}',true);`);
  assert.deepEqual(readFacts(),facts,'provider transaction replay must not duplicate effects');
  assert.equal(sql("SELECT pg_get_functiondef('auth.uid()'::regprocedure);"),authDefinition);
  if(waiting){waitingScope.check();console.log('SEPAY_REAL_GLOBAL_RETRY_FLOOR_REOPEN_PAID_WAIT_SEAT_NO_NEW_MONEY_FOREIGN_HAND_UNCHANGED_PASS',JSON.stringify({tour:f.tour,retries:waitingScope.retries}));}
  console.log(backlog?'SEPAY_BACKLOG_TAIL_NOT_STARVED_REAL_PAYMENT_PASS':'SEPAY_ACTUAL_HANDLER_PARTIAL_FAILURE_REAL_BANK_SPLIT_SEAT_RECEIPT_INAPP_PASS',JSON.stringify({tour:f.tour,registration:reg.registration_id,facts}));
 } finally {
  if(beforeSettings.length){const old=beforeSettings[0];sql(`UPDATE public.sepay_system_settings SET system_actor_id=${old.system_actor_id?quote(old.system_actor_id)+'::uuid':'NULL'},auto_confirm_enabled=${old.auto_confirm_enabled} WHERE id;`);}
  else sql('DELETE FROM public.sepay_system_settings WHERE id;');
  const restored=JSON.parse(sql("SELECT coalesce(jsonb_agg(jsonb_build_object('actor',system_actor_id,'enabled',auto_confirm_enabled)),'[]'::jsonb) FROM public.sepay_system_settings;"));
  assert.deepEqual(restored,beforeSettings.map(row=>({actor:row.system_actor_id,enabled:row.auto_confirm_enabled})));
  sql(`DROP ROLE ${role};`);
  if(waitingScope)waitingScope.check();
 }
}
