-- CLI generated20261024034656; catalog/source274 free at local672.
-- Unify reservation cancellation across cash/VIP close and tournament close,
-- break, deferred break and redraw. No backfill or payroll/rest/time changes.
-- Recovery: stop new close intents, restore all saved definitions together in
-- a reviewed forward migration. Keep receipts/schedules/audit; never resurrect
-- a cancelled reservation by rewriting history.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $pre$
DECLARE f record; p pg_proc%ROWTYPE;
BEGIN
 IF current_user<>'postgres' OR to_regclass('floor_private.dealer_close_pre274') IS NOT NULL
 OR to_regprocedure('floor_private.cancel_rotation_slot_internal274(uuid,text,boolean)') IS NOT NULL
 OR to_regprocedure('floor_private.clear_session_dealer_reservations274(uuid)') IS NOT NULL
 THEN RAISE EXCEPTION 'close274_namespace_or_actor_drift';END IF;
 FOR f IN SELECT * FROM (VALUES
 ('public.cancel_rotation_slot(uuid,text)','069c00d52a0ba626c64e3faa5d311dd2'),
 ('public.operator_close_club_table_v2(uuid,bigint,uuid)','b00f32d630b606425dcd73ec059d6102'),
 ('public.floor_break_table_v5(uuid,bigint,uuid,text,text)','eb05cb4da488f1af3931e2d32916f974'),
 ('public.close_tournament_table_v3(uuid,bigint,uuid)','2e250a050de4e80c806fa51f204dd41e'),
 ('public.floor_break_table_v3(uuid,bigint,uuid,text)','ea94066d48ecc649ade85d37aca5a44c'),
 ('public.floor_apply_tournament_redraw_v1(uuid,uuid)','cce6134355590a3b5cc5967b7e42e69f'),
 ('floor_private.floor_close_completed_break_source_v1()','dea1a80221a1a17ae72aaf83d201cb60')) v(signature,digest)
 LOOP
  IF (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid=to_regprocedure(f.signature)) IS DISTINCT FROM f.digest
  THEN RAISE EXCEPTION 'close274_definition_drift: %',f.signature;END IF;
  SELECT * INTO p FROM pg_proc WHERE oid=to_regprocedure(f.signature);
  IF p.proowner<>'postgres'::regrole OR NOT p.prosecdef
   OR p.proconfig IS DISTINCT FROM (CASE WHEN f.signature='public.cancel_rotation_slot(uuid,text)'
     THEN ARRAY['search_path=public']::text[] ELSE ARRAY['search_path=""']::text[] END)
   OR p.proacl::text IS DISTINCT FROM (CASE
     WHEN f.signature='public.cancel_rotation_slot(uuid,text)' THEN '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}'
     WHEN f.signature='floor_private.floor_close_completed_break_source_v1()' THEN '{postgres=X/postgres}'
     ELSE '{postgres=X/postgres,authenticated=X/postgres}' END)
  THEN RAISE EXCEPTION 'close274_owner_path_acl_drift: %',f.signature;END IF;
 END LOOP;
END $pre$;
CREATE TABLE floor_private.dealer_close_pre274(signature text PRIMARY KEY,definition text NOT NULL);
REVOKE ALL ON floor_private.dealer_close_pre274 FROM PUBLIC,anon,authenticated,service_role;
INSERT INTO floor_private.dealer_close_pre274
 SELECT p.oid::regprocedure::text,pg_get_functiondef(p.oid) FROM pg_proc p
 WHERE p.oid IN('public.cancel_rotation_slot(uuid,text)'::regprocedure,
 'public.operator_close_club_table_v2(uuid,bigint,uuid)'::regprocedure,
 'public.floor_break_table_v5(uuid,bigint,uuid,text,text)'::regprocedure,
 'public.close_tournament_table_v3(uuid,bigint,uuid)'::regprocedure,
 'public.floor_break_table_v3(uuid,bigint,uuid,text)'::regprocedure,
 'public.floor_apply_tournament_redraw_v1(uuid,uuid)'::regprocedure,
 'floor_private.floor_close_completed_break_source_v1()'::regprocedure);

-- Extract, do not duplicate, the established cancellation writer. Public calls
-- retain BOTH actor checks; only the revoked close helper can use the trusted
-- branch after its exact session/reservation checks. Deferred hand completion
-- may run as Tracker, not as the Floor who authorized the original break.
DO $core$
DECLARE body text; check_line text:='PERFORM floor_private.assert_rotation_schedule_actor_v1(p_schedule_id, true);';
BEGIN
 SELECT replace(prosrc,chr(13),'') INTO body FROM pg_proc
 WHERE oid='public.cancel_rotation_slot(uuid,text)'::regprocedure;
 IF length(body)-length(replace(body,check_line,''))<>2*length(check_line)
 THEN RAISE EXCEPTION 'close274_cancel_authority_anchor';END IF;
 body:=replace(body,check_line,'IF p_assert_actor THEN '||check_line||' END IF;');
 body:=replace(body,'FROM dealer_rotation_schedule','FROM public.dealer_rotation_schedule');
 body:=replace(body,'UPDATE dealer_rotation_schedule','UPDATE public.dealer_rotation_schedule');
 body:=replace(body,'UPDATE dealer_assignments','UPDATE public.dealer_assignments');
 body:=replace(body,'UPDATE dealer_attendance','UPDATE public.dealer_attendance');
 EXECUTE 'CREATE FUNCTION floor_private.cancel_rotation_slot_internal274(p_schedule_id uuid,p_reason text,p_assert_actor boolean) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='''' AS '||quote_literal(body);
END $core$;
ALTER FUNCTION floor_private.cancel_rotation_slot_internal274(uuid,text,boolean) OWNER TO postgres;
REVOKE ALL ON FUNCTION floor_private.cancel_rotation_slot_internal274(uuid,text,boolean) FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.cancel_rotation_slot(p_schedule_id uuid,p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 RETURN floor_private.cancel_rotation_slot_internal274(p_schedule_id,p_reason,true);
END $$;

DO $extract$
DECLARE body text; block text; start_at integer; stop_at integer;
 start_anchor text:='  -- Lock schedule before assignment/attendance, matching rotation writers.';
 release_anchor text:=E'  UPDATE public.dealer_assignments\n  SET released_at = COALESCE(released_at, pg_catalog.now()),';
BEGIN
 SELECT replace(prosrc,chr(13),'') INTO body FROM pg_proc
 WHERE oid='public.operator_close_club_table_v2(uuid,bigint,uuid)'::regprocedure;
 start_at:=strpos(body,start_anchor);stop_at:=strpos(body,release_anchor);
 IF start_at=0 OR stop_at<=start_at THEN RAISE EXCEPTION 'close274_extract_anchor';END IF;
 block:=substr(body,start_at,stop_at-start_at);
 IF strpos(block,'closed_session_legacy_reservation_conflict')=0
 OR strpos(block,'slot_index>0')=0 THEN RAISE EXCEPTION 'close274_extract_incomplete';END IF;
 block:=replace(block,'public.cancel_rotation_slot(plan_row.id,''table_session_closed'')',
 'floor_private.cancel_rotation_slot_internal274(plan_row.id,''table_session_closed'',false)');
 IF strpos(block,'public.cancel_rotation_slot(')>0 THEN RAISE EXCEPTION 'close274_internal_cancel_anchor';END IF;
 EXECUTE 'CREATE FUNCTION floor_private.clear_session_dealer_reservations274(p_session_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='''' AS '||quote_literal(
 E'DECLARE v_session public.table_sessions%ROWTYPE;\nBEGIN\n SELECT * INTO v_session FROM public.table_sessions WHERE id=p_session_id AND closed_at IS NULL;\n IF NOT FOUND THEN RAISE EXCEPTION ''closed_session_reservation_context_missing'';END IF;\n'||block||E'\nEND;');
 body:=substr(body,1,start_at-1)||'  PERFORM floor_private.clear_session_dealer_reservations274(v_session.id);'||E'\n'||substr(body,stop_at);
 EXECUTE 'CREATE OR REPLACE FUNCTION public.operator_close_club_table_v2(p_table_session_id uuid,p_expected_revision bigint,p_request_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='''' AS '||quote_literal(body);
END $extract$;
ALTER FUNCTION floor_private.clear_session_dealer_reservations274(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION floor_private.clear_session_dealer_reservations274(uuid) FROM PUBLIC,anon,authenticated,service_role;

DO $patch$
DECLARE f record; definition text; anchor text; addition text; occurrences integer;
BEGIN
 -- Callers with no earlier assignment lock can cancel at the final close seam.
 FOR f IN SELECT * FROM (VALUES
 ('public.close_tournament_table_v3(uuid,bigint,uuid)',E'  UPDATE public.dealer_assignments\n','v_session.id'),
 ('public.floor_break_table_v3(uuid,bigint,uuid,text)',E'  UPDATE public.dealer_assignments\n','v_source_session.id'),
 ('public.floor_break_table_v5(uuid,bigint,uuid,text,text)','    UPDATE public.dealer_assignments SET released_at','v_session.id'),
 ('floor_private.floor_close_completed_break_source_v1()','  UPDATE public.dealer_assignments SET released_at','NEW.source_table_session_id')) v(signature,anchor,session_expression)
 LOOP
  definition:=replace(pg_get_functiondef(f.signature::regprocedure),chr(13),'');
  occurrences:=(length(definition)-length(replace(definition,f.anchor,'')))/length(f.anchor);
  IF occurrences<>1 THEN RAISE EXCEPTION 'close274_close_anchor: %',f.signature;END IF;
  definition:=replace(definition,f.anchor,'  PERFORM floor_private.clear_session_dealer_reservations274('||f.session_expression||');'||E'\n'||f.anchor);
  EXECUTE definition;
 END LOOP;

 -- Break already locks assignments before it knows whether moves are deferred.
 -- Prelock all relevant plans before that first assignment lock, so raw cancel
 -- (schedule -> assignment) cannot form the reverse edge.
 definition:=replace(pg_get_functiondef('public.floor_break_table_v5(uuid,bigint,uuid,text,text)'::regprocedure),chr(13),'');
 anchor:=E'  PERFORM 1 FROM public.dealer_assignments d\n    JOIN public.game_tables gt ON gt.id = d.table_id';
 addition:=$locks$  PERFORM 1 FROM public.dealer_rotation_schedule rs
    LEFT JOIN public.dealer_assignments a ON a.id=rs.assignment_id
    WHERE rs.status IN ('predicted','announced','executing') AND (
      rs.table_id IN (SELECT game_table_id FROM public.table_sessions WHERE tournament_id=v_tournament.id AND closed_at IS NULL)
      OR a.table_session_id IN (SELECT id FROM public.table_sessions WHERE tournament_id=v_tournament.id AND closed_at IS NULL))
    ORDER BY rs.id FOR UPDATE OF rs;
$locks$;
 IF strpos(definition,anchor)=0 THEN RAISE EXCEPTION 'close274_break_lock_anchor';END IF;
 EXECUTE replace(definition,anchor,addition||anchor);

 definition:=replace(pg_get_functiondef('floor_private.floor_close_completed_break_source_v1()'::regprocedure),chr(13),'');
 anchor:=E'  PERFORM 1 FROM public.dealer_assignments d\n  WHERE d.table_session_id = NEW.source_table_session_id';
 addition:=$locks$  PERFORM 1 FROM public.dealer_rotation_schedule rs
    LEFT JOIN public.dealer_assignments a ON a.id=rs.assignment_id
    WHERE rs.status IN ('predicted','announced','executing')
      AND (rs.table_id=v_game_table_id OR a.table_session_id=NEW.source_table_session_id)
    ORDER BY rs.id FOR UPDATE OF rs;
$locks$;
 IF strpos(definition,anchor)=0 THEN RAISE EXCEPTION 'close274_deferred_lock_anchor';END IF;
 EXECUTE replace(definition,anchor,addition||anchor);

 -- Redraw cancels only sessions it will close, not retained target tables.
 definition:=replace(pg_get_functiondef('public.floor_apply_tournament_redraw_v1(uuid,uuid)'::regprocedure),chr(13),'');
 anchor:='  UPDATE public.dealer_assignments assignment_row';
 addition:=$redraw$  PERFORM floor_private.clear_session_dealer_reservations274(s.id)
    FROM public.table_sessions s
    WHERE s.tournament_id=v_tournament.id AND s.closed_at IS NULL
      AND NOT (s.game_table_id=ANY(v_batch.target_game_table_ids))
    ORDER BY s.game_table_id,s.id;
$redraw$;
 IF strpos(definition,anchor)=0 THEN RAISE EXCEPTION 'close274_redraw_anchor';END IF;
 EXECUTE replace(definition,anchor,addition||anchor);
END $patch$;

DO $post$
BEGIN
 IF has_function_privilege('authenticated','floor_private.clear_session_dealer_reservations274(uuid)','EXECUTE')
 OR has_function_privilege('service_role','floor_private.cancel_rotation_slot_internal274(uuid,text,boolean)','EXECUTE')
 OR (SELECT count(*) FROM floor_private.dealer_close_pre274)<>7
 THEN RAISE EXCEPTION 'close274_private_acl_or_backup_failed';END IF;
END $post$;
COMMIT;
