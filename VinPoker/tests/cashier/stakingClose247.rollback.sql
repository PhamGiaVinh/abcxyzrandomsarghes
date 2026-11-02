BEGIN;
SET LOCAL statement_timeout='15s';
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_net');
END $$;
CREATE FUNCTION pg_temp.close247_fault() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.action::text='player_close_early' AND current_setting('vinpoker.close247_fault',true)='on' THEN RAISE EXCEPTION 'LOCAL_CLOSE247_AUDIT_FAULT';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER local_close247_fault BEFORE INSERT ON public.staking_audit_logs FOR EACH ROW EXECUTE FUNCTION pg_temp.close247_fault();
DO $$
DECLARE actor uuid:='a364de8e-06b1-4428-a20d-ac614ec406e5'; deal uuid:=gen_random_uuid(); empty_deal uuid:=gen_random_uuid(); club uuid; result jsonb; denied boolean;
BEGIN
 SELECT id INTO STRICT club FROM public.clubs ORDER BY id LIMIT 1;
 INSERT INTO public.staking_deals(id,player_id,club_id,custom_event_name,custom_event_date,custom_event_venue,percentage_sold,markup,buy_in_amount_vnd,status)
 VALUES(deal,actor,club,'LOCAL247 partial',now(),'LOCAL ONLY',10,1,1000000,'committing'),
 (empty_deal,actor,club,'LOCAL247 empty',now(),'LOCAL ONLY',10,1,1000000,'listing');
 INSERT INTO public.staking_purchases(id,deal_id,backer_id,percent,markup,amount_vnd,status,reference_code)
 VALUES(gen_random_uuid(),deal,actor,5,1,50000,'committed',gen_random_uuid()::text);
 PERFORM set_config('role','service_role',true);
 denied:=false;
 BEGIN PERFORM public.close_staking_deal_early_v1(gen_random_uuid(),deal);
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;END;
 ASSERT denied;
 PERFORM set_config('vinpoker.close247_fault','on',true);
 denied:=false;
 BEGIN PERFORM public.close_staking_deal_early_v1(actor,deal);
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM<>'LOCAL_CLOSE247_AUDIT_FAULT' THEN RAISE;END IF;denied:=true;
 END;
 ASSERT denied;
 PERFORM set_config('role','postgres',true);
 ASSERT (SELECT status='committing' AND NOT early_closed FROM public.staking_deals WHERE id=deal);
 ASSERT NOT EXISTS(SELECT 1 FROM public.staking_close_early_receipts_v1 WHERE deal_id=deal);
 PERFORM set_config('vinpoker.close247_fault','off',true);
 PERFORM set_config('role','service_role',true);
 result:=public.close_staking_deal_early_v1(actor,deal);
 ASSERT result->>'deal_status'='committed' AND (result->>'filled_percent')::int=5;
 ASSERT public.close_staking_deal_early_v1(actor,deal)=result;
 result:=public.close_staking_deal_early_v1(actor,empty_deal);
 ASSERT result->>'deal_status'='cancelled' AND (result->>'filled_percent')::int=0;
 PERFORM set_config('role','postgres',true);
 ASSERT (SELECT count(*)=1 FROM public.staking_audit_logs WHERE deal_id=deal AND action='player_close_early');
 ASSERT NOT EXISTS(SELECT 1 FROM public.escrow_transactions WHERE deal_id IN(deal,empty_deal));
 ASSERT NOT has_function_privilege('authenticated','public.close_staking_deal_early_v1(uuid,uuid)','EXECUTE');
 RAISE NOTICE 'CLOSE247 native owner/partial/empty/auditrollback/replay PASS';
END $$;
ROLLBACK;
