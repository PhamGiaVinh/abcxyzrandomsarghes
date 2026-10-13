-- Forward-only raw-read visibility fence; does not change write policies/grants.
-- Public reads match spectator deleted/voided filtering. Existing operational
-- actors retain archived review within their server-derived club authority.
-- Compensation: NEW reviewed migration removing only these two restrictive
-- policies, then revoke/drop this helper; never modify hand/player/audit rows.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $guard$
BEGIN
 IF current_user<>'postgres' THEN RAISE EXCEPTION 'reviewed_postgres_owner_required'; END IF;
 IF md5(replace(pg_get_functiondef('floor_private.floor_table_v3_actor_is_tournament_operator(uuid,uuid)'::regprocedure),chr(13),''))<>'31191a2691e30698d1e3c0126b223421'
 OR md5(replace(pg_get_functiondef('public.is_club_tracker(uuid,uuid)'::regprocedure),chr(13),''))<>'754a878cd17019d6cb0b27aad6a10e84'
 OR md5(replace(pg_get_functiondef('public.is_club_dealer_control(uuid,uuid)'::regprocedure),chr(13),''))<>'3186459824aedc075cda311b80bf97ad' THEN RAISE EXCEPTION 'visibility74_authority_dependency_drift'; END IF;
 IF to_regprocedure('floor_private.tracker_hand_read_scope74(uuid,boolean,uuid)') IS NOT NULL
 OR EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND policyname IN ('tournament_hands_visibility74','hand_players_visibility74')) THEN RAISE EXCEPTION 'visibility74_already_present'; END IF;
 IF (SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename IN ('tournament_hands','hand_players'))<>6
 OR (SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename IN ('tournament_hands','hand_players') AND cmd='SELECT' AND permissive='PERMISSIVE' AND qual='true')<>4
 OR EXISTS(SELECT 1 FROM pg_class WHERE oid IN ('public.tournament_hands'::regclass,'public.hand_players'::regclass) AND NOT relrowsecurity) THEN RAISE EXCEPTION 'visibility74_policy_baseline_drift'; END IF;
 PERFORM set_config('visibility74.original_policies',(
 SELECT md5(jsonb_agg(to_jsonb(p) ORDER BY p.tablename,p.policyname)::text) FROM pg_policies p WHERE p.schemaname='public' AND p.tablename IN ('tournament_hands','hand_players')),true);
END;
$guard$;

CREATE FUNCTION floor_private.tracker_hand_read_scope74(p_tournament_id uuid,p_is_voided boolean,p_created_by uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $function$
 SELECT EXISTS(SELECT 1 FROM public.tournaments t WHERE t.id=p_tournament_id AND (
  (t.deleted_at IS NULL AND NOT COALESCE(p_is_voided,false))
  OR (auth.uid() IS NOT NULL AND (
   p_created_by=auth.uid()
   OR floor_private.floor_table_v3_actor_is_tournament_operator(auth.uid(),t.club_id)
   OR public.is_club_tracker(auth.uid(),t.club_id)
   OR public.is_club_dealer_control(auth.uid(),t.club_id)
  ))));
$function$;
REVOKE ALL ON FUNCTION floor_private.tracker_hand_read_scope74(uuid,boolean,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION floor_private.tracker_hand_read_scope74(uuid,boolean,uuid) TO anon,authenticated;

CREATE POLICY tournament_hands_visibility74 ON public.tournament_hands
 AS RESTRICTIVE FOR SELECT TO anon,authenticated
 USING(floor_private.tracker_hand_read_scope74(tournament_id,is_voided,created_by));
CREATE POLICY hand_players_visibility74 ON public.hand_players
 AS RESTRICTIVE FOR SELECT TO anon,authenticated
 USING(EXISTS(SELECT 1 FROM public.tournament_hands h WHERE h.id=hand_players.hand_id
  AND floor_private.tracker_hand_read_scope74(h.tournament_id,h.is_voided,h.created_by)));

DO $postcheck$
BEGIN
 IF md5(replace(pg_get_functiondef('floor_private.tracker_hand_read_scope74(uuid,boolean,uuid)'::regprocedure),chr(13),''))<>'9da991bb1262c314ded4bfd69c70749c'
 OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='floor_private.tracker_hand_read_scope74(uuid,boolean,uuid)'::regprocedure AND prosecdef AND provolatile='s' AND proconfig=ARRAY['search_path=""']::text[] AND pg_get_userbyid(proowner)='postgres') THEN RAISE EXCEPTION 'visibility74_helper_postcheck'; END IF;
 IF NOT has_function_privilege('anon','floor_private.tracker_hand_read_scope74(uuid,boolean,uuid)','EXECUTE')
 OR NOT has_function_privilege('authenticated','floor_private.tracker_hand_read_scope74(uuid,boolean,uuid)','EXECUTE')
 OR has_function_privilege('service_role','floor_private.tracker_hand_read_scope74(uuid,boolean,uuid)','EXECUTE')
 OR EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a WHERE p.oid='floor_private.tracker_hand_read_scope74(uuid,boolean,uuid)'::regprocedure AND a.grantee=0 AND a.privilege_type='EXECUTE') THEN RAISE EXCEPTION 'visibility74_helper_acl_postcheck'; END IF;
 IF (SELECT md5(jsonb_agg(to_jsonb(p) ORDER BY p.tablename,p.policyname)::text) FROM pg_policies p WHERE p.schemaname='public' AND p.tablename IN ('tournament_hands','hand_players') AND p.policyname NOT IN ('tournament_hands_visibility74','hand_players_visibility74')) IS DISTINCT FROM current_setting('visibility74.original_policies') THEN RAISE EXCEPTION 'visibility74_existing_policy_changed'; END IF;
 IF (SELECT count(*) FROM pg_policies WHERE schemaname='public' AND policyname IN ('tournament_hands_visibility74','hand_players_visibility74') AND permissive='RESTRICTIVE' AND cmd='SELECT' AND roles=ARRAY['anon','authenticated']::name[])<>2 THEN RAISE EXCEPTION 'visibility74_restrictive_postcheck'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='tournament_hands' AND policyname='tournament_hands_visibility74' AND md5(qual)='cf2065eba7a9638faaa4cfa59756577f')
 OR NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='hand_players' AND policyname='hand_players_visibility74' AND md5(qual)='8c08f5f437366972d6b8410701ffbf4b') THEN RAISE EXCEPTION 'visibility74_policy_expression_postcheck'; END IF;
END;
$postcheck$;
COMMIT;
