-- CLI candidate20261018093200, local forward141; NOT LIVE.
-- A global club_admin label is not membership in the requested club.
-- Preserve superadmin and all existing exact-club role branches and formulas.
-- Recovery: containment140 suspends preview; never restore cross-tenant reads.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $$
DECLARE target regprocedure:='public.calculate_club_payroll(uuid,date,date)'::regprocedure;
 body text; patched text; definition text; acl aclitem[];
 needle text:=$old$public.has_role(auth.uid(), 'club_admin'::public.app_role)$old$;
BEGIN
 SELECT prosrc,proacl INTO body,acl FROM pg_proc WHERE oid=target;
 IF current_user<>'postgres' OR md5(body)<>'911db1f308e78a06f940a0c80fb850fc'
  OR (SELECT pg_get_userbyid(proowner) FROM pg_proc WHERE oid=target)<>'postgres'
  OR length(body)-length(replace(body,needle,''))<>length(needle) THEN
  RAISE EXCEPTION 'payroll141_reviewed_wrapper_drift';END IF;
 patched:=replace(body,needle,'false /* payroll141_global_role_not_club_membership */');
 definition:=pg_get_functiondef(target);
 IF position(body IN definition)=0 THEN RAISE EXCEPTION 'payroll141_definition_drift';END IF;
 EXECUTE replace(definition,body,patched);
 IF (SELECT prosrc FROM pg_proc WHERE oid=target) IS DISTINCT FROM patched
  OR (SELECT proacl FROM pg_proc WHERE oid=target) IS DISTINCT FROM acl THEN
  RAISE EXCEPTION 'payroll141_source_or_acl_postcheck_failed';END IF;
END $$;
COMMIT;
