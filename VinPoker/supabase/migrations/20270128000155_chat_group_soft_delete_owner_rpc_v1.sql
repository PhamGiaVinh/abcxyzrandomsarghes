-- CLI candidate20261018161856; forward155 LOCAL ONLY / NOT LIVE.
-- Creator-scoped soft deletion without weakening SELECT policies for deleted
-- groups. The existing deleted_at timestamp is the durable idempotent outcome.
-- Recovery: revoke authenticated EXECUTE; preserve deleted groups/messages.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $$BEGIN
 IF current_user<>'postgres' OR to_regprocedure('public.soft_delete_chat_group_v1(uuid)') IS NOT NULL
 OR EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20270128000155')
 OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.chat_groups'::regclass
  AND tgname='chat_group_soft_delete_cascade' AND tgenabled='O') THEN
  RAISE EXCEPTION 'group_delete155_dependency_drift_or_collision';END IF;
END $$;
CREATE FUNCTION public.soft_delete_chat_group_v1(p_group_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); target public.chat_groups; stamp timestamptz;
BEGIN
 IF actor IS NULL OR p_group_id IS NULL THEN
  RETURN jsonb_build_object('ok',false,'error','group_delete_not_allowed');END IF;
 SELECT * INTO target FROM public.chat_groups WHERE id=p_group_id AND created_by=actor FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','group_delete_not_allowed');END IF;
 IF target.deleted_at IS NOT NULL THEN
  RETURN jsonb_build_object('ok',true,'outcome','already_deleted','groupId',target.id,'deletedAt',target.deleted_at);END IF;
 stamp:=clock_timestamp();
 UPDATE public.chat_groups SET deleted_at=stamp WHERE id=target.id AND created_by=actor;
 RETURN jsonb_build_object('ok',true,'outcome','deleted','groupId',target.id,'deletedAt',stamp);
END $$;
REVOKE ALL ON FUNCTION public.soft_delete_chat_group_v1(uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.soft_delete_chat_group_v1(uuid) TO authenticated;
COMMIT;
