-- Owned captured-schema fixture only. No production claims or row reads.
\set ON_ERROR_STOP on
BEGIN;
DO $test$
DECLARE row record; n integer; changed integer; conservation text; after_conservation text;
BEGIN
 IF current_database() NOT IN ('vinpoker_visibility74_candidate_20261014','vinpoker_visibility74_ci') OR current_user<>'postgres'
 OR inet_server_addr()<>'127.0.0.1'::inet
 OR (current_database()='vinpoker_visibility74_candidate_20261014' AND inet_server_port()<>55464)
 OR (current_database()='vinpoker_visibility74_ci' AND inet_server_port()<>55441)
 OR md5(replace(pg_get_functiondef('floor_private.tracker_hand_read_scope74(uuid,boolean,uuid)'::regprocedure),chr(13),''))<>'9da991bb1262c314ded4bfd69c70749c' THEN RAISE EXCEPTION 'owned_visibility74_fixture_required'; END IF;
 SELECT md5(jsonb_build_object('entries',(SELECT jsonb_agg(to_jsonb(e) ORDER BY e.id) FROM public.tournament_entries e),'seats',(SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id) FROM public.tournament_seats s),'chips',(SELECT jsonb_agg(to_jsonb(c) ORDER BY c.player_id,c.entry_number) FROM public.tournament_chip_counts c))::text) INTO conservation;
 PERFORM set_config('request.jwt.claim.sub','',true);
 PERFORM set_config('request.jwt.claims','{"role":"anon"}',true);
 SET LOCAL ROLE anon;
 SELECT count(*) INTO n FROM public.tournament_hands WHERE id='86000000-0000-4000-8000-000000000001';
 IF n<>1 THEN RAISE EXCEPTION 'published_guest_hand_hidden'; END IF;
 SELECT count(*) INTO n FROM public.hand_players WHERE hand_id='86000000-0000-4000-8000-000000000001';
 IF n<>2 THEN RAISE EXCEPTION 'published_guest_participants_hidden'; END IF;
 RESET ROLE;
 UPDATE public.tournament_hands SET is_voided=true WHERE id='86000000-0000-4000-8000-000000000001';
 -- Creator access is an existing write-policy exception, not an implicit role.
 DELETE FROM public.club_trackers WHERE user_id='81400000-0000-4000-8000-000000000001' AND club_id='81000000-0000-4000-8000-000000000001';
 IF public.is_club_tracker('81400000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000001') THEN RAISE EXCEPTION 'creator_role_removal_fixture_invalid'; END IF;
 FOR row IN SELECT * FROM (VALUES
  ('anon',NULL::uuid,0),
  ('authenticated','89999999-0000-4000-8000-000000000001'::uuid,0),
  ('authenticated','81600000-0000-4000-8000-000000000001'::uuid,0),
  ('authenticated','81300000-0000-4000-8000-000000000001'::uuid,1),
  ('authenticated','81100000-0000-4000-8000-000000000001'::uuid,1),
  ('authenticated','81400000-0000-4000-8000-000000000001'::uuid,1)
 ) AS actors(role_name,actor_id,expected) LOOP
  PERFORM set_config('request.jwt.claim.sub',COALESCE(row.actor_id::text,''),true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('role',row.role_name,'sub',row.actor_id)::text,true);
  EXECUTE format('SET LOCAL ROLE %I',row.role_name);
  SELECT count(*) INTO n FROM public.tournament_hands WHERE id='86000000-0000-4000-8000-000000000001';
  IF n<>row.expected THEN RAISE EXCEPTION 'voided_hand_actor_visibility_mismatch: %',row.actor_id; END IF;
  SELECT count(*) INTO n FROM public.hand_players WHERE hand_id='86000000-0000-4000-8000-000000000001';
  IF n<>row.expected*2 THEN RAISE EXCEPTION 'voided_participant_actor_visibility_mismatch: %',row.actor_id; END IF;
  IF row.role_name='authenticated' AND row.expected=0 THEN
   WITH rows AS (UPDATE public.tournament_hands SET pot_size=pot_size WHERE id='86000000-0000-4000-8000-000000000001' RETURNING id) SELECT count(*) INTO changed FROM rows;
   IF changed<>0 THEN RAISE EXCEPTION 'unrelated_actor_updated_unpublished_hand: %',row.actor_id; END IF;
   WITH rows AS (UPDATE public.hand_players SET seat_number=seat_number WHERE hand_id='86000000-0000-4000-8000-000000000001' RETURNING id) SELECT count(*) INTO changed FROM rows;
   IF changed<>0 THEN RAISE EXCEPTION 'unrelated_actor_updated_unpublished_participant: %',row.actor_id; END IF;
  END IF;
  RESET ROLE;
 END LOOP;
 -- Add each authority independently to the previously denied foreign-club actor.
 INSERT INTO public.club_cashiers(club_id,user_id) VALUES ('81000000-0000-4000-8000-000000000001','81600000-0000-4000-8000-000000000001');
 PERFORM set_config('request.jwt.claim.sub','81600000-0000-4000-8000-000000000001',true);
 PERFORM set_config('request.jwt.claims','{"role":"authenticated","sub":"81600000-0000-4000-8000-000000000001"}',true);
 SET LOCAL ROLE authenticated;
 SELECT count(*) INTO n FROM public.tournament_hands WHERE id='86000000-0000-4000-8000-000000000001';
 IF n<>1 THEN RAISE EXCEPTION 'cashier_archived_visibility_regression'; END IF;
 RESET ROLE;
 DELETE FROM public.club_cashiers WHERE club_id='81000000-0000-4000-8000-000000000001' AND user_id='81600000-0000-4000-8000-000000000001';
 INSERT INTO public.user_roles(user_id,role) VALUES ('81600000-0000-4000-8000-000000000001','super_admin');
 SET LOCAL ROLE authenticated;
 SELECT count(*) INTO n FROM public.tournament_hands WHERE id='86000000-0000-4000-8000-000000000001';
 IF n<>1 THEN RAISE EXCEPTION 'super_admin_archived_visibility_regression'; END IF;
 RESET ROLE;
 DELETE FROM public.user_roles WHERE user_id='81600000-0000-4000-8000-000000000001' AND role='super_admin';
 -- Existing Owner UPDATE/RETURNING remains eligible on a voided row.
 PERFORM set_config('request.jwt.claim.sub','81100000-0000-4000-8000-000000000001',true);
 PERFORM set_config('request.jwt.claims','{"role":"authenticated","sub":"81100000-0000-4000-8000-000000000001"}',true);
 SET LOCAL ROLE authenticated;
 WITH rows AS (UPDATE public.tournament_hands SET pot_size=pot_size WHERE id='86000000-0000-4000-8000-000000000001' RETURNING id) SELECT count(*) INTO changed FROM rows;
 IF changed<>1 THEN RAISE EXCEPTION 'owner_hand_update_returning_regression'; END IF;
 WITH rows AS (UPDATE public.hand_players SET seat_number=seat_number WHERE hand_id='86000000-0000-4000-8000-000000000001' RETURNING id) SELECT count(*) INTO changed FROM rows;
 IF changed<>2 THEN RAISE EXCEPTION 'owner_participant_update_returning_regression'; END IF;
 RESET ROLE;
 UPDATE public.tournaments SET deleted_at=now() WHERE id='85000000-0000-4000-8000-000000000001';
 -- INSERT RETURNING on an unpublished row must retain the existing Owner write path.
 -- No table/session is inferred: this is an isolated historical import shape.
 PERFORM set_config('request.jwt.claim.sub','81100000-0000-4000-8000-000000000001',true);
 PERFORM set_config('request.jwt.claims','{"role":"authenticated","sub":"81100000-0000-4000-8000-000000000001"}',true);
 SET LOCAL ROLE authenticated;
 WITH rows AS (
  INSERT INTO public.tournament_hands(id,tournament_id,hand_number,created_by,is_voided,status)
  VALUES ('86000000-0000-4000-8000-000000000074','85000000-0000-4000-8000-000000000001',740074,'81100000-0000-4000-8000-000000000001',true,'completed')
  RETURNING id
 ) SELECT count(*) INTO changed FROM rows;
 IF changed<>1 THEN RAISE EXCEPTION 'owner_unpublished_insert_returning_regression'; END IF;
 RESET ROLE;
 PERFORM set_config('request.jwt.claim.sub','',true);
 PERFORM set_config('request.jwt.claims','{"role":"anon"}',true);
 SET LOCAL ROLE anon;
 SELECT count(*) INTO n FROM public.tournament_hands WHERE tournament_id='85000000-0000-4000-8000-000000000001';
 IF n<>0 THEN RAISE EXCEPTION 'deleted_raw_hand_bypass'; END IF;
 SELECT count(*) INTO n FROM public.hand_players WHERE tournament_id='85000000-0000-4000-8000-000000000001';
 IF n<>0 THEN RAISE EXCEPTION 'deleted_raw_participant_bypass'; END IF;
 RESET ROLE;
 SELECT md5(jsonb_build_object('entries',(SELECT jsonb_agg(to_jsonb(e) ORDER BY e.id) FROM public.tournament_entries e),'seats',(SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id) FROM public.tournament_seats s),'chips',(SELECT jsonb_agg(to_jsonb(c) ORDER BY c.player_id,c.entry_number) FROM public.tournament_chip_counts c))::text) INTO after_conservation;
 IF conservation IS DISTINCT FROM after_conservation THEN RAISE EXCEPTION 'visibility_read_tests_changed_chip_entry_seat_state'; END IF;
 RAISE NOTICE 'VISIBILITY74_PUBLIC_OPERATOR_TENANT_VOID_DELETE_INSERT_UPDATE_RETURNING_PASS';
END;
$test$;
ROLLBACK;
