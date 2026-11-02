-- CLI candidate20261021010859, reserved224 after local source/catalog checks.
-- Archive metadata only: do not depend on active-hand launcher readiness.
-- No identity backfill, session inference, hand/ledger write or old function edit.
-- Recovery: revert the consumer first, then revoke authenticated EXECUTE on this
-- exact new signature in a reviewed forward migration. Retain historical rows.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='10s';
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='list_tracker_history_tables_v1') THEN
  RAISE EXCEPTION 'tracker_history_tables224_function_collision';
 END IF;
 IF pg_catalog.to_regprocedure('public.is_club_tracker(uuid,uuid)') IS NULL
  OR pg_catalog.to_regprocedure('public.is_club_floor(uuid,uuid)') IS NULL THEN
  RAISE EXCEPTION 'tracker_history_tables224_authority_dependency_missing';
 END IF;
END $$;
CREATE FUNCTION public.list_tracker_history_tables_v1(p_tournament_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE
 v_actor uuid:=auth.uid();
 v_club uuid;
 v_tables jsonb;
BEGIN
 IF v_actor IS NULL THEN RETURN pg_catalog.jsonb_build_object('ok',false,'error','unauthorized'); END IF;
 SELECT t.club_id INTO v_club FROM public.tournaments t WHERE t.id=p_tournament_id;
 IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('ok',false,'error','tournament_not_found'); END IF;
 -- Same authority as the predecessor archive consumer; no service/anon path.
 IF (COALESCE(public.is_club_tracker(v_actor,v_club),false)
   OR COALESCE(public.is_club_floor(v_actor,v_club),false)) IS DISTINCT FROM true THEN
  RETURN pg_catalog.jsonb_build_object('ok',false,'error','actor_not_allowed');
 END IF;
 IF EXISTS(SELECT 1 FROM public.tournament_tables tt WHERE tt.tournament_id=p_tournament_id
  AND tt.game_table_id IS NOT NULL AND tt.table_id IS NOT NULL AND tt.game_table_id<>tt.table_id) THEN
  RETURN pg_catalog.jsonb_build_object('ok',false,'error','table_identity_conflict');
 END IF;
 IF EXISTS(SELECT 1 FROM public.tournament_tables tt
  LEFT JOIN public.game_tables g ON g.id=COALESCE(tt.game_table_id,tt.table_id)
  LEFT JOIN public.table_sessions s ON s.id=tt.table_session_id
  WHERE tt.tournament_id=p_tournament_id AND (
   g.id IS NULL OR g.club_id IS DISTINCT FROM v_club
   OR (tt.table_session_id IS NOT NULL AND (s.id IS NULL OR s.club_id IS DISTINCT FROM v_club
    OR s.tournament_id IS DISTINCT FROM p_tournament_id OR s.game_table_id IS DISTINCT FROM g.id)))) THEN
  RETURN pg_catalog.jsonb_build_object('ok',false,'error','table_identity_unavailable');
 END IF;
 SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
  'tournament_table_id',tt.id,'physical_table_id',g.id,'table_session_id',tt.table_session_id,
  'table_name',COALESCE(NULLIF(pg_catalog.btrim(g.table_name),''),'Bàn chưa đặt tên'),
  'table_number',tt.table_number,'table_status',tt.status
 ) ORDER BY tt.table_number NULLS LAST,tt.created_at,tt.id),'[]'::jsonb)
 INTO v_tables FROM public.tournament_tables tt
 JOIN public.game_tables g ON g.id=COALESCE(tt.game_table_id,tt.table_id)
 WHERE tt.tournament_id=p_tournament_id;
 RETURN pg_catalog.jsonb_build_object('ok',true,'contract_version','tracker-history-tables-v1',
  'tournament_id',p_tournament_id,'tables',v_tables);
END $$;
REVOKE ALL ON FUNCTION public.list_tracker_history_tables_v1(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.list_tracker_history_tables_v1(uuid) TO authenticated;
COMMIT;
