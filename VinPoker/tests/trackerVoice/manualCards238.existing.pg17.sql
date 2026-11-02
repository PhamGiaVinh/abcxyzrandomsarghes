-- Existing R05 active TEST hand, canonical RPC probes only; all writes roll back.
BEGIN;
SET LOCAL statement_timeout='10s';
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND inet_server_port()=55441;
 ASSERT EXISTS(SELECT 1 FROM public.tournament_hands h JOIN public.tournament_tables tt ON tt.id=h.table_id
  JOIN public.table_sessions s ON s.id=h.table_session_id JOIN public.tournaments t ON t.id=h.tournament_id
  JOIN public.clubs c ON c.id=t.club_id
  WHERE h.id='525ec5b6-c6f7-4509-96dd-200c8262d463' AND h.source_revision=3 AND h.status='in_progress' AND NOT h.is_voided
   AND t.id='7638ff64-b5ca-402a-89fc-91e7f325c32f' AND t.name='Cash identity local TEST'
   AND c.owner_id='a9d04653-3074-416a-be53-c8b8d1fee348' AND tt.id='8375b595-60e6-4a40-85d4-0026c50ad6d1'
   AND tt.table_session_id=s.id AND s.id='9d653d5b-ff42-499b-8776-93cb888d6a55'
   AND s.closed_at IS NULL AND s.control_mode='tracker' AND s.control_epoch=2 AND tt.status='active');
 ASSERT (SELECT count(*)=2 AND bool_and(hole_cards='[]'::jsonb) FROM public.hand_players WHERE hand_id='525ec5b6-c6f7-4509-96dd-200c8262d463');
 ASSERT NOT EXISTS(SELECT 1 FROM floor_private.tracker_manual_card_receipts_v1 WHERE request_key LIKE 'manual238-%');
END $$;
GRANT USAGE ON SCHEMA auth TO authenticated;
SELECT set_config('vinpoker.test238.before',md5(jsonb_build_object(
 'hand',(SELECT to_jsonb(h) FROM public.tournament_hands h WHERE id='525ec5b6-c6f7-4509-96dd-200c8262d463'),
 'players',(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM public.hand_players p WHERE hand_id='525ec5b6-c6f7-4509-96dd-200c8262d463'),
 'receipts',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY actor_id,request_key),'[]') FROM floor_private.tracker_manual_card_receipts_v1 r),
 'queue',(SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY hand_id,source_revision),'[]') FROM public.tracker_historical_display_queue q WHERE hand_id='525ec5b6-c6f7-4509-96dd-200c8262d463')
)::text),true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE result jsonb; rev bigint:=3; cards jsonb:='[{"player_id":"b12bd7c2-1fbe-4de8-a25b-b9bee9976074","entry_number":1,"hole_cards":["As","Ad"]}]';
BEGIN
 PERFORM set_config('request.jwt.claim.sub','a9d04653-3074-416a-be53-c8b8d1fee348',true);
 PERFORM set_config('request.jwt.claims','{"sub":"a9d04653-3074-416a-be53-c8b8d1fee348","role":"authenticated"}',true);
 BEGIN
  result:=public.heartbeat_lock('525ec5b6-c6f7-4509-96dd-200c8262d463','a9d04653-3074-416a-be53-c8b8d1fee348');
  ASSERT result->>'status'='success','owner lock heartbeat failed';
  result:=public.show_tracker_manual_cards_v1('525ec5b6-c6f7-4509-96dd-200c8262d463','9d653d5b-ff42-499b-8776-93cb888d6a55',2,rev,'manual238-owner-0001',cards);
  ASSERT result->>'status'='success','valid owner card writer failed';
  ASSERT (result->>'committed_source_revision')::bigint>rev;
  ASSERT (SELECT hole_cards='["As","Ad"]'::jsonb FROM public.hand_players WHERE hand_id='525ec5b6-c6f7-4509-96dd-200c8262d463' AND seat_number=3);
  ASSERT public.show_tracker_manual_cards_v1('525ec5b6-c6f7-4509-96dd-200c8262d463','9d653d5b-ff42-499b-8776-93cb888d6a55',2,rev,'manual238-owner-0001',cards)=result,'exact replay mismatch';
  ASSERT public.show_tracker_manual_cards_v1('525ec5b6-c6f7-4509-96dd-200c8262d463','9d653d5b-ff42-499b-8776-93cb888d6a55',2,rev,'manual238-owner-0001',
   '[{"player_id":"b12bd7c2-1fbe-4de8-a25b-b9bee9976074","entry_number":1,"hole_cards":["Ks","Kd"]}]')->>'error'='idempotency_conflict','same key accepted different cards';
  ASSERT public.show_tracker_manual_cards_v1('525ec5b6-c6f7-4509-96dd-200c8262d463','9d653d5b-ff42-499b-8776-93cb888d6a55',3,rev,'manual238-owner-0001',cards)->>'error'='stale_manual_card_context','receipt bypassed current epoch';
  PERFORM set_config('request.jwt.claim.sub','675fe35e-60a8-4452-bb90-e79486d54da6',true);
  PERFORM set_config('request.jwt.claims','{"sub":"675fe35e-60a8-4452-bb90-e79486d54da6","role":"authenticated"}',true);
  ASSERT public.show_tracker_manual_cards_v1('525ec5b6-c6f7-4509-96dd-200c8262d463','9d653d5b-ff42-499b-8776-93cb888d6a55',2,rev,'manual238-owner-0001',cards)->>'error'='dealer_assignment_invalid','foreign actor received existing owner receipt';
  RAISE EXCEPTION USING ERRCODE='ZX238',MESSAGE='rollback successful owner probe';
 EXCEPTION WHEN SQLSTATE 'ZX238' THEN NULL; END;
 ASSERT (SELECT source_revision=rev FROM public.tournament_hands WHERE id='525ec5b6-c6f7-4509-96dd-200c8262d463');
 result:=public.show_tracker_manual_cards_v1('525ec5b6-c6f7-4509-96dd-200c8262d463','00000000-0000-4000-8000-000000000238',2,rev,'manual238-wrong-session',cards);
 ASSERT result->>'error'='stale_manual_card_context';
 result:=public.show_tracker_manual_cards_v1('525ec5b6-c6f7-4509-96dd-200c8262d463','9d653d5b-ff42-499b-8776-93cb888d6a55',3,rev,'manual238-wrong-epoch',cards);
 ASSERT result->>'error'='stale_manual_card_context';
 result:=public.show_tracker_manual_cards_v1('525ec5b6-c6f7-4509-96dd-200c8262d463','9d653d5b-ff42-499b-8776-93cb888d6a55',2,rev+1,'manual238-wrong-revision',cards);
 ASSERT result->>'error'='stale_manual_card_context';
 PERFORM set_config('request.jwt.claim.sub','675fe35e-60a8-4452-bb90-e79486d54da6',true);
 PERFORM set_config('request.jwt.claims','{"sub":"675fe35e-60a8-4452-bb90-e79486d54da6","role":"authenticated"}',true);
 result:=public.show_tracker_manual_cards_v1('525ec5b6-c6f7-4509-96dd-200c8262d463','9d653d5b-ff42-499b-8776-93cb888d6a55',2,rev,'manual238-outsider-0001',cards);
 ASSERT result->>'error'='dealer_assignment_invalid','foreign club owner gained Tracker authority';
 result:=public.show_hole_cards('525ec5b6-c6f7-4509-96dd-200c8262d463',cards,'a9d04653-3074-416a-be53-c8b8d1fee348');
 ASSERT result->>'error'='actor_mismatch','legacy card writer trusted supplied actor';
 RAISE NOTICE 'MANUAL_CARDS238_OWNER_POSITIVE_REPLAY_STALE_SESSION_EPOCH_REVISION_FOREIGN_OWNER_SPOOF_PASS';
END $$;
RESET ROLE;
DO $$ BEGIN
 ASSERT current_setting('vinpoker.test238.before')=md5(jsonb_build_object(
 'hand',(SELECT to_jsonb(h) FROM public.tournament_hands h WHERE id='525ec5b6-c6f7-4509-96dd-200c8262d463'),
 'players',(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM public.hand_players p WHERE hand_id='525ec5b6-c6f7-4509-96dd-200c8262d463'),
 'receipts',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY actor_id,request_key),'[]') FROM floor_private.tracker_manual_card_receipts_v1 r),
 'queue',(SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY hand_id,source_revision),'[]') FROM public.tracker_historical_display_queue q WHERE hand_id='525ec5b6-c6f7-4509-96dd-200c8262d463')
 )::text),'manual card probe leaked source/receipt/queue changes';
 RAISE NOTICE 'MANUAL_CARDS238_HAND_PLAYERS_RECEIPTS_QUEUE_UNCHANGED_PASS';
END $$;
SET LOCAL ROLE anon;
DO $$ BEGIN
 ASSERT NOT has_function_privilege(current_user,'public.show_tracker_manual_cards_v1(uuid,uuid,bigint,bigint,text,jsonb)','EXECUTE');
 BEGIN
  PERFORM public.show_tracker_manual_cards_v1(NULL,NULL,2,3,'manual238-anon-0001','[]');
  RAISE EXCEPTION 'anonymous manual card call unexpectedly allowed';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 RAISE NOTICE 'MANUAL_CARDS238_ANON_EXECUTE_DENIED_PASS';
END $$;
RESET ROLE;
SET LOCAL ROLE service_role;
DO $$ BEGIN
 ASSERT NOT has_function_privilege(current_user,'public.show_tracker_manual_cards_v1(uuid,uuid,bigint,bigint,text,jsonb)','EXECUTE');
 BEGIN
  PERFORM public.show_tracker_manual_cards_v1(NULL,NULL,2,3,'manual238-service-0001','[]');
  RAISE EXCEPTION 'service manual card call unexpectedly allowed';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 RAISE NOTICE 'MANUAL_CARDS238_SERVICE_EXECUTE_DENIED_PASS';
END $$;
RESET ROLE;
ROLLBACK;
