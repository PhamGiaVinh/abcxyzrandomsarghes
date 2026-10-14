-- Test-only scoped read prototype. Never apply this file to a live database.
\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
 IF current_database()<>'vinpoker_manual_card75_overlap_20261014' OR current_user<>'postgres'
 OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet OR inet_server_port() NOT IN (55441,55464)
 OR (SELECT count(*) FROM public.clubs)<>2
 OR NOT public.is_club_tracker('81600000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000002')
 OR to_regprocedure('public.manual76_context_prototype(uuid)') IS NOT NULL
 THEN RAISE EXCEPTION 'owned_manual76_read_prototype_required'; END IF;
END $$;
CREATE FUNCTION floor_private.manual76_context_prototype(p_tournament_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); club uuid; operator boolean; rows jsonb; invalid_rows jsonb;
BEGIN
 IF actor IS NULL OR coalesce(auth.jwt()->>'role','')<>'authenticated'
 THEN RETURN jsonb_build_object('ok',false,'error','unauthenticated'); END IF;
 SELECT t.club_id INTO club FROM public.tournaments t WHERE t.id=p_tournament_id AND t.deleted_at IS NULL;
 IF club IS NULL THEN RETURN jsonb_build_object('ok',false,'error','actor_not_allowed'); END IF;
 operator:=public.is_club_tracker(actor,club) OR public.is_club_floor(actor,club);
 WITH scoped AS (
  SELECT tt.id AS tournament_table_id,gt.id AS table_id,gt.table_name,tt.max_seats,
   s.id AS table_session_id,s.control_epoch,s.control_mode,
   (gt.id IS NOT NULL AND s.id IS NOT NULL AND s.closed_at IS NULL AND s.club_id=club
    AND s.tournament_id=p_tournament_id AND s.game_table_id=gt.id AND gt.club_id=club
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
   'can_manual_cards',c.control_mode='tracker' AND (public.is_club_tracker(actor,club) OR c.assigned),
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
REVOKE ALL ON FUNCTION floor_private.manual76_context_prototype(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION floor_private.manual76_context_prototype(uuid) TO authenticated;
CREATE FUNCTION public.manual76_context_prototype(p_tournament_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path=''
RETURN floor_private.manual76_context_prototype(p_tournament_id);
REVOKE ALL ON FUNCTION public.manual76_context_prototype(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.manual76_context_prototype(uuid) TO authenticated;
DO $$ BEGIN
 IF has_function_privilege('anon','public.manual76_context_prototype(uuid)','EXECUTE')
 OR has_function_privilege('service_role','public.manual76_context_prototype(uuid)','EXECUTE')
 OR has_schema_privilege('authenticated','floor_private','USAGE')
 OR NOT has_function_privilege('authenticated','public.manual76_context_prototype(uuid)','EXECUTE')
 THEN RAISE EXCEPTION 'prototype_read_acl_or_private_schema_exposure'; END IF;
END $$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','81300000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claims','{"sub":"81300000-0000-4000-8000-000000000001","role":"authenticated"}',true);
DO $$ DECLARE result jsonb; BEGIN
 result:=public.manual76_context_prototype('85000000-0000-4000-8000-000000000001');
 IF result->>'ok' IS DISTINCT FROM 'true' OR jsonb_array_length(result->'tables') IS DISTINCT FROM 2
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(result->'tables') t WHERE (t->>'can_manual_cards')::boolean IS DISTINCT FROM false)
 THEN RAISE EXCEPTION 'floor_scoped_read_without_new_write_capability_failed: %',result; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','81200000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claims','{"sub":"81200000-0000-4000-8000-000000000001","role":"authenticated"}',true);
DO $$ DECLARE result jsonb; BEGIN
 result:=public.manual76_context_prototype('85000000-0000-4000-8000-000000000001');
 IF result->>'ok' IS DISTINCT FROM 'true' OR jsonb_array_length(result->'tables') IS DISTINCT FROM 1
 OR result->'tables'->0->>'table_session_id' IS DISTINCT FROM '83500000-0000-4000-8000-000000000001'
 OR result->'tables'->0->>'can_manual_cards' IS DISTINCT FROM 'true'
 THEN RAISE EXCEPTION 'dealer_exact_session_read_failed: %',result; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','81500000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claims','{"sub":"81500000-0000-4000-8000-000000000001","role":"authenticated"}',true);
DO $$ DECLARE result jsonb; BEGIN
 result:=public.manual76_context_prototype('85000000-0000-4000-8000-000000000001');
 IF result->>'error' IS DISTINCT FROM 'actor_not_allowed' THEN RAISE EXCEPTION 'outsider_read_exposed: %',result; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','81600000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claims','{"sub":"81600000-0000-4000-8000-000000000001","role":"authenticated"}',true);
DO $$ DECLARE result jsonb; BEGIN
 result:=public.manual76_context_prototype('85000000-0000-4000-8000-000000000001');
 IF result->>'error' IS DISTINCT FROM 'actor_not_allowed' THEN RAISE EXCEPTION 'foreign_club_owner_read_exposed: %',result; END IF;
END $$;
RESET ROLE;
UPDATE public.table_sessions SET control_mode='manual' WHERE id='83500000-0000-4000-8000-000000000002';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','81100000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claims','{"sub":"81100000-0000-4000-8000-000000000001","role":"authenticated"}',true);
DO $$ DECLARE result jsonb; BEGIN
 result:=public.manual76_context_prototype('85000000-0000-4000-8000-000000000001');
 IF result->>'ok' IS DISTINCT FROM 'true'
 OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(result->'tables') t WHERE t->>'control_mode'='manual' AND t->>'can_manual_cards'='false')
 OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(result->'tables') t WHERE t->>'control_mode'='tracker' AND t->>'can_manual_cards'='true')
 THEN RAISE EXCEPTION 'owner_mode_specific_capability_failed: %',result; END IF;
END $$;
RESET ROLE;
UPDATE public.tournaments SET deleted_at=now() WHERE id='85000000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
DO $$ DECLARE result jsonb; BEGIN
 result:=public.manual76_context_prototype('85000000-0000-4000-8000-000000000001');
 IF result->>'error' IS DISTINCT FROM 'actor_not_allowed' THEN RAISE EXCEPTION 'deleted_tournament_read_exposed: %',result; END IF;
END $$;
RESET ROLE;
UPDATE public.tournaments SET deleted_at=NULL WHERE id='85000000-0000-4000-8000-000000000001';
UPDATE public.dealers SET status='inactive' WHERE id='87000000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','81200000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claims','{"sub":"81200000-0000-4000-8000-000000000001","role":"authenticated"}',true);
DO $$ DECLARE result jsonb; BEGIN
 result:=public.manual76_context_prototype('85000000-0000-4000-8000-000000000001');
 IF result->>'error' IS DISTINCT FROM 'actor_not_allowed' THEN RAISE EXCEPTION 'inactive_dealer_read_exposed: %',result; END IF;
END $$;
RESET ROLE;
UPDATE public.dealers SET status='active' WHERE id='87000000-0000-4000-8000-000000000001';
UPDATE public.tournament_tables SET table_session_id=NULL
 WHERE id='84000000-0000-4000-8000-000000000002';
UPDATE public.dealer_assignments SET table_session_id=NULL
 WHERE id='88000000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
DO $$ DECLARE result jsonb; BEGIN
 result:=public.manual76_context_prototype('85000000-0000-4000-8000-000000000001');
 IF result->>'error' IS DISTINCT FROM 'actor_not_allowed' THEN RAISE EXCEPTION 'missing_session_dealer_read_exposed: %',result; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','81300000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claims','{"sub":"81300000-0000-4000-8000-000000000001","role":"authenticated"}',true);
DO $$ DECLARE result jsonb; BEGIN
 result:=public.manual76_context_prototype('85000000-0000-4000-8000-000000000001');
 IF result->>'ok' IS DISTINCT FROM 'true'
 OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(result->'invalid_tables') t
  WHERE t->>'tournament_table_id'='84000000-0000-4000-8000-000000000002' AND t->>'error'='repair_required')
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(result->'tables') t
  WHERE t->>'tournament_table_id'='84000000-0000-4000-8000-000000000002')
 THEN RAISE EXCEPTION 'floor_malformed_session_not_reported_separately: %',result; END IF;
END $$;
RESET ROLE;
DELETE FROM public.club_floors WHERE club_id='81000000-0000-4000-8000-000000000001'
 AND user_id='81300000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
DO $$ DECLARE result jsonb; BEGIN
 result:=public.manual76_context_prototype('85000000-0000-4000-8000-000000000001');
 IF result->>'error' IS DISTINCT FROM 'actor_not_allowed' THEN RAISE EXCEPTION 'revoked_floor_read_exposed: %',result; END IF;
END $$;
ROLLBACK;
\echo MANUAL76_SCOPED_READ_PROTOTYPE_FLOOR_DEALER_OUTSIDER_INACTIVE_PASS_NOT_RELEASE
