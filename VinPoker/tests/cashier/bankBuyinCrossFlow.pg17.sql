-- Exact-local parent sets test.cross_flow fixture identity. Entire bank case
-- rolls back, including temporary SePay settings; no provider/email is called.
BEGIN;
-- The native baseline's auth.uid reads only the old per-claim GUC. Match the
-- official Supabase Auth 20220224000811 claims fallback for this transaction,
-- rather than seeding a human JWT subject into a service-only reconciliation.
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
 SELECT coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),
 nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid
$$;
DO $$
DECLARE f jsonb:=current_setting('test.cross_flow')::jsonb;
 actor uuid:=(f->>'actor')::uuid;club uuid:=(f->>'club')::uuid;tour uuid:=(f->>'tour')::uuid;
 player uuid:=gen_random_uuid();registration uuid;bank1 uuid:=gen_random_uuid();bank2 uuid:=gen_random_uuid();
 account text:='TEST-'||gen_random_uuid()::text;reference text;r jsonb;entry uuid;
BEGIN
 IF NOT has_function_privilege('service_role','public.cashier_record_verified_bank_v1(uuid,boolean)','EXECUTE')
 OR has_function_privilege('anon','public.cashier_record_verified_bank_v1(uuid,boolean)','EXECUTE')
 OR has_function_privilege('authenticated','public.cashier_record_verified_bank_v1(uuid,boolean)','EXECUTE')
 THEN RAISE EXCEPTION 'bank_worker_execution_boundary_invalid';END IF;
 INSERT INTO auth.users(id) VALUES(player);
 PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);
 PERFORM set_config('request.jwt.claim.role','service_role',true);
 r:=public.cashier_create_app_registration_v1(tour,player);
 IF r->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'bank_registration_failed: %',r;END IF;
 registration:=(r->>'registration_id')::uuid;
 SELECT reference_code INTO reference FROM public.tournament_registrations WHERE id=registration;
 INSERT INTO public.platform_bank_accounts(club_id,bank_name,account_number,account_holder,is_active)
 VALUES(club,'LOCAL TEST BANK',account,'NO REAL ACCOUNT',true);
 INSERT INTO public.sepay_system_settings(id,system_actor_id,auto_confirm_enabled) VALUES(true,actor,true)
 ON CONFLICT(id) DO UPDATE SET system_actor_id=excluded.system_actor_id,auto_confirm_enabled=true;
 INSERT INTO public.bank_transactions(id,provider,provider_txn_id,account_number,amount,transfer_type,content,status,raw_payload)
 VALUES(bank1,'sepay','local-'||bank1,account,40000,'in',reference,'unmatched','{}');
 r:=public.cashier_record_verified_bank_v1(bank1,true);
 IF r->>'handled' IS DISTINCT FROM 'false' OR EXISTS(SELECT 1 FROM public.cashier_buyin_movements WHERE registration_id=registration)
 THEN RAISE EXCEPTION 'unverified_webhook_must_not_pay_or_seat: %',r;END IF;
 UPDATE public.bank_transactions SET api_verified_at=now() WHERE id=bank1;
 r:=public.cashier_record_verified_bank_v1(bank1,false);
 IF r->>'handled' IS DISTINCT FROM 'false' THEN RAISE EXCEPTION 'auto_off_must_not_process';END IF;
 r:=public.cashier_record_verified_bank_v1(bank1,true);
 IF r->>'outcome' IS DISTINCT FROM 'partial_received' OR EXISTS(SELECT 1 FROM public.tournament_entries WHERE registration_id=registration)
 THEN RAISE EXCEPTION 'partial_transfer_must_not_seat: %',r;END IF;
 PERFORM public.cashier_record_verified_bank_v1(bank1,true);
 IF (SELECT count(*) FROM public.cashier_buyin_movements WHERE registration_id=registration)<>1
 THEN RAISE EXCEPTION 'partial_replay_double_recorded';END IF;
 INSERT INTO public.bank_transactions(id,provider,provider_txn_id,account_number,amount,transfer_type,content,status,api_verified_at,raw_payload)
 VALUES(bank2,'sepay','local-'||bank2,account,60000,'in',reference,'unmatched',now(),'{}');
 r:=public.cashier_record_verified_bank_v1(bank2,true);
 IF r->>'outcome' IS DISTINCT FROM 'paid_seated' THEN RAISE EXCEPTION 'verified_full_bank_buyin_not_seated: %',r;END IF;
 SELECT id INTO entry FROM public.tournament_entries WHERE registration_id=registration;
 IF entry IS NULL OR NOT EXISTS(SELECT 1 FROM public.tournament_seats s
 JOIN public.tournament_tables tt ON tt.id=s.tournament_table_id AND tt.tournament_id=tour
 JOIN public.table_sessions x ON x.id=s.table_session_id AND x.id=tt.table_session_id AND x.closed_at IS NULL
 WHERE s.entry_id=entry AND s.is_active)
 THEN RAISE EXCEPTION 'paid_entry_not_in_current_table_session';END IF;
 IF (SELECT count(*) FROM public.seat_draw_receipts WHERE registration_id=registration AND status='issued')<>1
 THEN RAISE EXCEPTION 'paid_bank_receipt_not_exactly_once';END IF;
 IF (SELECT count(*) FROM public.notifications WHERE user_id=player AND data->>'registration_id'=registration::text AND data ? 'receipt_code')<>1
 THEN RAISE EXCEPTION 'paid_bank_inapp_notification_not_exactly_once';END IF;
 PERFORM public.cashier_record_verified_bank_v1(bank2,true);
 IF (SELECT count(*) FROM public.cashier_buyin_movements WHERE registration_id=registration)<>2
 OR (SELECT count(*) FROM public.tournament_entries WHERE registration_id=registration)<>1
 OR (SELECT sum(applied_amount) FROM public.cashier_buyin_movements WHERE registration_id=registration)<>100000
 THEN RAISE EXCEPTION 'full_bank_retry_duplicated_effect';END IF;
END $$;
SELECT 'VERIFIED_BANK_SPLIT_PAYMENT_CANONICAL_SEAT_RECEIPT_INAPP_NOTIFICATION_LOCAL_PASS_NOT_EMAIL';
ROLLBACK;
