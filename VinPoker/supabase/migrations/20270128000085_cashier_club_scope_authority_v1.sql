-- Forward-only authority repair. Preserve the existing subject's club set;
-- restrict who may select a subject. Service-role callers already verify the
-- human actor in cashier-lookup-player / staking-mark-busted before this call.
DO $preflight$
BEGIN
  IF md5(pg_get_functiondef('public.cashier_club_ids(uuid)'::regprocedure))
      <> '1312fa57f2103eb3d72cd5e2d0fa4518' THEN
    RAISE EXCEPTION 'cashier_club_ids: reviewed live definition precondition mismatch';
  END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION public.cashier_club_ids(_user_id uuid)
RETURNS SETOF uuid
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  actor_id uuid := auth.uid();
BEGIN
  IF _user_id IS NULL THEN
    RAISE EXCEPTION 'cashier_club_ids: subject required' USING ERRCODE='22023';
  END IF;
  IF COALESCE(auth.role(),'') <> 'service_role' THEN
    IF actor_id IS NULL OR (
      actor_id <> _user_id AND
      public.has_role(actor_id,'super_admin'::public.app_role) IS NOT TRUE
    ) THEN
      RAISE EXCEPTION 'cashier_club_ids: subject not permitted' USING ERRCODE='42501';
    END IF;
  END IF;

  RETURN QUERY
    SELECT c.id FROM public.clubs c
      WHERE public.has_role(_user_id,'super_admin'::public.app_role)
    UNION
    SELECT cc.club_id FROM public.club_cashiers cc WHERE cc.user_id=_user_id
    UNION
    SELECT c.id FROM public.clubs c WHERE c.owner_id=_user_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.cashier_club_ids(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cashier_club_ids(uuid) TO authenticated, service_role;

DO $postcheck$
BEGIN
  IF has_function_privilege('anon','public.cashier_club_ids(uuid)','EXECUTE')
      OR NOT has_function_privilege('authenticated','public.cashier_club_ids(uuid)','EXECUTE')
      OR NOT has_function_privilege('service_role','public.cashier_club_ids(uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'cashier_club_ids: effective execution privileges mismatch';
  END IF;
END;
$postcheck$;
