-- CLI candidate20261018185339 ->167. LOCAL ONLY.
-- Remove an unrequested calendar-year restriction introduced by166.
-- Keep all actor/money/month/state/locking guards; recovery is166 containment.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $$
DECLARE target regprocedure:='public.save_payroll_period(uuid,integer,integer,date,date,jsonb,uuid)'::regprocedure;
 body text;definition text;patched text;acl aclitem[];
 needle text:='p_year NOT BETWEEN 2000 AND 2200 OR ';
BEGIN
 SELECT prosrc,proacl INTO body,acl FROM pg_proc WHERE oid=target;
 IF current_user<>'postgres' OR md5(replace(body,chr(13),''))<>'a115963875a6ca36a77a2adf9440e3c6'
 OR length(body)-length(replace(body,needle,''))<>length(needle)
 OR EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20270128000167') THEN
   RAISE EXCEPTION 'payroll167_reviewed_catalog_drift';END IF;
 patched:=replace(body,needle,'');definition:=pg_get_functiondef(target);
 IF position(body IN definition)=0 THEN RAISE EXCEPTION 'payroll167_definition_drift';END IF;
 EXECUTE replace(definition,body,patched);
 IF (SELECT prosrc FROM pg_proc WHERE oid=target) IS DISTINCT FROM patched
 OR (SELECT proacl FROM pg_proc WHERE oid=target) IS DISTINCT FROM acl THEN
   RAISE EXCEPTION 'payroll167_source_or_acl_postcheck';END IF;
END $$;
COMMIT;
