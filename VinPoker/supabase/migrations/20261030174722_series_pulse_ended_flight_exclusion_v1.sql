-- LOCAL qualified candidate; no production apply authorized.
-- An explicit End Flight marker ends play even while the generic tour status
-- remains live for bagging/qualification. Preserve those immutable source rows.
-- Correct the existing running/playing definitions; do not change today counts,
-- physical table counts, privacy, actor/tenant checks, grants or client contract.
-- Requires the canonical End Flight package. No data backfill or flag change.
-- Rollback: restore the pre-apply get_series_club_live_pulse_v1(uuid) definition
-- captured under SHIP_AND_TEST; verify its body MD5 below and unchanged ACL.
BEGIN;
DO $patch$
DECLARE v_proc regprocedure := 'public.get_series_club_live_pulse_v1(uuid)'::regprocedure;
 v_definition text; v_needle text := 'AND t.status IN (''live'', ''break'', ''final_table'')';
 v_filter text := 'AND t.status IN (''live'', ''break'', ''final_table'')
        AND NOT EXISTS (
          SELECT 1 FROM public.multi_day_flight_ends_v1 AS ended
          WHERE ended.flight_tournament_id = t.id AND ended.club_id = t.club_id
            AND ended.status IN (''bagging'', ''locked'') AND ended.ended_at IS NOT NULL
        )';
BEGIN
 IF to_regclass('public.multi_day_flight_ends_v1') IS NULL THEN
  RAISE EXCEPTION 'series_pulse_end_flight_dependency_missing';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=v_proc
   AND md5(p.prosrc)='192c6e04624e07d498aae68903c4c13b'
   AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef
   AND p.proconfig=ARRAY['search_path=""']
   AND p.proacl::text='{postgres=X/postgres,authenticated=X/postgres}') THEN
  RAISE EXCEPTION 'series_pulse_end_flight_baseline_drift';
 END IF;
 v_definition := pg_get_functiondef(v_proc);
 IF (length(v_definition)-length(replace(v_definition,v_needle,'')))/length(v_needle) <> 2 THEN
  RAISE EXCEPTION 'series_pulse_end_flight_source_shape_drift';
 END IF;
 EXECUTE replace(v_definition,v_needle,v_filter);
END $patch$;
COMMIT;
