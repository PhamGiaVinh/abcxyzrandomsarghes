BEGIN;
SET LOCAL statement_timeout='15s';
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_net');
END $$;
CREATE FUNCTION pg_temp.commit249_fault() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.action::text='committed' AND current_setting('vinpoker.commit249_fault',true)='on' THEN RAISE EXCEPTION 'LOCAL_COMMIT249_AUDIT_FAULT';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER local_commit249_fault BEFORE INSERT ON public.staking_audit_logs FOR EACH ROW EXECUTE FUNCTION pg_temp.commit249_fault();
DO $$
DECLARE player uuid:='a364de8e-06b1-4428-a20d-ac614ec406e5'; buyer uuid:=gen_random_uuid(); buyer2 uuid:=gen_random_uuid();
 deal uuid:=gen_random_uuid(); req uuid:=gen_random_uuid(); club uuid; result jsonb; denied boolean;
 expected_notifications integer;
BEGIN
 SELECT id INTO STRICT club FROM public.clubs ORDER BY id LIMIT 1;
 INSERT INTO auth.users(id) VALUES(buyer),(buyer2);
 INSERT INTO public.profiles(user_id,display_name,bank_name,bank_account_number,bank_account_holder)
 VALUES(buyer,'LOCAL249 '||buyer::text,'LOCAL','LOCAL_ONLY','TEST'),(buyer2,'LOCAL249 '||buyer2::text,'LOCAL','LOCAL_ONLY','TEST');
 INSERT INTO public.platform_bank_accounts(bank_name,account_number,account_holder,account_type,club_id)
 VALUES('LOCAL','LOCAL_ONLY','TEST','escrow',club);
 INSERT INTO public.staking_deals(id,player_id,club_id,custom_event_name,custom_event_date,custom_event_venue,percentage_sold,markup,buy_in_amount_vnd,status,admin_review_status)
 VALUES(deal,player,club,'LOCAL249 rollback commitment',now(),'LOCAL ONLY',10,1,1000000,'listing','approved');
 PERFORM set_config('vinpoker.commit249_fault','on',true);
 PERFORM set_config('role','service_role',true);
 denied:=false;
 BEGIN PERFORM public.commit_staking_purchase_v1(buyer,req,deal,10);
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM<>'LOCAL_COMMIT249_AUDIT_FAULT' THEN RAISE;END IF;denied:=true;
 END;
 ASSERT denied;
 PERFORM set_config('role','postgres',true);
 ASSERT NOT EXISTS(SELECT 1 FROM public.staking_purchases WHERE deal_id=deal);
 ASSERT (SELECT filled_percent=0 AND status='listing' FROM public.staking_deals WHERE id=deal);
 PERFORM set_config('vinpoker.commit249_fault','off',true);
 PERFORM set_config('role','service_role',true);
 result:=public.commit_staking_purchase_v1(buyer,req,deal,10);
 ASSERT (result->>'amount_vnd')::bigint=100000 AND (result->>'filled_percent')::int=10;
 ASSERT public.commit_staking_purchase_v1(buyer,req,deal,10)=result;
 denied:=false;
 BEGIN PERFORM public.commit_staking_purchase_v1(buyer2,gen_random_uuid(),deal,10);
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM<>'staking_purchase_state_conflict' THEN RAISE;END IF;denied:=true;
 END;
 ASSERT denied;
 denied:=false;
 BEGIN PERFORM public.commit_staking_purchase_v1(buyer,req,deal,5);
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM<>'staking_purchase_payload_conflict' THEN RAISE;END IF;denied:=true;
 END;
 ASSERT denied;
 PERFORM set_config('role','postgres',true);
 ASSERT (SELECT count(*)=1 AND sum(percent)=10 AND sum(amount_vnd)=100000 FROM public.staking_purchases WHERE deal_id=deal);
 ASSERT (SELECT count(*)=1 FROM public.staking_audit_logs WHERE deal_id=deal AND action='committed');
 ASSERT (SELECT count(*)=1 FROM public.staking_purchase_receipts_v1 WHERE deal_id=deal);
 SELECT count(DISTINCT recipient) INTO expected_notifications FROM (
  SELECT player AS recipient UNION ALL SELECT user_id FROM public.club_cashiers WHERE club_id=club AND user_id<>buyer
  UNION ALL SELECT owner_id FROM public.clubs WHERE id=club AND owner_id IS NOT NULL
 ) recipients;
 ASSERT (SELECT count(*)=expected_notifications FROM public.notifications
  WHERE data->>'purchase_id'=result->>'purchase_id');
 ASSERT (SELECT count(*)=1 FROM public.notifications WHERE user_id=player
  AND title='Có Backer mới cam kết' AND data->>'purchase_id'=result->>'purchase_id');
 ASSERT NOT has_function_privilege('authenticated','public.commit_staking_purchase_v1(uuid,uuid,uuid,integer)','EXECUTE');
 RAISE NOTICE 'COMMIT249 native auditrollback/amount/capacity/replay/conflict PASS';
END $$;
ROLLBACK;
