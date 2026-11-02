BEGIN;
SET LOCAL statement_timeout='15s';
SET LOCAL request.jwt.claim.sub='';
DO $$
DECLARE actor uuid:='a364de8e-06b1-4428-a20d-ac614ec406e5';deal uuid:=gen_random_uuid();purchase uuid:=gen_random_uuid();club uuid;
 value jsonb;denied boolean;audit_before jsonb;
BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname IN('pg_net','pg_cron'));
 ASSERT NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=actor AND role='super_admin');
 SELECT id INTO STRICT club FROM public.clubs WHERE owner_id<>actor AND NOT public.is_club_cashier(actor,id) ORDER BY id LIMIT 1;
 INSERT INTO public.user_roles(user_id,role) VALUES(actor,'super_admin');
 INSERT INTO public.staking_deals(id,player_id,club_id,custom_event_name,custom_event_date,custom_event_venue,percentage_sold,markup,buy_in_amount_vnd,status)
 VALUES(deal,actor,club,'LOCAL263 pending receipt rollback',now(),'LOCAL ONLY',10,1,1000000,'committed');
 INSERT INTO public.staking_purchases(id,deal_id,backer_id,percent,markup,amount_vnd,status,reference_code)
 VALUES(purchase,deal,actor,10,1,100000,'committed',purchase::text);
 SELECT jsonb_agg(to_jsonb(x) ORDER BY id) INTO audit_before FROM public.staking_audit_logs x WHERE deal_id=deal;
 PERFORM set_config('role','service_role',true);
 value:=public.get_staking_funding_receipt_v1(actor,purchase);
 ASSERT value=jsonb_build_object('success',false,'purchase_id',purchase,'state','not_recorded');
 ASSERT public.get_staking_funding_receipt_v1(actor,purchase)=value;
 PERFORM set_config('role','postgres',true);
 ASSERT NOT EXISTS(SELECT 1 FROM public.staking_funding_receipts_v1 WHERE purchase_id=purchase);
 ASSERT NOT EXISTS(SELECT 1 FROM public.escrow_transactions WHERE deal_id=deal);
 ASSERT (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.staking_audit_logs x WHERE deal_id=deal) IS NOT DISTINCT FROM audit_before;
 ASSERT NOT EXISTS(SELECT 1 FROM public.staking_funding_email_intents_v1 WHERE purchase_id=purchase);
 -- A legacy/unattributed ledger is not a clean zero-write outcome.
 INSERT INTO public.escrow_transactions(deal_id,transaction_type,amount_vnd,performed_by_admin_id,note)
 VALUES(deal,'fund_lock',100000,actor,'LOCAL263 ambiguous legacy');
 PERFORM set_config('role','service_role',true);
 ASSERT public.get_staking_funding_receipt_v1(actor,purchase)=jsonb_build_object('success',false,'purchase_id',purchase,'state','needs_attention');
 denied:=false;BEGIN PERFORM public.get_staking_funding_receipt_v1(gen_random_uuid(),purchase);EXCEPTION WHEN insufficient_privilege THEN denied:=true;END;ASSERT denied;
 denied:=false;BEGIN PERFORM public.get_staking_funding_receipt_v1(actor,gen_random_uuid());EXCEPTION WHEN insufficient_privilege THEN denied:=true;END;ASSERT denied;
 PERFORM set_config('role','postgres',true);
 DELETE FROM public.user_roles WHERE user_id=actor AND role='super_admin';
 INSERT INTO public.user_roles(user_id,role) SELECT actor,'cashier' WHERE NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=actor AND role='cashier');
 PERFORM set_config('role','service_role',true);denied:=false;
 BEGIN PERFORM public.get_staking_funding_receipt_v1(actor,purchase);EXCEPTION WHEN insufficient_privilege THEN denied:=true;END;ASSERT denied;
 PERFORM set_config('role','postgres',true);
 ASSERT NOT has_function_privilege('authenticated','public.get_staking_funding_receipt_v1(uuid,uuid)','EXECUTE');
 ASSERT NOT has_function_privilege('anon','public.get_staking_funding_receipt_v1(uuid,uuid)','EXECUTE');
 ASSERT (SELECT provolatile='s' FROM pg_proc WHERE oid='public.get_staking_funding_receipt_v1(uuid,uuid)'::regprocedure);
 RAISE NOTICE 'FUNDING263_PENDING_NO_WRITE_LEGACY_ATTENTION_DENIED_TENANT_ACL_PASS';
END $$;
ROLLBACK;
