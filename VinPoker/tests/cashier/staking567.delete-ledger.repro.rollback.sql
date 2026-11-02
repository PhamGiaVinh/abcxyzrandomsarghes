-- Existing append-only guard regression. Earlier deletion-loss hypothesis was refuted by runtime.
BEGIN;
SET LOCAL statement_timeout='15s';
DO $$
DECLARE actor uuid:='675fe35e-60a8-4452-bb90-e79486d54da6';club uuid:='a8e7d1b7-fdaa-45ad-b0a1-f894b6315760';deal uuid:=gen_random_uuid();blocked boolean:=false;before_value jsonb;after_value jsonb;
BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname IN('pg_net','pg_cron'));
 ASSERT EXISTS(SELECT 1 FROM public.clubs WHERE id=club AND owner_id=actor);
 INSERT INTO public.staking_deals(id,player_id,club_id,custom_event_name,custom_event_date,custom_event_venue,percentage_sold,markup,buy_in_amount_vnd,status)
 VALUES(deal,actor,club,'LOCAL567 deletion diagnostic rollback',now(),'LOCAL ONLY',10,1,1000000,'listing');
 INSERT INTO public.escrow_transactions(deal_id,transaction_type,amount_vnd,performed_by_admin_id,note)
 VALUES(deal,'fund_lock',100000,actor,'LOCAL567 legacy evidence, no canonical receipt');
 ASSERT NOT EXISTS(SELECT 1 FROM public.staking_purchases WHERE deal_id=deal);
 ASSERT EXISTS(SELECT 1 FROM public.escrow_transactions WHERE deal_id=deal);
 SELECT jsonb_build_object('deal',(SELECT to_jsonb(x) FROM public.staking_deals x WHERE id=deal),
 'ledger',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.escrow_transactions x WHERE deal_id=deal),
 'audit',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.staking_audit_logs x WHERE deal_id=deal)) INTO before_value;
 GRANT USAGE ON SCHEMA auth TO authenticated;
 PERFORM set_config('request.jwt.claim.sub',actor::text,true);
 PERFORM set_config('role','authenticated',true);
 BEGIN DELETE FROM public.staking_deals WHERE id=deal;
 EXCEPTION WHEN raise_exception THEN blocked:=SQLERRM='This table is append-only';END;
 PERFORM set_config('role','postgres',true);
 ASSERT blocked,'Existing append-only guard must reject cascade deletion';
 SELECT jsonb_build_object('deal',(SELECT to_jsonb(x) FROM public.staking_deals x WHERE id=deal),
 'ledger',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.escrow_transactions x WHERE deal_id=deal),
 'audit',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.staking_audit_logs x WHERE deal_id=deal)) INTO after_value;
 ASSERT before_value=after_value;
 RAISE NOTICE 'EXISTING_GUARD_PASS: legacy ledger cascade denied, full deal/ledger/audit snapshot unchanged';
END $$;
ROLLBACK;
