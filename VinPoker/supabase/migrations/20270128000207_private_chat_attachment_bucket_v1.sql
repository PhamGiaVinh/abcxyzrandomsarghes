-- CLI scaffold20261020093440, reserved207 locally. Additive private storage;
-- do not flip the shared public chat-uploads bucket or rewrite existing URLs.
-- Client private-reference/signed-read + legacy-byte migration are separate
-- required rollout dependencies; this migration alone does not fix old URLs.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='15s';
DO $$ BEGIN
 IF current_user<>'postgres'
 OR EXISTS(SELECT 1 FROM storage.buckets WHERE id='chat-private-v1')
 OR to_regprocedure('private.can_read_chat_attachment_v1(text)') IS NOT NULL
 OR EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20270128000207')
 OR NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='storage.objects'::regclass AND relrowsecurity)
 OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='public.is_group_member(uuid,uuid)'::regprocedure
  AND prosecdef AND proowner='postgres'::regrole AND proconfig=ARRAY['search_path=""']::text[]) THEN
  RAISE EXCEPTION 'private_chat207_dependency_drift_or_collision'; END IF;
END $$;
INSERT INTO storage.buckets(id,name,public,file_size_limit)
 VALUES('chat-private-v1','chat-private-v1',false,10485760);
CREATE FUNCTION private.can_read_chat_attachment_v1(p_name text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $body$
DECLARE actor uuid:=auth.uid(); parts text[]:=string_to_array(p_name,'/'); target uuid;
BEGIN
 IF actor IS NULL OR COALESCE(array_length(parts,1),0)<>4
 OR parts[1]!~'^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$'
 OR parts[3]!~'^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$'
 OR parts[4]!~'^[a-zA-Z0-9][a-zA-Z0-9._-]{0,199}$' THEN RETURN false; END IF;
 target:=parts[3]::uuid;
 IF parts[2]='dm' THEN
  RETURN EXISTS(SELECT 1 FROM public.direct_chats c WHERE c.id=target AND actor IN(c.user_a,c.user_b));
 ELSIF parts[2]='groups' THEN
  RETURN public.is_group_member(actor,target);
 END IF;
 RETURN false;
END $body$;
REVOKE ALL ON FUNCTION private.can_read_chat_attachment_v1(text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION private.can_read_chat_attachment_v1(text) TO authenticated;
CREATE POLICY "Private chat attachment read v1" ON storage.objects FOR SELECT TO authenticated
 USING(bucket_id='chat-private-v1' AND private.can_read_chat_attachment_v1(name));
CREATE POLICY "Private chat attachment insert v1" ON storage.objects FOR INSERT TO authenticated
 WITH CHECK(bucket_id='chat-private-v1' AND (storage.foldername(name))[1]=auth.uid()::text
  AND private.can_read_chat_attachment_v1(name));
CREATE POLICY "Private chat attachment immutable update v1" ON storage.objects AS RESTRICTIVE FOR UPDATE TO authenticated
 USING(bucket_id<>'chat-private-v1') WITH CHECK(bucket_id<>'chat-private-v1');
CREATE POLICY "Private chat attachment immutable delete v1" ON storage.objects AS RESTRICTIVE FOR DELETE TO authenticated
 USING(bucket_id<>'chat-private-v1');
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM storage.buckets WHERE id='chat-private-v1' AND public=false AND file_size_limit=10485760)
 OR has_function_privilege('anon','private.can_read_chat_attachment_v1(text)','EXECUTE') THEN
  RAISE EXCEPTION 'private_chat207_postcheck'; END IF;
END $$;
COMMIT;
