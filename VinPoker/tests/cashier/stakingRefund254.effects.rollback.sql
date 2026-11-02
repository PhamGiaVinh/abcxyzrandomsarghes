BEGIN;
SET LOCAL statement_timeout='15s';
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname IN('pg_net','pg_cron'));
END $$;
CREATE FUNCTION pg_temp.refund254_fault() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN IF current_setting('vinpoker.refund254_fault',true)='on' THEN RAISE EXCEPTION 'LOCAL254_INTENT_FAULT';END IF;RETURN NEW;END $$;
CREATE TRIGGER local_refund254_fault BEFORE INSERT ON public.staking_refund_email_intents_v1 FOR EACH ROW EXECUTE FUNCTION pg_temp.refund254_fault();
DO $$
DECLARE actor uuid:='a364de8e-06b1-4428-a20d-ac614ec406e5'; deal uuid:=gen_random_uuid(); req uuid:=gen_random_uuid();
 p1 uuid:=gen_random_uuid(); p2 uuid:=gen_random_uuid(); club uuid; result jsonb; denied boolean:=false; notices integer;
BEGIN
 SELECT id INTO STRICT club FROM public.clubs ORDER BY id LIMIT 1;
 INSERT INTO public.user_roles(user_id,role) SELECT actor,'super_admin' WHERE NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=actor AND role='super_admin');
 INSERT INTO public.staking_deals(id,player_id,club_id,custom_event_name,custom_event_date,custom_event_venue,percentage_sold,markup,buy_in_amount_vnd,status)
 VALUES(deal,actor,club,'LOCAL254 rollback effects',now(),'LOCAL ONLY',10,1,1000000,'funded');
 INSERT INTO public.staking_purchases(id,deal_id,backer_id,percent,markup,amount_vnd,status,reference_code)
 VALUES(p1,deal,actor,5,1,50000,'funded',p1::text),(p2,deal,actor,5,1,60000,'funded',p2::text);
 PERFORM set_config('vinpoker.refund254_fault','on',true);
 PERFORM set_config('role','service_role',true);
 BEGIN PERFORM public.commit_staking_refund_v1(actor,req,deal,'LOCAL254 test');
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'LOCAL254_INTENT_FAULT' THEN RAISE;END IF;denied:=true;END;
 ASSERT denied;
 PERFORM set_config('role','postgres',true);
 ASSERT (SELECT status='funded' FROM public.staking_deals WHERE id=deal);
 ASSERT (SELECT count(*)=2 FROM public.staking_purchases WHERE deal_id=deal AND status='funded');
 ASSERT NOT EXISTS(SELECT 1 FROM public.escrow_transactions WHERE deal_id=deal);
 ASSERT NOT EXISTS(SELECT 1 FROM public.staking_refund_receipts_v1 WHERE deal_id=deal);
 ASSERT NOT EXISTS(SELECT 1 FROM public.notifications WHERE data->>'deal_id'=deal::text);
 PERFORM set_config('vinpoker.refund254_fault','off',true);
 PERFORM set_config('role','service_role',true);
 result:=public.commit_staking_refund_v1(actor,req,deal,'LOCAL254 test');
 ASSERT public.commit_staking_refund_v1(actor,req,deal,'LOCAL254 test')=result;
 PERFORM set_config('role','postgres',true);
 ASSERT (SELECT count(*)=2 AND sum(amount_vnd)=110000 FROM public.escrow_transactions WHERE deal_id=deal AND transaction_type='refund');
 ASSERT (SELECT count(*)=2 AND sum((payload->>'amount_vnd')::bigint)=110000 FROM public.staking_refund_email_intents_v1 WHERE deal_id=deal AND state='pending');
 SELECT 3+count(*) INTO notices FROM public.club_cashiers WHERE club_id=club AND user_id<>actor;
 ASSERT (SELECT count(*)=notices FROM public.notifications WHERE data->>'deal_id'=deal::text);
 ASSERT NOT has_table_privilege('service_role','public.staking_refund_email_intents_v1','SELECT');
 ASSERT NOT has_table_privilege('authenticated','public.staking_refund_email_intents_v1','SELECT');
 ASSERT NOT has_function_privilege('anon','public._staking_refund_effect_intents_v1()','EXECUTE');
 RAISE NOTICE 'REFUND254 native intentfault rolls back money/audit/receipt/notices; replay queues once; 110K conservation/privateACL PASS';
END $$;
ROLLBACK;
