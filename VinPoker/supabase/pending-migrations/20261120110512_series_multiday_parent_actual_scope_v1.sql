-- Local candidate. Reserve a forward ledger slot after the precision migration.
-- ROLLBACK: restore the previous RPC definition, including the Final write guard.
-- Keep the native counting rule for standalone tours and individual flights.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '15s';

DO $migration$
DECLARE definition text:=pg_get_functiondef('public.series_promote_native_event_actual_v1(uuid,text)'::regprocedure);
 old_filter text:='tr.tournament_id = p_event_id';
 old_guard text:='IF v_event.phase = ''final'' AND v_event.event_id IS NOT NULL THEN RAISE EXCEPTION ''native_actual_multiday_parent_scope_required'' USING ERRCODE = ''55000''; END IF;';
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_proc
   WHERE oid='public.series_promote_native_event_actual_v1(uuid,text)'::regprocedure
    AND prosecdef AND proconfig @> ARRAY['search_path=""']) THEN
   RAISE EXCEPTION 'series_multiday_actual_contract_drift';
 END IF;
 IF position('native_actual_multiday_parent_not_final' IN definition)>0
    AND position(old_filter IN definition)=0
    AND position(old_guard IN definition)=0 THEN
   RETURN;
 END IF;
 IF length(definition)-length(replace(definition,old_filter,''))<>2*length(old_filter)
    OR length(definition)-length(replace(definition,old_guard,''))<>length(old_guard) THEN
   RAISE EXCEPTION 'series_multiday_actual_source_drift';
 END IF;

 definition:=replace(definition,old_filter,$scope$
 (CASE WHEN v_event.phase='final' AND v_event.event_id IS NOT NULL THEN
  EXISTS(SELECT 1 FROM public.tournaments child WHERE child.id=tr.tournament_id AND child.club_id=v_event.club_id AND child.event_id=v_event.event_id AND child.phase='flight' AND child.deleted_at IS NULL)
 ELSE tr.tournament_id=p_event_id END)
 $scope$);
 definition:=replace(definition,old_guard,$gate$
 IF v_event.phase='final' AND v_event.event_id IS NOT NULL AND (
    v_event.status<>'completed'
    OR NOT EXISTS(SELECT 1 FROM public.tournament_close_report r WHERE r.tournament_id=v_event.id)
    OR NOT EXISTS(SELECT 1 FROM public.multi_day_payout_finalizations_v1 p WHERE p.event_id=v_event.event_id AND p.club_id=v_event.club_id AND p.final_tournament_id=v_event.id)
    OR EXISTS(SELECT 1 FROM public.tournaments child
      WHERE child.event_id=v_event.event_id AND child.club_id=v_event.club_id AND child.phase='flight' AND child.deleted_at IS NULL
        AND NOT EXISTS(SELECT 1 FROM public.multi_day_flight_ends_v1 b WHERE b.flight_tournament_id=child.id AND b.event_id=child.event_id AND b.club_id=child.club_id AND b.status='locked' AND b.locked_at IS NOT NULL))
 ) THEN RAISE EXCEPTION 'native_actual_multiday_parent_not_final' USING ERRCODE='55000'; END IF;
 $gate$);
 EXECUTE definition;
END $migration$;

COMMIT;
