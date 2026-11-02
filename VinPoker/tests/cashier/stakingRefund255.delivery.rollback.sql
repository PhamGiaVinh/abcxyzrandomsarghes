BEGIN;
SET LOCAL statement_timeout='15s';
DO $$
DECLARE actor uuid:='a364de8e-06b1-4428-a20d-ac614ec406e5'; deal uuid:=gen_random_uuid(); req uuid:=gen_random_uuid();
 club uuid; job jsonb; second_job jsonb; third_job jsonb; status_value jsonb; denied boolean:=false;
BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname IN('pg_net','pg_cron'));
 SELECT id INTO STRICT club FROM public.clubs ORDER BY id LIMIT 1;
 INSERT INTO public.user_roles(user_id,role) SELECT actor,'super_admin' WHERE NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=actor AND role='super_admin');
 INSERT INTO public.staking_deals(id,player_id,club_id,custom_event_name,custom_event_date,custom_event_venue,percentage_sold,markup,buy_in_amount_vnd,status)
 VALUES(deal,actor,club,'LOCAL255 delivery rollback',now(),'LOCAL ONLY',15,1,1000000,'funded');
 INSERT INTO public.staking_purchases(deal_id,backer_id,percent,markup,amount_vnd,status,reference_code)
 SELECT deal,actor,5,1,50000,'funded',gen_random_uuid()::text FROM generate_series(1,3);
 PERFORM set_config('role','service_role',true);
 PERFORM public.commit_staking_refund_v1(actor,req,deal,'LOCAL255 no provider');
 status_value:=public.get_staking_refund_email_status_v1(actor,req);
 ASSERT status_value->>'state'='pending' AND (status_value->>'pending')::int=3;
 BEGIN PERFORM public.claim_staking_refund_email_v1(gen_random_uuid(),req);
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;END;ASSERT denied;
 job:=public.claim_staking_refund_email_v1(actor,req);
 second_job:=public.claim_staking_refund_email_v1(actor,req);
 third_job:=public.claim_staking_refund_email_v1(actor,req);
 ASSERT job->>'id'<>second_job->>'id' AND second_job->>'id'<>third_job->>'id';
 ASSERT public.claim_staking_refund_email_v1(actor,req) IS NULL;
 ASSERT NOT public.finish_staking_refund_email_v1(actor,req,(job->>'id')::uuid,gen_random_uuid(),'LOCAL_ACK',NULL);
 ASSERT public.finish_staking_refund_email_v1(actor,req,(job->>'id')::uuid,(job->>'lease_token')::uuid,'LOCAL_ACK',NULL);
 ASSERT public.finish_staking_refund_email_v1(actor,req,(job->>'id')::uuid,(job->>'lease_token')::uuid,'LOCAL_ACK',NULL);
 ASSERT NOT public.finish_staking_refund_email_v1(actor,req,(job->>'id')::uuid,(job->>'lease_token')::uuid,'DIFFERENT_ACK',NULL);
 ASSERT public.finish_staking_refund_email_v1(actor,req,(second_job->>'id')::uuid,(second_job->>'lease_token')::uuid,NULL,'delivery_failed_or_unknown');
 PERFORM set_config('role','postgres',true);
 UPDATE public.staking_refund_email_intents_v1 SET claimed_at=clock_timestamp()-interval '6 minutes' WHERE id=(third_job->>'id')::uuid;
 PERFORM set_config('role','service_role',true);
 status_value:=public.get_staking_refund_email_status_v1(actor,req);
 ASSERT status_value->>'state'='needs_attention' AND (status_value->>'delivered')::int=1
 AND (status_value->>'needs_attention')::int=2 AND NOT (status_value->>'evidence_missing')::boolean;
 ASSERT public.claim_staking_refund_email_v1(actor,req) IS NULL;
 ASSERT NOT public.finish_staking_refund_email_v1(actor,req,(third_job->>'id')::uuid,(third_job->>'lease_token')::uuid,'LATE_ACK',NULL);
 PERFORM set_config('role','postgres',true);
 ASSERT (SELECT count(*)=1 FROM public.staking_refund_email_intents_v1 WHERE deal_id=deal AND state='delivered');
 ASSERT (SELECT count(*)=2 FROM public.staking_refund_email_intents_v1 WHERE deal_id=deal AND state='needs_attention');
 ASSERT (SELECT count(*)=3 AND sum(amount_vnd)=150000 FROM public.escrow_transactions WHERE deal_id=deal AND transaction_type='refund');
 ASSERT NOT has_function_privilege('anon','public.claim_staking_refund_email_v1(uuid,uuid)','EXECUTE');
 ASSERT NOT has_function_privilege('authenticated','public.finish_staking_refund_email_v1(uuid,uuid,uuid,uuid,text,text)','EXECUTE');
 ASSERT NOT has_function_privilege('service_role','public._staking_refund_effect_authority_v1(uuid,uuid)','EXECUTE');
 ASSERT NOT has_function_privilege('authenticated','public.get_staking_refund_email_status_v1(uuid,uuid)','EXECUTE');
 RAISE NOTICE 'REFUND255 native ownership/unique claims/fenced exact ack replay/unknown+expiry held/no resend/150K unchanged ACL PASS';
END $$;
ROLLBACK;
