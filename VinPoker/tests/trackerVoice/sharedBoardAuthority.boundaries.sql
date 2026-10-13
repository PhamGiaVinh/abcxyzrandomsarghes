SELECT public._tracker_voice_hand_state_version('86000000-0000-4000-8000-000000000001') AS version,
 (SELECT count(*) FROM public.tracker_voice_events) AS events \gset direct_before_
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','81300000-0000-4000-8000-000000000001',false);
SELECT set_config('request.jwt.claims','{"sub":"81300000-0000-4000-8000-000000000001","role":"authenticated"}',false);
-- NULL/nonexistent hand must still reject delegation before touching its scope.
SELECT public._tracker_card_board_source_v1(NULL,'[]'::jsonb,'81300000-0000-4000-8000-000000000001',true)::text AS payload \gset direct_delegate_
SELECT public.update_community_cards('86000000-0000-4000-8000-000000000001','[]'::jsonb,'81300000-0000-4000-8000-000000000001')::text AS payload \gset direct_public_
SELECT public._tracker_card_hole_source_v1(NULL,'[]'::jsonb,'81300000-0000-4000-8000-000000000001',true)::text AS payload \gset direct_hole_delegate_
SELECT public.show_hole_cards('86000000-0000-4000-8000-000000000001','[]'::jsonb,'81300000-0000-4000-8000-000000000001')::text AS payload \gset direct_hole_public_
RESET ROLE;
SELECT public.tracker_voice_test_assert(
 :'direct_delegate_payload'::jsonb->>'error'='voice_delegation_required'
 AND :'direct_hole_delegate_payload'::jsonb->>'error'='voice_delegation_required'
 AND :'direct_public_payload'::jsonb->>'error'='Hand not found'
 AND :'direct_hole_public_payload'::jsonb->>'error'='hand_not_found'
 AND public._tracker_voice_hand_state_version('86000000-0000-4000-8000-000000000001')=:'direct_before_version'
 AND (SELECT count(*) FROM public.tracker_voice_events)=:'direct_before_events'::bigint,
 'Floor cannot select delegated branch or bypass original public RLS; zero source/event delta');
SELECT public.tracker_voice_test_assert(
 NOT has_function_privilege('anon','public._tracker_card_board_source_v1(uuid,jsonb,uuid,boolean)','EXECUTE')
 AND NOT has_function_privilege('service_role','public._tracker_card_board_source_v1(uuid,jsonb,uuid,boolean)','EXECUTE')
 AND (SELECT NOT prosecdef AND proconfig=ARRAY['search_path=""']::text[] AND pg_get_userbyid(proowner)='postgres' AND pronargdefaults=0
 FROM pg_proc WHERE oid='public._tracker_card_board_source_v1(uuid,jsonb,uuid,boolean)'::regprocedure),
 'shared writer invoker with fixed path, owner, no default delegation, no anon/service grant');
SELECT 'SHARED_BOARD_DELEGATION_BOUNDARY_PASS';
SELECT public.tracker_voice_test_assert(
 NOT has_function_privilege('anon','public._tracker_card_hole_source_v1(uuid,jsonb,uuid,boolean)','EXECUTE')
 AND NOT has_function_privilege('service_role','public._tracker_card_hole_source_v1(uuid,jsonb,uuid,boolean)','EXECUTE')
 AND (SELECT NOT prosecdef AND proconfig=ARRAY['search_path=""']::text[] AND pg_get_userbyid(proowner)='postgres' AND pronargdefaults=0
 FROM pg_proc WHERE oid='public._tracker_card_hole_source_v1(uuid,jsonb,uuid,boolean)'::regprocedure),
 'shared hole invoker retains restricted metadata');
SELECT 'SHARED_HOLE_DELEGATION_BOUNDARY_PASS';
