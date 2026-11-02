BEGIN;
SET LOCAL statement_timeout='15s';
SET LOCAL request.jwt.claim.sub='';
DO $$
DECLARE actor uuid:='a364de8e-06b1-4428-a20d-ac614ec406e5';deal uuid:=gen_random_uuid();purchase uuid:=gen_random_uuid();club uuid;
 job jsonb;value jsonb;before_value jsonb;after_value jsonb;denied boolean;
BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname IN('pg_net','pg_cron'));
 ASSERT NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=actor AND role='super_admin');
 SELECT id INTO STRICT club FROM public.clubs WHERE owner_id<>actor AND NOT public.is_club_cashier(actor,id) ORDER BY id LIMIT 1;
 INSERT INTO public.user_roles(user_id,role) VALUES(actor,'super_admin');
 INSERT INTO public.staking_deals(id,player_id,club_id,custom_event_name,custom_event_date,custom_event_venue,percentage_sold,markup,buy_in_amount_vnd,status)
 VALUES(deal,actor,club,'LOCAL261 receipt read rollback',now(),'LOCAL ONLY',10,1,1000000,'committed');
 INSERT INTO public.staking_purchases(id,deal_id,backer_id,percent,markup,amount_vnd,status,reference_code)
 VALUES(purchase,deal,actor,10,1,100000,'committed',purchase::text);
 PERFORM set_config('role','service_role',true);
 PERFORM public.commit_staking_funding_v1(actor,purchase,NULL,NULL);
 job:=public.claim_staking_funding_email_v1(actor,purchase);
 ASSERT public.finish_staking_funding_email_v1(actor,purchase,(job->>'id')::uuid,(job->>'lease_token')::uuid,'LOCAL261_ACK',NULL);
 value:=public.get_staking_funding_receipt_v1(actor,purchase);
 ASSERT value->>'success'='true' AND value->>'purchase_id'=purchase::text AND value->>'purchase_status'='funded';
 ASSERT value#>>'{delivery,state}'='pending' AND (value#>>'{delivery,delivered}')::int=1 AND (value#>>'{delivery,pending}')::int=1;
 ASSERT NOT value ? 'payload' AND NOT value ? 'bank_tx_id';
 PERFORM set_config('role','postgres',true);
 SELECT jsonb_build_object('deal',(SELECT to_jsonb(x) FROM public.staking_deals x WHERE id=deal),
  'purchase',(SELECT to_jsonb(x) FROM public.staking_purchases x WHERE id=purchase),
  'ledger',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.escrow_transactions x WHERE deal_id=deal),
  'audit',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.staking_audit_logs x WHERE deal_id=deal),
  'receipt',(SELECT to_jsonb(x) FROM public.staking_funding_receipts_v1 x WHERE purchase_id=purchase),
  'email',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.staking_funding_email_intents_v1 x WHERE purchase_id=purchase)) INTO before_value;
 PERFORM set_config('role','service_role',true);
 ASSERT public.get_staking_funding_receipt_v1(actor,purchase)=value;
 ASSERT public.get_staking_funding_receipt_v1(actor,purchase)=value;
 denied:=false;BEGIN PERFORM public.get_staking_funding_receipt_v1(gen_random_uuid(),purchase);
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;END;ASSERT denied;
 denied:=false;BEGIN PERFORM public.get_staking_funding_receipt_v1(actor,gen_random_uuid());
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;END;ASSERT denied;
 PERFORM set_config('role','postgres',true);
 SELECT jsonb_build_object('deal',(SELECT to_jsonb(x) FROM public.staking_deals x WHERE id=deal),
  'purchase',(SELECT to_jsonb(x) FROM public.staking_purchases x WHERE id=purchase),
  'ledger',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.escrow_transactions x WHERE deal_id=deal),
  'audit',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.staking_audit_logs x WHERE deal_id=deal),
  'receipt',(SELECT to_jsonb(x) FROM public.staking_funding_receipts_v1 x WHERE purchase_id=purchase),
  'email',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.staking_funding_email_intents_v1 x WHERE purchase_id=purchase)) INTO after_value;
 ASSERT before_value=after_value;
 DELETE FROM public.user_roles WHERE user_id=actor AND role='super_admin';
 INSERT INTO public.user_roles(user_id,role) SELECT actor,'cashier' WHERE NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=actor AND role='cashier');
 PERFORM set_config('role','service_role',true);denied:=false;
 BEGIN PERFORM public.get_staking_funding_receipt_v1(actor,purchase);EXCEPTION WHEN insufficient_privilege THEN denied:=true;END;ASSERT denied;
 PERFORM set_config('role','postgres',true);
 ASSERT NOT has_function_privilege('anon','public.get_staking_funding_receipt_v1(uuid,uuid)','EXECUTE');
 ASSERT NOT has_function_privilege('authenticated','public.get_staking_funding_receipt_v1(uuid,uuid)','EXECUTE');
 ASSERT has_function_privilege('service_role','public.get_staking_funding_receipt_v1(uuid,uuid)','EXECUTE');
 ASSERT (SELECT provolatile='s' FROM pg_proc WHERE oid='public.get_staking_funding_receipt_v1(uuid,uuid)'::regprocedure);
 RAISE NOTICE 'FUNDING261_READ_ONLY_SNAPSHOT_REPEAT_NO_DELTA_PENDING_EMAIL_ACTOR_CLUB_REVOCATION_ACL_PASS';
END $$;
ROLLBACK;
