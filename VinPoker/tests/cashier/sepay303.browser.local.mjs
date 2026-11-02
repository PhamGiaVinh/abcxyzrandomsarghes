import assert from 'node:assert/strict';
export function createSePay303Browser(sql,actor,club,log){
 assert.equal(actor,'675fe35e-60a8-4452-bb90-e79486d54da6');assert.equal(club,'a8e7d1b7-fdaa-45ad-b0a1-f894b6315760');
 const bank='e3030000-0000-4000-8000-000000000001',reason='TEST local ignore recovery303';
 assert.equal(sql("SELECT md5(prosrc) FROM pg_proc WHERE oid='public.cashier_sepay_intent_v1(text,text,uuid,uuid,text,uuid,jsonb)'::regprocedure;"),'b4dc451a84c1bc1e52e7bd19cee12a0c');
 const hash=sql(`SELECT encode(sha256(convert_to(jsonb_build_object('operation','ignore','bank_transaction_id','${bank}'::uuid,
  'registration_id',NULL,'reason','${reason}','snapshot',jsonb_build_object('bank_amount',1000,'total_pay',NULL))::text,'UTF8')),'hex');`);
 const fingerprint=()=>sql(`SELECT md5(jsonb_build_object(
  'banks',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.bank_transactions x WHERE id<>'${bank}'),
  'settlements',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.payment_settlements x WHERE bank_transaction_id IS DISTINCT FROM '${bank}'::uuid),
  'receipts',(SELECT jsonb_agg(to_jsonb(x) ORDER BY idempotency_key) FROM public.ops_cashier_mutation_idempotency x WHERE NOT(actor_user_id='${actor}' AND operation='sepay_ignore' AND request_hash='${hash}')),
  'cash',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.cashier_buyin_movements x),
  'entries',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_entries x),
  'seats',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_seats x),
  'hands',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_hands x),
  'prizes',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_prize_payments x))::text);`);
 const before=fingerprint();
 const existing=JSON.parse(sql(`SELECT coalesce((SELECT to_jsonb(b) FROM public.bank_transactions b WHERE id='${bank}'),'null');`));
 if(existing){assert.equal(process.env.VINPOKER_SEPAY_WRITE303_RESUME,'1','existing303: explicit resume only, never reset');
  assert.equal(existing.club_id,club);assert.equal(existing.account_number,'NON-BANK-TEST303');assert.equal(existing.amount,1000);
 }else sql(`INSERT INTO public.bank_transactions(id,provider_txn_id,account_number,club_id,amount,transfer_type,content,api_verified_at)
  VALUES('${bank}','LOCAL-303-IGNORE-ONLY','NON-BANK-TEST303','${club}',1000,'in','TEST303 isolated ignore only',now());`);
 const accounts=JSON.parse(sql("SELECT coalesce(jsonb_agg(jsonb_build_object('club',club_id,'active',is_active)),'[]'::jsonb) FROM public.platform_bank_accounts WHERE account_number='NON-BANK-TEST303';"));
 if(accounts.length)assert.deepEqual(accounts,[{club,active:true}]);
 else sql(`INSERT INTO public.platform_bank_accounts(club_id,bank_name,account_number,account_holder,is_active)
  VALUES('${club}','LOCAL NON-BANK TEST303','NON-BANK-TEST303','NO REAL ACCOUNT',true);`);
 let writes=0;
 const query=statement=>JSON.parse(sql(`BEGIN;SET LOCAL request.jwt.claim.sub='${actor}';
  SET LOCAL request.jwt.claims='{"sub":"${actor}","role":"authenticated"}';SET LOCAL ROLE authenticated;${statement}COMMIT;`));
 return {
  handle(path,body){
   if(path==='/rest/v1/rpc/sepay_cashier_settlement_worklist'){
    assert.deepEqual(Object.keys(body).sort(),['p_limit','p_scope']);assert.equal(body.p_limit,200);assert.ok(['actionable','resolved'].includes(body.p_scope));
    const value=query(`SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) FROM public.sepay_cashier_settlement_worklist('${body.p_scope}',200) r WHERE r.bank_transaction_id='${bank}';`);
    log.push({sepay303:'worklist',scope:body.p_scope,rows:value.length});return {status:200,value};
   }
   assert.equal(path,'/rest/v1/rpc/cashier_sepay_intent_v1');
   assert.deepEqual(Object.keys(body).sort(),['p_mode','p_operation','p_bank_transaction_id','p_registration_id','p_reason','p_request_id','p_expected_snapshot'].sort());
   assert.equal(body.p_operation,'ignore');assert.equal(body.p_bank_transaction_id,bank);assert.equal(body.p_registration_id,null);assert.equal(body.p_reason,reason);
   assert.match(body.p_request_id,/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i);assert.deepEqual(body.p_expected_snapshot,{bank_amount:1000,total_pay:null});
   assert.ok(['commit','receipt'].includes(body.p_mode));
   if(body.p_mode==='commit'){assert.equal(writes,0,'one fresh commit only');assert.equal(sql(`SELECT status FROM public.bank_transactions WHERE id='${bank}';`),'unmatched');}
   const value=query(`SELECT public.cashier_sepay_intent_v1('${body.p_mode}','ignore','${bank}',NULL,'${reason}','${body.p_request_id}',
    '{"bank_amount":1000,"total_pay":null}'::jsonb);`);
   log.push({sepay303:body.p_mode,requestId:body.p_request_id,status:value.status,outcome:value.receipt?.outcome??null,replayed:value.replayed});
   if(body.p_mode==='commit'){
    assert.equal(value.receipt?.outcome,'dismissed');writes++;log.at(-1).responseDropped=true;
    return {status:503,value:{message:'LOCAL_SEPAY303_RESPONSE_LOST_AFTER_COMMIT'}};
   }
   return {status:200,value};
  },
  verify(){assert.equal(fingerprint(),before,'unexpected non303 business delta');
   console.log('LOCAL_SEPAY303_OTHER_BANK_HAND_CASH_ENTRY_SEAT_PRIZE_UNCHANGED_PASS',JSON.stringify({bank,writes}));}
 };
}
