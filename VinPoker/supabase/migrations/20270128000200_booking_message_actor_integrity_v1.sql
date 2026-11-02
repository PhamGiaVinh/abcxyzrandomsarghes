BEGIN;
SET LOCAL lock_timeout='3s';
DO $guard$ BEGIN
 IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.chat_messages'::regclass)
 OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.booking_chats'::regclass)
 OR (SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename='chat_messages')<>2
 OR NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='chat_messages' AND policyname='Participants send messages' AND cmd='INSERT')
 OR NOT EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND tablename='booking_chats'
   AND indexname='booking_chats_tournament_id_player_id_key' AND indexdef LIKE 'CREATE UNIQUE INDEX%')
 OR to_regprocedure('public.ensure_booking_chat_v1(uuid)') IS NOT NULL
 THEN RAISE EXCEPTION 'booking200_catalog_precondition';END IF;
END $guard$;

-- Existing participant policy remains; this restrictive policy cannot widen it.
-- Bot/system messages are emitted only by the canonical server creation below.
CREATE POLICY booking_human_message_actor_v1 ON public.chat_messages AS RESTRICTIVE
FOR INSERT TO authenticated WITH CHECK (
 sender_id=(SELECT auth.uid()) AND kind IN('text','image')
 AND EXISTS(SELECT 1 FROM public.booking_chats bc JOIN public.tournaments t ON t.id=bc.tournament_id
   WHERE bc.id=chat_messages.chat_id AND bc.club_id=t.club_id AND bc.status='open')
);

CREATE POLICY booking_create_canonical_club_v1 ON public.booking_chats AS RESTRICTIVE
FOR INSERT TO authenticated WITH CHECK (
 EXISTS(SELECT 1 FROM public.tournaments t WHERE t.id=booking_chats.tournament_id AND t.club_id=booking_chats.club_id)
);

CREATE FUNCTION public.guard_booking_client_identity_v1() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF current_user IN('authenticated','anon') AND
  (NEW.id,NEW.tournament_id,NEW.club_id,NEW.player_id,NEW.registration_id,NEW.payment_confirmed)
  IS DISTINCT FROM
  (OLD.id,OLD.tournament_id,OLD.club_id,OLD.player_id,OLD.registration_id,OLD.payment_confirmed)
 THEN RAISE EXCEPTION 'booking_identity_or_payment_marker_immutable' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_booking_client_identity_v1() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER booking_client_identity_v1 BEFORE UPDATE ON public.booking_chats
FOR EACH ROW EXECUTE FUNCTION public.guard_booking_client_identity_v1();

CREATE FUNCTION public.ensure_booking_chat_v1(p_tournament_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid:=auth.uid();v_tour public.tournaments%ROWTYPE;v_club public.clubs%ROWTYPE;v_chat public.booking_chats%ROWTYPE;
BEGIN
 IF v_actor IS NULL THEN RAISE EXCEPTION 'booking_actor_required' USING ERRCODE='42501';END IF;
 SELECT * INTO v_tour FROM public.tournaments WHERE id=p_tournament_id AND deleted_at IS NULL FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'booking_tournament_unavailable' USING ERRCODE='42501';END IF;
 SELECT * INTO v_club FROM public.clubs WHERE id=v_tour.club_id AND status='approved' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'booking_club_unavailable' USING ERRCODE='42501';END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('booking_chat_v1:'||p_tournament_id::text||':'||v_actor::text,0));
 SELECT * INTO v_chat FROM public.booking_chats WHERE tournament_id=p_tournament_id AND player_id=v_actor;
 IF FOUND THEN
  IF v_chat.club_id IS DISTINCT FROM v_tour.club_id THEN RAISE EXCEPTION 'booking_existing_scope_mismatch' USING ERRCODE='23514';END IF;
  RETURN jsonb_build_object('ok',true,'created',false,'chat',to_jsonb(v_chat));
 END IF;
 -- Preserve current player-only creation semantics; staff open existing threads.
 IF v_club.owner_id=v_actor OR public.has_role(v_actor,'super_admin'::public.app_role)
 THEN RAISE EXCEPTION 'booking_player_creation_required' USING ERRCODE='42501';END IF;
 INSERT INTO public.booking_chats(tournament_id,club_id,player_id)
 VALUES(v_tour.id,v_club.id,v_actor) RETURNING * INTO v_chat;
 INSERT INTO public.chat_messages(chat_id,sender_id,kind,content)
 VALUES(v_chat.id,NULL,'system','Yêu cầu đặt chỗ: '||v_tour.name);
 IF v_club.bot_enabled THEN
  IF nullif(btrim(v_club.bot_qr_url),'') IS NOT NULL THEN
   INSERT INTO public.chat_messages(chat_id,sender_id,kind,content) VALUES(v_chat.id,NULL,'image',v_club.bot_qr_url);
  END IF;
  IF nullif(btrim(v_club.bot_welcome_message),'') IS NOT NULL THEN
   INSERT INTO public.chat_messages(chat_id,sender_id,kind,content) VALUES(v_chat.id,NULL,'text',btrim(v_club.bot_welcome_message));
  END IF;
 END IF;
 RETURN jsonb_build_object('ok',true,'created',true,'chat',to_jsonb(v_chat));
END $$;
REVOKE ALL ON FUNCTION public.ensure_booking_chat_v1(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.ensure_booking_chat_v1(uuid) TO authenticated;
COMMIT;
