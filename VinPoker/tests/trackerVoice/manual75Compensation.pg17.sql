\set ON_ERROR_STOP on
BEGIN READ ONLY;
DO $$ BEGIN
 IF current_database()<>'vinpoker_manual_card75_compensation_20261014' OR current_user<>'postgres'
 OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet OR inet_server_port() NOT IN (55441,55464)
 OR (SELECT count(*) FROM public.clubs)<>2
 OR (SELECT count(*) FROM floor_private.tracker_manual_card_receipts_v1)<>1
 THEN RAISE EXCEPTION 'owned_committed_manual75_compensation_clone_required'; END IF;
END $$;
SELECT md5(jsonb_build_object(
 'hand',(SELECT jsonb_agg(to_jsonb(h) ORDER BY h.id) FROM public.tournament_hands h),
 'players',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.hand_id,p.seat_number) FROM public.hand_players p),
 'queue',(SELECT jsonb_agg(to_jsonb(q) ORDER BY q.hand_id,q.source_revision) FROM public.tracker_historical_display_queue q),
 'receipts',(SELECT jsonb_agg(to_jsonb(r) ORDER BY r.actor_id,r.request_key) FROM floor_private.tracker_manual_card_receipts_v1 r)
 )::text) AS value \gset compensation_before_
SELECT md5(jsonb_agg(jsonb_build_object('oid',p.oid,'definition',pg_get_functiondef(p.oid),
 'owner',p.proowner,'acl',p.proacl::text,'path',p.proconfig) ORDER BY p.oid)::text) AS value
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname IN ('public','floor_private') AND p.prokind='f'
 AND p.oid NOT IN ('public.show_tracker_manual_cards_v1(uuid,uuid,bigint,bigint,text,jsonb)'::regprocedure,
 'floor_private.tracker_manual_cards_v1(uuid,uuid,bigint,bigint,text,jsonb)'::regprocedure,
 'public.get_tracker_manual_card_receipt_v1(text,jsonb)'::regprocedure,
 'floor_private.tracker_manual_card_receipt_v1(text,jsonb)'::regprocedure) \gset compensation_functions_before_
COMMIT;
\ir ../../docs/runbooks/TRACKER_MANUAL_75_COMPENSATION_SOURCE.sql
BEGIN;
SELECT set_config('manual75.compensation_before',:'compensation_before_value',true);
SELECT set_config('manual75.functions_before',:'compensation_functions_before_value',true);
DO $$ BEGIN
 IF md5(jsonb_build_object(
 'hand',(SELECT jsonb_agg(to_jsonb(h) ORDER BY h.id) FROM public.tournament_hands h),
 'players',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.hand_id,p.seat_number) FROM public.hand_players p),
 'queue',(SELECT jsonb_agg(to_jsonb(q) ORDER BY q.hand_id,q.source_revision) FROM public.tracker_historical_display_queue q),
 'receipts',(SELECT jsonb_agg(to_jsonb(r) ORDER BY r.actor_id,r.request_key) FROM floor_private.tracker_manual_card_receipts_v1 r)
 )::text) IS DISTINCT FROM current_setting('manual75.compensation_before')
 OR (SELECT md5(jsonb_agg(jsonb_build_object('oid',p.oid,'definition',pg_get_functiondef(p.oid),
 'owner',p.proowner,'acl',p.proacl::text,'path',p.proconfig) ORDER BY p.oid)::text)
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname IN ('public','floor_private') AND p.prokind='f'
 AND p.oid NOT IN ('public.show_tracker_manual_cards_v1(uuid,uuid,bigint,bigint,text,jsonb)'::regprocedure,
 'floor_private.tracker_manual_cards_v1(uuid,uuid,bigint,bigint,text,jsonb)'::regprocedure,
 'public.get_tracker_manual_card_receipt_v1(text,jsonb)'::regprocedure,
 'floor_private.tracker_manual_card_receipt_v1(text,jsonb)'::regprocedure)) IS DISTINCT FROM current_setting('manual75.functions_before')
 THEN RAISE EXCEPTION 'manual75_compensation_changed_canonical_data_or_other_function'; END IF;
END $$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','81200000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claims','{"sub":"81200000-0000-4000-8000-000000000001","role":"authenticated"}',true);
DO $$ DECLARE rejected boolean:=false; BEGIN
 BEGIN
  PERFORM public.show_tracker_manual_cards_v1('86000000-0000-4000-8000-000000000001',
   '83500000-0000-4000-8000-000000000001',1,0,'manual75-after-compensation','[]');
 EXCEPTION WHEN insufficient_privilege THEN rejected:=true; END;
 IF NOT rejected THEN RAISE EXCEPTION 'compensated_manual_writer_still_callable'; END IF;
 rejected:=false;
 BEGIN PERFORM public.get_tracker_manual_card_receipt_v1('manual75-real-overlap-0001','{}');
 EXCEPTION WHEN insufficient_privilege THEN rejected:=true; END;
 IF NOT rejected THEN RAISE EXCEPTION 'compensated_manual_reader_still_callable'; END IF;
END $$;
ROLLBACK;
\echo MANUAL75_COMPENSATION_PRESERVES_COMMITTED_CARDS_REVISION_QUEUE_RECEIPTS_OTHER_FUNCTIONS_PASS
