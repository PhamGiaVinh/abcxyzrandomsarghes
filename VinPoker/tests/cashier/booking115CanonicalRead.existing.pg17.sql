BEGIN;
SET LOCAL statement_timeout='10s';
DO $guard$ BEGIN
 IF current_database()<>'vinpoker_ops_cash115_qualified_c' OR host(inet_server_addr())<>'127.0.0.1' OR inet_server_port()<>55441
 OR EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_net')
 OR EXISTS(SELECT 1 FROM public.booking_chats WHERE tournament_id='d24e3aed-f125-4bc5-ab11-49836c435e30')
 OR NOT EXISTS(SELECT 1 FROM public.tournaments t JOIN public.clubs c ON c.id=t.club_id
   JOIN public.tournament_registrations r ON r.tournament_id=t.id
   WHERE t.id='d24e3aed-f125-4bc5-ab11-49836c435e30' AND c.id='8e5239a5-36f2-4a0b-a0a3-cb7a236f51b2'
   AND c.owner_id='f793a5b3-6025-4766-bc1b-49f16aa1b44a' AND r.id='0b14549a-b6d7-4e00-9487-125cdfb575b1'
   AND r.player_id='a6b9e3c6-ce29-4ce9-851b-b3e7a8698dec')
 THEN RAISE EXCEPTION 'booking115_retained_scope';END IF;
END $guard$;
SELECT set_config('test.booking115_id',gen_random_uuid()::text,true);
-- booking_chats.registration_id is a legacy stack_registrations FK, not a
-- canonical tournament_registrations ID. Never repurpose it in this bridge.
INSERT INTO public.booking_chats(id,tournament_id,club_id,player_id,archived_at)
VALUES(current_setting('test.booking115_id')::uuid,'d24e3aed-f125-4bc5-ab11-49836c435e30',
 '8e5239a5-36f2-4a0b-a0a3-cb7a236f51b2','a6b9e3c6-ce29-4ce9-851b-b3e7a8698dec','2026-10-18T00:00:00Z');
SET LOCAL request.jwt.claim.sub='f793a5b3-6025-4766-bc1b-49f16aa1b44a';
SET LOCAL request.jwt.claim.role='authenticated';
SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"f793a5b3-6025-4766-bc1b-49f16aa1b44a"}';
SET LOCAL ROLE authenticated;
DO $owner$ DECLARE v jsonb; closed public.booking_chats%ROWTYPE; affected integer; BEGIN
 IF (SELECT count(*) FROM public.tournament_registrations
   WHERE player_id='a6b9e3c6-ce29-4ce9-851b-b3e7a8698dec' AND tournament_id='d24e3aed-f125-4bc5-ab11-49836c435e30'
   AND club_id='8e5239a5-36f2-4a0b-a0a3-cb7a236f51b2')<>1 THEN RAISE EXCEPTION 'booking115_owner_canonical_read';END IF;
 v:=public.cashier_tour_worklist_v1('8e5239a5-36f2-4a0b-a0a3-cb7a236f51b2','d24e3aed-f125-4bc5-ab11-49836c435e30','0b14549a-b6d7-4e00-9487-125cdfb575b1','all',0,50);
 IF v->>'ok'<>'true' OR jsonb_array_length(v->'rows')<>1
   OR v#>>'{rows,0,id}'<>'0b14549a-b6d7-4e00-9487-125cdfb575b1'
   OR v#>>'{rows,0,tournament_id}'<>'d24e3aed-f125-4bc5-ab11-49836c435e30'
   OR (v#>>'{rows,0,received}')::numeric<>100000
 THEN RAISE EXCEPTION 'booking115_exact_registration_worklist %',v;END IF;
 v:=public.cashier_tour_worklist_v1('a8e7d1b7-fdaa-45ad-b0a1-f894b6315760','d24e3aed-f125-4bc5-ab11-49836c435e30','0b14549a-b6d7-4e00-9487-125cdfb575b1','all',0,50);
 IF v->>'ok' IS DISTINCT FROM 'false' THEN RAISE EXCEPTION 'booking115_cross_club';END IF;
 UPDATE public.booking_chats SET archived_at=NULL WHERE id=current_setting('test.booking115_id')::uuid
 AND tournament_id='d24e3aed-f125-4bc5-ab11-49836c435e30' AND club_id='8e5239a5-36f2-4a0b-a0a3-cb7a236f51b2'
 AND archived_at='2026-10-17T00:00:00Z';
 GET DIAGNOSTICS affected=ROW_COUNT;
 IF affected<>0 THEN RAISE EXCEPTION 'booking117_unarchive_stale';END IF;
 UPDATE public.booking_chats SET archived_at=NULL WHERE id=current_setting('test.booking115_id')::uuid
 AND tournament_id='d24e3aed-f125-4bc5-ab11-49836c435e30' AND club_id='8e5239a5-36f2-4a0b-a0a3-cb7a236f51b2'
 AND archived_at='2026-10-18T00:00:00Z' RETURNING * INTO closed;
 IF NOT FOUND OR closed.id<>current_setting('test.booking115_id')::uuid OR closed.archived_at IS NOT NULL THEN RAISE EXCEPTION 'booking117_unarchive_ack';END IF;
 INSERT INTO public.chat_messages(chat_id,sender_id,kind,content)
 VALUES(current_setting('test.booking115_id')::uuid,auth.uid(),'text','TEST Booking117 canonical participant');
 BEGIN
  INSERT INTO public.chat_messages(chat_id,sender_id,kind,content)
  VALUES(current_setting('test.booking115_id')::uuid,'44791b41-77f8-43fd-8634-9947ef069f87','text','TEST Booking117 forged sender');
  RAISE EXCEPTION 'booking117_sender_forgery_allowed';
 EXCEPTION WHEN insufficient_privilege THEN
  IF SQLERRM NOT LIKE '%row-level security policy%' THEN RAISE;END IF;
 END;
 UPDATE public.booking_chats SET status='closed',closed_by=auth.uid(),closed_at=clock_timestamp()
 WHERE id=current_setting('test.booking115_id')::uuid AND tournament_id='d24e3aed-f125-4bc5-ab11-49836c435e30'
 AND club_id='8e5239a5-36f2-4a0b-a0a3-cb7a236f51b2' AND status='open' RETURNING * INTO closed;
 IF NOT FOUND OR closed.status<>'closed' OR closed.payment_confirmed OR closed.registration_id IS NOT NULL THEN RAISE EXCEPTION 'booking115_close_ack';END IF;
 UPDATE public.booking_chats SET status='closed',closed_by=auth.uid(),closed_at=clock_timestamp()
 WHERE id=current_setting('test.booking115_id')::uuid AND status='open';
 GET DIAGNOSTICS affected=ROW_COUNT;
 IF affected<>0 THEN RAISE EXCEPTION 'booking115_close_replay';END IF;
END $owner$;
RESET ROLE;
-- A different real player may read their own participation, not this player's row.
SET LOCAL request.jwt.claim.sub='44791b41-77f8-43fd-8634-9947ef069f87';
SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"44791b41-77f8-43fd-8634-9947ef069f87"}';
SET LOCAL ROLE authenticated;
DO $outsider$ DECLARE v jsonb; BEGIN
 IF EXISTS(SELECT 1 FROM public.tournament_registrations WHERE id='0b14549a-b6d7-4e00-9487-125cdfb575b1') THEN RAISE EXCEPTION 'booking115_other_player_read';END IF;
 v:=public.cashier_tour_worklist_v1('8e5239a5-36f2-4a0b-a0a3-cb7a236f51b2','d24e3aed-f125-4bc5-ab11-49836c435e30','0b14549a-b6d7-4e00-9487-125cdfb575b1','all',0,50);
 IF v->>'ok' IS DISTINCT FROM 'false' THEN RAISE EXCEPTION 'booking115_other_player_cashier';END IF;
 IF EXISTS(SELECT 1 FROM public.chat_messages WHERE chat_id=current_setting('test.booking115_id')::uuid) THEN RAISE EXCEPTION 'booking117_other_player_message_read';END IF;
 BEGIN
  INSERT INTO public.chat_messages(chat_id,sender_id,kind,content)
  VALUES(current_setting('test.booking115_id')::uuid,auth.uid(),'text','TEST Booking117 outsider');
  RAISE EXCEPTION 'booking117_outsider_message_allowed';
 EXCEPTION WHEN insufficient_privilege THEN
  IF SQLERRM NOT LIKE '%row-level security policy%' THEN RAISE;END IF;
 END;
END $outsider$;
RESET ROLE;
ROLLBACK;
SELECT 'BOOKING115_ACTUAL_RLS_OWNER_READ_EXACT_CASHIER_TARGET_CHAT_ONLY_CLOSE_ACK_REPLAY_ZERO_OTHER_PLAYER_AND_CROSS_CLUB_DENIED_ROLLBACK';
SELECT 'BOOKING117_ACTUAL_UNARCHIVE_SCOPE_TIMESTAMP_CAS_MESSAGE_OWNER_POSITIVE_FORGED_SENDER_AND_OUTSIDER_DENIED_ROLLBACK';
