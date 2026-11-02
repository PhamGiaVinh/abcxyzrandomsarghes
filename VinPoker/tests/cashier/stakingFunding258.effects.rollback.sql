BEGIN;
SET LOCAL statement_timeout='15s';
DO $$ BEGIN ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
ASSERT NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname IN('pg_net','pg_cron'));END $$;
CREATE FUNCTION pg_temp.funding258_fault() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN IF current_setting('vinpoker.funding258_fault',true)='on' THEN RAISE EXCEPTION 'LOCAL258_INTENT_FAULT';END IF;RETURN NEW;END $$;
CREATE TRIGGER local_funding258_fault BEFORE INSERT ON public.staking_funding_email_intents_v1 FOR EACH ROW EXECUTE FUNCTION pg_temp.funding258_fault();
DO $$ DECLARE actor uuid:='a364de8e-06b1-4428-a20d-ac614ec406e5';deal uuid:=gen_random_uuid();purchase uuid:=gen_random_uuid();club uuid;
 result jsonb;denied boolean:=false;notices integer;
BEGIN
 SELECT id INTO STRICT club FROM public.clubs ORDER BY id LIMIT 1;
 INSERT INTO public.user_roles(user_id,role) SELECT actor,'super_admin' WHERE NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=actor AND role='super_admin');
 INSERT INTO public.staking_deals(id,player_id,club_id,custom_event_name,custom_event_date,custom_event_venue,percentage_sold,markup,buy_in_amount_vnd,status)
 VALUES(deal,actor,club,'LOCAL258 funding effects rollback',now(),'LOCAL ONLY',10,1,1000000,'committed');
 INSERT INTO public.staking_purchases(id,deal_id,backer_id,percent,markup,amount_vnd,status,reference_code)
 VALUES(purchase,deal,actor,10,1,100000,'committed',purchase::text);
 PERFORM set_config('vinpoker.funding258_fault','on',true);PERFORM set_config('role','service_role',true);
 BEGIN PERFORM public.commit_staking_funding_v1(actor,purchase,'LOCAL_BANK','LOCAL258');
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'LOCAL258_INTENT_FAULT' THEN RAISE;END IF;denied:=true;END;ASSERT denied;
 PERFORM set_config('role','postgres',true);
 ASSERT (SELECT status='committed' FROM public.staking_purchases WHERE id=purchase);
 ASSERT (SELECT status='committed' FROM public.staking_deals WHERE id=deal);
 ASSERT NOT EXISTS(SELECT 1 FROM public.escrow_transactions WHERE deal_id=deal);
 ASSERT NOT EXISTS(SELECT 1 FROM public.staking_funding_receipts_v1 WHERE purchase_id=purchase);
 ASSERT NOT EXISTS(SELECT 1 FROM public.staking_audit_logs WHERE deal_id=deal AND action='admin_confirmed_funded');
 ASSERT NOT EXISTS(SELECT 1 FROM public.notifications WHERE data->>'deal_id'=deal::text);
 PERFORM set_config('vinpoker.funding258_fault','off',true);PERFORM set_config('role','service_role',true);
 result:=public.commit_staking_funding_v1(actor,purchase,'LOCAL_BANK','LOCAL258');
 ASSERT result->>'success'='true';PERFORM set_config('role','postgres',true);
 SELECT count(*) INTO notices FROM public.notifications WHERE data->>'deal_id'=deal::text;
 PERFORM set_config('role','service_role',true);ASSERT public.commit_staking_funding_v1(actor,purchase,'LOCAL_BANK','LOCAL258')=result;
 PERFORM set_config('role','postgres',true);
 ASSERT (SELECT count(*)=1 AND sum(amount_vnd)=100000 FROM public.escrow_transactions WHERE deal_id=deal AND transaction_type='fund_lock');
 ASSERT (SELECT count(*)=2 AND count(DISTINCT recipient_role)=2 AND bool_and((payload->>'amount_vnd')::bigint=100000)
 FROM public.staking_funding_email_intents_v1 WHERE purchase_id=purchase AND state='pending');
 ASSERT (SELECT count(*)=notices FROM public.notifications WHERE data->>'deal_id'=deal::text);
 ASSERT NOT has_table_privilege('authenticated','public.staking_funding_email_intents_v1','SELECT');
 ASSERT NOT has_table_privilege('service_role','public.staking_funding_email_intents_v1','SELECT');
 RAISE NOTICE 'FUNDING258 intentfailure allmoney/audit/parent/noticesrollback +100Kfundonce/2roleintents/replaynoextras/privateACL PASS';
END $$;
ROLLBACK;
