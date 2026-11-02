BEGIN;
SET LOCAL statement_timeout='15s';
DO $$
DECLARE actor uuid:='a364de8e-06b1-4428-a20d-ac614ec406e5';deal uuid:=gen_random_uuid();purchase uuid:=gen_random_uuid();club uuid;
 first_job jsonb;second_job jsonb;status_value jsonb;denied boolean:=false;
BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname IN('pg_net','pg_cron'));
 ASSERT NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=actor AND role='super_admin');
 SELECT id INTO STRICT club FROM public.clubs ORDER BY id LIMIT 1;
 INSERT INTO public.user_roles(user_id,role) VALUES(actor,'super_admin');
 INSERT INTO public.staking_deals(id,player_id,club_id,custom_event_name,custom_event_date,custom_event_venue,percentage_sold,markup,buy_in_amount_vnd,status)
 VALUES(deal,actor,club,'LOCAL259 funding delivery rollback',now(),'LOCAL ONLY',10,1,1000000,'committed');
 INSERT INTO public.staking_purchases(id,deal_id,backer_id,percent,markup,amount_vnd,status,reference_code)
 VALUES(purchase,deal,actor,10,1,100000,'committed',purchase::text);
 PERFORM set_config('role','service_role',true);
 PERFORM public.commit_staking_funding_v1(actor,purchase,'LOCAL_BANK','LOCAL259');
 status_value:=public.get_staking_funding_email_status_v1(actor,purchase);
 ASSERT status_value->>'state'='pending' AND (status_value->>'total')::int=2;
 BEGIN PERFORM public.claim_staking_funding_email_v1(gen_random_uuid(),purchase);
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;END;ASSERT denied;
 BEGIN
  first_job:=public.claim_staking_funding_email_v1(actor,purchase);second_job:=public.claim_staking_funding_email_v1(actor,purchase);
  ASSERT first_job->>'id'<>second_job->>'id' AND first_job->>'recipient_role'<>second_job->>'recipient_role';
  ASSERT public.claim_staking_funding_email_v1(actor,purchase) IS NULL;
  ASSERT NOT public.finish_staking_funding_email_v1(actor,purchase,(first_job->>'id')::uuid,gen_random_uuid(),'LOCAL_ACK',NULL);
  ASSERT public.finish_staking_funding_email_v1(actor,purchase,(first_job->>'id')::uuid,(first_job->>'lease_token')::uuid,'LOCAL_ACK',NULL);
  ASSERT public.finish_staking_funding_email_v1(actor,purchase,(first_job->>'id')::uuid,(first_job->>'lease_token')::uuid,'LOCAL_ACK',NULL);
  ASSERT NOT public.finish_staking_funding_email_v1(actor,purchase,(first_job->>'id')::uuid,(first_job->>'lease_token')::uuid,'OTHER_ACK',NULL);
  ASSERT public.finish_staking_funding_email_v1(actor,purchase,(second_job->>'id')::uuid,(second_job->>'lease_token')::uuid,NULL,'delivery_failed_or_unknown');
  status_value:=public.get_staking_funding_email_status_v1(actor,purchase);
  ASSERT status_value->>'state'='needs_attention' AND (status_value->>'delivered')::int=1 AND (status_value->>'needs_attention')::int=1;
  RAISE EXCEPTION 'LOCAL259_BRANCH_ROLLBACK';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'LOCAL259_BRANCH_ROLLBACK' THEN RAISE;END IF;END;
 -- Separate rollback-only branch: no resetting delivered production jobs.
 first_job:=public.claim_staking_funding_email_v1(actor,purchase);second_job:=public.claim_staking_funding_email_v1(actor,purchase);
 PERFORM set_config('role','postgres',true);
 UPDATE public.staking_funding_email_intents_v1 SET claimed_at=clock_timestamp()-interval '6 minutes' WHERE id=(first_job->>'id')::uuid;
 PERFORM set_config('role','service_role',true);
 ASSERT public.claim_staking_funding_email_v1(actor,purchase) IS NULL;
 ASSERT NOT public.finish_staking_funding_email_v1(actor,purchase,(first_job->>'id')::uuid,(first_job->>'lease_token')::uuid,'LATE_ACK',NULL);
 status_value:=public.get_staking_funding_email_status_v1(actor,purchase);
 ASSERT status_value->>'state'='needs_attention' AND (status_value->>'needs_attention')::int=1;
 PERFORM set_config('role','postgres',true);
 ASSERT (SELECT count(*)=1 AND sum(amount_vnd)=100000 FROM public.escrow_transactions WHERE deal_id=deal AND transaction_type='fund_lock');
 DELETE FROM public.user_roles WHERE user_id=actor AND role='super_admin';
 PERFORM set_config('role','service_role',true);denied:=false;
 BEGIN PERFORM public.get_staking_funding_email_status_v1(actor,purchase);
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;END;ASSERT denied;
 PERFORM set_config('role','postgres',true);
 ASSERT NOT has_function_privilege('authenticated','public.claim_staking_funding_email_v1(uuid,uuid)','EXECUTE');
 ASSERT NOT has_function_privilege('anon','public.finish_staking_funding_email_v1(uuid,uuid,uuid,uuid,text,text)','EXECUTE');
 ASSERT NOT has_function_privilege('service_role','public._staking_funding_effect_authority_v1(uuid,uuid)','EXECUTE');
 RAISE NOTICE 'FUNDING259 native2roleclaims/fencedack/replay/unknown+expiredheld/noreclaim/revokedactor/100Kunchanged/privateACL PASS';
END $$;
ROLLBACK;
