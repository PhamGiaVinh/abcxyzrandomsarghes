-- CLI candidate20261018151052; forward151. LOCAL ONLY, no message delivery.
-- Client read-marker writes must not reassign access to existing private history.
-- Recovery: revoke authenticated UPDATE until repaired, never reopen membership rewriting.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $$
BEGIN
  IF current_user<>'postgres' OR to_regprocedure('public._direct_chat_client_update_guard_v1()') IS NOT NULL
    OR EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20270128000151')
    OR NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='public.direct_chats'::regclass AND relrowsecurity)
    OR NOT EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND tablename='direct_chats'
      AND indexname='direct_chats_pair_unique' AND indexdef LIKE '%UNIQUE% (user_a, user_b)%') THEN
    RAISE EXCEPTION 'dm151_catalog_drift_or_collision';
  END IF;
END $$;
CREATE FUNCTION public._direct_chat_client_update_guard_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $$
DECLARE actor uuid;
BEGIN
  -- Canonical SECURITY DEFINER message-insert trigger must still bump last_message_at.
  -- Browser JWT roles cannot select these database roles.
  IF current_user IN('postgres','service_role') THEN RETURN NEW;END IF;
  actor:=auth.uid();
  IF actor IS NULL OR (actor<>OLD.user_a AND actor<>OLD.user_b) THEN
    RAISE EXCEPTION 'direct_chat_update_forbidden' USING ERRCODE='42501';
  END IF;
  IF (NEW.id,NEW.user_a,NEW.user_b,NEW.created_at,NEW.last_message_at)
    IS DISTINCT FROM (OLD.id,OLD.user_a,OLD.user_b,OLD.created_at,OLD.last_message_at) THEN
    RAISE EXCEPTION 'direct_chat_identity_immutable' USING ERRCODE='42501';
  END IF;
  IF (actor=OLD.user_a AND NEW.user_b_last_read_at IS DISTINCT FROM OLD.user_b_last_read_at)
    OR (actor=OLD.user_b AND NEW.user_a_last_read_at IS DISTINCT FROM OLD.user_a_last_read_at) THEN
    RAISE EXCEPTION 'direct_chat_other_read_marker_forbidden' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public._direct_chat_client_update_guard_v1() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER direct_chat_client_update_guard_v1 BEFORE UPDATE ON public.direct_chats
  FOR EACH ROW EXECUTE FUNCTION public._direct_chat_client_update_guard_v1();
COMMIT;
