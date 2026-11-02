-- CLI candidate20261018162131; forward156 LOCAL ONLY / NOT LIVE.
-- Membership rows remain historical evidence; deleted groups have no active
-- member access. Do not restore the old helper to recover access after delete.
-- Recovery: suspend group message writes until reviewed; retain all rows.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $$BEGIN
 IF current_user<>'postgres'
 OR EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20270128000156')
 OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='public.is_group_member(uuid,uuid)'::regprocedure
  AND proowner='postgres'::regrole AND prosecdef AND proconfig=ARRAY['search_path=public']
  AND md5(replace(prosrc,chr(13),''))='31ab21e7ee85e119b4dc93aa96a5d1e2') THEN
  RAISE EXCEPTION 'active_group156_helper_drift_or_collision';END IF;
END $$;
CREATE OR REPLACE FUNCTION public.is_group_member(_user_id uuid,_group_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.chat_group_members m JOIN public.chat_groups g ON g.id=m.group_id
  WHERE m.group_id=_group_id AND m.user_id=_user_id AND g.deleted_at IS NULL)
$$;
COMMIT;
