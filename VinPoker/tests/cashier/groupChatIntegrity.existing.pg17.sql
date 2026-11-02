-- Private groups/messages and membership are synthetic; ALL rows/notifications rollback.
BEGIN;
SET LOCAL statement_timeout='15s';
GRANT USAGE ON SCHEMA auth TO authenticated;
DO $$
DECLARE a uuid:='a364de8e-06b1-4428-a20d-ac614ec406e5'; b uuid:='62ead6ed-2bef-45ca-92ee-ed963baa1018';
 ga uuid:=gen_random_uuid(); gb uuid:=gen_random_uuid(); gp uuid:=gen_random_uuid(); msg uuid:=gen_random_uuid(); ownmsg uuid:=gen_random_uuid();
 page_ids uuid[]; older_ids uuid[]; cursor_id uuid; cursor_time timestamptz; old_count integer;
 denied boolean; changed integer; receipt jsonb; again jsonb;
BEGIN
 IF current_database()<>'vinpoker_ops_cash115_qualified_c' OR inet_server_port()<>55441
 OR inet_server_addr()<>'127.0.0.1'::inet OR EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_net') THEN
  RAISE EXCEPTION 'isolated_group_database_required';END IF;
 INSERT INTO public.chat_groups(id,name,created_by,is_public) VALUES(ga,'LOCAL integrity A',a,false),(gb,'LOCAL private B',b,false),(gp,'LOCAL pagination TEST',a,false);
 -- Only the creator exists in B; no notification recipient or external delivery.
 INSERT INTO public.chat_group_messages(id,group_id,sender_id,content) VALUES(msg,gb,b,'PRIVATE LOCAL TEST');
 PERFORM set_config('request.jwt.claim.sub',a::text,true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',a)::text,true);
 PERFORM set_config('role','authenticated',true);
 IF EXISTS(SELECT 1 FROM public.chat_group_messages WHERE id=msg) THEN RAISE EXCEPTION 'OUTSIDER_READ_PRIVATE_GROUP';END IF;
 -- Creator-only synthetic group: no recipient exists for external notification.
 INSERT INTO public.chat_group_messages(group_id,sender_id,content,created_at)
 SELECT gp,a,'LOCAL TIED PAGE '||n,'2026-10-18T00:00:00.123456+00:00'::timestamptz FROM generate_series(1,55) n;
 SELECT array_agg(p.id ORDER BY p.created_at DESC,p.id DESC) INTO page_ids FROM
  (SELECT id,created_at FROM public.chat_group_messages WHERE group_id=gp AND deleted_at IS NULL ORDER BY created_at DESC,id DESC LIMIT 50) p;
 SELECT id,created_at INTO cursor_id,cursor_time FROM public.chat_group_messages
  WHERE group_id=gp AND deleted_at IS NULL ORDER BY created_at DESC,id DESC OFFSET 49 LIMIT 1;
 SELECT count(*) INTO old_count FROM public.chat_group_messages WHERE group_id=gp AND deleted_at IS NULL AND created_at<cursor_time;
 IF old_count<>0 THEN RAISE EXCEPTION 'TIED_TIMESTAMP_REPRO_FIXTURE_DRIFT';END IF;
 SELECT array_agg(p.id ORDER BY p.created_at DESC,p.id DESC) INTO older_ids FROM
  (SELECT id,created_at FROM public.chat_group_messages WHERE group_id=gp AND deleted_at IS NULL
   AND (created_at<cursor_time OR (created_at=cursor_time AND id<cursor_id)) ORDER BY created_at DESC,id DESC LIMIT 50) p;
 IF cardinality(page_ids)<>50 OR cardinality(older_ids)<>5 OR page_ids&&older_ids
  OR (SELECT count(DISTINCT id) FROM unnest(page_ids||older_ids) id)<>55
  OR cursor_time<>'2026-10-18T00:00:00.123456+00:00'::timestamptz THEN RAISE EXCEPTION 'GROUP_COMPOSITE_PAGE_SKIPS_OR_DUPLICATES';END IF;
 PERFORM set_config('request.jwt.claim.sub',b::text,true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',b)::text,true);
 IF EXISTS(SELECT 1 FROM public.chat_group_messages WHERE group_id=gp) THEN RAISE EXCEPTION 'GROUP_COMPOSITE_PAGE_OUTSIDER_LEAK';END IF;
 PERFORM set_config('request.jwt.claim.sub',a::text,true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',a)::text,true);
 RAISE NOTICE 'GROUP_COMPOSITE_TIMESTAMP_UUID_55_ROWS_PRIVATE_RLS_NO_SKIPS_ROLLBACK_PASS';
 receipt:=public.soft_delete_chat_group_v1(gb);
 IF receipt->>'error' IS DISTINCT FROM 'group_delete_not_allowed' THEN RAISE EXCEPTION 'NON_CREATOR_GROUP_DELETE_ALLOWED: %',receipt;END IF;
 denied:=false;
 BEGIN
  UPDATE public.chat_group_members SET group_id=gb WHERE group_id=ga AND user_id=a;
 EXCEPTION WHEN insufficient_privilege OR check_violation THEN denied:=true;END;
 IF NOT denied THEN RAISE EXCEPTION 'GROUP_MEMBERSHIP_REPARENT_ALLOWED';END IF;
 UPDATE public.chat_group_members SET last_read_at=now()+interval '1 second' WHERE group_id=ga AND user_id=a;
 GET DIAGNOSTICS changed=ROW_COUNT;
 IF changed<>1 THEN RAISE EXCEPTION 'OWN_READ_MARKER_BLOCKED';END IF;
 -- No recipient exists yet, so this insert cannot enqueue external notifications.
 INSERT INTO public.chat_group_messages(id,group_id,sender_id,content) VALUES(ownmsg,ga,a,'OWN LOCAL TEST');
 denied:=false;
 BEGIN
  UPDATE public.chat_group_messages SET group_id=gb WHERE id=ownmsg;
 EXCEPTION WHEN insufficient_privilege OR check_violation THEN denied:=true;END;
 IF NOT denied THEN RAISE EXCEPTION 'GROUP_MESSAGE_REPARENT_ALLOWED';END IF;
 denied:=false;
 BEGIN
  UPDATE public.chat_group_messages SET sender_id=b WHERE id=ownmsg;
 EXCEPTION WHEN insufficient_privilege OR check_violation THEN denied:=true;END;
 IF NOT denied THEN RAISE EXCEPTION 'GROUP_MESSAGE_SENDER_REWRITE_ALLOWED';END IF;
 denied:=false;
 BEGIN
  UPDATE public.chat_group_messages SET content='REWRITTEN' WHERE id=ownmsg;
 EXCEPTION WHEN insufficient_privilege OR check_violation THEN denied:=true;END;
 IF NOT denied THEN RAISE EXCEPTION 'GROUP_MESSAGE_CONTENT_REWRITE_ALLOWED';END IF;
 denied:=false;
 BEGIN
  UPDATE public.chat_group_messages SET attachment_url='https://test.invalid/changed' WHERE id=ownmsg;
 EXCEPTION WHEN insufficient_privilege OR check_violation THEN denied:=true;END;
 IF NOT denied THEN RAISE EXCEPTION 'GROUP_MESSAGE_ATTACHMENT_REWRITE_ALLOWED';END IF;
 denied:=false;
 BEGIN
  INSERT INTO public.chat_group_messages(group_id,sender_id,content) VALUES(ga,b,'FORGED LOCAL TEST');
 EXCEPTION WHEN insufficient_privilege OR check_violation THEN denied:=true;END;
 IF NOT denied THEN RAISE EXCEPTION 'FORGED_GROUP_MESSAGE_INSERT_ALLOWED';END IF;
 UPDATE public.chat_group_messages SET deleted_at=now() WHERE id=ownmsg;
 GET DIAGNOSTICS changed=ROW_COUNT;
 IF changed<>1 THEN RAISE EXCEPTION 'OWN_SOFT_DELETE_BLOCKED';END IF;
 INSERT INTO public.chat_group_members(group_id,user_id) VALUES(ga,b);
 PERFORM set_config('request.jwt.claim.sub',b::text,true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',b)::text,true);
 IF NOT EXISTS(SELECT 1 FROM public.chat_groups WHERE id=ga) THEN RAISE EXCEPTION 'LEGITIMATE_MEMBER_CANNOT_READ';END IF;
 DELETE FROM public.chat_group_members WHERE group_id=ga AND user_id=b;
 IF EXISTS(SELECT 1 FROM public.chat_groups WHERE id=ga) THEN RAISE EXCEPTION 'LEFT_MEMBER_STILL_READS';END IF;
 PERFORM set_config('request.jwt.claim.sub',a::text,true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',a)::text,true);
 UPDATE public.chat_group_messages SET deleted_at=NULL WHERE id=ownmsg;
 receipt:=public.soft_delete_chat_group_v1(ga);
 IF receipt->>'outcome' IS DISTINCT FROM 'deleted' OR receipt->>'groupId' IS DISTINCT FROM ga::text THEN
  RAISE EXCEPTION 'OWNER_GROUP_DELETE_FAILED: %',receipt;END IF;
 again:=public.soft_delete_chat_group_v1(ga);
 IF again->>'outcome' IS DISTINCT FROM 'already_deleted' OR again->>'deletedAt' IS DISTINCT FROM receipt->>'deletedAt' THEN
  RAISE EXCEPTION 'GROUP_DELETE_REPLAY_CHANGED: %',again;END IF;
 denied:=false;
 BEGIN
  INSERT INTO public.chat_group_messages(group_id,sender_id,content) VALUES(ga,a,'AFTER DELETE');
 EXCEPTION WHEN insufficient_privilege OR check_violation THEN denied:=true;END;
 IF NOT denied THEN RAISE EXCEPTION 'DELETED_GROUP_STILL_ACCEPTS_MESSAGES';END IF;
 IF EXISTS(SELECT 1 FROM public.chat_group_messages WHERE id=ownmsg)
 OR public.is_group_member(a,ga) THEN RAISE EXCEPTION 'DELETED_GROUP_PRIVATE_ACCESS_REMAINS';END IF;
 PERFORM set_config('role','none',true);
 IF NOT EXISTS(SELECT 1 FROM public.chat_group_messages WHERE id=ownmsg AND deleted_at IS NOT NULL) THEN
  RAISE EXCEPTION 'SERVER_GROUP_SOFT_DELETE_CASCADE_BLOCKED';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.chat_group_members WHERE group_id=ga AND user_id=a) THEN
  RAISE EXCEPTION 'DELETION_DESTROYED_MEMBERSHIP_HISTORY';END IF;
 IF has_function_privilege('authenticated','public._group_message_client_update_guard_v1()','EXECUTE')
 OR has_function_privilege('anon','public._group_message_client_update_guard_v1()','EXECUTE') THEN
  RAISE EXCEPTION 'INTERNAL_MESSAGE_GUARD_EXPOSED';END IF;
 IF has_function_privilege('anon','public.soft_delete_chat_group_v1(uuid)','EXECUTE')
 OR has_function_privilege('service_role','public.soft_delete_chat_group_v1(uuid)','EXECUTE')
 OR NOT has_function_privilege('authenticated','public.soft_delete_chat_group_v1(uuid)','EXECUTE') THEN
  RAISE EXCEPTION 'GROUP_DELETE_RPC_ACL_FAILED';END IF;
END $$;
ROLLBACK;
SELECT 'GROUP_PRIVATE_RLS_MEMBERSHIP_MESSAGE_IDENTITY_READ_MARKER_SOFT_DELETE_ROLLBACK_PASS';
