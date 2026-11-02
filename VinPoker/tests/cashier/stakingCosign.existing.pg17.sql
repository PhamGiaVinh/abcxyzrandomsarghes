BEGIN;
SET LOCAL statement_timeout='15s';
CREATE FUNCTION pg_temp.fail_staking_cosign_audit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.action::text='release_cosigned' AND current_setting('vinpoker.test_cosign_fault',true)='on'
 THEN RAISE EXCEPTION 'LOCAL_TEST_COSIGN_AUDIT_FAULT';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER local_test_cosign_fault BEFORE INSERT ON public.staking_audit_logs
FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_staking_cosign_audit();
DO $$
DECLARE admin1 uuid:=gen_random_uuid(); admin2 uuid:=gen_random_uuid(); cashier uuid:=gen_random_uuid(); outsider uuid:=gen_random_uuid();
 club uuid; deal uuid; purchase uuid; request uuid; actor uuid; signer uuid; cashier_case boolean; denied boolean; result jsonb; replay jsonb;
BEGIN
 IF current_database()<>'vinpoker_ops_cash115_qualified_c' OR inet_server_port()<>55441
 OR EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_net') THEN RAISE EXCEPTION 'isolated_database_required';END IF;
 SELECT id INTO STRICT club FROM public.clubs ORDER BY id LIMIT 1;
 INSERT INTO auth.users(id) VALUES(admin1),(admin2),(cashier),(outsider);
 INSERT INTO public.user_roles(user_id,role) VALUES(admin1,'super_admin'),(admin2,'super_admin'),(cashier,'cashier'),(outsider,'cashier');
 INSERT INTO public.club_cashiers(club_id,user_id,granted_by) VALUES(club,cashier,admin1);
 FOREACH cashier_case IN ARRAY ARRAY[false,true] LOOP
  actor:=CASE WHEN cashier_case THEN cashier ELSE admin1 END;
  signer:=CASE WHEN cashier_case THEN cashier ELSE admin2 END;
  deal:=gen_random_uuid();purchase:=gen_random_uuid();
  INSERT INTO public.staking_deals(id,player_id,club_id,custom_event_name,custom_event_date,percentage_sold,markup,buy_in_amount_vnd,status,
    filled_percent,result_prize_vnd,backer_payout_vnd,player_payout_vnd,platform_fee_vnd,platform_archive_fee)
  VALUES(deal,actor,club,'LOCAL rollback atomic cosign',now(),10,1,1000000,'result_verified',10,1000000,80100,720900,199000,199000);
  INSERT INTO public.staking_purchases(id,deal_id,backer_id,percent,markup,amount_vnd,status,reference_code)
  VALUES(purchase,deal,actor,10,1,100000,'funded',purchase::text);
  PERFORM set_config('role','service_role',true);
  result:=public.request_staking_release_v1(actor,deal,80100,720900,'REQUEST NOTE');request:=(result->>'release_request_id')::uuid;
  IF NOT cashier_case THEN
   denied:=false;BEGIN PERFORM public.cosign_staking_release_v1(admin1,request,NULL);
   EXCEPTION WHEN insufficient_privilege THEN denied:=true;END;
   IF NOT denied THEN RAISE EXCEPTION 'same_admin_cosign_allowed';END IF;
  END IF;
  PERFORM set_config('role','authenticated',true);
  denied:=false;BEGIN PERFORM public.cosign_staking_release_v1(signer,request,NULL);
  EXCEPTION WHEN insufficient_privilege THEN denied:=true;END;
  IF NOT denied THEN RAISE EXCEPTION 'browser_cosign_service_boundary_allowed';END IF;
  PERFORM set_config('role','service_role',true);
  PERFORM set_config('vinpoker.test_cosign_fault','on',true);
  denied:=false;BEGIN PERFORM public.cosign_staking_release_v1(signer,request,'COSIGN NOTE');
  EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'LOCAL_TEST_COSIGN_AUDIT_FAULT' THEN RAISE;END IF;denied:=true;END;
  IF NOT denied THEN RAISE EXCEPTION 'cosign_fault_not_exercised';END IF;
  PERFORM set_config('role','postgres',true);
  IF (SELECT status FROM public.staking_deals WHERE id=deal)<>'release_requested'
   OR (SELECT status FROM public.staking_release_requests WHERE id=request)<>'pending_cosign'
   OR EXISTS(SELECT 1 FROM public.staking_release_requests WHERE id=request AND (cosigned_by_admin_id IS NOT NULL OR cosigned_at IS NOT NULL))
   OR EXISTS(SELECT 1 FROM public.staking_audit_logs WHERE deal_id=deal AND action='release_cosigned')
  THEN RAISE EXCEPTION 'partial_cosign_after_audit_fault';END IF;
  PERFORM set_config('role','service_role',true);PERFORM set_config('vinpoker.test_cosign_fault','off',true);
  result:=public.cosign_staking_release_v1(signer,request,'COSIGN NOTE');
  replay:=public.cosign_staking_release_v1(signer,request,'COSIGN NOTE');
  IF result->>'status'<>'cosigned' OR replay->'existing'<>'true'::jsonb THEN RAISE EXCEPTION 'cosign_replay_failed';END IF;
  denied:=false;BEGIN PERFORM public.cosign_staking_release_v1(outsider,request,'COSIGN NOTE');
  EXCEPTION WHEN insufficient_privilege THEN denied:=true;END;
  IF NOT denied THEN RAISE EXCEPTION 'approved_replay_club_bypass';END IF;
  denied:=false;BEGIN PERFORM public.cosign_staking_release_v1(signer,request,'DIFFERENT NOTE');
  EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'staking_cosign_payload_conflict' THEN RAISE;END IF;denied:=true;END;
  IF NOT denied THEN RAISE EXCEPTION 'cosign_changed_note_allowed';END IF;
  replay:=public.request_staking_release_v1(actor,deal,80100,720900,'REQUEST NOTE');
  IF replay->>'release_request_id'<>request::text THEN RAISE EXCEPTION 'request_replay_after_cosign_failed';END IF;
  PERFORM set_config('role','postgres',true);
  IF (SELECT count(*) FROM public.staking_audit_logs WHERE deal_id=deal AND action='release_cosigned')<>1
   OR (SELECT note FROM public.staking_release_requests WHERE id=request)<>'REQUEST NOTE'
   OR EXISTS(SELECT 1 FROM public.staking_ledger WHERE deal_id=deal)
  THEN RAISE EXCEPTION 'cosign_duplicate_audit_or_request_note_overwrite';END IF;
 END LOOP;
 IF has_function_privilege('anon','public.cosign_staking_release_v1(uuid,uuid,text)','EXECUTE')
 OR has_function_privilege('authenticated','public.cosign_staking_release_v1(uuid,uuid,text)','EXECUTE')
 THEN RAISE EXCEPTION 'cosign_acl_exposed';END IF;
 RAISE NOTICE 'STAKING_COSIGN_ATOMIC_FAULT_ROLLBACK_DISTINCT_ADMIN_SAME_CASHIER_TENANT_REPLAY_PASS';
END $$;
ROLLBACK;
