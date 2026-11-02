-- Native object METADATA/RLS qualification. No Storage service, bytes, signed
-- URLs, legacy migration or actual upload acceptance. Parent rolls all back.
GRANT USAGE ON SCHEMA auth TO authenticated;
DO $test$
DECLARE a uuid:='a364de8e-06b1-4428-a20d-ac614ec406e5'; b uuid:='62ead6ed-2bef-45ca-92ee-ed963baa1018';
 outsider uuid:='675fe35e-60a8-4452-bb90-e79486d54da6'; dm uuid:=gen_random_uuid(); foreign_dm uuid:=gen_random_uuid(); grp uuid:=gen_random_uuid();
 dm_path text;group_path text;bad text;changed int;
BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND inet_server_port()=55441 AND inet_server_addr()='127.0.0.1'::inet;
 INSERT INTO public.direct_chats(id,user_a,user_b) VALUES(dm,LEAST(a,b),GREATEST(a,b)),(foreign_dm,LEAST(b,outsider),GREATEST(b,outsider));
 INSERT INTO public.chat_groups(id,name,created_by,is_public) VALUES(grp,'PRIVATE ATTACHMENT207 ROLLBACK TEST',a,false);
 INSERT INTO public.chat_group_members(group_id,user_id) VALUES(grp,b);
 dm_path:=a||'/dm/'||dm||'/'||gen_random_uuid()||'.png';group_path:=a||'/groups/'||grp||'/'||gen_random_uuid()||'.pdf';
 PERFORM set_config('test.private207_dm',dm_path,true);PERFORM set_config('test.private207_group',group_path,true);
 PERFORM set_config('request.jwt.claim.sub',a::text,true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',a)::text,true);
 PERFORM set_config('role','authenticated',true);
 INSERT INTO storage.objects(bucket_id,name) VALUES('chat-private-v1',dm_path),('chat-private-v1',group_path);
 ASSERT (SELECT count(*) FROM storage.objects WHERE bucket_id='chat-private-v1')=2;
 FOREACH bad IN ARRAY ARRAY[b||'/dm/'||dm||'/other-owner.png',a||'/dm/'||foreign_dm||'/foreign-chat.png',
  a||'/groups/'||gen_random_uuid()||'/foreign-group.png',a||'/dm/not-a-uuid/x.png',a||'/dm/'||dm||'/../escape.png'] LOOP
  BEGIN
   INSERT INTO storage.objects(bucket_id,name) VALUES('chat-private-v1',bad);
   RAISE EXCEPTION 'private207_invalid_upload_allowed:%',bad;
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 END LOOP;
 UPDATE storage.objects SET metadata='{"size":1}' WHERE bucket_id='chat-private-v1';GET DIAGNOSTICS changed=ROW_COUNT;ASSERT changed=0,'private207_mutable';
 -- storage.protect_delete blocks direct SQL deletes even for an empty match.
 -- Do not bypass it; deletion API behavior is NOT qualified by this test.
 ASSERT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects'
  AND policyname='Private chat attachment immutable delete v1' AND permissive='RESTRICTIVE');
 PERFORM set_config('request.jwt.claim.sub',b::text,true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',b)::text,true);
 ASSERT (SELECT count(*) FROM storage.objects WHERE bucket_id='chat-private-v1')=2,'recipient/member cannot read';
 PERFORM set_config('request.jwt.claim.sub',outsider::text,true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',outsider)::text,true);
 ASSERT (SELECT count(*) FROM storage.objects WHERE bucket_id='chat-private-v1')=0,'outsider can read';
 PERFORM set_config('role','none',true);
 DELETE FROM public.chat_group_members WHERE group_id=grp AND user_id=b;
 PERFORM set_config('request.jwt.claim.sub',b::text,true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',b)::text,true);
 PERFORM set_config('role','authenticated',true);
 ASSERT (SELECT count(*) FROM storage.objects WHERE bucket_id='chat-private-v1' AND name=group_path)=0,'removed member retains access';
 ASSERT (SELECT count(*) FROM storage.objects WHERE bucket_id='chat-private-v1' AND name=dm_path)=1,'unrelated DM access regressed';
 PERFORM set_config('role','none',true);
 UPDATE public.chat_groups SET deleted_at=now() WHERE id=grp;
 PERFORM set_config('request.jwt.claim.sub',a::text,true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',a)::text,true);
 PERFORM set_config('role','authenticated',true);
 ASSERT (SELECT count(*) FROM storage.objects WHERE bucket_id='chat-private-v1' AND name=group_path)=0,'deleted group retains access';
 PERFORM set_config('role','none',true);
END $test$;
SET LOCAL ROLE anon;
DO $$ BEGIN ASSERT (SELECT count(*) FROM storage.objects WHERE bucket_id='chat-private-v1')=0,'anon private metadata leak'; END $$;
RESET ROLE;
SELECT 'PRIVATE_CHAT207_OWNER_RECIPIENT_MEMBER_OUTSIDER_REVOKE_UPDATE_RLS_PASS_DELETE_API_UNTESTED';
