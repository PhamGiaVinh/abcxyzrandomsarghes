-- Forward read-only API; deploy before its client consumer. V3 and writer75
-- remain unchanged. can_manual_cards is a UI hint, never commit authority.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $guard$
BEGIN
 IF current_user<>'postgres' THEN RAISE EXCEPTION 'context76_reviewed_owner_required'; END IF;
 IF md5(replace(pg_get_functiondef('public.is_club_tracker(uuid,uuid)'::regprocedure),chr(13),''))<>'754a878cd17019d6cb0b27aad6a10e84'
 OR md5(replace(pg_get_functiondef('public.is_club_floor(uuid,uuid)'::regprocedure),chr(13),''))<>'28967d0f86ef7c2ed5c583884a67214c'
 OR md5(replace(pg_get_functiondef('public.get_tracker_hand_input_tables_v3(uuid)'::regprocedure),chr(13),''))<>'f5bd425da1ca2d94367c5136de16bdc1'
 OR md5(replace(pg_get_functiondef('floor_private.tracker_manual_cards_v1(uuid,uuid,bigint,bigint,text,jsonb)'::regprocedure),chr(13),''))<>'37faf2e637e06d255c0f9186d3a7e9e9'
 OR NOT has_function_privilege('authenticated','public.show_tracker_manual_cards_v1(uuid,uuid,bigint,bigint,text,jsonb)','EXECUTE')
 THEN RAISE EXCEPTION 'context76_dependency_drift'; END IF;
 IF to_regprocedure('floor_private.tracker_hand_input_context_v4(uuid)') IS NOT NULL
 OR to_regprocedure('public.get_tracker_hand_input_tables_v4(uuid)') IS NOT NULL
 THEN RAISE EXCEPTION 'context76_catalog_collision'; END IF;
END;
$guard$;
CREATE FUNCTION floor_private.tracker_hand_input_context_v4(p_tournament_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); club uuid; tracker boolean; operator boolean; rows jsonb; invalid_rows jsonb;
BEGIN
 IF actor IS NULL OR coalesce(auth.jwt()->>'role','')<>'authenticated'
 THEN RETURN jsonb_build_object('ok',false,'error','unauthenticated'); END IF;
 SELECT t.club_id INTO club FROM public.tournaments t WHERE t.id=p_tournament_id AND t.deleted_at IS NULL;
 IF club IS NULL THEN RETURN jsonb_build_object('ok',false,'error','actor_not_allowed'); END IF;
 tracker:=public.is_club_tracker(actor,club);
 operator:=tracker OR public.is_club_floor(actor,club);
 WITH scoped AS (
  SELECT tt.id AS tournament_table_id,gt.id AS table_id,gt.table_name,tt.max_seats,
   s.id AS table_session_id,s.control_epoch,s.control_mode,
   (gt.id IS NOT NULL AND s.id IS NOT NULL AND s.closed_at IS NULL AND s.club_id=club
    AND s.tournament_id=p_tournament_id AND s.game_table_id=gt.id
    AND s.control_epoch IS NOT NULL AND s.control_epoch>0 AND s.control_mode IN ('manual','tracker')) AS compatible,
   (SELECT count(*)=1 FROM public.dealer_assignments a WHERE a.table_id=gt.id
    AND a.status='assigned' AND a.released_at IS NULL) AND EXISTS(
    SELECT 1 FROM public.dealer_assignments a JOIN public.dealers d ON d.id=a.dealer_id
    JOIN public.dealer_attendance attendance ON attendance.id=a.attendance_id
    WHERE a.table_id=gt.id AND a.table_session_id=s.id AND a.club_id=club
     AND a.status='assigned' AND a.released_at IS NULL AND d.club_id=club
     AND d.user_id=actor AND d.status='active' AND d.deleted_at IS NULL
     AND attendance.dealer_id=d.id AND attendance.status='checked_in'
     AND attendance.check_out_time IS NULL AND attendance.current_state IN ('assigned','on_break')) AS assigned
  FROM public.tournament_tables tt LEFT JOIN public.game_tables gt ON gt.id=coalesce(tt.game_table_id,tt.table_id) AND gt.club_id=club
  LEFT JOIN public.table_sessions s ON s.id=tt.table_session_id
  WHERE tt.tournament_id=p_tournament_id AND tt.status='active'
 ) SELECT coalesce(jsonb_agg(jsonb_build_object('table_id',c.table_id,'tournament_table_id',c.tournament_table_id,
   'table_session_id',c.table_session_id,'control_epoch',c.control_epoch,'control_mode',c.control_mode,
   'table_name',c.table_name,'max_seats',c.max_seats,
   'can_manual_cards',c.control_mode='tracker' AND (tracker OR c.assigned),
   'player_count',(SELECT count(*) FROM public.tournament_seats seat WHERE seat.tournament_id=p_tournament_id
    AND seat.tournament_table_id=c.tournament_table_id AND seat.table_session_id=c.table_session_id AND seat.is_active),
   'has_live_hand',EXISTS(SELECT 1 FROM public.tournament_hands hand WHERE hand.tournament_id=p_tournament_id
    AND hand.tournament_table_id=c.tournament_table_id AND hand.table_session_id=c.table_session_id
    AND hand.status='in_progress' AND NOT coalesce(hand.is_voided,false))) ORDER BY c.table_name,c.tournament_table_id)
   FILTER (WHERE c.compatible AND (operator OR c.assigned)),'[]'::jsonb),
  coalesce(jsonb_agg(jsonb_build_object('tournament_table_id',c.tournament_table_id,'table_id',c.table_id,
   'error','repair_required') ORDER BY c.tournament_table_id) FILTER (WHERE operator AND NOT c.compatible),'[]'::jsonb)
 INTO rows,invalid_rows FROM scoped c;
 IF NOT operator AND jsonb_array_length(rows)=0 THEN RETURN jsonb_build_object('ok',false,'error','actor_not_allowed'); END IF;
 RETURN jsonb_build_object('ok',true,'tables',rows,'invalid_tables',invalid_rows);
END $$;
REVOKE ALL ON FUNCTION floor_private.tracker_hand_input_context_v4(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION floor_private.tracker_hand_input_context_v4(uuid) TO authenticated;
CREATE FUNCTION public.get_tracker_hand_input_tables_v4(p_tournament_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path=''
RETURN floor_private.tracker_hand_input_context_v4(p_tournament_id);
REVOKE ALL ON FUNCTION public.get_tracker_hand_input_tables_v4(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_tracker_hand_input_tables_v4(uuid) TO authenticated;
DO $postcheck$
DECLARE signature text; expected_definer boolean; expected_digest text; actual record;
BEGIN
 FOR signature,expected_definer,expected_digest IN SELECT * FROM (VALUES
 ('floor_private.tracker_hand_input_context_v4(uuid)',true,'62a140af9a26974a2912dde48cdf1b80'),
 ('public.get_tracker_hand_input_tables_v4(uuid)',false,'b815d03fd7b596eba689f7a788fc49fc')) AS functions(signature,definer,digest) LOOP
  SELECT * INTO STRICT actual FROM pg_proc WHERE oid=signature::regprocedure;
  IF md5(replace(pg_get_functiondef(actual.oid),chr(13),'')) IS DISTINCT FROM expected_digest
   OR pg_get_userbyid(actual.proowner)<>'postgres' OR actual.prosecdef IS DISTINCT FROM expected_definer
   OR actual.provolatile<>'s' OR actual.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
   OR actual.proacl::text IS DISTINCT FROM '{postgres=X/postgres,authenticated=X/postgres}'
   OR actual.proargnames IS DISTINCT FROM ARRAY['p_tournament_id']::text[]
  THEN RAISE EXCEPTION 'context76_metadata_postcheck: %',signature; END IF;
 END LOOP;
 IF md5(replace(pg_get_functiondef('public.get_tracker_hand_input_tables_v3(uuid)'::regprocedure),chr(13),''))<>'f5bd425da1ca2d94367c5136de16bdc1'
 OR md5(replace(pg_get_functiondef('floor_private.tracker_manual_cards_v1(uuid,uuid,bigint,bigint,text,jsonb)'::regprocedure),chr(13),''))<>'37faf2e637e06d255c0f9186d3a7e9e9'
 OR has_schema_privilege('authenticated','floor_private','USAGE')
 THEN RAISE EXCEPTION 'context76_old_contract_or_private_schema_changed'; END IF;
END;
$postcheck$;
COMMIT;
