-- A locked bag is a survivor, not an elimination. Release only its exact source
-- incarnation; keep all identity, stack, frozen roster and bag records intact.
DO $preflight$ BEGIN
 IF to_regprocedure('public.release_bagged_flight_table_v1(uuid,uuid,bigint,text,integer,uuid)') IS NOT NULL
    OR to_regclass('floor_private.bagged_flight_release_permits_v1') IS NOT NULL THEN
  RAISE EXCEPTION 'bagged_release_catalog_collision';
 END IF;
 IF md5(replace(pg_get_functiondef('private.multi_day_after_end_roster_guard_v1()'::regprocedure),chr(13),''))
    <> '5a8dd5f8cddab87949879fff45e6c833' THEN
  RAISE EXCEPTION 'bagged_release_guard_definition_drift';
 END IF;
 IF md5(replace(pg_get_functiondef('public.close_tournament_table_v3(uuid,bigint,uuid)'::regprocedure),chr(13),''))
    <> '1fdcf509235a612c85ad3dfcff4c68e8'
 OR md5(replace(pg_get_functiondef('public.close_tournament_table_v4(uuid,bigint,uuid)'::regprocedure),chr(13),''))
    <> '1d9295e2da7c50daddfea9552e297a7e' THEN
  RAISE EXCEPTION 'bagged_release_close_definition_drift';
 END IF;
 IF (SELECT pg_get_constraintdef(oid) FROM pg_constraint
    WHERE conrelid='public.tournament_entries'::regclass AND conname='tournament_entries_status_check')
    IS DISTINCT FROM $$CHECK ((status = ANY (ARRAY['registered'::text, 'seated'::text, 'busted'::text, 'finished'::text, 'cancelled'::text])))$$
 OR (SELECT pg_get_constraintdef(oid) FROM pg_constraint
    WHERE conrelid='public.tournament_seats'::regclass AND conname='tournament_seats_status_check')
    IS DISTINCT FROM $$CHECK ((status = ANY (ARRAY['active'::text, 'moved'::text, 'busted'::text, 'cancelled'::text, 'free_sit'::text])))$$ THEN
  RAISE EXCEPTION 'bagged_release_status_constraint_drift';
 END IF;
END $preflight$;

CREATE TABLE floor_private.bagged_flight_release_permits_v1 (
 transaction_id bigint NOT NULL,
 backend_pid integer NOT NULL,
 actor_id uuid NOT NULL,
 relation_name text NOT NULL CHECK (relation_name IN ('tournament_entries','tournament_seats')),
 row_id uuid NOT NULL,
 row_before jsonb NOT NULL,
 PRIMARY KEY(transaction_id,backend_pid,relation_name,row_id)
);
ALTER TABLE floor_private.bagged_flight_release_permits_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON floor_private.bagged_flight_release_permits_v1 FROM PUBLIC,anon,authenticated,service_role;

ALTER TABLE public.tournament_entries DROP CONSTRAINT tournament_entries_status_check;
ALTER TABLE public.tournament_entries ADD CONSTRAINT tournament_entries_status_check
 CHECK (status IN ('registered','seated','busted','finished','cancelled','bagged'));
ALTER TABLE public.tournament_seats DROP CONSTRAINT tournament_seats_status_check;
ALTER TABLE public.tournament_seats ADD CONSTRAINT tournament_seats_status_check
 CHECK (status IN ('active','moved','busted','cancelled','free_sit','bagged'));

CREATE OR REPLACE FUNCTION private.multi_day_after_end_roster_guard_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_tournament_id uuid; v_phase text; v_permitted boolean:=false;
BEGIN
 IF TG_OP='UPDATE' AND TG_TABLE_SCHEMA='public'
    AND TG_TABLE_NAME IN ('tournament_entries','tournament_seats') THEN
  SELECT EXISTS(SELECT 1 FROM floor_private.bagged_flight_release_permits_v1 p
   WHERE p.transaction_id=txid_current() AND p.backend_pid=pg_backend_pid()
    AND p.actor_id=auth.uid() AND p.relation_name=TG_TABLE_NAME
    AND p.row_id=OLD.id AND p.row_before=to_jsonb(OLD)) INTO v_permitted;
  IF v_permitted AND NEW.status='bagged' THEN
   IF TG_TABLE_NAME='tournament_entries' AND OLD.status='seated'
      AND (to_jsonb(NEW)-ARRAY['status','updated_at'])=(to_jsonb(OLD)-ARRAY['status','updated_at']) THEN
    RETURN NEW;
   ELSIF TG_TABLE_NAME='tournament_seats' AND OLD.status='active'
      AND (to_jsonb(OLD)->>'is_active')::boolean
      AND NOT (to_jsonb(NEW)->>'is_active')::boolean
      AND (to_jsonb(NEW)-ARRAY['status','is_active'])=(to_jsonb(OLD)-ARRAY['status','is_active']) THEN
    RETURN NEW;
   END IF;
  END IF;
 END IF;
 -- Adding a CHECK value must not introduce a second, raw-table entry point.
 IF TG_OP='INSERT' THEN
  IF NEW.status='bagged' THEN
   RAISE EXCEPTION 'bagged_release_permit_required' USING ERRCODE='23514';
  END IF;
 ELSIF TG_OP='UPDATE' AND NEW.status='bagged' AND OLD.status IS DISTINCT FROM NEW.status THEN
  RAISE EXCEPTION 'bagged_release_permit_required' USING ERRCODE='23514';
 END IF;
 v_tournament_id:=CASE WHEN TG_OP='DELETE' THEN OLD.tournament_id ELSE NEW.tournament_id END;
 SELECT t.phase INTO v_phase FROM public.tournaments t WHERE t.id=v_tournament_id FOR SHARE;
 IF v_phase='flight' AND EXISTS(SELECT 1 FROM public.multi_day_flight_ends_v1 f
  WHERE f.flight_tournament_id=v_tournament_id) THEN
  RAISE EXCEPTION 'multi_day_end_play_roster_frozen' USING ERRCODE='23514';
 END IF;
 IF TG_OP='UPDATE' AND OLD.tournament_id IS DISTINCT FROM NEW.tournament_id THEN
  SELECT t.phase INTO v_phase FROM public.tournaments t WHERE t.id=OLD.tournament_id FOR SHARE;
  IF v_phase='flight' AND EXISTS(SELECT 1 FROM public.multi_day_flight_ends_v1 f
   WHERE f.flight_tournament_id=OLD.tournament_id) THEN
   RAISE EXCEPTION 'multi_day_end_play_roster_frozen' USING ERRCODE='23514';
  END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.multi_day_after_end_roster_guard_v1() FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.release_bagged_flight_table_v1(
 p_tournament_table_id uuid,p_table_session_id uuid,p_expected_revision bigint,
 p_expected_roster_hash text,p_expected_day_version integer,p_request_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 v_actor uuid:=auth.uid(); v_table public.tournament_tables%ROWTYPE;
 v_tour public.tournaments%ROWTYPE; v_session public.table_sessions%ROWTYPE;
 v_end public.multi_day_flight_ends_v1%ROWTYPE; v_day public.day_close%ROWTYPE;
 v_fingerprint text; v_prior record; v_result jsonb; v_count integer; v_total bigint;
BEGIN
 IF v_actor IS NULL OR p_tournament_table_id IS NULL OR p_table_session_id IS NULL
  OR p_expected_revision IS NULL OR p_expected_revision<0 OR p_request_id IS NULL
  OR p_expected_roster_hash IS NULL OR p_expected_day_version IS NULL THEN
  RAISE EXCEPTION 'bagged_release_invalid_request' USING ERRCODE='22023';
 END IF;
 v_fingerprint:=jsonb_build_object('table',p_tournament_table_id,'session',p_table_session_id,
  'revision',p_expected_revision,'rosterHash',p_expected_roster_hash,'dayVersion',p_expected_day_version)::text;
 PERFORM floor_private.floor_table_v3_lock_receipt(v_actor,'release_bagged_flight_table_v1',p_request_id);
 SELECT * INTO v_prior FROM floor_private.floor_table_v3_existing_receipt(v_actor,'release_bagged_flight_table_v1',p_request_id);
 IF FOUND THEN
  IF v_prior.request_fingerprint<>v_fingerprint THEN
   RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT' USING ERRCODE='23505';
  END IF;
  RETURN v_prior.result;
 END IF;
 SELECT * INTO v_table FROM public.tournament_tables WHERE id=p_tournament_table_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'bagged_release_table_missing' USING ERRCODE='23514'; END IF;
 -- Same parent -> physical -> session -> logical lock order as canonical close.
 SELECT * INTO v_tour FROM public.tournaments WHERE id=v_table.tournament_id FOR UPDATE;
 IF v_tour.phase IS DISTINCT FROM 'flight'
  OR NOT floor_private.floor_table_v3_actor_is_tournament_operator(v_actor,v_tour.club_id) THEN
  RAISE EXCEPTION 'bagged_release_actor_or_scope_denied' USING ERRCODE='42501';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.multi_day_package_release_v1 g
  WHERE g.id AND g.enabled AND v_tour.club_id=ANY(g.allowed_club_ids)) THEN
  RAISE EXCEPTION 'multi_day_package_release_off' USING ERRCODE='42501';
 END IF;
 PERFORM 1 FROM public.game_tables WHERE id=v_table.game_table_id AND club_id=v_tour.club_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'bagged_release_physical_scope_mismatch' USING ERRCODE='23514'; END IF;
 SELECT * INTO v_session FROM public.table_sessions WHERE id=p_table_session_id FOR UPDATE;
 IF NOT FOUND OR v_session.closed_at IS NOT NULL OR v_session.game_table_id IS DISTINCT FROM v_table.game_table_id
  OR v_session.club_id IS DISTINCT FROM v_tour.club_id OR v_session.tournament_id IS DISTINCT FROM v_tour.id THEN
  RAISE EXCEPTION 'bagged_release_session_mismatch' USING ERRCODE='23514';
 END IF;
 SELECT * INTO v_table FROM public.tournament_tables WHERE id=p_tournament_table_id FOR UPDATE;
 IF v_table.status<>'active' OR v_table.table_session_id IS DISTINCT FROM p_table_session_id
  OR v_table.tournament_id IS DISTINCT FROM v_tour.id OR v_table.game_table_id IS DISTINCT FROM v_session.game_table_id THEN
  RAISE EXCEPTION 'bagged_release_table_mismatch' USING ERRCODE='23514';
 END IF;
 IF v_session.revision<>p_expected_revision THEN RAISE EXCEPTION 'bagged_release_stale_session' USING ERRCODE='40001'; END IF;
 SELECT * INTO v_end FROM public.multi_day_flight_ends_v1 WHERE flight_tournament_id=v_tour.id FOR UPDATE;
 IF NOT FOUND OR v_end.status<>'locked' OR v_end.club_id IS DISTINCT FROM v_tour.club_id
  OR v_end.roster_hash IS DISTINCT FROM p_expected_roster_hash THEN
  RAISE EXCEPTION 'bagged_release_flight_not_locked' USING ERRCODE='23514';
 END IF;
 SELECT * INTO v_day FROM public.day_close WHERE tournament_id=v_tour.id AND day_number=v_end.day_number FOR UPDATE;
 IF NOT FOUND OR v_day.status<>'locked' OR v_day.version<>p_expected_day_version
  OR v_day.expected_total_value IS DISTINCT FROM v_day.counted_total_value OR NOT v_day.all_zero THEN
  RAISE EXCEPTION 'bagged_release_day_not_reconciled' USING ERRCODE='23514';
 END IF;
 IF floor_private.floor_table_v3_has_active_hand(v_tour.id,v_table.id,v_session.id)
  OR v_session.redraw_hold_batch_id IS NOT NULL
  OR EXISTS(SELECT 1 FROM public.floor_pending_tracker_moves m WHERE m.status='pending'
   AND (m.source_table_session_id=v_session.id OR m.destination_table_session_id=v_session.id))
  OR EXISTS(SELECT 1 FROM floor_private.table_mode_requests_v1 m WHERE m.table_session_id=v_session.id AND m.status='pending')
  OR EXISTS(SELECT 1 FROM public.tracker_floor_alerts a WHERE a.tournament_table_id=v_table.id
   AND a.status IN ('open','acknowledged','in_progress') AND a.correction_required)
  OR EXISTS(SELECT 1 FROM public.dealer_rotation_schedule r
   JOIN public.dealer_assignments a ON a.id=r.assignment_id AND a.table_session_id=v_session.id
   WHERE r.table_id=v_session.game_table_id AND r.status IN ('predicted','announced','executing')) THEN
  RAISE EXCEPTION 'bagged_release_pending_operation' USING ERRCODE='23514';
 END IF;
 -- Lock all source rows before comparison. Missing/extra seats or any changed
 -- stack/entry incarnation fail closed, never get inferred from player alone.
 PERFORM 1 FROM public.tournament_entries e WHERE e.id IN
  (SELECT r.entry_id FROM public.multi_day_flight_roster_v1 r WHERE r.flight_tournament_id=v_tour.id
   AND r.tournament_table_id=v_table.id AND r.table_session_id=v_session.id) ORDER BY e.id FOR UPDATE;
 PERFORM 1 FROM public.tournament_seats s WHERE s.tournament_table_id=v_table.id
  AND s.table_session_id=v_session.id ORDER BY s.id FOR UPDATE;
 PERFORM 1 FROM public.chip_bag b WHERE b.tournament_id=v_tour.id AND b.day_number=v_end.day_number ORDER BY b.id FOR UPDATE;
 SELECT count(*),sum(r.tracked_stack) INTO v_count,v_total
 FROM public.multi_day_flight_roster_v1 r
 JOIN public.tournament_seats s ON s.id=r.seat_id AND s.entry_id=r.entry_id
  AND s.player_id=r.player_id AND s.tournament_id=r.flight_tournament_id
  AND s.tournament_table_id=r.tournament_table_id AND s.table_session_id=r.table_session_id
  AND s.seat_number=r.seat_number AND s.chip_count=r.tracked_stack AND s.status='active' AND s.is_active
 JOIN public.tournament_entries e ON e.id=r.entry_id AND e.tournament_id=r.flight_tournament_id
  AND e.player_id=r.player_id AND e.seat_id=r.seat_id AND e.status='seated' AND e.current_stack=r.tracked_stack
 JOIN public.chip_bag b ON b.tournament_id=r.flight_tournament_id AND b.player_id=r.player_id
  AND b.day_number=v_end.day_number AND b.club_id=v_tour.club_id AND b.sealed
  AND b.multi_day_revision=b.multi_day_sealed_version AND b.multi_day_roster_hash=v_end.roster_hash
  AND b.total_value=r.tracked_stack
 WHERE r.flight_tournament_id=v_tour.id AND r.tournament_table_id=v_table.id AND r.table_session_id=v_session.id;
 IF v_count=0 OR v_count<>(SELECT count(*) FROM public.multi_day_flight_roster_v1 r
  WHERE r.flight_tournament_id=v_tour.id AND r.tournament_table_id=v_table.id AND r.table_session_id=v_session.id)
  OR v_count<>(SELECT count(*) FROM public.tournament_seats s WHERE s.tournament_table_id=v_table.id
   AND s.table_session_id=v_session.id AND s.is_active) THEN
  RAISE EXCEPTION 'bagged_release_source_mismatch' USING ERRCODE='23514';
 END IF;
 INSERT INTO floor_private.bagged_flight_release_permits_v1
 SELECT txid_current(),pg_backend_pid(),v_actor,'tournament_entries',e.id,to_jsonb(e)
 FROM public.tournament_entries e JOIN public.multi_day_flight_roster_v1 r ON r.entry_id=e.id
 WHERE r.flight_tournament_id=v_tour.id AND r.tournament_table_id=v_table.id AND r.table_session_id=v_session.id;
 INSERT INTO floor_private.bagged_flight_release_permits_v1
 SELECT txid_current(),pg_backend_pid(),v_actor,'tournament_seats',s.id,to_jsonb(s)
 FROM public.tournament_seats s JOIN public.multi_day_flight_roster_v1 r ON r.seat_id=s.id
 WHERE r.flight_tournament_id=v_tour.id AND r.tournament_table_id=v_table.id AND r.table_session_id=v_session.id;
 UPDATE public.tournament_entries e SET status='bagged' WHERE e.id IN
  (SELECT r.entry_id FROM public.multi_day_flight_roster_v1 r WHERE r.flight_tournament_id=v_tour.id
   AND r.tournament_table_id=v_table.id AND r.table_session_id=v_session.id);
 UPDATE public.tournament_seats SET status='bagged',is_active=false
  WHERE tournament_table_id=v_table.id AND table_session_id=v_session.id AND is_active;
 v_result:=public.close_tournament_table_v4(v_table.id,p_expected_revision,p_request_id);
 IF COALESCE((v_result->>'ok')::boolean,false) IS NOT TRUE THEN
  RAISE EXCEPTION 'bagged_release_close_failed: %',v_result USING ERRCODE='23514';
 END IF;
 -- The older close receipt key does not contain session identity. Never let a
 -- colliding/replayed close receipt stand in for closing this exact incarnation.
 IF NOT EXISTS(SELECT 1 FROM public.table_sessions s WHERE s.id=v_session.id
    AND s.closed_at IS NOT NULL AND s.revision=p_expected_revision+1)
  OR NOT EXISTS(SELECT 1 FROM public.tournament_tables tt WHERE tt.id=v_table.id
    AND tt.table_session_id=v_session.id AND tt.status='closed')
  OR EXISTS(SELECT 1 FROM public.dealer_assignments a WHERE a.table_session_id=v_session.id AND a.released_at IS NULL) THEN
  RAISE EXCEPTION 'bagged_release_close_postcondition_failed' USING ERRCODE='23514';
 END IF;
 DELETE FROM floor_private.bagged_flight_release_permits_v1
 WHERE transaction_id=txid_current() AND backend_pid=pg_backend_pid() AND actor_id=v_actor;
 v_result:=v_result||jsonb_build_object('status','bagged','releasedPlayers',v_count,
  'baggedTotal',v_total,'rosterHash',v_end.roster_hash,'dayVersion',v_day.version);
 PERFORM floor_private.floor_table_v3_save_receipt(v_actor,'release_bagged_flight_table_v1',p_request_id,v_fingerprint,v_result);
 RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION public.release_bagged_flight_table_v1(uuid,uuid,bigint,text,integer,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.release_bagged_flight_table_v1(uuid,uuid,bigint,text,integer,uuid) TO authenticated;
