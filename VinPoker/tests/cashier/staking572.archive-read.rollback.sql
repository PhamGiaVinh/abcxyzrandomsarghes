BEGIN;
SET LOCAL statement_timeout='15s';
SET LOCAL request.jwt.claim.sub='';
DO $$
DECLARE actor uuid:='a364de8e-06b1-4428-a20d-ac614ec406e5';deal uuid:=gen_random_uuid();club uuid;other_actor uuid;value jsonb;before_value jsonb;after_value jsonb;denied boolean;
BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname IN('pg_net','pg_cron'));
 ASSERT NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=actor AND role='super_admin');
 SELECT id INTO STRICT club FROM public.clubs WHERE owner_id<>actor ORDER BY id LIMIT 1;
 INSERT INTO public.user_roles(user_id,role) VALUES(actor,'super_admin');
 INSERT INTO public.staking_deals(id,player_id,club_id,custom_event_name,custom_event_date,custom_event_venue,percentage_sold,markup,buy_in_amount_vnd,status,admin_review_status)
 VALUES(deal,actor,club,'LOCAL572 receipt read rollback',now(),'LOCAL ONLY',10,1,1000000,'listing','rejected');
 PERFORM set_config('role','service_role',true);
 ASSERT public.get_staking_listing_archive_receipt_v1(actor,deal,'rejected')=jsonb_build_object('success',false,'deal_id',deal,'state','not_recorded');
 value:=public.archive_staking_listing_v1(actor,deal,'rejected');
 ASSERT public.get_staking_listing_archive_receipt_v1(actor,deal,'rejected')=value;
 PERFORM set_config('role','postgres',true);
 SELECT jsonb_build_object('deal',(SELECT to_jsonb(x) FROM public.staking_deals x WHERE id=deal),
 'receipt',(SELECT to_jsonb(x) FROM public.staking_listing_archive_receipts_v1 x WHERE deal_id=deal),
 'audit',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.staking_audit_logs x WHERE deal_id=deal),
 'ledger',(SELECT count(*) FROM public.escrow_transactions WHERE deal_id=deal),'notifications',(SELECT count(*) FROM public.notifications)) INTO before_value;
 PERFORM set_config('role','service_role',true);
 ASSERT public.get_staking_listing_archive_receipt_v1(actor,deal,'rejected')=value;
 ASSERT public.get_staking_listing_archive_receipt_v1(actor,deal,'rejected')=value;
 denied:=false;BEGIN PERFORM public.get_staking_listing_archive_receipt_v1(actor,deal,'approved');EXCEPTION WHEN raise_exception THEN denied:=SQLERRM='staking_archive_receipt_conflict';END;ASSERT denied;
 PERFORM set_config('role','postgres',true);
 SELECT jsonb_build_object('deal',(SELECT to_jsonb(x) FROM public.staking_deals x WHERE id=deal),
 'receipt',(SELECT to_jsonb(x) FROM public.staking_listing_archive_receipts_v1 x WHERE deal_id=deal),
 'audit',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.staking_audit_logs x WHERE deal_id=deal),
 'ledger',(SELECT count(*) FROM public.escrow_transactions WHERE deal_id=deal),'notifications',(SELECT count(*) FROM public.notifications)) INTO after_value;
 ASSERT before_value=after_value;
 SELECT id INTO STRICT other_actor FROM auth.users u WHERE id<>actor AND NOT EXISTS(SELECT 1 FROM public.user_roles r WHERE r.user_id=u.id AND role='super_admin') ORDER BY id LIMIT 1;
 INSERT INTO public.user_roles(user_id,role) VALUES(other_actor,'super_admin');
 PERFORM set_config('role','service_role',true);denied:=false;
 BEGIN PERFORM public.get_staking_listing_archive_receipt_v1(other_actor,deal,'rejected');EXCEPTION WHEN insufficient_privilege THEN denied:=true;END;ASSERT denied;
 denied:=false;BEGIN PERFORM public.get_staking_listing_archive_receipt_v1(actor,gen_random_uuid(),'rejected');EXCEPTION WHEN raise_exception THEN denied:=SQLERRM='staking_archive_not_found';END;ASSERT denied;
 PERFORM set_config('role','postgres',true);
 -- Simulate a later inconsistent/reopened fixture; rollback this subtransaction after observing it.
 BEGIN
  UPDATE public.staking_deals SET status='listing' WHERE id=deal;
  PERFORM set_config('role','service_role',true);
  ASSERT public.get_staking_listing_archive_receipt_v1(actor,deal,'rejected')=jsonb_build_object('success',false,'deal_id',deal,'state','needs_attention');
  PERFORM set_config('role','postgres',true);
  RAISE EXCEPTION 'LOCAL572_ROLLBACK_STATE_PROBE';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'LOCAL572_ROLLBACK_STATE_PROBE' THEN RAISE;END IF;END;
 ASSERT (SELECT status='cancelled' FROM public.staking_deals WHERE id=deal);
 DELETE FROM public.user_roles WHERE user_id=actor AND role='super_admin';
 PERFORM set_config('role','service_role',true);denied:=false;
 BEGIN PERFORM public.get_staking_listing_archive_receipt_v1(actor,deal,'rejected');EXCEPTION WHEN insufficient_privilege THEN denied:=true;END;ASSERT denied;
 PERFORM set_config('role','postgres',true);
 ASSERT (SELECT provolatile='s' FROM pg_proc WHERE oid='public.get_staking_listing_archive_receipt_v1(uuid,uuid,text)'::regprocedure);
 ASSERT NOT has_function_privilege('authenticated','public.get_staking_listing_archive_receipt_v1(uuid,uuid,text)','EXECUTE');
 ASSERT NOT has_function_privilege('anon','public.get_staking_listing_archive_receipt_v1(uuid,uuid,text)','EXECUTE');
 RAISE NOTICE 'ARCHIVE572_READ_NOT_RECORDED_EXACT_RECEIPT_REPEAT_NO_DELTA_PAYLOAD_OTHER_ACTOR_UNKNOWN_REOPENED_REVOKED_ROLE_ACL_PASS';
END $$;
ROLLBACK;
