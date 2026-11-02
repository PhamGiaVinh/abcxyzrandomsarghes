BEGIN;
SET LOCAL statement_timeout='15s';
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_net');
END $$;
CREATE FUNCTION pg_temp.funding245_fault() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF current_setting('vinpoker.funding245_fault',true)=TG_TABLE_NAME THEN RAISE EXCEPTION 'LOCAL_FUNDING245_FAULT';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER local_funding245_ledger BEFORE INSERT ON public.escrow_transactions FOR EACH ROW EXECUTE FUNCTION pg_temp.funding245_fault();
CREATE TRIGGER local_funding245_audit BEFORE INSERT ON public.staking_audit_logs FOR EACH ROW EXECUTE FUNCTION pg_temp.funding245_fault();
CREATE TRIGGER local_funding245_parent BEFORE UPDATE ON public.staking_deals FOR EACH ROW EXECUTE FUNCTION pg_temp.funding245_fault();
DO $$
DECLARE actor uuid:='a364de8e-06b1-4428-a20d-ac614ec406e5'; deal uuid:=gen_random_uuid();
 p1 uuid:=gen_random_uuid(); p2 uuid:=gen_random_uuid(); club uuid; result jsonb; denied boolean; stage text;
 outsider uuid:=gen_random_uuid(); caller_role text;
BEGIN
 SELECT id INTO STRICT club FROM public.clubs ORDER BY id LIMIT 1;
 INSERT INTO public.user_roles(user_id,role) SELECT actor,'super_admin' WHERE NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=actor AND role='super_admin');
 INSERT INTO public.staking_deals(id,player_id,club_id,custom_event_name,custom_event_date,custom_event_venue,percentage_sold,markup,buy_in_amount_vnd,status)
 VALUES(deal,actor,club,'LOCAL245 rollback funding',now(),'LOCAL ONLY',10,1,1000000,'committing');
 INSERT INTO public.staking_purchases(id,deal_id,backer_id,percent,markup,amount_vnd,status,reference_code)
 VALUES(p1,deal,actor,5,1,50000,'committed',p1::text),(p2,deal,actor,5,1,50000,'committed',p2::text);
 INSERT INTO auth.users(id) VALUES(outsider);
 INSERT INTO public.user_roles(user_id,role) VALUES(outsider,'cashier');
 FOREACH caller_role IN ARRAY ARRAY['anon','authenticated'] LOOP
  ASSERT NOT has_function_privilege(caller_role,'public.commit_staking_funding_v1(uuid,uuid,text,text)','EXECUTE');
  ASSERT NOT has_table_privilege(caller_role,'public.staking_funding_receipts_v1','SELECT');
  PERFORM set_config('role',caller_role,true);
  denied:=false;
  BEGIN PERFORM public.commit_staking_funding_v1(actor,p1,'LOCAL BANK','LOCAL TEST');
  EXCEPTION WHEN insufficient_privilege THEN denied:=true;END;
  ASSERT denied;
  PERFORM set_config('role','postgres',true);
 END LOOP;
 PERFORM set_config('role','service_role',true);
 denied:=false;
 BEGIN PERFORM public.commit_staking_funding_v1(outsider,p1,'LOCAL BANK','LOCAL TEST');
 EXCEPTION WHEN insufficient_privilege THEN
  IF SQLERRM<>'staking_funding_club_denied' THEN RAISE;END IF;denied:=true;
 END;
 ASSERT denied;
 denied:=false;
 BEGIN PERFORM public.commit_staking_funding_v1(gen_random_uuid(),p1,'LOCAL BANK','LOCAL TEST');
 EXCEPTION WHEN insufficient_privilege THEN
  IF SQLERRM<>'staking_funding_forbidden' THEN RAISE;END IF;denied:=true;
 END;
 ASSERT denied;
 PERFORM set_config('role','postgres',true);
 ASSERT NOT EXISTS(SELECT 1 FROM public.escrow_transactions WHERE deal_id=deal);
 -- Legacy funded without a receipt must never manufacture a fund_lock on retry.
 UPDATE public.staking_purchases SET status='funded' WHERE id=p1;
 PERFORM set_config('role','service_role',true);
 denied:=false;
 BEGIN PERFORM public.commit_staking_funding_v1(actor,p1,'LOCAL BANK','LOCAL TEST');
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM<>'staking_funding_legacy_review_required' THEN RAISE;END IF;denied:=true;
 END;
 ASSERT denied;
 PERFORM set_config('role','postgres',true);
 UPDATE public.staking_purchases SET status='auto_cancelled' WHERE id=p1;
 PERFORM set_config('role','service_role',true);
 denied:=false;
 BEGIN PERFORM public.commit_staking_funding_v1(actor,p1,'LOCAL BANK','LOCAL TEST');
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM<>'staking_funding_state_conflict' THEN RAISE;END IF;denied:=true;
 END;
 ASSERT denied;
 PERFORM set_config('role','postgres',true);
 ASSERT NOT EXISTS(SELECT 1 FROM public.escrow_transactions WHERE deal_id=deal);
 ASSERT NOT EXISTS(SELECT 1 FROM public.staking_funding_receipts_v1 WHERE purchase_id=p1);
 UPDATE public.staking_purchases SET status='committed' WHERE id=p1;
 FOREACH stage IN ARRAY ARRAY['escrow_transactions','staking_audit_logs','staking_deals'] LOOP
  PERFORM set_config('vinpoker.funding245_fault',stage,true);
  PERFORM set_config('role','service_role',true);
  denied:=false;
  BEGIN PERFORM public.commit_staking_funding_v1(actor,p1,'LOCAL BANK','LOCAL TEST');
  EXCEPTION WHEN OTHERS THEN
   IF SQLERRM<>'LOCAL_FUNDING245_FAULT' THEN RAISE;END IF;denied:=true;
  END;
  ASSERT denied;
  PERFORM set_config('role','postgres',true);
  ASSERT (SELECT status='committed' FROM public.staking_purchases WHERE id=p1);
  ASSERT NOT EXISTS(SELECT 1 FROM public.escrow_transactions WHERE deal_id=deal);
  ASSERT NOT EXISTS(SELECT 1 FROM public.staking_funding_receipts_v1 WHERE purchase_id=p1);
 END LOOP;
 PERFORM set_config('vinpoker.funding245_fault','off',true);
 PERFORM set_config('role','service_role',true);
 result:=public.commit_staking_funding_v1(actor,p1,'LOCAL BANK','LOCAL TEST');
 ASSERT result->>'purchase_status'='funded' AND result->>'deal_status'='committing';
 ASSERT public.commit_staking_funding_v1(actor,p1,'LOCAL BANK','LOCAL TEST')=result;
 denied:=false;
 BEGIN PERFORM public.commit_staking_funding_v1(actor,p1,'CHANGED BANK','LOCAL TEST');
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM<>'staking_funding_payload_conflict' THEN RAISE;END IF;denied:=true;
 END;
 ASSERT denied;
 -- Another privileged actor cannot adopt the original actor's receipt intent.
 PERFORM set_config('role','postgres',true);
 INSERT INTO public.user_roles(user_id,role) VALUES(outsider,'super_admin');
 PERFORM set_config('role','service_role',true);
 denied:=false;
 BEGIN PERFORM public.commit_staking_funding_v1(outsider,p1,'LOCAL BANK','LOCAL TEST');
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM<>'staking_funding_payload_conflict' THEN RAISE;END IF;denied:=true;
 END;
 ASSERT denied;
 result:=public.commit_staking_funding_v1(actor,p2,'LOCAL BANK2','LOCAL TEST');
 ASSERT result->>'deal_status'='funded';
 ASSERT (result->>'total_funded_percent')::int=10 AND (result->>'total_committed_percent')::int=0;
 PERFORM public.commit_staking_refund_v1(actor,gen_random_uuid(),deal,'LOCAL refund after funding');
 PERFORM set_config('role','postgres',true);
 ASSERT (SELECT count(*)=2 AND sum(amount_vnd)=100000 FROM public.escrow_transactions WHERE deal_id=deal AND transaction_type='fund_lock');
 ASSERT (SELECT count(*)=2 AND sum(amount_vnd)=100000 FROM public.escrow_transactions WHERE deal_id=deal AND transaction_type='refund');
 ASSERT (SELECT status='deal_refunded' FROM public.staking_deals WHERE id=deal);
 RAISE NOTICE 'FUNDING245 fault rollback/replay/full-funding/refund conservation PASS';
END $$;
ROLLBACK;
