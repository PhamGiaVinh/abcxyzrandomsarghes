-- Regression for trigger + explicit decrement; no retained data changes.
BEGIN;
SET LOCAL statement_timeout='15s';
DO $$
DECLARE actor uuid:='a364de8e-06b1-4428-a20d-ac614ec406e5'; deal uuid:=gen_random_uuid(); club uuid;
BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_net');
 SELECT id INTO STRICT club FROM public.clubs ORDER BY id LIMIT 1;
 INSERT INTO public.staking_deals(id,player_id,club_id,custom_event_name,custom_event_date,custom_event_venue,percentage_sold,markup,buy_in_amount_vnd,status)
 VALUES(deal,actor,club,'LOCAL494 rollback cancellation',now(),'LOCAL ONLY',10,1,1000000,'committing');
 INSERT INTO public.staking_purchases(id,deal_id,backer_id,percent,markup,amount_vnd,status,reference_code,committed_at)
 VALUES(gen_random_uuid(),deal,actor,5,1,50000,'committed',gen_random_uuid()::text,now()-interval '40 minutes'),
 (gen_random_uuid(),deal,actor,5,1,50000,'committed',gen_random_uuid()::text,now());
 ASSERT (SELECT filled_percent=10 FROM public.staking_deals WHERE id=deal);
 PERFORM public.auto_cancel_expired_commits();
 ASSERT (SELECT count(*)=1 FROM public.staking_purchases WHERE deal_id=deal AND status='committed');
 ASSERT (SELECT filled_percent=5 FROM public.staking_deals WHERE id=deal), 'remaining committed5 must not become filled0';
 UPDATE public.staking_purchases SET committed_at=now()-interval '40 minutes' WHERE deal_id=deal AND status='committed';
 PERFORM public.auto_cancel_expired_commits();
 ASSERT (SELECT filled_percent=0 AND status='listing' FROM public.staking_deals WHERE id=deal);
 UPDATE public.staking_deals SET status='committing',early_closed=true WHERE id=deal;
 INSERT INTO public.staking_purchases(id,deal_id,backer_id,percent,markup,amount_vnd,status,reference_code,committed_at)
 VALUES(gen_random_uuid(),deal,actor,5,1,50000,'committed',gen_random_uuid()::text,now()-interval '40 minutes');
 PERFORM public.auto_cancel_expired_commits();
 ASSERT (SELECT filled_percent=0 AND status='cancelled' AND cancellation_reason='early_closed_no_funded' FROM public.staking_deals WHERE id=deal);
 UPDATE public.staking_deals SET status='committing',early_closed=false WHERE id=deal;
 INSERT INTO public.staking_purchases(id,deal_id,backer_id,percent,markup,amount_vnd,status,reference_code,committed_at)
 VALUES(gen_random_uuid(),deal,actor,5,1,50000,'funded',gen_random_uuid()::text,now()-interval '40 minutes'),
 (gen_random_uuid(),deal,actor,5,1,50000,'committed',gen_random_uuid()::text,now()-interval '40 minutes');
 PERFORM public.auto_cancel_expired_commits();
 ASSERT (SELECT filled_percent=5 AND status='committing' FROM public.staking_deals WHERE id=deal);
 ASSERT (SELECT count(*)=1 FROM public.staking_purchases WHERE deal_id=deal AND status='funded');
 ASSERT NOT has_function_privilege('authenticated','public.auto_cancel_expired_commits()','EXECUTE');
 ASSERT has_function_privilege('service_role','public.auto_cancel_expired_commits()','EXECUTE');
 RAISE NOTICE 'CANCEL246 partial/full/earlyclosed/funded-preserved/ACL PASS';
END $$;
ROLLBACK;
