-- Run inside migration265 transaction before its final ROLLBACK, not standalone.
GRANT USAGE ON SCHEMA auth TO authenticated;
SET LOCAL request.jwt.claim.sub='675fe35e-60a8-4452-bb90-e79486d54da6';
SET LOCAL request.jwt.claim.role='authenticated';
DO $test$
DECLARE
 tour uuid:='46cab483-91e7-4220-aacf-e17bdf05269c';tbl uuid:='d294f4a4-082b-4efc-a6ca-1f96579ea344';
 hand uuid:='7080b766-b07b-41c5-b4f5-d3350cc505d5';action uuid:='aa364f28-b2a2-4793-b383-6c9c8322fe01';
 request uuid:='b5920000-0000-4000-8000-000000000001';actor uuid:='675fe35e-60a8-4452-bb90-e79486d54da6';
 first jsonb;again jsonb;result jsonb;before_business text;after_business text;
 recorded_before jsonb;recorded_after jsonb;
BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 ASSERT NOT EXISTS(SELECT 1 FROM private.tracker_undo_intent_cancellations_v1);
 ASSERT EXISTS(SELECT 1 FROM public.tournament_hands WHERE id=hand AND status='in_progress' AND source_revision=6);
 ASSERT EXISTS(SELECT 1 FROM public.tracker_correction_uat_scopes WHERE id='9f76148b-189e-4af7-b4b6-8f8111242c7d' AND enabled=false);
 SELECT md5(jsonb_build_object('hands',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_hands x),
 'actions',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.hand_actions x),
 'players',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.hand_players x),
 'seats',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_seats x),
 'operations',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tracker_correction_operations x))::text) INTO before_business;
 SET LOCAL ROLE authenticated;
 -- Retained real Undo, not a fabricated receipt: cancellation must preserve it.
 recorded_before:=public.get_tracker_undo_receipt_v1(tour,tbl,
 '876a9056-b3bf-414c-a1f6-5e344fc003d3','1529555e-5907-4be9-95ab-0cc3edcc2d04',6,
 'bad8e19f-9679-4cd2-97be-674e9a206a79');
 ASSERT recorded_before->>'ok'='true' AND recorded_before->>'outcome'='recorded';
 recorded_after:=public.cancel_tracker_undo_intent_v1(tour,tbl,
 '876a9056-b3bf-414c-a1f6-5e344fc003d3','1529555e-5907-4be9-95ab-0cc3edcc2d04',6,
 'bad8e19f-9679-4cd2-97be-674e9a206a79');
 ASSERT recorded_after=recorded_before,'cancellation must not mask an already committed Undo';
 result:=public.get_tracker_undo_receipt_v1(tour,tbl,hand,action,6,request);
 ASSERT result->>'ok'='true' AND result->>'outcome'='not_found';
 first:=public.cancel_tracker_undo_intent_v1(tour,tbl,hand,action,6,request);
 ASSERT first->>'ok'='true' AND first->>'outcome'='cancelled' AND first->>'actor_id'=actor::text AND first->>'request_id'=request::text;
 ASSERT first#>>'{receipt,operation}'='cancel_undo_open_hand' AND first#>>'{receipt,cancelled}'='true';
 ASSERT first#>>'{receipt,hand_id}'=hand::text AND first#>>'{receipt,expected_action_id}'=action::text;
 ASSERT first#>>'{receipt,expected_source_revision}'='6';
 again:=public.cancel_tracker_undo_intent_v1(tour,tbl,hand,action,6,request);
 ASSERT again=first,'same intent must replay exactly without an extra cancellation/audit';
 result:=public.get_tracker_undo_receipt_v1(tour,tbl,hand,action,6,request);
 ASSERT result=first,'pure receipt lookup must recover the cancellation proof';
 result:=public.undo_tracker_last_action_v1(tour,tbl,hand,action,6,request);
 ASSERT result->>'ok'='false' AND result->>'error'='undo_request_cancelled','late writer must see tombstone before UAT gate';
 result:=public.cancel_tracker_undo_intent_v1(tour,tbl,hand,action,7,request);
 ASSERT result->>'ok'='false' AND result->>'error'='request_key_conflict';
 result:=public.undo_tracker_last_action_v1(tour,tbl,hand,action,7,request);
 ASSERT result->>'ok'='false' AND result->>'error'='request_key_conflict';
 PERFORM set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000099',true);
 result:=public.cancel_tracker_undo_intent_v1(tour,tbl,hand,action,6,request);
 ASSERT result->>'ok'='false' AND result->>'error'='tracker_scope_denied';
 PERFORM set_config('request.jwt.claim.sub','',true);
 result:=public.cancel_tracker_undo_intent_v1(tour,tbl,hand,action,6,request);
 ASSERT result->>'ok'='false' AND result->>'error'='authentication_required';
 RESET ROLE;
 ASSERT (SELECT count(*)=1 FROM private.tracker_undo_intent_cancellations_v1);
 ASSERT (SELECT count(*)=1 FROM public.audit_logs audit WHERE audit.action='tracker_undo_intent_cancelled' AND audit.payload->>'request_id'=request::text);
 ASSERT NOT has_table_privilege('authenticated','private.tracker_undo_intent_cancellations_v1','SELECT');
 ASSERT NOT has_table_privilege('service_role','private.tracker_undo_intent_cancellations_v1','INSERT');
 ASSERT NOT has_function_privilege('anon','public.cancel_tracker_undo_intent_v1(uuid,uuid,uuid,uuid,bigint,uuid)','EXECUTE');
 ASSERT NOT has_function_privilege('service_role','public.cancel_tracker_undo_intent_v1(uuid,uuid,uuid,uuid,bigint,uuid)','EXECUTE');
 SELECT md5(jsonb_build_object('hands',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_hands x),
 'actions',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.hand_actions x),
 'players',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.hand_players x),
 'seats',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_seats x),
 'operations',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tracker_correction_operations x))::text) INTO after_business;
 ASSERT before_business=after_business,'cancellation must not undo or rewrite any business state';
 RAISE NOTICE 'UNDO592_CANCEL_REPLAY_LOOKUP_CONFLICT_LATE_WRITER_AUTH_ACL_NO_BUSINESS_DELTA_PASS';
END $test$;
