-- Restore the historical scoped Dealer Control/owner write authority, rather
-- than the live authenticated/true policies. Public SELECT is unchanged.
-- This does NOT repair the legacy multi-request config mutation itself.
DO $preflight$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid='public.tournament_tables'::regclass
      AND relrowsecurity) OR (
      SELECT count(*) FROM pg_policy WHERE polrelid='public.tournament_tables'::regclass
      AND polroles=ARRAY['authenticated'::regrole::oid]
      AND ((polname='tournament_tables_insert' AND polcmd='a' AND polqual IS NULL
        AND pg_get_expr(polwithcheck,polrelid)='true')
        OR (polname='tournament_tables_update' AND polcmd='w'
          AND pg_get_expr(polqual,polrelid)='true' AND polwithcheck IS NULL)
        OR (polname='tournament_tables_delete' AND polcmd='d'
          AND pg_get_expr(polqual,polrelid)='true' AND polwithcheck IS NULL))) <> 3
      OR EXISTS (SELECT 1 FROM pg_policy
        WHERE polrelid='public.tournament_tables'::regclass AND polcmd IN ('a','w','d','*')
        AND polname NOT IN ('tournament_tables_insert','tournament_tables_update','tournament_tables_delete')) THEN
    RAISE EXCEPTION 'tournament table write scope: reviewed live policy precondition mismatch';
  END IF;
END;
$preflight$;

-- Used by three policies. Caller identity is never supplied by the client.
-- Definer reads avoid requiring browser SELECT on private table_sessions.
CREATE FUNCTION public._tournament_table_write_scope_v1(
  p_tournament_id uuid,p_table_id uuid,p_game_table_id uuid,p_session_id uuid
) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
AS $function$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.tournaments t WHERE t.id=p_tournament_id
      AND (public.is_club_dealer_control(auth.uid(),t.club_id) IS TRUE
        OR public.has_role(auth.uid(),'super_admin'::public.app_role) IS TRUE)
      AND (p_table_id IS NULL OR EXISTS (SELECT 1 FROM public.game_tables g
        WHERE g.id=p_table_id AND g.club_id=t.club_id))
      AND (p_game_table_id IS NULL OR EXISTS (SELECT 1 FROM public.game_tables g
        WHERE g.id=p_game_table_id AND g.club_id=t.club_id))
      AND (p_table_id IS NULL OR p_game_table_id IS NULL OR p_table_id=p_game_table_id)
      AND (p_session_id IS NULL OR EXISTS (SELECT 1 FROM public.table_sessions s
        WHERE s.id=p_session_id AND s.tournament_id=t.id
          AND s.game_table_id=coalesce(p_game_table_id,p_table_id)))
  );
$function$;
REVOKE ALL ON FUNCTION public._tournament_table_write_scope_v1(uuid,uuid,uuid,uuid)
  FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public._tournament_table_write_scope_v1(uuid,uuid,uuid,uuid)
  TO authenticated;

ALTER POLICY tournament_tables_insert ON public.tournament_tables TO authenticated
  WITH CHECK (public._tournament_table_write_scope_v1(tournament_id,table_id,game_table_id,table_session_id));
ALTER POLICY tournament_tables_update ON public.tournament_tables TO authenticated
  USING (public._tournament_table_write_scope_v1(tournament_id,table_id,game_table_id,table_session_id))
  WITH CHECK (public._tournament_table_write_scope_v1(tournament_id,table_id,game_table_id,table_session_id));
ALTER POLICY tournament_tables_delete ON public.tournament_tables TO authenticated
  USING (public._tournament_table_write_scope_v1(tournament_id,table_id,game_table_id,table_session_id));

DO $postcheck$
BEGIN
  IF has_function_privilege('anon','public._tournament_table_write_scope_v1(uuid,uuid,uuid,uuid)','EXECUTE')
      OR NOT has_function_privilege('authenticated','public._tournament_table_write_scope_v1(uuid,uuid,uuid,uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'tournament table write scope: effective helper ACL mismatch';
  END IF;
END;
$postcheck$;
