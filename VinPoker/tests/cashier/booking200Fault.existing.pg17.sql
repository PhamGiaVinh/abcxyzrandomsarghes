BEGIN;
SET LOCAL statement_timeout='10s';
DO $$ BEGIN
 IF current_database()<>'vinpoker_ops_cash115_qualified_c' OR host(inet_server_addr())<>'127.0.0.1' OR inet_server_port()<>55441
 OR EXISTS(SELECT 1 FROM public.booking_chats WHERE tournament_id='d24e3aed-f125-4bc5-ab11-49836c435e30')
 OR to_regprocedure('public.test_booking200_welcome_fault()') IS NOT NULL THEN RAISE EXCEPTION 'booking200_fault_scope';END IF;
END $$;
CREATE FUNCTION public.test_booking200_welcome_fault() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.sender_id IS NULL THEN RAISE EXCEPTION 'TEST_BOOKING200_WELCOME_FAILURE';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER test_booking200_welcome_fault BEFORE INSERT ON public.chat_messages
FOR EACH ROW EXECUTE FUNCTION public.test_booking200_welcome_fault();
SET LOCAL request.jwt.claim.role='authenticated';
SET LOCAL request.jwt.claim.sub='a6b9e3c6-ce29-4ce9-851b-b3e7a8698dec';
SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"a6b9e3c6-ce29-4ce9-851b-b3e7a8698dec"}';
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN
  PERFORM public.ensure_booking_chat_v1('d24e3aed-f125-4bc5-ab11-49836c435e30');
  RAISE EXCEPTION 'booking200_expected_fault_missing';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'TEST_BOOKING200_WELCOME_FAILURE' THEN RAISE;END IF;END;
 IF EXISTS(SELECT 1 FROM public.booking_chats WHERE tournament_id='d24e3aed-f125-4bc5-ab11-49836c435e30')
 THEN RAISE EXCEPTION 'booking200_chat_survived_failed_welcome';END IF;
END $$;
RESET ROLE;
ROLLBACK;
SELECT 'BOOKING200_WELCOME_FAILURE_ROLLS_BACK_CHAT_CREATION_AND_TEST_TRIGGER';
