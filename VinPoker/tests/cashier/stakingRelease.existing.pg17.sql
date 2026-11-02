-- Synthetic financial facts only, full rollback. No external provider/real transfer.
BEGIN;
SET LOCAL statement_timeout='15s';
CREATE FUNCTION pg_temp.fail_staking_release_audit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.action::text='payout_executed' AND current_setting('vinpoker.test_release_fault',true)='on'
 THEN RAISE EXCEPTION 'LOCAL_TEST_RELEASE_AUDIT_FAULT';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER local_test_release_fault BEFORE INSERT ON public.staking_audit_logs
FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_staking_release_audit();
DO $$
DECLARE actor uuid:='a364de8e-06b1-4428-a20d-ac614ec406e5';
 deal uuid:=gen_random_uuid(); req uuid:=gen_random_uuid(); purchase uuid:=gen_random_uuid();
 club uuid; payload jsonb; result jsonb; again jsonb; denied boolean; job jsonb; expired_job jsonb;
 outsider uuid:=gen_random_uuid(); purchase2 uuid; override_case boolean;
 expected_backer bigint; expected_player bigint; publication_id uuid; published uuid; published_again uuid; publication_token uuid; preview jsonb;
BEGIN
 IF current_database()<>'vinpoker_ops_cash115_qualified_c' OR inet_server_port()<>55441
 OR EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_net') THEN RAISE EXCEPTION 'isolated_database_required';END IF;
 SELECT id INTO STRICT club FROM public.clubs ORDER BY id LIMIT 1;
 INSERT INTO public.user_roles(user_id,role) SELECT actor,'super_admin' WHERE NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=actor AND role='super_admin');
 INSERT INTO public.staking_deals(id,player_id,club_id,custom_event_name,custom_event_date,custom_event_venue,percentage_sold,markup,buy_in_amount_vnd,status,
  filled_percent,result_prize_vnd,backer_payout_vnd,player_payout_vnd,platform_fee_vnd,platform_archive_fee)
 VALUES(deal,actor,club,'LOCAL rollback release',now(),'LOCAL ONLY',10,1,1000000,'cosigned',10,1000000,80100,720900,199000,199000);
 INSERT INTO public.staking_purchases(id,deal_id,backer_id,percent,markup,amount_vnd,status,reference_code)
 VALUES(purchase,deal,actor,10,1,100000,'funded',purchase::text);
 INSERT INTO public.staking_release_requests(id,deal_id,requested_by_admin_id,cosigned_by_admin_id,status)
 VALUES(req,deal,actor,actor,'approved');
 PERFORM set_config('request.jwt.claim.sub',actor::text,true);
 PERFORM set_config('role','authenticated',true);
 preview:=public.get_staking_release_preview_v1(deal);
 PERFORM set_config('role','postgres',true);
 payload:=jsonb_build_object('release_request_id',req,'preview_hash',preview->>'preview_hash','player_paid',true,'backer_payouts',jsonb_build_array(
   jsonb_build_object('purchase_id',purchase,'paid',true,'payout_method','cash')));
 INSERT INTO auth.users(id) VALUES(outsider);
 INSERT INTO public.user_roles(user_id,role) VALUES(outsider,'cashier');
 PERFORM set_config('role','service_role',true);
 denied:=false;
 BEGIN PERFORM public.commit_staking_release_v1(actor,payload); EXCEPTION WHEN insufficient_privilege THEN denied:=true;END;
 IF NOT denied THEN RAISE EXCEPTION 'legacy_service_cas_bypass_allowed';END IF;
 denied:=false;
 BEGIN PERFORM public.commit_staking_release_v2(outsider,payload); EXCEPTION WHEN insufficient_privilege THEN
   IF SQLERRM<>'staking_preview_club_denied' THEN RAISE;END IF;denied:=true;END;
 IF NOT denied THEN RAISE EXCEPTION 'unassigned_cashier_allowed';END IF;
 denied:=false;
 BEGIN PERFORM public.commit_staking_release_v2(gen_random_uuid(),payload); EXCEPTION WHEN insufficient_privilege THEN denied:=true;END;
 IF NOT denied THEN RAISE EXCEPTION 'unprivileged_actor_allowed';END IF;
 PERFORM set_config('vinpoker.test_release_fault','on',true);
 denied:=false;
 BEGIN PERFORM public.commit_staking_release_v2(actor,payload); EXCEPTION WHEN OTHERS THEN
   IF SQLERRM<>'LOCAL_TEST_RELEASE_AUDIT_FAULT' THEN RAISE;END IF;denied:=true;END;
 IF NOT denied THEN RAISE EXCEPTION 'fault_not_exercised';END IF;
 PERFORM set_config('role','postgres',true);
 IF EXISTS(SELECT 1 FROM public.staking_ledger WHERE deal_id=deal)
 OR EXISTS(SELECT 1 FROM public.payout_recipients WHERE deal_id=deal)
 OR EXISTS(SELECT 1 FROM public.staking_release_receipts_v1 WHERE release_request_id=req)
 OR (SELECT status FROM public.staking_deals WHERE id=deal)<>'cosigned'
 OR (SELECT executed_at FROM public.staking_release_requests WHERE id=req) IS NOT NULL
 THEN RAISE EXCEPTION 'failed_release_left_partial_facts';END IF;
 PERFORM set_config('vinpoker.test_release_fault','off',true);
 PERFORM set_config('role','service_role',true);
 result:=public.commit_staking_release_v2(actor,payload);
 again:=public.commit_staking_release_v2(actor,payload);
 IF result IS DISTINCT FROM again OR result->>'success'<>'true' THEN RAISE EXCEPTION 'receipt_replay_mismatch';END IF;
 job:=public.claim_staking_release_effect_v1(req);
 IF job IS NULL OR job->>'state'<>'processing' THEN RAISE EXCEPTION 'effect_not_enqueued';END IF;
 IF public.finish_staking_release_effect_v1((job->>'id')::uuid,gen_random_uuid(),'LOCAL_ACK',NULL)
 THEN RAISE EXCEPTION 'stale_effect_token_accepted';END IF;
 IF NOT public.finish_staking_release_effect_v1((job->>'id')::uuid,(job->>'lease_token')::uuid,'LOCAL_ACK',NULL)
 THEN RAISE EXCEPTION 'effect_ack_failed';END IF;
 expired_job:=public.claim_staking_release_effect_v1(req);
 PERFORM set_config('role','postgres',true);
 UPDATE public.staking_release_effects_v1 SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE id=(expired_job->>'id')::uuid;
 PERFORM set_config('role','service_role',true);
 job:=public.claim_staking_release_effect_v1(req);
 IF job->>'id'=expired_job->>'id' OR public.finish_staking_release_effect_v1((expired_job->>'id')::uuid,(expired_job->>'lease_token')::uuid,'LATE_ACK',NULL)
 THEN RAISE EXCEPTION 'expired_effect_reclaimed_or_acknowledged';END IF;
 PERFORM set_config('role','postgres',true);
 IF (SELECT count(*) FROM public.staking_release_effects_v1 WHERE release_request_id=req)<>3
 OR NOT EXISTS(SELECT 1 FROM public.staking_release_effects_v1 WHERE id=(expired_job->>'id')::uuid AND state='needs_attention' AND error_code='delivery_outcome_unknown')
 THEN RAISE EXCEPTION 'effect_dedup_or_unknown_state_failed';END IF;
 PERFORM set_config('role','service_role',true);
 result:=public.get_staking_release_effect_status_for_actor_v1(actor,req);
 IF result->>'state'<>'needs_attention' OR (result->>'needs_attention')::integer<>1
 THEN RAISE EXCEPTION 'held_effect_reported_delivered';END IF;
 denied:=false;
 BEGIN PERFORM public.get_staking_release_effect_status_for_actor_v1(outsider,req); EXCEPTION WHEN insufficient_privilege THEN denied:=true;END;
 IF NOT denied THEN RAISE EXCEPTION 'status_cross_club_leak';END IF;
 denied:=false;
 BEGIN PERFORM public.commit_staking_release_v2(actor,payload||jsonb_build_object('note','different')); EXCEPTION WHEN OTHERS THEN
   IF SQLERRM<>'staking_release_payload_conflict' THEN RAISE;END IF;denied:=true;END;
 IF NOT denied THEN RAISE EXCEPTION 'payload_conflict_allowed';END IF;
 PERFORM set_config('role','postgres',true);
 IF (SELECT count(*) FROM public.staking_ledger WHERE deal_id=deal)<>2
 OR (SELECT sum(amount_vnd) FROM public.staking_ledger WHERE deal_id=deal)<>801000
 OR (SELECT count(*) FROM public.payout_recipients WHERE deal_id=deal)<>2
 OR (SELECT status FROM public.staking_deals WHERE id=deal)<>'completed'
 OR (SELECT count(*) FROM public.staking_release_receipts_v1 WHERE release_request_id=req)<>1
 THEN RAISE EXCEPTION 'atomic_release_postcondition_failed';END IF;
 IF has_function_privilege('authenticated','public.commit_staking_release_v1(uuid,jsonb)','EXECUTE')
 OR has_function_privilege('service_role','public.commit_staking_release_v1(uuid,jsonb)','EXECUTE')
 OR has_function_privilege('anon','public.commit_staking_release_v1(uuid,jsonb)','EXECUTE')
 OR has_function_privilege('authenticated','public.claim_staking_release_effect_v1(uuid)','EXECUTE')
 OR has_function_privilege('anon','public.finish_staking_release_effect_v1(uuid,uuid,text,text)','EXECUTE')
 OR has_table_privilege('authenticated','public.staking_release_effects_v1','SELECT')
 THEN RAISE EXCEPTION 'browser_grant_exposed';END IF;
 FOR override_case IN SELECT unnest(ARRAY[false,true]) LOOP
   deal:=gen_random_uuid();req:=gen_random_uuid();purchase:=gen_random_uuid();purchase2:=gen_random_uuid();
   expected_backer:=CASE WHEN override_case THEN 333333 ELSE 320400 END;
   expected_player:=CASE WHEN override_case THEN 123456 ELSE 480601 END;
   INSERT INTO public.staking_deals(id,player_id,club_id,custom_event_name,custom_event_date,percentage_sold,markup,buy_in_amount_vnd,status,
    filled_percent,result_prize_vnd,backer_payout_vnd,player_payout_vnd,platform_fee_vnd,platform_archive_fee,override_data)
   VALUES(deal,actor,club,'LOCAL multi backer rollback',now(),40,1,1000000,'cosigned',40,1000001,expected_backer,expected_player,199000,199000,
    CASE WHEN override_case THEN jsonb_build_object('override_backer_amount',expected_backer,'override_player_amount',expected_player) ELSE NULL END);
   INSERT INTO public.staking_purchases(id,deal_id,backer_id,percent,markup,amount_vnd,status,reference_code)
   VALUES(purchase,deal,actor,23,1,230000,'funded',purchase::text),(purchase2,deal,outsider,17,1,170000,'funded',purchase2::text);
   INSERT INTO public.staking_release_requests(id,deal_id,requested_by_admin_id,cosigned_by_admin_id,status)
   VALUES(req,deal,actor,actor,'approved');
   PERFORM set_config('request.jwt.claim.sub',actor::text,true);
   PERFORM set_config('role','authenticated',true);
   preview:=public.get_staking_release_preview_v1(deal);
   PERFORM set_config('role','postgres',true);
   IF (preview->>'backer_amount')::bigint<>expected_backer OR (preview->>'player_amount')::bigint<>expected_player
   THEN RAISE EXCEPTION 'authoritative_preview_amounts_wrong';END IF;
   PERFORM set_config('request.jwt.claim.sub',outsider::text,true);
   PERFORM set_config('role','authenticated',true);
   denied:=false;
   BEGIN PERFORM public.get_staking_release_preview_v1(deal); EXCEPTION WHEN insufficient_privilege THEN denied:=true;END;
   IF NOT denied THEN RAISE EXCEPTION 'preview_cross_club_bank_data_exposed';END IF;
   PERFORM set_config('role','postgres',true);
   payload:=jsonb_build_object('release_request_id',req,'preview_hash',preview->>'preview_hash','player_paid',true,'backer_payouts',
     (SELECT jsonb_agg(jsonb_build_object('purchase_id',b->>'purchase_id','paid',true,'payout_method','cash') ORDER BY ord)
      FROM jsonb_array_elements(preview->'rows') WITH ORDINALITY AS x(b,ord)));
   PERFORM set_config('role','service_role',true);
   denied:=false;
   BEGIN PERFORM public.commit_staking_release_v2(actor,payload||jsonb_build_object('preview_hash','stale')); EXCEPTION WHEN OTHERS THEN
     IF SQLERRM<>'staking_release_preview_stale' THEN RAISE;END IF;denied:=true;END;
   IF NOT denied THEN RAISE EXCEPTION 'stale_preview_paid';END IF;
   result:=public.commit_staking_release_v2(actor,payload);
   again:=public.commit_staking_release_v2(actor,payload);
   IF result IS DISTINCT FROM again THEN RAISE EXCEPTION 'preview_commit_replay_failed';END IF;
   PERFORM set_config('role','postgres',true);
   SELECT id INTO STRICT publication_id FROM public.staking_release_effects_v1 WHERE release_request_id=req AND kind='publication';
   publication_token:=gen_random_uuid();
   UPDATE public.staking_release_effects_v1 SET state='processing',lease_token=publication_token,lease_expires_at=clock_timestamp()+interval '60 seconds' WHERE id=publication_id;
   UPDATE public.staking_deals SET custom_event_name='LATER MUTABLE NAME' WHERE id=deal;
   PERFORM set_config('role','service_role',true);
   published:=public.publish_staking_release_result_v1(publication_id,publication_token);
   published_again:=public.publish_staking_release_result_v1(publication_id,publication_token);
   denied:=false;
   BEGIN PERFORM public.publish_staking_release_result_v1(publication_id,gen_random_uuid()); EXCEPTION WHEN OTHERS THEN
     IF SQLERRM<>'publication_lease_invalid' THEN RAISE;END IF;denied:=true;END;
   IF NOT denied THEN RAISE EXCEPTION 'publication_wrong_token_allowed';END IF;
   PERFORM set_config('role','postgres',true);
   IF published IS DISTINCT FROM published_again
   OR (SELECT tournament_name FROM public.player_results WHERE id=published)<>'LOCAL multi backer rollback'
   OR (SELECT count(*) FROM public.staking_release_publications_v1 WHERE effect_id=publication_id)<>1
   THEN RAISE EXCEPTION 'publication_snapshot_or_replay_failed';END IF;
   IF (result->'amounts'->>'backer')::bigint<>expected_backer OR (result->'amounts'->>'player')::bigint<>expected_player
   OR (SELECT count(*) FROM public.staking_ledger WHERE deal_id=deal)<>3
   OR (SELECT sum(amount_vnd) FROM public.staking_ledger WHERE deal_id=deal AND entry_type='escrow_out_backer')<>expected_backer
   OR (SELECT amount_vnd FROM public.staking_ledger WHERE deal_id=deal AND metadata->>'purchase_id'=purchase::text)<>
      (CASE WHEN purchase<purchase2 THEN round(expected_backer*23::numeric/40) ELSE expected_backer-round(expected_backer*17::numeric/40) END)
   OR (SELECT amount_vnd FROM public.staking_ledger WHERE deal_id=deal AND metadata->>'purchase_id'=purchase2::text)<>
      (CASE WHEN purchase2<purchase THEN round(expected_backer*17::numeric/40) ELSE expected_backer-round(expected_backer*23::numeric/40) END)
   THEN RAISE EXCEPTION 'multi_backer_rounding_or_override_changed';END IF;
 END LOOP;
 RAISE NOTICE 'STAKING_ATOMIC_RELEASE_REPLAY_CONFLICT_AMOUNTS_ACL_ROLLBACK_PASS';
END $$;
ROLLBACK;
