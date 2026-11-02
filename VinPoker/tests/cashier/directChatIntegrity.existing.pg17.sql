BEGIN;
SET LOCAL statement_timeout='10s';
-- Native managed-auth parity only; rolled back with all fixture writes.
GRANT USAGE ON SCHEMA auth TO authenticated;
DO $$
DECLARE a uuid:=gen_random_uuid();b uuid:=gen_random_uuid();outsider uuid:=gen_random_uuid();chat uuid:=gen_random_uuid();
BEGIN
  ASSERT current_database()='vinpoker_ops_cash115_qualified_c';
  IF a>b THEN SELECT b,a INTO a,b;END IF;
  ASSERT NOT public.has_role(a,'super_admin') AND NOT public.has_role(b,'super_admin') AND NOT public.has_role(outsider,'super_admin');
  INSERT INTO public.direct_chats(id,user_a,user_b,last_message_at)VALUES(chat,a,b,now()-interval '1 hour');
  PERFORM set_config('test.dm_a',a::text,true);PERFORM set_config('test.dm_b',b::text,true);
  PERFORM set_config('test.dm_outsider',outsider::text,true);PERFORM set_config('test.dm_chat',chat::text,true);
END $$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',current_setting('test.dm_a'),true);
SELECT set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',current_setting('test.dm_a'))::text,true);
DO $$
DECLARE chat uuid:=current_setting('test.dm_chat')::uuid;a uuid:=current_setting('test.dm_a')::uuid;
  replacement uuid;changed int;message uuid:=gen_random_uuid();
BEGIN
  INSERT INTO public.direct_messages(id,chat_id,sender_id,kind,content)VALUES(message,chat,a,'text','LOCAL DM rollback private message');
  BEGIN
    INSERT INTO public.direct_messages(id,chat_id,sender_id,kind,content)VALUES(message,chat,a,'text','LOCAL DM rollback private message');
    RAISE EXCEPTION 'DM_SAME_ID_REPLAY_INSERTED_TWICE';
  EXCEPTION WHEN unique_violation THEN NULL;END;
  BEGIN
    INSERT INTO public.direct_messages(id,chat_id,sender_id,kind,content)VALUES(message,chat,a,'text','LOCAL conflicting payload');
    RAISE EXCEPTION 'DM_SAME_ID_CHANGED_PAYLOAD_REPLACED';
  EXCEPTION WHEN unique_violation THEN NULL;END;
  ASSERT (SELECT content FROM public.direct_messages WHERE id=message AND chat_id=chat AND sender_id=a)='LOCAL DM rollback private message','same-id conflict changed original message';
  PERFORM set_config('test.dm_message',message::text,true);
  ASSERT (SELECT count(*) FROM public.direct_messages WHERE chat_id=chat)=1,'participant message read failed';
  ASSERT (SELECT last_message_at=now() FROM public.direct_chats WHERE id=chat),'server bump was blocked';
  UPDATE public.direct_chats SET user_a_last_read_at=now() WHERE id=chat;
  GET DIAGNOSTICS changed=ROW_COUNT;ASSERT changed=1,'own read marker failed';
  -- Keep UUID order valid to avoid a constraint giving false security confidence.
  replacement:=('ffffffff-ffff-ffff-ffff-'||substr(replace(gen_random_uuid()::text,'-',''),1,12))::uuid;
  BEGIN
    UPDATE public.direct_chats SET user_b=replacement WHERE id=chat;
    RAISE EXCEPTION 'DM_MEMBERSHIP_REWRITE_ALLOWED';
  EXCEPTION WHEN insufficient_privilege THEN NULL;END;
  BEGIN
    UPDATE public.direct_chats SET user_b_last_read_at=now()+interval '1 day' WHERE id=chat;
    RAISE EXCEPTION 'DM_OTHER_PARTICIPANT_READ_MARKER_ALLOWED';
  EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END $$;
SELECT jsonb_build_object('local_dm_receipt',(SELECT to_jsonb(m) FROM public.direct_messages m
  WHERE m.id=current_setting('test.dm_message')::uuid AND m.chat_id=current_setting('test.dm_chat')::uuid
    AND m.sender_id=current_setting('test.dm_a')::uuid));
SELECT set_config('request.jwt.claim.sub',current_setting('test.dm_b'),true);
SELECT set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',current_setting('test.dm_b'))::text,true);
DO $$
DECLARE chat uuid:=current_setting('test.dm_chat')::uuid;b uuid:=current_setting('test.dm_b')::uuid;changed int;
BEGIN
  ASSERT (SELECT count(*) FROM public.direct_messages WHERE chat_id=chat)=1,'recipient cannot read';
  UPDATE public.direct_chats SET user_b_last_read_at=now() WHERE id=chat;
  GET DIAGNOSTICS changed=ROW_COUNT;ASSERT changed=1,'recipient own read marker failed';
  BEGIN
    INSERT INTO public.direct_messages(chat_id,sender_id,content)VALUES(chat,current_setting('test.dm_a')::uuid,'LOCAL forged sender');
    RAISE EXCEPTION 'forged sender accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;END;
  INSERT INTO public.direct_messages(chat_id,sender_id,content)VALUES(chat,b,'LOCAL DM reply');
  ASSERT (SELECT count(*) FROM public.direct_messages WHERE chat_id=chat)=2,'recipient reply failed';
END $$;
SELECT set_config('request.jwt.claim.sub',current_setting('test.dm_outsider'),true);
SELECT set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',current_setting('test.dm_outsider'))::text,true);
DO $$
DECLARE chat uuid:=current_setting('test.dm_chat')::uuid;outsider uuid:=current_setting('test.dm_outsider')::uuid;
BEGIN
  ASSERT (SELECT count(*) FROM public.direct_chats WHERE id=chat)=0,'outsider sees chat';
  ASSERT (SELECT count(*) FROM public.direct_messages WHERE chat_id=chat)=0,'outsider sees messages';
  BEGIN
    INSERT INTO public.direct_messages(chat_id,sender_id,content)VALUES(chat,outsider,'LOCAL denied');
    RAISE EXCEPTION 'outsider message inserted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END $$;
ROLLBACK;
SELECT 'DIRECT_MESSAGE_CLIENT_ID_REPLAY_RLS_ROLLBACK_PASS';
