-- CLI candidate20261018180741 ->165. LOCAL ONLY; retain historic use counters.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $$BEGIN
 IF to_regclass('public.chat_group_invite_accept_receipts_v2') IS NOT NULL
 OR to_regprocedure('public.accept_group_invite_v2(text,uuid)') IS NOT NULL
 OR EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20270128000165')
 OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='public.accept_group_invite(text)'::regprocedure
   AND proowner='postgres'::regrole AND prosecdef AND md5(replace(prosrc,chr(13),''))='b1d74e81162cefb6cdce34ff6ac48c47')
 THEN RAISE EXCEPTION 'group_invite165_drift_or_collision';END IF;
END $$;
CREATE TABLE public.chat_group_invite_accept_receipts_v2(
 actor_id uuid NOT NULL,request_id uuid NOT NULL,token_digest text NOT NULL,
 invite_id uuid NOT NULL,group_id uuid NOT NULL,membership_joined_at timestamptz NOT NULL,
 outcome text NOT NULL CHECK(outcome IN('joined','already_member')),accepted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(actor_id,request_id)
);
ALTER TABLE public.chat_group_invite_accept_receipts_v2 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.chat_group_invite_accept_receipts_v2 FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public._accept_group_invite_v2(p_token text,p_request uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid();receipt public.chat_group_invite_accept_receipts_v2%ROWTYPE;
 invite public.chat_group_invites%ROWTYPE;target public.chat_groups%ROWTYPE;member_stamp timestamptz;inserted integer;result_outcome text;
BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'group_invite_auth_required' USING ERRCODE='42501';END IF;
 IF p_token IS NULL OR length(p_token) NOT BETWEEN 1 AND 512 THEN RAISE EXCEPTION 'group_invite_invalid_token';END IF;
 IF p_request IS NOT NULL THEN
   PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text||':'||p_request::text,0));
   SELECT * INTO receipt FROM public.chat_group_invite_accept_receipts_v2 WHERE actor_id=actor AND request_id=p_request;
   IF FOUND THEN
     IF receipt.token_digest IS DISTINCT FROM md5(p_token) THEN RAISE EXCEPTION 'group_invite_request_conflict';END IF;
     SELECT * INTO target FROM public.chat_groups WHERE id=receipt.group_id FOR UPDATE;
     IF NOT FOUND OR target.deleted_at IS NOT NULL THEN
       RETURN jsonb_build_object('ok',false,'outcome','no_longer_member','request_id',p_request,'group_id',receipt.group_id);END IF;
     SELECT joined_at INTO member_stamp FROM public.chat_group_members WHERE group_id=receipt.group_id AND user_id=actor FOR UPDATE;
     IF NOT FOUND OR member_stamp IS DISTINCT FROM receipt.membership_joined_at THEN
       RETURN jsonb_build_object('ok',false,'outcome','no_longer_member','request_id',p_request,'group_id',receipt.group_id);END IF;
     RETURN jsonb_build_object('ok',true,'outcome','replayed','request_id',p_request,'group_id',receipt.group_id);
   END IF;
 END IF;
 SELECT * INTO invite FROM public.chat_group_invites WHERE token=p_token FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'group_invite_not_found';END IF;
 SELECT * INTO target FROM public.chat_groups WHERE id=invite.group_id FOR UPDATE;
 IF NOT FOUND OR target.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'group_invite_group_deleted';END IF;
 IF invite.revoked_at IS NOT NULL THEN RAISE EXCEPTION 'group_invite_revoked';END IF;
 IF invite.expires_at IS NOT NULL AND invite.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'group_invite_expired';END IF;
 IF invite.uses<0 OR invite.max_uses<0 THEN RAISE EXCEPTION 'group_invite_counter_invalid';END IF;
 SELECT joined_at INTO member_stamp FROM public.chat_group_members WHERE group_id=invite.group_id AND user_id=actor FOR UPDATE;
 IF FOUND THEN result_outcome:='already_member';
 ELSE
   IF invite.max_uses IS NOT NULL AND invite.uses>=invite.max_uses THEN RAISE EXCEPTION 'group_invite_exhausted';END IF;
   INSERT INTO public.chat_group_members(group_id,user_id,joined_at) VALUES(invite.group_id,actor,clock_timestamp())
     ON CONFLICT DO NOTHING RETURNING joined_at INTO member_stamp;
   GET DIAGNOSTICS inserted=ROW_COUNT;
   IF inserted=1 THEN
     UPDATE public.chat_group_invites SET uses=uses+1 WHERE id=invite.id;
     result_outcome:='joined';
   ELSE
     SELECT joined_at INTO member_stamp FROM public.chat_group_members WHERE group_id=invite.group_id AND user_id=actor FOR UPDATE;
     IF NOT FOUND THEN RAISE EXCEPTION 'group_invite_membership_unverified';END IF;
     result_outcome:='already_member';
   END IF;
 END IF;
 IF p_request IS NOT NULL THEN
   INSERT INTO public.chat_group_invite_accept_receipts_v2(actor_id,request_id,token_digest,invite_id,group_id,membership_joined_at,outcome)
   VALUES(actor,p_request,md5(p_token),invite.id,invite.group_id,member_stamp,result_outcome);
 END IF;
 RETURN jsonb_build_object('ok',true,'outcome',result_outcome,'request_id',p_request,'group_id',invite.group_id);
END $$;
REVOKE ALL ON FUNCTION public._accept_group_invite_v2(text,uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.accept_group_invite_v2(_token text,_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$BEGIN
 IF _request_id IS NULL THEN RAISE EXCEPTION 'group_invite_request_required';END IF;
 RETURN public._accept_group_invite_v2(_token,_request_id);
END $$;
REVOKE ALL ON FUNCTION public.accept_group_invite_v2(text,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.accept_group_invite_v2(text,uuid) TO authenticated;
CREATE OR REPLACE FUNCTION public.accept_group_invite(_token text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$DECLARE result jsonb;BEGIN
 result:=public._accept_group_invite_v2(_token,NULL);
 IF result->'ok' IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'group_invite_membership_unverified';END IF;
 RETURN (result->>'group_id')::uuid;
END $$;
REVOKE ALL ON FUNCTION public.accept_group_invite(text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.accept_group_invite(text) TO authenticated;
COMMIT;
