\set ON_ERROR_STOP on
BEGIN;
SET LOCAL statement_timeout='20s'; SET LOCAL lock_timeout='3s';
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 ASSERT EXISTS(SELECT 1 FROM public.table_sessions WHERE id='0aab12d1-b855-4014-9f22-1dc59719c7e2' AND closed_at IS NOT NULL);
 ASSERT EXISTS(SELECT 1 FROM public.table_sessions WHERE id='f60106c2-7ed5-4be3-8512-602b16eddff3' AND game_table_id='29b12a26-6987-4bfa-810f-bfc64d13ef01' AND tournament_id='c367013a-3ed3-48af-ad48-3915acadc50e' AND closed_at IS NULL AND control_mode='manual' AND control_epoch=1 AND revision=1);
 ASSERT EXISTS(SELECT 1 FROM public.tournament_tables WHERE id='4f493b5e-ef25-4e55-bafd-faab24fcade9' AND table_session_id='f60106c2-7ed5-4be3-8512-602b16eddff3' AND status='active');
 ASSERT EXISTS(SELECT 1 FROM public.tournament_tables WHERE id='174d8c97-ed28-4170-9053-813ccb50ec89' AND table_session_id='0aab12d1-b855-4014-9f22-1dc59719c7e2' AND status='closed');
 ASSERT NOT EXISTS(SELECT 1 FROM public.dealer_assignments WHERE table_session_id='f60106c2-7ed5-4be3-8512-602b16eddff3');
 ASSERT EXISTS(SELECT 1 FROM public.dealer_assignments WHERE id='dfebfb3c-d6bc-437b-a400-0d0b6a9f086a' AND table_session_id='0aab12d1-b855-4014-9f22-1dc59719c7e2' AND released_at IS NOT NULL AND status='completed');
 ASSERT NOT EXISTS(SELECT 1 FROM public.tournament_seats WHERE table_session_id='f60106c2-7ed5-4be3-8512-602b16eddff3' AND is_active);
 ASSERT (SELECT count(*)=8 AND sum(chip_count)=160000 FROM public.tournament_seats WHERE table_session_id='b792f67f-4110-4cf4-bf9f-2bb55a6d4ed5' AND is_active);
END $$;
SELECT set_config('vinpoker.reopen658_before',md5(jsonb_build_array(
 (SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.table_sessions s WHERE game_table_id='29b12a26-6987-4bfa-810f-bfc64d13ef01'),
 (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.tournament_tables t WHERE game_table_id='29b12a26-6987-4bfa-810f-bfc64d13ef01'),
 (SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.dealer_assignments a WHERE table_id='29b12a26-6987-4bfa-810f-bfc64d13ef01'),
 (SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.dealer_attendance a),
 (SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.tournament_seats s WHERE tournament_id='c367013a-3ed3-48af-ad48-3915acadc50e'),
 (SELECT jsonb_agg(to_jsonb(r) ORDER BY actor_id,operation_type,request_id) FROM public.table_operation_receipts r)
 )::text),true) IS NOT NULL;
SET LOCAL request.jwt.claim.sub='febf2b51-fdb7-42ff-886c-b3bb1fffdc3e';
SET LOCAL request.jwt.claims='{"sub":"febf2b51-fdb7-42ff-886c-b3bb1fffdc3e","role":"authenticated"}';
SET LOCAL ROLE authenticated;
DO $$ DECLARE result jsonb; BEGIN
 result:=public.floor_request_table_control_mode_v4('174d8c97-ed28-4170-9053-813ccb50ec89','0aab12d1-b855-4014-9f22-1dc59719c7e2','tracker',5,1,gen_random_uuid());
 ASSERT result->>'ok'='false' AND result->>'error'='table_session_mismatch',result::text;
 result:=public.floor_request_table_control_mode_v4('4f493b5e-ef25-4e55-bafd-faab24fcade9','0aab12d1-b855-4014-9f22-1dc59719c7e2','tracker',1,1,gen_random_uuid());
 ASSERT result->>'ok'='false' AND result->>'error'='table_session_mismatch',result::text;
 result:=public.close_tournament_table('174d8c97-ed28-4170-9053-813ccb50ec89','fill_lowest_table','TEST stale old-session request');
 ASSERT result->>'ok'='false' AND result->>'error'='exact_session_required',result::text;
END $$;
RESET ROLE;
DO $$ BEGIN
 ASSERT current_setting('vinpoker.reopen658_before')=md5(jsonb_build_array(
 (SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.table_sessions s WHERE game_table_id='29b12a26-6987-4bfa-810f-bfc64d13ef01'),
 (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.tournament_tables t WHERE game_table_id='29b12a26-6987-4bfa-810f-bfc64d13ef01'),
 (SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.dealer_assignments a WHERE table_id='29b12a26-6987-4bfa-810f-bfc64d13ef01'),
 (SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.dealer_attendance a),
 (SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.tournament_seats s WHERE tournament_id='c367013a-3ed3-48af-ad48-3915acadc50e'),
 (SELECT jsonb_agg(to_jsonb(r) ORDER BY actor_id,operation_type,request_id) FROM public.table_operation_receipts r)
 )::text);
END $$;
ROLLBACK;
SELECT 'SINGLE658_NEW_SESSION_EMPTY_NO_ASSIGNMENT_OLD_MODE_CROSSLINK_LEGACY_CLOSE_DENIED_NO_DELTA_PASS';
