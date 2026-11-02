import assert from 'node:assert/strict';
export function createSePay306Browser(sql,actor,club,log){
 const parent=JSON.parse(sql('SELECT fixture FROM floor_private.sepay305_fixture;'));
 assert.equal(parent.tour,'6a7fb4a3-8b46-44be-a71a-ca12a052ee08');assert.equal(parent.actor,actor);assert.equal(parent.club,club);
 assert.equal(sql(`SELECT auto_swing_enabled FROM public.club_settings WHERE club_id='${club}';`),'f');
 const exists=sql("SELECT to_regclass('floor_private.sepay306_fixture') IS NOT NULL;")==='t';
 if(exists)assert.equal(process.env.VINPOKER_SEPAY_WRITE306_RESUME,'1','existing306 requires explicit resume; never reseed');
 else sql(`BEGIN;DO $$ DECLARE player uuid:=gen_random_uuid();bank uuid:=gen_random_uuid();r jsonb;reg uuid;reference text; BEGIN
  INSERT INTO auth.users(id) VALUES(player);
  INSERT INTO public.profiles(user_id,display_name) VALUES(player,'SePay306 TEST player');
  PERFORM set_config('request.jwt.claim.sub','',true);PERFORM set_config('request.jwt.claim.role','service_role',true);
  PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);PERFORM set_config('role','service_role',true);
  r:=public.cashier_create_app_registration_v1('${parent.tour}',player);
  IF r->>'ok' IS DISTINCT FROM 'true' OR r->>'total_pay'<>'100000' THEN RAISE EXCEPTION 'sepay306_registration_failed:%',r;END IF;
  reg:=(r->>'registration_id')::uuid;PERFORM set_config('role','none',true);
  SELECT reference_code INTO reference FROM public.tournament_registrations WHERE id=reg;
  INSERT INTO public.platform_bank_accounts(club_id,bank_name,account_number,account_holder,is_active)
   VALUES('${club}','LOCAL NON-BANK TEST306','NON-BANK-TEST306','NO REAL ACCOUNT',true);
  INSERT INTO public.bank_transactions(id,provider_txn_id,account_number,club_id,amount,transfer_type,content,api_verified_at)
   VALUES(bank,'LOCAL-SEPAY306-'||bank,'NON-BANK-TEST306','${club}',100000,'in',reference,now());
  CREATE TABLE floor_private.sepay306_fixture(fixture jsonb NOT NULL);
  REVOKE ALL ON floor_private.sepay306_fixture FROM PUBLIC,anon,authenticated,service_role;
  ALTER TABLE floor_private.sepay306_fixture ENABLE ROW LEVEL SECURITY;
  INSERT INTO floor_private.sepay306_fixture VALUES(jsonb_build_object('tour','${parent.tour}','actor','${actor}','club','${club}',
   'player',player,'bank',bank,'registration',reg));END $$;COMMIT;`);
 const f=JSON.parse(sql('SELECT fixture FROM floor_private.sepay306_fixture;'));
 for(const value of Object.values(f))assert.match(value,/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i);
 assert.equal(f.actor,actor);assert.equal(f.club,club);assert.equal(f.tour,parent.tour);
 const hash=sql(`SELECT encode(sha256(convert_to(jsonb_build_object('operation','confirm','bank_transaction_id','${f.bank}'::uuid,
  'registration_id','${f.registration}'::uuid,'reason',NULL,'snapshot',jsonb_build_object('bank_amount',100000,'total_pay',100000))::text,'UTF8')),'hex');`);
 const fingerprint=()=>sql(`SELECT md5(jsonb_build_object(
  'cash',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.cashier_buyin_movements x WHERE bank_transaction_id IS DISTINCT FROM '${f.bank}'::uuid),
  'banks',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.bank_transactions x WHERE id<>'${f.bank}'),
  'registrations',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_registrations x WHERE id<>'${f.registration}'),
  'settlements',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.payment_settlements x WHERE bank_transaction_id IS DISTINCT FROM '${f.bank}'::uuid),
  'entries',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_entries x WHERE registration_id IS DISTINCT FROM '${f.registration}'::uuid),
  'seats',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_seats x WHERE NOT EXISTS(SELECT 1 FROM public.tournament_entries e WHERE e.id=x.entry_id AND e.registration_id='${f.registration}')),
  'hands',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_hands x),
  'prizes',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_prize_payments x),
  'intents',(SELECT jsonb_agg(to_jsonb(x) ORDER BY idempotency_key) FROM public.ops_cashier_mutation_idempotency x WHERE NOT(actor_user_id='${actor}' AND operation='sepay_confirm' AND request_hash='${hash}'))
  )::text);`);
 const before=fingerprint();let writes=0;
 const query=q=>JSON.parse(sql(`BEGIN;SET LOCAL request.jwt.claim.sub='${actor}';SET LOCAL request.jwt.claim.role='authenticated';
  SET LOCAL request.jwt.claims='{"sub":"${actor}","role":"authenticated"}';SET LOCAL ROLE authenticated;${q}COMMIT;`));
 return {manifest:f,handle(path,body){
  if(path==='/rest/v1/rpc/sepay_cashier_settlement_worklist'){
   assert.deepEqual(Object.keys(body).sort(),['p_limit','p_scope']);assert.equal(body.p_limit,200);assert.ok(['actionable','resolved'].includes(body.p_scope));
   const value=query(`SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) FROM public.sepay_cashier_settlement_worklist('${body.p_scope}',200) r WHERE r.bank_transaction_id='${f.bank}';`);
   log.push({sepay306:'worklist',scope:body.p_scope,rows:value.length});return {status:200,value};
  }
  assert.equal(path,'/rest/v1/rpc/cashier_sepay_intent_v1');
  assert.deepEqual(Object.keys(body).sort(),['p_mode','p_operation','p_bank_transaction_id','p_registration_id','p_reason','p_request_id','p_expected_snapshot'].sort());
  assert.equal(body.p_operation,'confirm');assert.equal(body.p_bank_transaction_id,f.bank);assert.equal(body.p_registration_id,f.registration);assert.equal(body.p_reason,null);
  assert.deepEqual(body.p_expected_snapshot,{bank_amount:100000,total_pay:100000});assert.match(body.p_request_id,/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i);
  assert.ok(['commit','receipt'].includes(body.p_mode));
  if(body.p_mode==='commit'){assert.equal(writes,0);assert.equal(sql(`SELECT status FROM public.bank_transactions WHERE id='${f.bank}';`),'unmatched');}
  const value=query(`SELECT public.cashier_sepay_intent_v1('${body.p_mode}','confirm','${f.bank}','${f.registration}',NULL,'${body.p_request_id}',
   '{"bank_amount":100000,"total_pay":100000}'::jsonb);`);
  log.push({sepay306:body.p_mode,requestId:body.p_request_id,status:value.status,outcome:value.receipt?.outcome??null,replayed:value.replayed});
  if(body.p_mode==='commit'){assert.equal(value.receipt?.outcome,'manual_confirmed');writes++;log.at(-1).responseDropped=true;
   return {status:503,value:{message:'LOCAL_SEPAY306_RESPONSE_LOST_AFTER_COMMIT'}};}
  return {status:200,value};
 },verify(){assert.equal(fingerprint(),before,'unexpected non306 business delta');console.log('LOCAL_SEPAY306_OTHER_CASH_BANK_REG_ENTRY_SEAT_HAND_PRIZE_UNCHANGED_PASS',JSON.stringify({bank:f.bank,writes}));}};
}
