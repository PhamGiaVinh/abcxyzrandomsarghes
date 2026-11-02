-- Existing opted-in paid TEST registration only; not legacy-path acceptance.
BEGIN;
SET LOCAL statement_timeout='15s';
SET LOCAL lock_timeout='3s';
DO $$ BEGIN
 IF current_database()<>'vinpoker_ops_cash115_qualified_c'
 OR current_setting('data_directory')<>'/tmp/vinpoker-sol-local-20261016-0e79a729/data'
 OR inet_server_port()<>55441 OR EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_net')
 OR NOT EXISTS(SELECT 1 FROM public.tournament_registrations WHERE id='39b9d553-f5b2-4d50-8cfc-4d138fd77cbc'
  AND tournament_id='46cab483-91e7-4220-aacf-e17bdf05269c' AND player_id='533feda3-28c5-4194-bdf3-53a07c41305b'
  AND status='confirmed' AND total_pay=100000)
 THEN RAISE EXCEPTION 'retained_registration_local_scope_required';END IF;
END $$;
CREATE TEMP VIEW retained_registration_state AS SELECT md5(jsonb_build_object(
 'tour',(SELECT to_jsonb(t) FROM public.tournaments t WHERE id='46cab483-91e7-4220-aacf-e17bdf05269c'),
 'registrations',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.tournament_registrations r WHERE tournament_id='46cab483-91e7-4220-aacf-e17bdf05269c'),
 'movements',(SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM public.cashier_buyin_movements m WHERE tournament_id='46cab483-91e7-4220-aacf-e17bdf05269c'),
 'prizes',(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM public.tournament_prize_payments p WHERE tournament_id='46cab483-91e7-4220-aacf-e17bdf05269c'))::text) fingerprint;
CREATE TEMP TABLE registration_before AS SELECT * FROM retained_registration_state;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SET LOCAL ROLE service_role;
CREATE TEMP TABLE registration_retry AS SELECT public.cashier_create_app_registration_v1(
 '46cab483-91e7-4220-aacf-e17bdf05269c','533feda3-28c5-4194-bdf3-53a07c41305b') result;
RESET ROLE;
DO $$ DECLARE r jsonb; BEGIN
 SELECT result INTO r FROM registration_retry;
 IF r->>'ok'<>'true' OR r->>'already_registered'<>'true'
 OR r->>'registration_id'<>'39b9d553-f5b2-4d50-8cfc-4d138fd77cbc'
 OR (r->>'total_pay')::bigint<>100000 THEN RAISE EXCEPTION 'canonical_existing_retry_changed_receipt: %',r;END IF;
 IF (SELECT fingerprint FROM registration_before) IS DISTINCT FROM (SELECT fingerprint FROM retained_registration_state)
 THEN RAISE EXCEPTION 'canonical_existing_retry_changed_state';END IF;
END $$;
SELECT 'RETAINED_OPTED_IN_REGISTRATION_RETRY_FROZEN_RECEIPT_NO_DELTA_PASS';
ROLLBACK;
