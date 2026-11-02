-- Continuation of the canonical cash fixture before any cash payment or table.
DECLARE bank_a uuid:=gen_random_uuid(); bank_b uuid:=gen_random_uuid(); bank_bad uuid:=gen_random_uuid();
 key_a uuid:=gen_random_uuid(); key_b uuid:=gen_random_uuid(); result_a jsonb; result_b jsonb; checked jsonb; physical uuid;
BEGIN
 PERFORM set_config('role','none',true);
 INSERT INTO public.bank_transactions(id,provider_txn_id,account_number,club_id,amount,transfer_type)
 VALUES(bank_a,'LOCAL-ROLLBACK297-'||bank_a,'TEST-NON-BANK-297',club,40000,'in'),
 (bank_b,'LOCAL-ROLLBACK297-'||bank_b,'TEST-NON-BANK-297',club,80000,'in'),
 (bank_bad,'LOCAL-ROLLBACK297-'||bank_bad,'TEST-NON-BANK-297','a8e7d1b7-fdaa-45ad-b0a1-f894b6315760',100000,'in');
 PERFORM set_config('role','authenticated',true);
 checked:=public.cashier_sepay_intent_v1('commit','confirm',bank_bad,registration,NULL,gen_random_uuid());
 PERFORM pg_temp.assert_cash(checked #>> '{receipt,error}'='club_mismatch','cross club bank denied');
 result_a:=public.cashier_sepay_intent_v1('commit','confirm',bank_a,registration,'TEST partial transfer',key_a);
 PERFORM pg_temp.assert_cash(result_a #>> '{receipt,outcome}'='partial_received'
  AND result_a #>> '{receipt,received}'='40000' AND result_a #>> '{receipt,remaining}'='60000','partial is not seated: '||result_a::text);
 checked:=public.cashier_sepay_intent_v1('commit','confirm',bank_a,registration,'TEST partial transfer',key_a);
 PERFORM pg_temp.assert_cash(checked->'receipt'=result_a->'receipt' AND checked->>'replayed'='true','partial replay');
 PERFORM set_config('role','none',true);
 PERFORM pg_temp.assert_cash(NOT EXISTS(SELECT 1 FROM public.tournament_entries WHERE registration_id=registration),'partial no entry');
 PERFORM set_config('request.jwt.claim.sub',player_id::text,true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',player_id,'role','authenticated')::text,true);
 PERFORM set_config('role','authenticated',true);
 checked:=public.cashier_sepay_intent_v1('receipt','confirm',bank_a,registration,'TEST partial transfer',key_a);
 PERFORM pg_temp.assert_cash(checked->>'error'='actor_not_allowed','other actor cannot retrieve receipt');
 PERFORM set_config('role','none',true);
 PERFORM set_config('request.jwt.claim.sub',owner_id::text,true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',owner_id,'role','authenticated')::text,true);
 PERFORM set_config('role','authenticated',true);
 result_b:=public.cashier_sepay_intent_v1('commit','confirm',bank_b,registration,'TEST completion plus surplus',key_b);
 PERFORM pg_temp.assert_cash(result_b #>> '{receipt,outcome}'='paid_waiting_seat'
  AND result_b #>> '{receipt,applied}'='60000' AND result_b #>> '{receipt,surplus}'='20000'
  AND result_b #>> '{receipt,confirm,seating_state}'='waiting','paid surplus waits without a seat: '||result_b::text);
 checked:=public.cashier_sepay_intent_v1('receipt','confirm',bank_b,registration,'TEST completion plus surplus',key_b);
 PERFORM pg_temp.assert_cash(checked->'receipt'=result_b->'receipt','waiting receipt recovery');
 PERFORM set_config('role','none',true);
 PERFORM pg_temp.assert_cash((SELECT count(*)=2 AND sum(amount)=120000 AND sum(applied_amount)=100000
  FROM public.cashier_buyin_movements WHERE registration_id=registration),'partial plus surplus ledger conservation');
 PERFORM pg_temp.assert_cash((SELECT status='pending' AND cashier_paid_at IS NOT NULL FROM public.tournament_registrations WHERE id=registration)
  AND NOT EXISTS(SELECT 1 FROM public.tournament_entries WHERE registration_id=registration)
  AND NOT EXISTS(SELECT 1 FROM public.seat_draw_receipts WHERE registration_id=registration),'paid waiting does not fabricate entry or receipt');
 PERFORM pg_temp.assert_cash((SELECT status='unmatched' FROM public.bank_transactions WHERE id=bank_bad)
  AND NOT EXISTS(SELECT 1 FROM public.cashier_buyin_movements WHERE bank_transaction_id=bank_bad),'cross club denial no movement');
 IF current_setting('test.sepay_retry298',true)='true' THEN
  -- Parent must hold existing pending rows locked in another session; SKIP LOCKED
  -- restricts actual worker to this new rollback child, no retained-row mutation.
  SELECT id INTO physical FROM public.game_tables WHERE club_id=club AND table_number=30;
  PERFORM set_config('role','authenticated',true);
  checked:=public.floor_open_tournament_table_v3(tour,physical,'manual',gen_random_uuid());
  PERFORM pg_temp.assert_cash(checked->>'ok'='true','waiting child table opens');
  PERFORM set_config('role','none',true);
  DELETE FROM public.club_cashiers WHERE club_id=club AND user_id=owner_id;
  UPDATE public.clubs SET owner_id=player_id WHERE id=club;
  PERFORM set_config('role','service_role',true);
  checked:=public.cashier_retry_paid_seating_v1(false,100);
  PERFORM pg_temp.assert_cash(checked->>'attempted'='0','revoked manual confirmer not eligible');
  PERFORM set_config('role','none',true);
  UPDATE public.clubs SET owner_id=auth.uid() WHERE id=club;
  INSERT INTO public.club_cashiers(club_id,user_id) VALUES(club,owner_id);
  PERFORM set_config('role','service_role',true);
  checked:=public.cashier_retry_paid_seating_v1(false,100);
  PERFORM pg_temp.assert_cash(checked->>'attempted'='1' AND checked->>'seated'='1','manual bank retry with auto OFF: '||checked::text);
  checked:=public.cashier_retry_paid_seating_v1(false,100);
  PERFORM pg_temp.assert_cash(checked->>'attempted'='0','worker retry no duplicate');
  PERFORM set_config('role','none',true);
  PERFORM pg_temp.assert_cash((SELECT count(*)=1 FROM public.tournament_entries WHERE registration_id=registration)
   AND (SELECT count(*)=1 FROM public.seat_draw_receipts WHERE registration_id=registration AND status='issued')
   AND (SELECT count(*)=2 AND sum(amount)=120000 AND sum(applied_amount)=100000 FROM public.cashier_buyin_movements WHERE registration_id=registration),
   'retry creates one entry receipt without taking more money');
 END IF;
END;
END $$;
RESET ROLE;
SELECT 'SEPAY297_PARTIAL_SURPLUS_WAIT_RECEIPT_TENANT_ROLLBACK_PASS';
ROLLBACK;
