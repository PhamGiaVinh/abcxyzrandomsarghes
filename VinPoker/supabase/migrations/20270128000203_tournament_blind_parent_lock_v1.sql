-- CLI generated20261020073003;203 reserved after exact catalog collision check.
-- Preserve legacy invoker/RLS/output. Acquire parent BEFORE child DELETE locks.
-- The narrow definer is necessary because blind-only Cashier/Tracker members
-- cannot necessarily lock the parent through the tournaments UPDATE policy.
-- Recovery: rollback DDL transaction before qualification. For containment after
-- release, suspend this legacy RPC, not RLS or the lock ordering guard.
BEGIN;
SET LOCAL lock_timeout='3s';SET LOCAL statement_timeout='30s';
DO $$ BEGIN
 IF current_user<>'postgres'
 OR md5(replace(pg_get_functiondef('public.update_blind_structure(uuid,jsonb)'::regprocedure),chr(13),''))<>'aec73001b2b0055bc0e5aba94afb48f8'
 OR to_regprocedure('public._lock_tournament_blind_parent_v1(uuid)') IS NOT NULL
 OR EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20270128000203')
 OR (SELECT md5(string_agg(polcmd::text||':'||coalesce(pg_get_expr(polqual,polrelid),'')||':'||coalesce(pg_get_expr(polwithcheck,polrelid),''),'|' ORDER BY polname)) FROM pg_policy WHERE polrelid='public.tournament_levels'::regclass AND polcmd<>'r') IS DISTINCT FROM '45fcb862a3fbea8ccc9fa3075f5cae0b'
 OR NOT(SELECT relrowsecurity FROM pg_class WHERE oid='public.tournament_levels'::regclass)
 THEN RAISE EXCEPTION 'blind_parent203_catalog_drift_or_collision';END IF;
END $$;

CREATE FUNCTION public._lock_tournament_blind_parent_v1(p_tournament_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid();club uuid;
BEGIN
 SELECT club_id INTO club FROM public.tournaments WHERE id=p_tournament_id;
 -- Mirrors the existing tournament_levels ALL policy, not broader app roles.
 IF actor IS NULL OR club IS NULL OR NOT EXISTS(
  SELECT 1 FROM public.clubs c WHERE c.id=club AND
   (c.owner_id=actor OR EXISTS(SELECT 1 FROM public.club_cashiers x WHERE x.club_id=c.id AND x.user_id=actor)
    OR EXISTS(SELECT 1 FROM public.club_trackers x WHERE x.club_id=c.id AND x.user_id=actor)
    OR EXISTS(SELECT 1 FROM public.club_dealer_controls x WHERE x.club_id=c.id AND x.user_id=actor)))
 THEN RAISE EXCEPTION 'blind_parent_actor_not_allowed' USING ERRCODE='42501';END IF;
 PERFORM id FROM public.tournaments WHERE id=p_tournament_id AND club_id=club FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'blind_parent_context_changed' USING ERRCODE='40001';END IF;
 -- A membership may have been revoked while this transaction waited.
 IF NOT EXISTS(SELECT 1 FROM public.clubs c WHERE c.id=club AND
   (c.owner_id=actor OR EXISTS(SELECT 1 FROM public.club_cashiers x WHERE x.club_id=c.id AND x.user_id=actor)
    OR EXISTS(SELECT 1 FROM public.club_trackers x WHERE x.club_id=c.id AND x.user_id=actor)
    OR EXISTS(SELECT 1 FROM public.club_dealer_controls x WHERE x.club_id=c.id AND x.user_id=actor)))
 THEN RAISE EXCEPTION 'blind_parent_actor_not_allowed' USING ERRCODE='42501';END IF;
END $$;
REVOKE ALL ON FUNCTION public._lock_tournament_blind_parent_v1(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public._lock_tournament_blind_parent_v1(uuid) TO authenticated;

DO $$ DECLARE definition text;acl aclitem[];marker text;BEGIN
 SELECT replace(pg_get_functiondef(oid),chr(13),''),proacl INTO definition,acl FROM pg_proc
 WHERE oid='public.update_blind_structure(uuid,jsonb)'::regprocedure AND proowner='postgres'::regrole AND NOT prosecdef AND proconfig IS NULL;
 IF definition IS NULL THEN RAISE EXCEPTION 'blind_parent203_legacy_owner_or_mode_drift';END IF;
 marker:=E'BEGIN\n    DELETE FROM public.tournament_levels';
 IF array_length(string_to_array(definition,marker),1)<>2 THEN RAISE EXCEPTION 'blind_parent203_legacy_body_drift';END IF;
 definition:=replace(definition,marker,E'BEGIN\n    PERFORM public._lock_tournament_blind_parent_v1(p_tournament_id);\n    DELETE FROM public.tournament_levels');
 EXECUTE definition;
 IF (SELECT proacl FROM pg_proc WHERE oid='public.update_blind_structure(uuid,jsonb)'::regprocedure) IS DISTINCT FROM acl
 OR (SELECT prosecdef FROM pg_proc WHERE oid='public.update_blind_structure(uuid,jsonb)'::regprocedure)
 THEN RAISE EXCEPTION 'blind_parent203_legacy_acl_or_rls_changed';END IF;
END $$;
COMMIT;
