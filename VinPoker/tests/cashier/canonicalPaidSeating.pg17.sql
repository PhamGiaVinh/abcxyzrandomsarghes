\set ON_ERROR_STOP on
-- Isolated native fixture only. All malformed lifecycle states roll back.
BEGIN;
DO $$ BEGIN
 IF current_database()<>'vinpoker_ops_cash112_ui' OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet
 OR inet_server_port()<>55441 OR current_setting('server_version_num')::int/10000<>17
 OR EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_net') THEN
 RAISE EXCEPTION 'isolated_cash113_database_required';END IF;
END $$;
DO $$ DECLARE tour uuid:='8e5f7bbd-a466-48c1-b2b8-ef82a2979a86'; count_before bigint; BEGIN
 SELECT count(*) INTO count_before FROM public.tournament_seats;
 IF NOT EXISTS(SELECT 1 FROM floor_private.pick_cashier_canonical_seat_v1(tour,'random_balanced')) THEN
 RAISE EXCEPTION 'current_canonical_session_positive_failed';END IF;
 BEGIN
  UPDATE public.table_sessions SET closed_at=now() WHERE tournament_id=tour AND closed_at IS NULL;
  IF EXISTS(SELECT 1 FROM floor_private.pick_cashier_canonical_seat_v1(tour,'random_balanced')) THEN
   RAISE EXCEPTION 'closed_session_accepted';END IF;
  RAISE SQLSTATE 'PZ001';
 EXCEPTION WHEN SQLSTATE 'PZ001' THEN NULL;END;
 BEGIN
  -- Preserve FK integrity of the occupied paid fixture; challenge only the
  -- other empty table while occupied tables are temporarily ineligible.
  UPDATE public.tournament_tables SET status='closed' WHERE tournament_id=tour;
  UPDATE public.tournament_tables t SET table_session_id=NULL,status='active' WHERE tournament_id=tour
   AND NOT EXISTS(SELECT 1 FROM public.tournament_seats s WHERE s.tournament_table_id=t.id OR s.table_id=t.id);
  IF NOT FOUND THEN RAISE EXCEPTION 'empty_table_negative_fixture_missing';END IF;
  IF EXISTS(SELECT 1 FROM floor_private.pick_cashier_canonical_seat_v1(tour,'fill_lowest_table')) THEN
   RAISE EXCEPTION 'missing_session_accepted';END IF;
  RAISE SQLSTATE 'PZ001';
 EXCEPTION WHEN SQLSTATE 'PZ001' THEN NULL;END;
 BEGIN
  UPDATE public.tournament_tables SET status='closed' WHERE tournament_id=tour;
  IF EXISTS(SELECT 1 FROM floor_private.pick_cashier_canonical_seat_v1(tour,'random_balanced')) THEN
   RAISE EXCEPTION 'inactive_logical_table_accepted';END IF;
  RAISE SQLSTATE 'PZ001';
 EXCEPTION WHEN SQLSTATE 'PZ001' THEN NULL;END;
 IF (SELECT count(*) FROM public.tournament_seats)<>count_before THEN RAISE EXCEPTION 'picker_mutated_seats';END IF;
 IF NOT EXISTS(SELECT 1 FROM floor_private.pick_cashier_canonical_seat_v1(tour,'random_balanced')) THEN
 RAISE EXCEPTION 'positive_after_negative_rollback_failed';END IF;
 IF has_function_privilege('authenticated','floor_private.pick_cashier_canonical_seat_v1(uuid,text)','EXECUTE')
 OR has_function_privilege('anon','floor_private.pick_cashier_canonical_seat_v1(uuid,text)','EXECUTE')
 OR has_function_privilege('service_role','floor_private.pick_cashier_canonical_seat_v1(uuid,text)','EXECUTE') THEN
 RAISE EXCEPTION 'private_picker_acl_exposed';END IF;
END $$;
ROLLBACK;
SELECT 'CASH113_CURRENT_CLOSED_MISSING_INACTIVE_SESSION_ACL_PASS';
