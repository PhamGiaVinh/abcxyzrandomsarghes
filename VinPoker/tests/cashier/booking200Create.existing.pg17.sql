BEGIN;
SET LOCAL statement_timeout='10s';
DO $guard$ BEGIN
 IF current_database()<>'vinpoker_ops_cash115_qualified_c' OR host(inet_server_addr())<>'127.0.0.1' OR inet_server_port()<>55441
 OR EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_net')
 OR EXISTS(SELECT 1 FROM public.booking_chats WHERE tournament_id='d24e3aed-f125-4bc5-ab11-49836c435e30')
 THEN RAISE EXCEPTION 'booking200_test_scope';END IF;
END $guard$;
UPDATE public.clubs SET bot_enabled=true,bot_qr_url='https://example.invalid/TEST-only-qr.png',bot_welcome_message='TEST Booking200 welcome'
WHERE id='8e5239a5-36f2-4a0b-a0a3-cb7a236f51b2';
SET LOCAL request.jwt.claim.role='authenticated';
SET LOCAL request.jwt.claim.sub='a6b9e3c6-ce29-4ce9-851b-b3e7a8698dec';
SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"a6b9e3c6-ce29-4ce9-851b-b3e7a8698dec"}';
SET LOCAL ROLE authenticated;
DO $player$ DECLARE first jsonb;again jsonb; c uuid; BEGIN
 first:=public.ensure_booking_chat_v1('d24e3aed-f125-4bc5-ab11-49836c435e30');
 IF first->>'ok'<>'true' OR first->>'created'<>'true' OR first#>>'{chat,player_id}'<>auth.uid()::text
 OR first#>>'{chat,club_id}'<>'8e5239a5-36f2-4a0b-a0a3-cb7a236f51b2' THEN RAISE EXCEPTION 'booking200_create %',first;END IF;
 c:=(first#>>'{chat,id}')::uuid;
 again:=public.ensure_booking_chat_v1('d24e3aed-f125-4bc5-ab11-49836c435e30');
 IF again->>'created'<>'false' OR (again#>>'{chat,id}')::uuid<>c THEN RAISE EXCEPTION 'booking200_replay';END IF;
 IF (SELECT count(*) FROM public.chat_messages WHERE chat_id=c AND sender_id IS NULL)<>3 THEN RAISE EXCEPTION 'booking200_welcome_once';END IF;
 INSERT INTO public.chat_messages(chat_id,sender_id,kind,content) VALUES(c,auth.uid(),'text','TEST valid player message');
 BEGIN
  INSERT INTO public.chat_messages(chat_id,sender_id,kind,content) VALUES(c,NULL,'system','TEST fake paid bot');
  RAISE EXCEPTION 'booking200_fake_bot_allowed';
 EXCEPTION WHEN insufficient_privilege THEN IF SQLERRM NOT LIKE '%row-level security policy%' THEN RAISE;END IF;END;
 BEGIN
  INSERT INTO public.chat_messages(chat_id,sender_id,kind,content) VALUES(c,auth.uid(),'system','TEST fake system kind');
  RAISE EXCEPTION 'booking200_system_kind_allowed';
 EXCEPTION WHEN insufficient_privilege THEN IF SQLERRM NOT LIKE '%row-level security policy%' THEN RAISE;END IF;END;
 BEGIN
  UPDATE public.booking_chats SET player_id='44791b41-77f8-43fd-8634-9947ef069f87' WHERE id=c;
  RAISE EXCEPTION 'booking200_identity_update_allowed';
 EXCEPTION WHEN check_violation THEN IF SQLERRM<>'booking_identity_or_payment_marker_immutable' THEN RAISE;END IF;END;
END $player$;
RESET ROLE;
SET LOCAL request.jwt.claim.sub='f793a5b3-6025-4766-bc1b-49f16aa1b44a';
SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"f793a5b3-6025-4766-bc1b-49f16aa1b44a"}';
SET LOCAL ROLE authenticated;
DO $owner$ BEGIN
 BEGIN
  PERFORM public.ensure_booking_chat_v1('d24e3aed-f125-4bc5-ab11-49836c435e30');
  RAISE EXCEPTION 'booking200_owner_create_allowed';
 EXCEPTION WHEN insufficient_privilege THEN IF SQLERRM<>'booking_player_creation_required' THEN RAISE;END IF;END;
END $owner$;
RESET ROLE;
SET LOCAL request.jwt.claim.sub='';
SET LOCAL request.jwt.claims='{"role":"anon"}';
SET LOCAL ROLE anon;
DO $anon$ BEGIN
 BEGIN
  PERFORM public.ensure_booking_chat_v1('d24e3aed-f125-4bc5-ab11-49836c435e30');
  RAISE EXCEPTION 'booking200_anon_execute_allowed';
 EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END $anon$;
RESET ROLE;
ROLLBACK;
SELECT 'BOOKING200_CANONICAL_PLAYER_CREATE_TRUSTED_WELCOME_ONCE_REPLAY_NULL_SYSTEM_FORGERY_IDENTITY_UPDATE_OWNER_CREATE_ANON_DENIED_ROLLBACK';
