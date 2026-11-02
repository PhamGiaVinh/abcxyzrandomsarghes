BEGIN;
SET LOCAL statement_timeout='15s';
SET LOCAL request.jwt.claim.sub='';
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname IN('pg_net','pg_cron'));
END $$;
CREATE FUNCTION pg_temp.legacy260_fault() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF current_setting('vinpoker.legacy260_fault',true)='skip' AND TG_TABLE_NAME='staking_deals' THEN RETURN NULL;END IF;
 IF current_setting('vinpoker.legacy260_fault',true)=TG_TABLE_NAME
 AND (TG_TABLE_NAME<>'staking_audit_logs' OR to_jsonb(NEW)->>'action'='funded')
 THEN RAISE EXCEPTION 'LOCAL260_FAULT';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER local260_ledger BEFORE INSERT ON public.escrow_transactions FOR EACH ROW EXECUTE FUNCTION pg_temp.legacy260_fault();
CREATE TRIGGER local260_parent BEFORE UPDATE ON public.staking_deals FOR EACH ROW EXECUTE FUNCTION pg_temp.legacy260_fault();
CREATE TRIGGER local260_audit BEFORE INSERT ON public.staking_audit_logs FOR EACH ROW EXECUTE FUNCTION pg_temp.legacy260_fault();
CREATE TRIGGER local260_receipt BEFORE INSERT ON public.staking_legacy_funding_receipts_v1 FOR EACH ROW EXECUTE FUNCTION pg_temp.legacy260_fault();
DO $$
DECLARE actor uuid:='a364de8e-06b1-4428-a20d-ac614ec406e5';deal uuid:=gen_random_uuid();hybrid uuid:=gen_random_uuid();
 club uuid;amount bigint;result jsonb;denied boolean;stage text;caller_role text;
BEGIN
 SELECT id INTO STRICT club FROM public.clubs ORDER BY id LIMIT 1;
 INSERT INTO public.user_roles(user_id,role) SELECT actor,'super_admin' WHERE NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=actor AND role='super_admin');
 INSERT INTO public.staking_deals(id,player_id,backer_id,club_id,custom_event_name,custom_event_date,custom_event_venue,percentage_sold,markup,buy_in_amount_vnd,status)
 VALUES(deal,actor,actor,club,'LOCAL260 legacy funding rollback',now(),'LOCAL ONLY',10,1,1000000,'committed'),
 (hybrid,actor,actor,club,'LOCAL260 purchase flow guard',now(),'LOCAL ONLY',10,1,1000000,'committed');
 SELECT escrow_amount_vnd INTO amount FROM public.staking_deals WHERE id=deal;ASSERT amount=100000;
 INSERT INTO public.staking_purchases(id,deal_id,backer_id,percent,markup,amount_vnd,status,reference_code)
 VALUES(gen_random_uuid(),hybrid,actor,10,1,100000,'committed','LOCAL260');
 FOREACH caller_role IN ARRAY ARRAY['anon','authenticated'] LOOP
  ASSERT NOT has_function_privilege(caller_role,'public.commit_staking_legacy_funding_v1(uuid,uuid,text,bigint,text,text)','EXECUTE');
  ASSERT NOT has_table_privilege(caller_role,'public.staking_legacy_funding_receipts_v1','SELECT');
 END LOOP;
 ASSERT NOT has_table_privilege('service_role','public.staking_legacy_funding_receipts_v1','INSERT');
 PERFORM set_config('role','service_role',true);
 denied:=false;BEGIN PERFORM public.commit_staking_legacy_funding_v1(gen_random_uuid(),deal,'LOCAL260',amount,NULL,NULL);
 EXCEPTION WHEN insufficient_privilege THEN ASSERT SQLERRM='staking_legacy_funding_forbidden';denied:=true;END;ASSERT denied;
 denied:=false;BEGIN PERFORM public.commit_staking_legacy_funding_v1(actor,hybrid,'LOCAL260',amount,NULL,NULL);
 EXCEPTION WHEN OTHERS THEN ASSERT SQLERRM='staking_legacy_funding_purchase_flow_required';denied:=true;END;ASSERT denied;
 denied:=false;BEGIN PERFORM public.commit_staking_legacy_funding_v1(actor,deal,'LOCAL260',amount-1,NULL,NULL);
 EXCEPTION WHEN OTHERS THEN ASSERT SQLERRM='staking_legacy_funding_amount_mismatch';denied:=true;END;ASSERT denied;
 PERFORM set_config('role','postgres',true);
 FOREACH stage IN ARRAY ARRAY['escrow_transactions','staking_deals','staking_audit_logs','staking_legacy_funding_receipts_v1','skip'] LOOP
  PERFORM set_config('vinpoker.legacy260_fault',stage,true);PERFORM set_config('role','service_role',true);
  denied:=false;
  BEGIN PERFORM public.commit_staking_legacy_funding_v1(actor,deal,'LOCAL260',amount,'https://local.invalid/proof','LOCAL TEST');
  EXCEPTION WHEN OTHERS THEN
   IF stage='skip' THEN ASSERT SQLERRM='staking_legacy_funding_write_unverified';ELSE ASSERT SQLERRM='LOCAL260_FAULT';END IF;denied:=true;
  END;ASSERT denied;PERFORM set_config('role','postgres',true);
  ASSERT (SELECT status='committed' FROM public.staking_deals WHERE id=deal);
  ASSERT NOT EXISTS(SELECT 1 FROM public.escrow_transactions WHERE deal_id=deal);
  ASSERT NOT EXISTS(SELECT 1 FROM public.staking_audit_logs WHERE deal_id=deal AND action='funded');
  ASSERT NOT EXISTS(SELECT 1 FROM public.staking_legacy_funding_receipts_v1 WHERE deal_id=deal);
 END LOOP;
 PERFORM set_config('vinpoker.legacy260_fault','off',true);
 -- Old partial ledger evidence is not adopted or funded twice.
 INSERT INTO public.escrow_transactions(deal_id,transaction_type,amount_vnd,bank_tx_id,performed_by_admin_id) VALUES(deal,'fund_lock',amount,'LOCAL OLD',actor);
 PERFORM set_config('role','service_role',true);denied:=false;
 BEGIN PERFORM public.commit_staking_legacy_funding_v1(actor,deal,'LOCAL260',amount,NULL,NULL);
 EXCEPTION WHEN OTHERS THEN ASSERT SQLERRM='staking_legacy_funding_legacy_review_required';denied:=true;END;ASSERT denied;
 -- Keep the old-ledger branch isolated; append-only ledger must not be deleted.
 PERFORM set_config('role','postgres',true);
 RAISE NOTICE 'LEGACY260 native five-fault rollback/ACL/amount/hybrid/old-ledger guard PASS';
END $$;
ROLLBACK;

BEGIN;
SET LOCAL request.jwt.claim.sub='';
SET LOCAL statement_timeout='15s';
DO $$
DECLARE actor uuid:='a364de8e-06b1-4428-a20d-ac614ec406e5';deal uuid:=gen_random_uuid();club uuid;result jsonb;denied boolean;
BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 SELECT id INTO STRICT club FROM public.clubs ORDER BY id LIMIT 1;
 INSERT INTO public.user_roles(user_id,role) SELECT actor,'super_admin' WHERE NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=actor AND role='super_admin');
 INSERT INTO public.staking_deals(id,player_id,backer_id,club_id,custom_event_name,custom_event_date,custom_event_venue,percentage_sold,markup,buy_in_amount_vnd,status)
 VALUES(deal,actor,actor,club,'LOCAL260 replay rollback',now(),'LOCAL ONLY',10,1,1000000,'committed');
 PERFORM set_config('role','service_role',true);
 result:=public.commit_staking_legacy_funding_v1(actor,deal,'LOCAL260',100000,'https://local.invalid/proof','LOCAL TEST');
 ASSERT result=jsonb_build_object('success',true,'deal_id',deal,'status','locked');
 ASSERT public.commit_staking_legacy_funding_v1(actor,deal,'LOCAL260',100000,'https://local.invalid/proof','LOCAL TEST')=result;
 denied:=false;BEGIN PERFORM public.commit_staking_legacy_funding_v1(actor,deal,'OTHER',100000,'https://local.invalid/proof','LOCAL TEST');
 EXCEPTION WHEN OTHERS THEN ASSERT SQLERRM='staking_legacy_funding_payload_conflict';denied:=true;END;ASSERT denied;
 PERFORM set_config('role','postgres',true);
 ASSERT (SELECT status='locked' FROM public.staking_deals WHERE id=deal);
 ASSERT (SELECT count(*)=1 AND sum(amount_vnd)=100000 FROM public.escrow_transactions WHERE deal_id=deal AND transaction_type='fund_lock');
 ASSERT (SELECT count(*)=1 FROM public.staking_audit_logs WHERE deal_id=deal AND action='funded');
 ASSERT (SELECT count(*)=1 FROM public.staking_legacy_funding_receipts_v1 WHERE deal_id=deal);
 RAISE NOTICE 'LEGACY260 native exact replay/conflict/one fund_lock100K/locked/audit/receipt PASS';
END $$;
ROLLBACK;
