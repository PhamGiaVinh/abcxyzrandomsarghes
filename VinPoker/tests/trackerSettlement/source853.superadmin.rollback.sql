\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout='1s';SET LOCAL statement_timeout='10s';
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 ASSERT NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname IN('pg_net','dblink'));
END $$;
-- LOCAL853_CANDIDATE_BEFORE_TEST
CREATE FUNCTION pg_temp.facts853() RETURNS text LANGUAGE sql AS $$
 SELECT md5(jsonb_build_array(
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.user_roles x),
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_hands x),
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.hand_actions x),
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.hand_players x),
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_settlement_outcomes x),
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY hand_id,source_revision) FROM public.tracker_historical_display_queue x),
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.cashier_buyin_movements x),
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_prize_payments x)
 )::text);
$$;
DO $test$
DECLARE actor uuid:='febf2b51-fdb7-42ff-886c-b3bb1fffdc3e';hand uuid;changed integer;baseline text;
BEGIN
 baseline:=pg_temp.facts853();
 ASSERT NOT public.is_club_tracker(actor,'a8e7d1b7-fdaa-45ad-b0a1-f894b6315760');
 BEGIN
  -- Ephemeral provisioning only; no persistent privilege or account changes.
  INSERT INTO public.user_roles(user_id,role) VALUES(actor,'super_admin');
  ASSERT public.is_club_tracker(actor,'a8e7d1b7-fdaa-45ad-b0a1-f894b6315760');
  PERFORM set_config('request.jwt.claim.sub',actor::text,true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',actor)::text,true);
  SET LOCAL ROLE authenticated;
  INSERT INTO public.tournament_hands(tournament_id,table_id,hand_number,created_by,status)
   VALUES('46cab483-91e7-4220-aacf-e17bdf05269c','d294f4a4-082b-4efc-a6ca-1f96579ea344',1853000001,actor,'completed')
   RETURNING id INTO hand;
  UPDATE public.tournament_hands SET pot_size=pot_size+1 WHERE id=hand;
  GET DIAGNOSTICS changed=ROW_COUNT;ASSERT changed=1,'legacy super-admin creator update lost';
  DELETE FROM public.tournament_hands WHERE id=hand;
  GET DIAGNOSTICS changed=ROW_COUNT;ASSERT changed=1,'legacy super-admin creator delete lost';
  RESET ROLE;
  -- Do not expand this compatibility exception to another creator's raw row.
  INSERT INTO public.tournament_hands(tournament_id,table_id,hand_number,created_by,status)
   VALUES('46cab483-91e7-4220-aacf-e17bdf05269c','d294f4a4-082b-4efc-a6ca-1f96579ea344',1853000002,
    '675fe35e-60a8-4452-bb90-e79486d54da6','completed') RETURNING id INTO hand;
  SET LOCAL ROLE authenticated;
  UPDATE public.tournament_hands SET pot_size=pot_size+1 WHERE id=hand;
  GET DIAGNOSTICS changed=ROW_COUNT;ASSERT changed=0,'super-admin raw update scope expanded';
  DELETE FROM public.tournament_hands WHERE id=hand;
  GET DIAGNOSTICS changed=ROW_COUNT;ASSERT changed=0,'super-admin raw delete scope expanded';
  RESET ROLE;
  RAISE EXCEPTION USING ERRCODE='P0853',MESSAGE='rollback super-admin compatibility probes';
 EXCEPTION WHEN SQLSTATE 'P0853' THEN NULL;
 END;
 ASSERT pg_temp.facts853()=baseline,'super-admin probe changed eight fact groups';
 ASSERT NOT public.has_role(actor,'super_admin');
 RAISE NOTICE 'SOURCE853_EXISTING_SUPERADMIN_CREATOR_IUD_PRESERVED_NO_OTHER_CREATOR_EXPANSION_EIGHT_FACTS_ROLLBACK_PASS';
END $test$;
ROLLBACK;
