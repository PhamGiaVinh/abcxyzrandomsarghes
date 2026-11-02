-- Actual local PG17 transaction, including audit failure after request/deal writes.
BEGIN;
SET LOCAL statement_timeout='15s';
CREATE FUNCTION pg_temp.fail_staking_request_audit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.action::text='release_requested' AND current_setting('vinpoker.test_request_fault',true)='on'
 THEN RAISE EXCEPTION 'LOCAL_TEST_REQUEST_AUDIT_FAULT';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER local_test_request_fault BEFORE INSERT ON public.staking_audit_logs
FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_staking_request_audit();
DO $$
DECLARE actor uuid:='a364de8e-06b1-4428-a20d-ac614ec406e5'; outsider uuid:=gen_random_uuid();
 deal uuid:=gen_random_uuid(); purchase uuid:=gen_random_uuid(); club uuid; result jsonb; replay jsonb; denied boolean;
BEGIN
 IF current_database()<>'vinpoker_ops_cash115_qualified_c' OR inet_server_port()<>55441
 OR EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_net') THEN RAISE EXCEPTION 'isolated_database_required';END IF;
 SELECT id INTO STRICT club FROM public.clubs ORDER BY id LIMIT 1;
 INSERT INTO auth.users(id) VALUES(actor),(outsider) ON CONFLICT DO NOTHING;
 INSERT INTO public.user_roles(user_id,role) VALUES(actor,'super_admin'),(outsider,'cashier') ON CONFLICT DO NOTHING;
 INSERT INTO public.staking_deals(id,player_id,club_id,custom_event_name,custom_event_date,percentage_sold,markup,buy_in_amount_vnd,status,
   filled_percent,result_prize_vnd,backer_payout_vnd,player_payout_vnd,platform_fee_vnd,platform_archive_fee)
 VALUES(deal,actor,club,'LOCAL rollback atomic request',now(),10,1,1000000,'result_verified',10,1000000,80100,720900,199000,199000);
 INSERT INTO public.staking_purchases(id,deal_id,backer_id,percent,markup,amount_vnd,status,reference_code)
 VALUES(purchase,deal,actor,10,1,100000,'funded',purchase::text);
 PERFORM set_config('role','authenticated',true);
 denied:=false;BEGIN PERFORM public.request_staking_release_v1(actor,deal,80100,720900,NULL);
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;END;
 IF NOT denied THEN RAISE EXCEPTION 'browser_direct_service_boundary_allowed';END IF;
 PERFORM set_config('role','service_role',true);
 denied:=false;BEGIN PERFORM public.request_staking_release_v1(outsider,deal,80100,720900,NULL);
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;END;
 IF NOT denied THEN RAISE EXCEPTION 'cross_club_request_allowed';END IF;
 denied:=false;BEGIN PERFORM public.request_staking_release_v1(actor,deal,100000,900000,NULL);
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'staking_request_amount_mismatch' THEN RAISE;END IF;denied:=true;END;
 IF NOT denied THEN RAISE EXCEPTION 'gross_amount_request_allowed';END IF;
 PERFORM set_config('vinpoker.test_request_fault','on',true);
 denied:=false;BEGIN PERFORM public.request_staking_release_v1(actor,deal,80100,720900,'LOCAL TEST');
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'LOCAL_TEST_REQUEST_AUDIT_FAULT' THEN RAISE;END IF;denied:=true;END;
 IF NOT denied THEN RAISE EXCEPTION 'audit_fault_not_exercised';END IF;
 PERFORM set_config('role','postgres',true);
 IF EXISTS(SELECT 1 FROM public.staking_release_requests WHERE deal_id=deal)
 OR EXISTS(SELECT 1 FROM public.staking_audit_logs WHERE deal_id=deal AND action='release_requested')
 OR (SELECT status FROM public.staking_deals WHERE id=deal)<>'result_verified'
 THEN RAISE EXCEPTION 'partial_request_state_after_audit_fault';END IF;
 PERFORM set_config('vinpoker.test_request_fault','off',true);
 PERFORM set_config('role','service_role',true);
 result:=public.request_staking_release_v1(actor,deal,80100,720900,'LOCAL TEST');
 replay:=public.request_staking_release_v1(actor,deal,80100,720900,'LOCAL TEST');
 IF result->>'release_request_id' IS DISTINCT FROM replay->>'release_request_id'
 OR result->>'status'<>'release_requested' OR replay->'existing'<>'true'::jsonb THEN RAISE EXCEPTION 'request_replay_failed';END IF;
 denied:=false;BEGIN PERFORM public.request_staking_release_v1(actor,deal,80100,720900,'DIFFERENT');
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'staking_request_payload_conflict' THEN RAISE;END IF;denied:=true;END;
 IF NOT denied THEN RAISE EXCEPTION 'changed_note_replay_accepted';END IF;
 PERFORM set_config('role','postgres',true);
 IF (SELECT count(*) FROM public.staking_release_requests WHERE deal_id=deal)<>1
 OR (SELECT count(*) FROM public.staking_audit_logs WHERE deal_id=deal AND action='release_requested')<>1
 OR EXISTS(SELECT 1 FROM public.staking_ledger WHERE deal_id=deal)
 THEN RAISE EXCEPTION 'request_replay_duplicate_or_financial_write';END IF;
 IF has_function_privilege('anon','public.request_staking_release_v1(uuid,uuid,bigint,bigint,text)','EXECUTE')
 OR has_function_privilege('authenticated','public.request_staking_release_v1(uuid,uuid,bigint,bigint,text)','EXECUTE')
 THEN RAISE EXCEPTION 'request_function_acl_exposed';END IF;
 RAISE NOTICE 'STAKING_REQUEST_ACTOR_TENANT_NET_AMOUNT_ATOMIC_AUDIT_ROLLBACK_REPLAY_CONFLICT_PASS';
END $$;
ROLLBACK;
