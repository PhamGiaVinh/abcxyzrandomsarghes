BEGIN;
SET LOCAL statement_timeout='15s';
SET LOCAL request.jwt.claim.sub='';
CREATE FUNCTION pg_temp.archive570_fault() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='staking_audit_logs' THEN
  IF NEW.metadata->>'operation'='archive_reviewed_listing' AND current_setting('vinpoker.archive570_fault',true)='audit_fault' THEN RAISE EXCEPTION 'LOCAL570_AUDIT_FAULT';END IF;
 ELSIF current_setting('vinpoker.archive570_fault',true)='receipt_fault' THEN RAISE EXCEPTION 'LOCAL570_RECEIPT_FAULT';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER local570_fault BEFORE INSERT ON public.staking_audit_logs FOR EACH ROW EXECUTE FUNCTION pg_temp.archive570_fault();
CREATE TRIGGER local570_fault BEFORE INSERT ON public.staking_listing_archive_receipts_v1 FOR EACH ROW EXECUTE FUNCTION pg_temp.archive570_fault();
DO $$
DECLARE actor uuid:='a364de8e-06b1-4428-a20d-ac614ec406e5';club uuid;deal uuid;mode text;failure text;expected text;before_value jsonb;after_value jsonb;
BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname IN('pg_net','pg_cron'));
 ASSERT NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=actor AND role='super_admin');
 SELECT id INTO STRICT club FROM public.clubs WHERE owner_id<>actor ORDER BY id LIMIT 1;
 INSERT INTO public.user_roles(user_id,role) VALUES(actor,'super_admin');
 FOREACH mode IN ARRAY ARRAY['purchase','legacy','review','outsider','audit_fault','receipt_fault'] LOOP
  deal:=gen_random_uuid();PERFORM set_config('vinpoker.archive570_fault','',true);
  INSERT INTO public.staking_deals(id,player_id,club_id,custom_event_name,custom_event_date,custom_event_venue,percentage_sold,markup,buy_in_amount_vnd,status,admin_review_status)
  VALUES(deal,actor,club,'LOCAL570 archive negative rollback',now(),'LOCAL ONLY',10,1,1000000,'listing','rejected');
  IF mode='purchase' THEN INSERT INTO public.staking_purchases(deal_id,backer_id,percent,markup,amount_vnd,status,reference_code) VALUES(deal,actor,10,1,100000,'committed',deal::text);END IF;
  IF mode='legacy' THEN INSERT INTO public.escrow_transactions(deal_id,transaction_type,amount_vnd,performed_by_admin_id,note) VALUES(deal,'fund_lock',100000,actor,'LOCAL570 legacy dependency');END IF;
  SELECT jsonb_build_object('deal',(SELECT to_jsonb(x) FROM public.staking_deals x WHERE id=deal),
   'audit',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.staking_audit_logs x WHERE deal_id=deal),
   'purchase',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.staking_purchases x WHERE deal_id=deal),
   'ledger',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.escrow_transactions x WHERE deal_id=deal),
   'receipt',(SELECT to_jsonb(x) FROM public.staking_listing_archive_receipts_v1 x WHERE deal_id=deal),
   'notifications',(SELECT count(*) FROM public.notifications)) INTO before_value;
  PERFORM set_config('vinpoker.archive570_fault',mode,true);failure:=NULL;
  PERFORM set_config('role','service_role',true);
  BEGIN PERFORM public.archive_staking_listing_v1(CASE WHEN mode='outsider' THEN gen_random_uuid() ELSE actor END,deal,CASE WHEN mode='review' THEN 'approved' ELSE 'rejected' END);
  EXCEPTION WHEN OTHERS THEN failure:=SQLERRM;END;
  PERFORM set_config('role','postgres',true);
  expected:=CASE WHEN mode IN('purchase','legacy') THEN 'staking_archive_dependencies_present' WHEN mode='review' THEN 'staking_archive_state_conflict' WHEN mode='outsider' THEN 'staking_archive_forbidden' WHEN mode='audit_fault' THEN 'LOCAL570_AUDIT_FAULT' ELSE 'LOCAL570_RECEIPT_FAULT' END;
  ASSERT failure=expected,format('Expected %s, got %s',expected,failure);
  SELECT jsonb_build_object('deal',(SELECT to_jsonb(x) FROM public.staking_deals x WHERE id=deal),
   'audit',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.staking_audit_logs x WHERE deal_id=deal),
   'purchase',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.staking_purchases x WHERE deal_id=deal),
   'ledger',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.escrow_transactions x WHERE deal_id=deal),
   'receipt',(SELECT to_jsonb(x) FROM public.staking_listing_archive_receipts_v1 x WHERE deal_id=deal),
   'notifications',(SELECT count(*) FROM public.notifications)) INTO after_value;
  ASSERT before_value=after_value;
 END LOOP;
 RAISE NOTICE 'ARCHIVE570_PURCHASE_LEGACY_REVIEW_OUTSIDER_AUDITFAULT_RECEIPTFAULT_FULL_NO_DELTA_PASS';
END $$;
ROLLBACK;
