-- Continuation of cashPaymentIdentity fixture DO block, before any cash payment.
-- Parent transaction owns candidate225 and rolls every child record back.
DECLARE physical uuid; bank uuid:=gen_random_uuid();
 key_rejected uuid:=gen_random_uuid(); key_confirm uuid:=gen_random_uuid(); key_snapshot uuid:=gen_random_uuid(); outcome jsonb; replay jsonb;
BEGIN
 PERFORM set_config('role','none',true);
 SELECT id INTO physical FROM public.game_tables WHERE club_id=club AND table_number=30;
 PERFORM pg_temp.assert_cash(physical IS NOT NULL,'canonical new-club inventory table30 exists');
 PERFORM set_config('role','authenticated',true);
 outcome:=public.floor_open_tournament_table_v3(tour,physical,'manual',gen_random_uuid());
 PERFORM pg_temp.assert_cash(outcome->>'ok'='true','child exact session opens: '||outcome::text);
 PERFORM set_config('role','none',true);
 INSERT INTO public.bank_transactions(id,provider_txn_id,account_number,club_id,amount,content,transfer_type)
 VALUES(bank,'LOCAL-ROLLBACK295-'||bank,'TEST-NON-BANK-295',club,90000,'LOCAL child fixture only','in');
 PERFORM set_config('role','authenticated',true);
 outcome:=public.cashier_sepay_intent_v1('commit','confirm',bank,registration,NULL,key_snapshot,
  '{"bank_amount":80000,"total_pay":100000}'::jsonb);
 PERFORM pg_temp.assert_cash(outcome #>> '{receipt,error}'='sepay_snapshot_changed','changed amount terminal rejection');
 replay:=public.cashier_sepay_intent_v1('receipt','confirm',bank,registration,NULL,key_snapshot,
  '{"bank_amount":80000,"total_pay":100000}'::jsonb);
 PERFORM pg_temp.assert_cash(replay->'receipt'=outcome->'receipt' AND replay->>'replayed'='true','stale snapshot receipt recovered');
 replay:=public.cashier_sepay_intent_v1('commit','confirm',bank,registration,NULL,key_snapshot,
  '{"bank_amount":90000,"total_pay":100000}'::jsonb);
 PERFORM pg_temp.assert_cash(replay->>'error'='request_payload_conflict','same key cannot update snapshot');
 PERFORM set_config('role','none',true);
 PERFORM pg_temp.assert_cash(NOT EXISTS(SELECT 1 FROM public.cashier_buyin_movements WHERE bank_transaction_id=bank)
  AND (SELECT status='unmatched' FROM public.bank_transactions WHERE id=bank),'stale snapshot no payment or bank write');
 PERFORM set_config('role','authenticated',true);
 outcome:=public.cashier_sepay_intent_v1('commit','confirm',bank,registration,NULL,key_rejected);
 PERFORM pg_temp.assert_cash(outcome #>> '{receipt,error}'='reason_required_on_mismatch','rejected confirm has receipt: '||outcome::text);
 replay:=public.cashier_sepay_intent_v1('receipt','confirm',bank,registration,NULL,key_rejected);
 PERFORM pg_temp.assert_cash(replay->'receipt'=outcome->'receipt' AND replay->>'replayed'='true','rejected receipt replay');
 PERFORM set_config('role','none',true);
 PERFORM pg_temp.assert_cash(NOT EXISTS(SELECT 1 FROM public.tournament_entries WHERE registration_id=registration),'rejected confirm no entry');
 -- Correct only uncommitted synthetic input; not an existing ledger/real bank row.
 UPDATE public.bank_transactions SET amount=100000 WHERE id=bank;
 PERFORM set_config('role','authenticated',true);
 outcome:=public.cashier_sepay_intent_v1('commit','confirm',bank,registration,NULL,key_confirm,'{"bank_amount":100000,"total_pay":100000}'::jsonb);
 PERFORM pg_temp.assert_cash(outcome #>> '{receipt,outcome}'='manual_confirmed','positive manual confirm: '||outcome::text);
 PERFORM pg_temp.assert_cash(outcome #>> '{receipt,confirm,entry_id}' IS NOT NULL
  AND outcome #>> '{receipt,confirm,seat_id}' IS NOT NULL
  AND outcome #>> '{receipt,confirm,receipt_id}' IS NOT NULL,'canonical identity receipt');
 replay:=public.cashier_sepay_intent_v1('commit','confirm',bank,registration,NULL,key_confirm,'{"bank_amount":100000,"total_pay":100000}'::jsonb);
 PERFORM pg_temp.assert_cash(replay->'receipt'=outcome->'receipt' AND replay->>'replayed'='true','confirm replay same receipt');
 PERFORM set_config('role','none',true);
 PERFORM pg_temp.assert_cash((SELECT count(*)=1 FROM public.tournament_entries WHERE registration_id=registration)
  AND (SELECT count(*)=1 FROM public.payment_settlements ps WHERE ps.bank_transaction_id=bank AND ps.outcome='manual_confirmed')
  AND (SELECT count(*)=1 FROM public.seat_draw_receipts WHERE registration_id=registration AND status='issued'),'one entry settlement seating receipt');
 PERFORM pg_temp.assert_cash((SELECT count(*)=1 AND sum(amount)=100000 AND sum(applied_amount)=100000
  FROM public.cashier_buyin_movements WHERE bank_transaction_id=bank),'actual bank allocation exactly once');
 PERFORM pg_temp.assert_cash(EXISTS(SELECT 1 FROM public.tournament_seats s
  JOIN public.tournament_entries e ON e.id=s.entry_id JOIN public.tournament_tables tt ON tt.id=s.tournament_table_id
  JOIN public.table_sessions ts ON ts.id=s.table_session_id AND ts.id=tt.table_session_id
  WHERE e.registration_id=registration AND s.is_active AND ts.closed_at IS NULL
   AND tt.tournament_id=tour AND tt.game_table_id=physical),'entry seated in exact child session');
END;
END $$;
RESET ROLE;
SELECT 'SEPAY295_CONFIRM_REJECTION_REPLAY_EXACT_SEAT_ROLLBACK_PASS';
ROLLBACK;
