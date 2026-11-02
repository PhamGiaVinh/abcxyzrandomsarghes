import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createUnregisteredJourneyFixture} from './paidJourney.fixture.mjs';

export async function runVerifiedBankOverlap264(sql,{session,until,resume=false}){
 assert.equal(process.env.VINPOKER_NATIVE_PAYOUT,'1');
 assert.equal(sql("SELECT current_database()||'|'||host(inet_server_addr())||'|'||inet_server_port();"),'vinpoker_ops_cash115_qualified_c|127.0.0.1|55441');
 assert.equal(sql('SHOW data_directory;'),'/tmp/vinpoker-sol-local-20261016-0e79a729/data');
 assert.equal(sql("SELECT count(*) FROM pg_extension WHERE extname IN('pg_net','pg_cron');"),'0');
 assert.equal(sql('SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid();'),'0');
 assert.equal(sql('SELECT count(*) FROM public.sepay_system_settings;'),'0','exact prior disabled/absent settings required');
 assert.equal(sql("SELECT md5(replace(pg_get_functiondef('public.cashier_record_verified_bank_v1(uuid,boolean)'::regprocedure),chr(13),''));"),'fc30f66519e45823ef05eff4e5cf8a96');
 assert.equal(sql("SELECT bool_and(prosrc LIKE '%INSERT INTO net.cash_ui_http_sink%') FROM pg_proc WHERE pronamespace='net'::regnamespace AND proname='http_post';"),'t','local notification sink only');
 let f=null;const players=[];
 const outside=()=>sql(`SELECT md5(jsonb_build_array(
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.cashier_buyin_movements x ${f?`WHERE tournament_id<>'${f.tour}'`:''}),
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_entries x ${f?`WHERE tournament_id<>'${f.tour}'`:''}),
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_seats x ${f?`WHERE tournament_id<>'${f.tour}'`:''}),
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.notifications x ${players.length?`WHERE user_id NOT IN(${players.map(id=>`'${id}'::uuid`).join(',')})`:''}),
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.chip_inventory_ledger x),
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.chip_bank_ledger x),
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_prize_payments x))::text);`);
 if(resume){
  f=JSON.parse(sql(`SELECT jsonb_build_object('tour',t.id,'club',c.id,'actor',c.owner_id) FROM public.tournaments t JOIN public.clubs c ON c.id=t.club_id
   JOIN public.profiles p ON p.user_id=c.owner_id WHERE t.id='e68e9748-00d8-47b1-b3cc-e68530802b71' AND c.id='ad0dde9e-864a-42cc-9eb9-fb97b2f0fe90'
   AND c.owner_id='79918c47-6fb3-47ce-94ea-b7eeeb742b01' AND p.display_name='Verified264 ced1868c TEST owner';`));
  players.push(...JSON.parse(sql(`SELECT jsonb_agg(player_id) FROM public.tournament_registrations WHERE tournament_id='${f.tour}';`)));
 }else assert.equal(sql("SELECT count(*) FROM public.profiles WHERE display_name LIKE 'Verified264 % TEST owner';"),'0','retained failed canary must be resumed, never replaced');
 const before=outside();if(!f)f=createUnregisteredJourneyFixture(sql,{profileLabel:'Verified264 '+randomUUID().slice(0,8)+' TEST'});
 assert.equal(sql(`SELECT auto_swing_enabled FROM public.club_settings WHERE club_id='${f.club}';`),'f');
 const owner=`SET LOCAL request.jwt.claim.sub='${f.actor}';SET LOCAL request.jwt.claim.role='authenticated';SET LOCAL request.jwt.claims='{"sub":"${f.actor}","role":"authenticated"}';SET LOCAL ROLE authenticated;`;
 if(!resume){const opened=JSON.parse(sql(`BEGIN;${owner}SELECT public.floor_open_tournament_table_v3('${f.tour}',
  (SELECT id FROM public.game_tables WHERE club_id='${f.club}' AND table_number=1),'manual','${randomUUID()}');COMMIT;`));
 assert.equal(opened.ok,true,JSON.stringify(opened));}
 assert.equal(sql(`SELECT count(*) FROM public.tournament_tables WHERE tournament_id='${f.tour}' AND status='active';`),'1');
 const account='TEST-verified264-'+randomUUID(),q=v=>`'${String(v).replaceAll("'","''")}'`;
 sql(`INSERT INTO public.platform_bank_accounts(club_id,bank_name,account_number,account_holder,is_active)
  VALUES('${f.club}','LOCAL TEST BANK',${q(account)},'NO REAL ACCOUNT',true);
  INSERT INTO public.sepay_system_settings(id,system_actor_id,auto_confirm_enabled) VALUES(true,'${f.actor}',true);`);
 const claims=`SET LOCAL request.jwt.claim.sub='';SET LOCAL request.jwt.claim.role='service_role';SET LOCAL request.jwt.claims='{"role":"service_role"}';SET LOCAL ROLE service_role;`;
 const service=statement=>JSON.parse(sql(`BEGIN;${claims}${statement}COMMIT;`));
 const calls=[];
 const authDefinition=sql("SELECT pg_get_functiondef('auth.uid()'::regprocedure);");
 const bank=(amount,reference)=>{
  const id=randomUUID();sql(`INSERT INTO public.bank_transactions(id,provider,provider_txn_id,account_number,amount,transfer_type,content,status,api_verified_at,raw_payload)
   VALUES('${id}','sepay','local-${id}',${q(account)},${amount},'in',${q(reference)},'unmatched',now(),'{}');`);return id;
 };
 const facts=registration=>JSON.parse(sql(`SELECT jsonb_build_object(
  'movements',(SELECT count(*) FROM public.cashier_buyin_movements WHERE registration_id='${registration}'),
  'received',(SELECT coalesce(sum(amount),0) FROM public.cashier_buyin_movements WHERE registration_id='${registration}'),
  'applied',(SELECT coalesce(sum(applied_amount),0) FROM public.cashier_buyin_movements WHERE registration_id='${registration}'),
  'entries',(SELECT count(*) FROM public.tournament_entries WHERE registration_id='${registration}'),
  'seats',(SELECT count(*) FROM public.tournament_seats s JOIN public.tournament_entries e ON e.id=s.entry_id WHERE e.registration_id='${registration}' AND s.is_active),
  'receipts',(SELECT count(*) FROM public.seat_draw_receipts WHERE registration_id='${registration}' AND status='issued'),
  'notices',(SELECT count(*) FROM public.notifications WHERE data->>'registration_id'='${registration}' AND data ? 'receipt_code'));`));
 try{
  // Same managed-Auth claims fallback used by existing SePay native tests.
  // Install ONCE before overlap, never DDL per worker (which would serialize it).
  sql(`CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
   SELECT coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid $$;`);
  if(resume){
   const old='af687634-f714-48c5-aa04-c0fe7ceafc63',beforeOld=facts(old);
   assert.deepEqual(beforeOld,{movements:1,received:100000,applied:100000,entries:0,seats:0,receipts:0,notices:0});
   const holder=session('verified264_foreign_'+randomUUID().slice(0,8));
   try{
    holder.child.stdin.write(`BEGIN;SET LOCAL statement_timeout='12s';SET LOCAL idle_in_transaction_session_timeout='12s';SELECT count(*) FROM(SELECT id FROM public.tournament_registrations WHERE id<>'${old}' FOR UPDATE)x;SELECT 'VERIFIED264_FOREIGN_LOCKED';\n`);
    await until(()=>holder.output().includes('VERIFIED264_FOREIGN_LOCKED'));
    const recovered=service('SELECT public.cashier_retry_paid_seating_v1(true,1);');
    assert.deepEqual(recovered,{ok:true,attempted:1,seated:1,needs_review:0});
   }finally{holder.child.stdin.end('ROLLBACK;\n');await holder.closed;}
   assert.deepEqual(facts(old),{movements:1,received:100000,applied:100000,entries:1,seats:1,receipts:1,notices:1});
   console.log('VERIFIED264_RETAINED_FAILED_REGISTRATION_PUBLIC_RETRY_NO_NEW_MONEY_PASS',JSON.stringify({registration:old,facts:facts(old)}));
  }
  for(const order of ['same-bank-fixed-auth','split-bank']){
   const same=order.startsWith('same-bank');
   const player=randomUUID();players.push(player);sql(`INSERT INTO auth.users(id) VALUES('${player}');INSERT INTO public.profiles(user_id,display_name) VALUES('${player}','Verified264 ${f.tour.slice(0,8)} ${order} TEST');`);
   const registration=service(`SELECT public.cashier_create_app_registration_v1('${f.tour}','${player}');`);
   assert.equal(registration.ok,true,JSON.stringify(registration));
   const reg=registration.registration_id,reference=sql(`SELECT reference_code FROM public.tournament_registrations WHERE id='${reg}';`);
   const first=bank(same?100000:40000,reference),second=same?first:bank(60000,reference);
   const suffix=randomUUID().slice(0,8),a=session('verified264_a_'+suffix),b=session('verified264_b_'+suffix);
   try{
    a.child.stdin.write(`BEGIN;SET LOCAL statement_timeout='12s';${claims}SELECT 'RESULT:'||public.cashier_record_verified_bank_v1('${first}',true)::text;SELECT 'VERIFIED264_HELD';\n`);
    await Promise.race([until(()=>a.output().includes('VERIFIED264_HELD')),a.closed.then(()=>{throw Error('first worker ended before barrier');})]);
    b.child.stdin.write(`BEGIN;SET LOCAL statement_timeout='12s';${claims}SELECT 'RESULT:'||public.cashier_record_verified_bank_v1('${second}',true)::text;SELECT 'VERIFIED264_RETURNED';\n`);
    await Promise.race([until(()=>sql(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='verified264_b_${suffix}' AND cardinality(pg_blocking_pids(pid))>0);`)==='t'),b.closed.then(()=>{throw Error('second worker ended before lock');})]);
    assert.equal(b.output().includes('VERIFIED264_RETURNED'),false);
    a.child.stdin.end('COMMIT;\n');await a.closed;
    await until(()=>b.output().includes('VERIFIED264_RETURNED'));b.child.stdin.end('COMMIT;\n');await b.closed;
    const result=h=>JSON.parse(h.output().split('\n').find(line=>line.startsWith('RESULT:')).slice(7));
    assert.equal(result(a).outcome,same?'paid_seated':'partial_received');
    if(same)assert.equal(result(b).handled,false);else assert.equal(result(b).outcome,'paid_seated');
    assert.deepEqual(facts(reg),{movements:same?1:2,received:100000,applied:100000,entries:1,seats:1,receipts:1,notices:1});
    for(const id of new Set([first,second]))service(`SELECT public.cashier_record_verified_bank_v1('${id}',true);`);
    assert.deepEqual(facts(reg),{movements:same?1:2,received:100000,applied:100000,entries:1,seats:1,receipts:1,notices:1});
    if(order==='split-bank'){
     const extra=bank(20000,reference),r=service(`SELECT public.cashier_record_verified_bank_v1('${extra}',true);`);
     assert.equal(r.outcome,'surplus_received');assert.equal(r.applied,0);assert.equal(r.surplus,20000);
     assert.deepEqual(facts(reg),{movements:3,received:120000,applied:100000,entries:1,seats:1,receipts:1,notices:1});
    }
    calls.push({order,tour:f.tour,registration:reg,first,second,facts:facts(reg)});
    console.log('VERIFIED264_REAL_BANK_OR_REGISTRATION_LOCK_ONE_ENTRY_RECEIPT_NOTICE_PASS',JSON.stringify(calls.at(-1)));
   }finally{
    for(const h of[a,b])if(!h.child.stdin.writableEnded&&!h.child.stdin.destroyed)h.child.stdin.end('ROLLBACK;\n');
    await Promise.allSettled([a.closed,b.closed]);
   }
  }
  assert.equal(outside(),before,'all unrelated business facts must stay unchanged');
 }finally{
  sql(authDefinition);
  assert.equal(sql(`SELECT count(*) FROM public.sepay_system_settings WHERE id AND system_actor_id='${f.actor}' AND auto_confirm_enabled;`),'1');
  sql(`DELETE FROM public.sepay_system_settings WHERE id AND system_actor_id='${f.actor}';`);
 }
 assert.equal(sql('SELECT count(*) FROM public.sepay_system_settings;'),'0');
 assert.equal(sql("SELECT pg_get_functiondef('auth.uid()'::regprocedure);"),authDefinition);
 console.log('VERIFIED264_SYSTEM_AUTO_CONFIG_RESTORED_ABSENT_FOREIGN_FACTS_PASS',JSON.stringify({tour:f.tour,club:f.club,actor:f.actor,calls}));
}
