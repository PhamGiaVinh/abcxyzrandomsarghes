\set ON_ERROR_STOP on
SELECT md5(jsonb_build_object('qual',pg_get_expr(polqual,polrelid),'check',pg_get_expr(polwithcheck,polrelid),
 'roles',polroles,'permissive',polpermissive,'command',polcmd)::text) AS source852_policy_before
 FROM pg_policy WHERE polrelid='public.tournament_hands'::regclass AND polname='Tournament hands manageable by admins' \gset
-- Existing retained active hand journey, all changes rollback. No new fixture.
BEGIN;
SET LOCAL lock_timeout='1s';SET LOCAL statement_timeout='10s';
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 ASSERT NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname IN('pg_net','dblink'));
END $$;
CREATE TEMP TABLE source852_before AS SELECT
 (SELECT md5(jsonb_agg(to_jsonb(x) ORDER BY id)::text) FROM public.tournament_hands x) hands,
 (SELECT md5(jsonb_agg(to_jsonb(x) ORDER BY id)::text) FROM public.hand_actions x) actions,
 (SELECT md5(jsonb_agg(to_jsonb(x) ORDER BY id)::text) FROM public.hand_players x) players,
 (SELECT md5(jsonb_agg(to_jsonb(x) ORDER BY id)::text) FROM public.tournament_settlement_outcomes x) outcomes,
 (SELECT md5(jsonb_agg(to_jsonb(x) ORDER BY hand_id,source_revision)::text) FROM public.tracker_historical_display_queue x) queue,
 (SELECT md5(jsonb_agg(to_jsonb(x) ORDER BY id)::text) FROM public.cashier_buyin_movements x) cash,
 (SELECT md5(jsonb_agg(to_jsonb(x) ORDER BY id)::text) FROM public.tournament_prize_payments x) prizes,
 md5(jsonb_build_array(
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY club_id,user_id) FROM public.club_cashiers x),
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY club_id,user_id) FROM public.club_trackers x),
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY club_id,user_id) FROM public.club_dealer_controls x))::text) permissions;
-- LOCAL852_CANDIDATE_BEFORE_TEST
DO $test$
DECLARE denied boolean:=false; inserted uuid; actor uuid:='febf2b51-fdb7-42ff-886c-b3bb1fffdc3e';
 bad_paths text[]:=ARRAY[]::text[];changed integer;membership_table text;authorized_actor uuid;
BEGIN
 ASSERT EXISTS(SELECT 1 FROM public.tournaments WHERE id='46cab483-91e7-4220-aacf-e17bdf05269c'
  AND club_id='a8e7d1b7-fdaa-45ad-b0a1-f894b6315760');
 ASSERT NOT public.is_club_tracker(actor,'a8e7d1b7-fdaa-45ad-b0a1-f894b6315760');
 ASSERT NOT EXISTS(SELECT 1 FROM public.club_cashiers WHERE user_id=actor AND club_id='a8e7d1b7-fdaa-45ad-b0a1-f894b6315760');
 ASSERT NOT EXISTS(SELECT 1 FROM public.club_dealer_controls WHERE user_id=actor AND club_id='a8e7d1b7-fdaa-45ad-b0a1-f894b6315760');
 PERFORM set_config('request.jwt.claim.sub',actor::text,true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',actor)::text,true);
 BEGIN
  BEGIN
   SET LOCAL ROLE authenticated;
   INSERT INTO public.tournament_hands(tournament_id,table_id,hand_number,created_by,status)
    VALUES('46cab483-91e7-4220-aacf-e17bdf05269c','d294f4a4-082b-4efc-a6ca-1f96579ea344',1852000001,actor,'completed')
    RETURNING id INTO inserted;
   RESET ROLE;
  EXCEPTION WHEN insufficient_privilege THEN
   RESET ROLE;denied:=true;
  END;
  RAISE EXCEPTION USING ERRCODE='P0852',MESSAGE='rollback foreign insert probe';
 EXCEPTION WHEN SQLSTATE 'P0852' THEN NULL;
 END;
 RAISE NOTICE 'SOURCE852_FOREIGN_INSERT_DENIED=% ACCEPTED_ID=%',denied,inserted;
 IF NOT denied THEN bad_paths:=array_append(bad_paths,'INSERT'); END IF;
 -- Model a legacy poisoned row created by the old permission defect. This is
 -- privileged fault setup, not a legitimate product entry or accepted history.
 BEGIN
  INSERT INTO public.tournament_hands(tournament_id,table_id,hand_number,created_by,status)
   VALUES('46cab483-91e7-4220-aacf-e17bdf05269c','d294f4a4-082b-4efc-a6ca-1f96579ea344',1852000003,actor,'completed')
   RETURNING id INTO inserted;
  SET LOCAL ROLE authenticated;
  UPDATE public.tournament_hands SET pot_size=pot_size+1 WHERE id=inserted;
  GET DIAGNOSTICS changed=ROW_COUNT;
  RESET ROLE;
  RAISE NOTICE 'SOURCE852_FOREIGN_LEGACY_UPDATE_ROWS=%',changed;
  IF changed<>0 THEN bad_paths:=array_append(bad_paths,'UPDATE'); END IF;
  SET LOCAL ROLE authenticated;
  DELETE FROM public.tournament_hands WHERE id=inserted;
  GET DIAGNOSTICS changed=ROW_COUNT;
  RESET ROLE;
  RAISE NOTICE 'SOURCE852_FOREIGN_LEGACY_DELETE_ROWS=%',changed;
  IF changed<>0 THEN bad_paths:=array_append(bad_paths,'DELETE'); END IF;
  RAISE EXCEPTION USING ERRCODE='P0852',MESSAGE='rollback legacy ownership probes';
 EXCEPTION WHEN SQLSTATE 'P0852' THEN NULL;
 END;
 ASSERT cardinality(bad_paths)=0,'SOURCE852_FOREIGN_CREATOR_WRITE_PATHS: '||array_to_string(bad_paths,',');
 -- Each existing role branch stays authorized. New TEST grants and rows exist
 -- only inside independently rolled-back subtransactions.
 FOREACH membership_table IN ARRAY ARRAY['owner','club_cashiers','club_trackers','club_dealer_controls'] LOOP
 BEGIN
  authorized_actor:=CASE WHEN membership_table='owner' THEN '675fe35e-60a8-4452-bb90-e79486d54da6'::uuid ELSE actor END;
  IF membership_table<>'owner' THEN
   EXECUTE format('INSERT INTO public.%I(club_id,user_id,granted_by) VALUES($1,$2,$3)',membership_table)
    USING 'a8e7d1b7-fdaa-45ad-b0a1-f894b6315760'::uuid,authorized_actor,'675fe35e-60a8-4452-bb90-e79486d54da6'::uuid;
  END IF;
  PERFORM set_config('request.jwt.claim.sub',authorized_actor::text,true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',authorized_actor)::text,true);
  SET LOCAL ROLE authenticated;
  INSERT INTO public.tournament_hands(tournament_id,table_id,hand_number,created_by,status)
   VALUES('46cab483-91e7-4220-aacf-e17bdf05269c','d294f4a4-082b-4efc-a6ca-1f96579ea344',1852000002,
    authorized_actor,'completed') RETURNING id INTO inserted;
  RESET ROLE;
  ASSERT inserted IS NOT NULL;
  SET LOCAL ROLE authenticated;
  UPDATE public.tournament_hands SET pot_size=pot_size+1 WHERE id=inserted;
  GET DIAGNOSTICS changed=ROW_COUNT;
  RESET ROLE;ASSERT changed=1,'same-club operator update lost';
  SET LOCAL ROLE authenticated;
  DELETE FROM public.tournament_hands WHERE id=inserted;
  GET DIAGNOSTICS changed=ROW_COUNT;
  RESET ROLE;ASSERT changed=1,'same-club operator delete lost';
  RAISE NOTICE 'SOURCE852_AUTHORIZED_IUD_ROLE=%',membership_table;
  RAISE EXCEPTION USING ERRCODE='P0852',MESSAGE='rollback successful authorized insert';
 EXCEPTION WHEN SQLSTATE 'P0852' THEN NULL;
 END;
 END LOOP;
END $test$;
DO $$ BEGIN
 ASSERT (SELECT hands FROM source852_before) IS NOT DISTINCT FROM (SELECT md5(jsonb_agg(to_jsonb(x) ORDER BY id)::text) FROM public.tournament_hands x);
 ASSERT (SELECT actions FROM source852_before) IS NOT DISTINCT FROM (SELECT md5(jsonb_agg(to_jsonb(x) ORDER BY id)::text) FROM public.hand_actions x);
 ASSERT (SELECT players FROM source852_before) IS NOT DISTINCT FROM (SELECT md5(jsonb_agg(to_jsonb(x) ORDER BY id)::text) FROM public.hand_players x);
 ASSERT (SELECT outcomes FROM source852_before) IS NOT DISTINCT FROM (SELECT md5(jsonb_agg(to_jsonb(x) ORDER BY id)::text) FROM public.tournament_settlement_outcomes x);
 ASSERT (SELECT queue FROM source852_before) IS NOT DISTINCT FROM (SELECT md5(jsonb_agg(to_jsonb(x) ORDER BY hand_id,source_revision)::text) FROM public.tracker_historical_display_queue x);
 ASSERT (SELECT cash FROM source852_before) IS NOT DISTINCT FROM (SELECT md5(jsonb_agg(to_jsonb(x) ORDER BY id)::text) FROM public.cashier_buyin_movements x);
 ASSERT (SELECT prizes FROM source852_before) IS NOT DISTINCT FROM (SELECT md5(jsonb_agg(to_jsonb(x) ORDER BY id)::text) FROM public.tournament_prize_payments x);
 ASSERT (SELECT permissions FROM source852_before)=md5(jsonb_build_array(
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY club_id,user_id) FROM public.club_cashiers x),
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY club_id,user_id) FROM public.club_trackers x),
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY club_id,user_id) FROM public.club_dealer_controls x))::text);
END $$;
ROLLBACK;
SELECT md5(jsonb_build_object('qual',pg_get_expr(polqual,polrelid),'check',pg_get_expr(polwithcheck,polrelid),
 'roles',polroles,'permissive',polpermissive,'command',polcmd)::text)=:'source852_policy_before' AS source852_policy_restored
 FROM pg_policy WHERE polrelid='public.tournament_hands'::regclass AND polname='Tournament hands manageable by admins' \gset
\if :source852_policy_restored
\echo SOURCE852_FOREIGN_IUD_DENIED_FOUR_ROLE_IUD_POSITIVE_EIGHT_FACTS_POLICY_EXACT_ROLLBACK_PASS
\else
DO $$ BEGIN RAISE EXCEPTION 'SOURCE852_POLICY_NOT_RESTORED';END $$;
\endif
