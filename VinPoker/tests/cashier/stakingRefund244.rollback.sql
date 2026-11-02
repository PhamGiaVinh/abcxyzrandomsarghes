-- Actual PostgreSQL function, synthetic facts, every test fact/trigger rolled back.
BEGIN;
SET LOCAL statement_timeout='15s';
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c'
 AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_net');
END $$;
CREATE FUNCTION pg_temp.refund244_fault() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF current_setting('vinpoker.refund244_fault',true)=TG_TABLE_NAME
 AND (TG_TABLE_NAME<>'escrow_transactions' OR (to_jsonb(NEW)->>'amount_vnd')::bigint=60000)
 THEN RAISE EXCEPTION 'LOCAL_REFUND244_FAULT';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER local_refund244_purchase BEFORE UPDATE ON public.staking_purchases
 FOR EACH ROW EXECUTE FUNCTION pg_temp.refund244_fault();
CREATE TRIGGER local_refund244_ledger BEFORE INSERT ON public.escrow_transactions
 FOR EACH ROW EXECUTE FUNCTION pg_temp.refund244_fault();
CREATE TRIGGER local_refund244_audit BEFORE INSERT ON public.staking_audit_logs
 FOR EACH ROW EXECUTE FUNCTION pg_temp.refund244_fault();
DO $$
DECLARE actor uuid:='a364de8e-06b1-4428-a20d-ac614ec406e5'; deal uuid:=gen_random_uuid();
 req uuid:=gen_random_uuid(); club uuid; stage text; result jsonb; denied boolean;
 outsider uuid:=gen_random_uuid(); caller_role text;
BEGIN
 SELECT id INTO STRICT club FROM public.clubs ORDER BY id LIMIT 1;
 INSERT INTO public.user_roles(user_id,role) SELECT actor,'super_admin'
 WHERE NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=actor AND role='super_admin');
 INSERT INTO public.staking_deals(id,player_id,club_id,custom_event_name,custom_event_date,
  custom_event_venue,percentage_sold,markup,buy_in_amount_vnd,status)
 VALUES(deal,actor,club,'LOCAL244 rollback refund',now(),'LOCAL ONLY',10,1,1000000,'funded');
 INSERT INTO public.staking_purchases(id,deal_id,backer_id,percent,markup,amount_vnd,status,reference_code)
 SELECT ('e2440000-0000-4000-8000-'||lpad(ord::text,12,'0'))::uuid,
 deal,actor,5,1,amount,'funded',gen_random_uuid()::text
 FROM unnest(ARRAY[50000,60000]) WITH ORDINALITY AS amounts(amount,ord);
 INSERT INTO auth.users(id) VALUES(outsider);
 INSERT INTO public.user_roles(user_id,role) VALUES(outsider,'cashier');
 FOREACH caller_role IN ARRAY ARRAY['anon','authenticated'] LOOP
  ASSERT NOT has_function_privilege(caller_role,'public.commit_staking_refund_v1(uuid,uuid,uuid,text)','EXECUTE');
  ASSERT NOT has_table_privilege(caller_role,'public.staking_refund_receipts_v1','SELECT');
  PERFORM set_config('role',caller_role,true);
  denied:=false;
  BEGIN PERFORM public.commit_staking_refund_v1(actor,req,deal,'LOCAL TEST');
  EXCEPTION WHEN insufficient_privilege THEN denied:=true;END;
  ASSERT denied;
  PERFORM set_config('role','postgres',true);
 END LOOP;
 PERFORM set_config('role','service_role',true);
 denied:=false;
 BEGIN PERFORM public.commit_staking_refund_v1(gen_random_uuid(),req,deal,'LOCAL TEST');
 EXCEPTION WHEN insufficient_privilege THEN
  IF SQLERRM<>'staking_refund_forbidden' THEN RAISE;END IF;denied:=true;
 END;
 ASSERT denied;
 denied:=false;
 BEGIN PERFORM public.commit_staking_refund_v1(outsider,req,deal,'LOCAL TEST');
 EXCEPTION WHEN insufficient_privilege THEN
  IF SQLERRM<>'staking_refund_club_denied' THEN RAISE;END IF;denied:=true;
 END;
 ASSERT denied;
 PERFORM set_config('role','postgres',true);
 ASSERT (SELECT status='funded' FROM public.staking_deals WHERE id=deal);
 ASSERT NOT EXISTS(SELECT 1 FROM public.escrow_transactions WHERE deal_id=deal);
 ASSERT NOT EXISTS(SELECT 1 FROM public.staking_refund_receipts_v1 WHERE deal_id=deal);
 FOREACH stage IN ARRAY ARRAY['staking_purchases','escrow_transactions','staking_audit_logs'] LOOP
  PERFORM set_config('vinpoker.refund244_fault',stage,true);
  PERFORM set_config('role','service_role',true);
  denied:=false;
  BEGIN PERFORM public.commit_staking_refund_v1(actor,req,deal,'LOCAL TEST');
  EXCEPTION WHEN OTHERS THEN
   IF SQLERRM<>'LOCAL_REFUND244_FAULT' THEN RAISE;END IF;denied:=true;
  END;
  ASSERT denied;
  PERFORM set_config('role','postgres',true);
  ASSERT (SELECT status='funded' FROM public.staking_deals WHERE id=deal);
  ASSERT (SELECT count(*)=2 AND bool_and(status='funded') FROM public.staking_purchases WHERE deal_id=deal);
  ASSERT NOT EXISTS(SELECT 1 FROM public.escrow_transactions WHERE deal_id=deal);
  ASSERT NOT EXISTS(SELECT 1 FROM public.staking_refund_receipts_v1 WHERE deal_id=deal);
 END LOOP;
 PERFORM set_config('vinpoker.refund244_fault','off',true);
 PERFORM set_config('role','service_role',true);
 result:=public.commit_staking_refund_v1(actor,req,deal,'LOCAL TEST');
 ASSERT result->>'success'='true' AND (result->>'refunded_backers')::int=2;
 ASSERT public.commit_staking_refund_v1(actor,req,deal,'LOCAL TEST')=result;
 -- A different request cannot refund the same deal again.
 denied:=false;
 BEGIN PERFORM public.commit_staking_refund_v1(actor,gen_random_uuid(),deal,'LOCAL TEST');
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM<>'staking_refund_state_conflict' THEN RAISE;END IF;denied:=true;
 END;
 ASSERT denied;
 denied:=false;
 BEGIN PERFORM public.commit_staking_refund_v1(actor,req,deal,'CHANGED');
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM<>'staking_refund_payload_conflict' THEN RAISE;END IF;denied:=true;
 END;
 ASSERT denied;
 PERFORM set_config('role','postgres',true);
 ASSERT (SELECT status='deal_refunded' FROM public.staking_deals WHERE id=deal);
 ASSERT (SELECT count(*)=2 AND sum(amount_vnd)=110000 FROM public.escrow_transactions WHERE deal_id=deal AND transaction_type='refund');
 ASSERT (SELECT count(*)=1 FROM public.staking_audit_logs WHERE deal_id=deal AND action='refunded');
 ASSERT (SELECT count(*)=1 FROM public.staking_refund_receipts_v1 WHERE deal_id=deal);
 -- Receipt replay is not an authorization capability after actor revocation.
 DELETE FROM public.user_roles WHERE user_id=actor AND role IN('super_admin','cashier');
 PERFORM set_config('role','service_role',true);
 denied:=false;
 BEGIN PERFORM public.commit_staking_refund_v1(actor,req,deal,'LOCAL TEST');
 EXCEPTION WHEN insufficient_privilege THEN
  IF SQLERRM<>'staking_refund_forbidden' THEN RAISE;END IF;denied:=true;
 END;
 ASSERT denied;
 PERFORM set_config('role','postgres',true);
 ASSERT (SELECT count(*)=2 AND sum(amount_vnd)=110000 FROM public.escrow_transactions WHERE deal_id=deal AND transaction_type='refund');
 RAISE NOTICE 'REFUND244 native ACL/actor/tenant + fault rollback + commit/replay/conflict PASS';
END $$;
ROLLBACK;
