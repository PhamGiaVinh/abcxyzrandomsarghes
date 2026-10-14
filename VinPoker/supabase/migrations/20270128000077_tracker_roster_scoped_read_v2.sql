-- Additive read API. Never replace V1 or grant a roster/card write capability.
-- Compensation: reviewed forward migration revokes new API EXECUTE, keeps V1.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $copy$
DECLARE definition text; signature text; digest text;
 old_guard text := $old$IF a IS NULL OR c.id IS NULL OR NOT (public.is_club_tracker(a,c.club_id) OR public.is_club_floor(a,c.club_id)) THEN$old$;
 new_guard text := $new$IF a IS NULL OR c.id IS NULL OR coalesce(auth.jwt()->>'role','')<>'authenticated' OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(floor_private.tracker_hand_input_context_v4(p_tournament_id)->'tables') context WHERE context->>'tournament_table_id'=p_tournament_table_id::text AND context->>'table_session_id'=p_table_session_id::text AND (context->>'control_epoch')::bigint=p_expected_epoch) THEN$new$;
 return_boundary text := $old$ RETURN jsonb_build_object('ok',true,'tournament_table_id',t.id,'table_session_id',s.id,'control_epoch',s.control_epoch,'seats',rows);$old$;
 final_check text := $new$ SELECT EXISTS(SELECT 1 FROM jsonb_array_elements(floor_private.tracker_hand_input_context_v4(p_tournament_id)->'tables') context WHERE context->>'tournament_table_id'=p_tournament_table_id::text AND context->>'table_session_id'=p_table_session_id::text AND (context->>'control_epoch')::bigint=p_expected_epoch) INTO allowed_now;
 IF NOT coalesce(allowed_now,false) THEN RETURN jsonb_build_object('ok',false,'error','actor_not_authorized'); END IF;
$new$;
BEGIN
 IF current_user<>'postgres' THEN RAISE EXCEPTION 'roster77_reviewed_owner_required'; END IF;
 FOR signature,digest IN SELECT * FROM (VALUES
 ('public.get_tracker_roster_snapshot_v1(uuid,uuid,uuid,bigint)','9fecaf3e1287fbf1a6912bb1eebbd1b3'),
 ('floor_private.tracker_roster_seat_token_v1(uuid,integer)','c45fb95991fe1f3f010455f646c75091'),
 ('floor_private.tournament_entry_display_v1(uuid,uuid,uuid,integer)','b7f94cbd3c2df431d317d6ba8180edbf'),
 ('floor_private.tracker_hand_input_context_v4(uuid)','588f4bc2f1b8ce3839bb42a635f7b6a0')) f(signature,digest) LOOP
  IF md5(replace(pg_get_functiondef(signature::regprocedure),chr(13),'')) IS DISTINCT FROM digest
   OR (SELECT pg_get_userbyid(proowner) FROM pg_proc WHERE oid=signature::regprocedure)<>'postgres'
  THEN RAISE EXCEPTION 'roster77_dependency_drift: %',signature; END IF;
 END LOOP;
 IF to_regprocedure('floor_private.tracker_roster_snapshot_v2(uuid,uuid,uuid,bigint)') IS NOT NULL
 OR to_regprocedure('public.get_tracker_roster_snapshot_v2(uuid,uuid,uuid,bigint)') IS NOT NULL
 THEN RAISE EXCEPTION 'roster77_catalog_collision'; END IF;
 definition:=replace(pg_get_functiondef('public.get_tracker_roster_snapshot_v1(uuid,uuid,uuid,bigint)'::regprocedure),chr(13),'');
 IF (length(definition)-length(replace(definition,old_guard,'')))/length(old_guard)<>1
 OR (length(definition)-length(replace(definition,return_boundary,'')))/length(return_boundary)<>1
 OR (length(definition)-length(replace(definition,'rows jsonb;','')))/length('rows jsonb;')<>1
 THEN RAISE EXCEPTION 'roster77_copy_boundary_drift'; END IF;
 definition:=replace(definition,'public.get_tracker_roster_snapshot_v1(','floor_private.tracker_roster_snapshot_v2(');
 definition:=replace(definition,old_guard,new_guard);
 definition:=replace(definition,'rows jsonb;','rows jsonb; allowed_now boolean;');
 definition:=replace(definition,return_boundary,final_check||return_boundary);
 EXECUTE definition;
END;
$copy$;
REVOKE ALL ON FUNCTION floor_private.tracker_roster_snapshot_v2(uuid,uuid,uuid,bigint) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION floor_private.tracker_roster_snapshot_v2(uuid,uuid,uuid,bigint) TO authenticated;
CREATE FUNCTION public.get_tracker_roster_snapshot_v2(p_tournament_id uuid,p_tournament_table_id uuid,p_table_session_id uuid,p_expected_epoch bigint)
RETURNS jsonb LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path=''
RETURN floor_private.tracker_roster_snapshot_v2(p_tournament_id,p_tournament_table_id,p_table_session_id,p_expected_epoch);
REVOKE ALL ON FUNCTION public.get_tracker_roster_snapshot_v2(uuid,uuid,uuid,bigint) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_tracker_roster_snapshot_v2(uuid,uuid,uuid,bigint) TO authenticated;
DO $postcheck$
DECLARE signature text; definer boolean; digest text; actual record;
BEGIN
 FOR signature,definer,digest IN SELECT * FROM (VALUES
 ('floor_private.tracker_roster_snapshot_v2(uuid,uuid,uuid,bigint)',true,'1e55b9ed040ac4a384265df912c2edce'),
 ('public.get_tracker_roster_snapshot_v2(uuid,uuid,uuid,bigint)',false,'2d58c68cc297e4df045c30a6c71444c5')) f(signature,definer,digest) LOOP
  SELECT * INTO STRICT actual FROM pg_proc WHERE oid=signature::regprocedure;
  IF md5(replace(pg_get_functiondef(actual.oid),chr(13),'')) IS DISTINCT FROM digest
  OR pg_get_userbyid(actual.proowner)<>'postgres' OR actual.prosecdef IS DISTINCT FROM definer
  OR actual.provolatile<>'v' OR actual.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
  OR actual.proacl::text IS DISTINCT FROM '{postgres=X/postgres,authenticated=X/postgres}'
  OR actual.proargnames IS DISTINCT FROM ARRAY['p_tournament_id','p_tournament_table_id','p_table_session_id','p_expected_epoch']::text[]
  THEN RAISE EXCEPTION 'roster77_metadata_postcheck: %',signature; END IF;
 END LOOP;
 IF md5(replace(pg_get_functiondef('public.get_tracker_roster_snapshot_v1(uuid,uuid,uuid,bigint)'::regprocedure),chr(13),''))<>'9fecaf3e1287fbf1a6912bb1eebbd1b3'
 OR has_schema_privilege('authenticated','floor_private','USAGE')
 THEN RAISE EXCEPTION 'roster77_old_contract_or_private_schema_changed'; END IF;
END;
$postcheck$;
COMMIT;
