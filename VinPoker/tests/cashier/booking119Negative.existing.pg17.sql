BEGIN;
SET LOCAL statement_timeout='10s';
DO $$ BEGIN
 IF current_database()<>'vinpoker_ops_cash115_qualified_c' OR host(inet_server_addr())<>'127.0.0.1' OR inet_server_port()<>55441
 OR NOT EXISTS(SELECT 1 FROM public.booking_chats c JOIN public.tournaments t ON t.id=c.tournament_id
  WHERE c.id='820180d4-e9ad-4684-b259-c399859e82e1' AND c.tournament_id='f811e882-0bf8-4bfa-b790-d0f8cf122ca4'
  AND c.player_id='a6b9e3c6-ce29-4ce9-851b-b3e7a8698dec' AND c.club_id='8e5239a5-36f2-4a0b-a0a3-cb7a236f51b2'
  AND c.status='open' AND t.name='Booking concurrent119 local TEST')
 THEN RAISE EXCEPTION 'booking119_retained_scope';END IF;
END $$;
SET LOCAL request.jwt.claim.role='authenticated';
SET LOCAL request.jwt.claim.sub='a6b9e3c6-ce29-4ce9-851b-b3e7a8698dec';
SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"a6b9e3c6-ce29-4ce9-851b-b3e7a8698dec"}';
SET LOCAL ROLE authenticated;
DO $$ DECLARE r jsonb; BEGIN
 BEGIN
  INSERT INTO public.booking_chats(tournament_id,club_id,player_id)
  VALUES('46cab483-91e7-4220-aacf-e17bdf05269c','8e5239a5-36f2-4a0b-a0a3-cb7a236f51b2',auth.uid());
  RAISE EXCEPTION 'booking119_crosslinked_club_allowed';
 EXCEPTION WHEN insufficient_privilege THEN IF SQLERRM NOT LIKE '%row-level security policy%' THEN RAISE;END IF;END;
 BEGIN
  UPDATE public.booking_chats SET payment_confirmed=true WHERE id='820180d4-e9ad-4684-b259-c399859e82e1';
  RAISE EXCEPTION 'booking119_payment_marker_update_allowed';
 EXCEPTION WHEN check_violation THEN IF SQLERRM<>'booking_identity_or_payment_marker_immutable' THEN RAISE;END IF;END;
 BEGIN
  UPDATE public.booking_chats SET tournament_id='46cab483-91e7-4220-aacf-e17bdf05269c' WHERE id='820180d4-e9ad-4684-b259-c399859e82e1';
  RAISE EXCEPTION 'booking119_tour_reassignment_allowed';
 EXCEPTION WHEN check_violation THEN IF SQLERRM<>'booking_identity_or_payment_marker_immutable' THEN RAISE;END IF;END;
END $$;
RESET ROLE;
-- Close as the existing authorized owner; this negative test does not define
-- whether a player may close their own thread or all metadata write semantics.
SET LOCAL request.jwt.claim.sub='f793a5b3-6025-4766-bc1b-49f16aa1b44a';
SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"f793a5b3-6025-4766-bc1b-49f16aa1b44a"}';
SET LOCAL ROLE authenticated;
UPDATE public.booking_chats SET status='closed',closed_by=auth.uid(),closed_at=clock_timestamp()
WHERE id='820180d4-e9ad-4684-b259-c399859e82e1';
RESET ROLE;
SET LOCAL request.jwt.claim.sub='a6b9e3c6-ce29-4ce9-851b-b3e7a8698dec';
SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"a6b9e3c6-ce29-4ce9-851b-b3e7a8698dec"}';
SET LOCAL ROLE authenticated;
DO $$ DECLARE r jsonb; BEGIN
 BEGIN
  INSERT INTO public.chat_messages(chat_id,sender_id,kind,content)
  VALUES('820180d4-e9ad-4684-b259-c399859e82e1',auth.uid(),'text','TEST closed chat denied');
  RAISE EXCEPTION 'booking119_closed_message_allowed';
 EXCEPTION WHEN insufficient_privilege THEN IF SQLERRM NOT LIKE '%row-level security policy%' THEN RAISE;END IF;END;
 r:=public.ensure_booking_chat_v1('f811e882-0bf8-4bfa-b790-d0f8cf122ca4');
 IF r->>'created'<>'false' OR r#>>'{chat,id}'<>'820180d4-e9ad-4684-b259-c399859e82e1'
 OR r#>>'{chat,status}'<>'closed' THEN RAISE EXCEPTION 'booking119_closed_chat_reopened_or_replaced';END IF;
END $$;
RESET ROLE;
ROLLBACK;
SELECT 'BOOKING119_CROSSCLUB_LINK_PAYMENT_MARKER_TOUR_REASSIGNMENT_CLOSED_MESSAGE_DENIED_EXISTING_CLOSED_NOT_REOPENED_ROLLBACK';
