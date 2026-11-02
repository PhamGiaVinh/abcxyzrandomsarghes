-- CLI candidate20261018161715; forward154, LOCAL ONLY / NOT LIVE.
-- Existing browser UPDATE policy is for soft-delete, not message impersonation.
-- Recovery: suspend authenticated UPDATE, retain messages/membership/audit;
-- do not drop the guard to reopen sender or group rewriting.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $$ BEGIN
 IF current_user<>'postgres'
 OR to_regprocedure('public._group_message_client_update_guard_v1()') IS NOT NULL
 OR EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20270128000154')
 OR NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='public.chat_group_messages'::regclass AND relrowsecurity)
 OR NOT EXISTS(SELECT 1 FROM pg_policy WHERE polrelid='public.chat_group_messages'::regclass AND polcmd='w'
   AND polname='Sender or creator soft-delete') THEN
  RAISE EXCEPTION 'group_message154_catalog_drift_or_collision';END IF;
END $$;
CREATE FUNCTION public._group_message_client_update_guard_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 -- Existing definer group soft-delete cascade and service maintenance remain
 -- valid. A browser authenticated role cannot select these database roles.
 IF current_user IN('postgres','service_role') THEN RETURN NEW;END IF;
 IF auth.uid() IS NULL OR (to_jsonb(NEW)-'deleted_at') IS DISTINCT FROM (to_jsonb(OLD)-'deleted_at') THEN
  RAISE EXCEPTION 'group_message_update_soft_delete_only' USING ERRCODE='42501';END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public._group_message_client_update_guard_v1() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER group_message_client_update_guard_v1 BEFORE UPDATE ON public.chat_group_messages
 FOR EACH ROW EXECUTE FUNCTION public._group_message_client_update_guard_v1();
COMMIT;
