-- CLI candidate20261016030400, local catalog reserved108. Live catalog/body/ACL
-- must be checked before owner-gated release. No function-body/data changes.
-- Only process-swing calls this worker bookkeeping RPC; browser users must use
-- the authorized operational workflow, never mark arbitrary schedules executed.
-- Recovery: retain this restriction when rolling back Edge. Capture prior ACL
-- for recovery evidence; do not automatically restore the vulnerable browser
-- grant. Any alternative caller path needs equivalent reviewed authorization.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $guard$
DECLARE target regprocedure:='public.complete_rotation_slot(uuid,uuid)'::regprocedure;
BEGIN
 IF md5(replace(pg_get_functiondef(target),chr(13),''))<>'5b323b5e2a24a151a320af417a3c6024' THEN
   RAISE EXCEPTION 'rotation_completion_definition_drift';
 END IF;
 IF NOT has_function_privilege('service_role',target,'EXECUTE') THEN
   RAISE EXCEPTION 'rotation_completion_worker_grant_missing';
 END IF;
 IF EXISTS(SELECT 1 FROM pg_proc p,
   LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) acl
   WHERE p.oid=target AND acl.grantee NOT IN (0,p.proowner,
     'anon'::regrole::oid,'authenticated'::regrole::oid,'service_role'::regrole::oid)) THEN
   RAISE EXCEPTION 'rotation_completion_unreviewed_grantee';
 END IF;
END $guard$;
REVOKE ALL ON FUNCTION public.complete_rotation_slot(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.complete_rotation_slot(uuid,uuid) TO service_role;
DO $postcheck$
BEGIN
 IF has_function_privilege('anon','public.complete_rotation_slot(uuid,uuid)','EXECUTE')
 OR has_function_privilege('authenticated','public.complete_rotation_slot(uuid,uuid)','EXECUTE')
 OR NOT has_function_privilege('service_role','public.complete_rotation_slot(uuid,uuid)','EXECUTE') THEN
   RAISE EXCEPTION 'rotation_completion_acl_postcheck_failed';
 END IF;
END $postcheck$;
COMMIT;
