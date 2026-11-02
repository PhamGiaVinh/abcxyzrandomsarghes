-- CLI candidate 20261018143859; forward catalog slot149. LOCAL ONLY.
-- Keep the public signature for current clients; caller identity is server-derived.
-- Recovery: suspend this read endpoint, never restore other-user enumeration.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $$
DECLARE target regprocedure:='public.fnb_club_ids(uuid)'::regprocedure;
BEGIN
  IF current_user<>'postgres' OR (SELECT md5(prosrc) FROM pg_proc WHERE oid=target)<>'9db373eef6b654e4bebb87c6f620e7fa'
    OR EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20270128000149') THEN
    RAISE EXCEPTION 'fnb149_catalog_drift_or_collision';
  END IF;
END $$;
CREATE OR REPLACE FUNCTION public.fnb_club_ids(_user_id uuid)
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
AS $$
  SELECT staff.club_id FROM public.club_fnb_staff staff
    WHERE auth.uid() IS NOT NULL AND _user_id=auth.uid() AND staff.user_id=auth.uid()
  UNION
  SELECT club.id FROM public.clubs club
    WHERE auth.uid() IS NOT NULL AND _user_id=auth.uid() AND club.owner_id=auth.uid()
  UNION
  SELECT club.id FROM public.clubs club
    WHERE auth.uid() IS NOT NULL AND _user_id=auth.uid()
      AND public.has_role(auth.uid(),'super_admin'::public.app_role)
$$;
REVOKE ALL ON FUNCTION public.fnb_club_ids(uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.fnb_club_ids(uuid) TO authenticated;
COMMIT;
