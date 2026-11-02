\set ON_ERROR_STOP on
DO $$ BEGIN
 ASSERT current_database()='vinpoker_checkout814_race_local' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 ASSERT (SELECT shobj_description(oid,'pg_database')='VINPOKER_CHECKOUT814_OWNED_LOCAL_CLONE_SOURCE_vinpoker_fnb719_gate_local_HEAD_ef6a26948' FROM pg_database WHERE datname=current_database());
 ASSERT NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname IN('pg_net','pg_cron','dblink'));
END $$;
CREATE TEMP VIEW swing830_business AS SELECT md5(jsonb_build_array(
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.dealer_assignments x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.dealer_attendance x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.dealer_breaks x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.dealer_rotation_schedule x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.audit_logs x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.dealer_payroll x)
)::text) value;
CREATE TEMP TABLE swing830_before AS SELECT value,
 (SELECT md5(coalesce(jsonb_agg(to_jsonb(r) ORDER BY club_id,request_id)::text,'null')) FROM public.dealer_swing_operator_requests r) receipts
 FROM swing830_business;
CREATE TEMP TABLE swing830_catalog AS SELECT pg_get_functiondef(oid) definition,proowner,proacl,proconfig
 FROM pg_proc WHERE oid='public.perform_swing(uuid,integer,boolean,integer,integer,integer,uuid,integer)'::regprocedure;
BEGIN;
SET LOCAL statement_timeout='15s'; SET LOCAL lock_timeout='3s';
CREATE FUNCTION pg_temp.swing830_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.table_id='53637b3a-b553-472f-830d-6e7ede661f6f' THEN
  RAISE EXCEPTION 'SWING830_INJECTED_ACQUISITION_FAILURE';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER swing830_fault BEFORE INSERT ON public.dealer_assignments FOR EACH ROW EXECUTE FUNCTION pg_temp.swing830_fault();
SET LOCAL request.jwt.claim.sub='febf2b51-fdb7-42ff-886c-b3bb1fffdc3e';
SET LOCAL request.jwt.claim.role='authenticated';
SET LOCAL request.jwt.claims='{"sub":"febf2b51-fdb7-42ff-886c-b3bb1fffdc3e","role":"authenticated"}';
SET LOCAL ROLE authenticated;
DO $$ DECLARE result jsonb; receipt jsonb; cancellation jsonb; replay jsonb;
 actor uuid:='febf2b51-fdb7-42ff-886c-b3bb1fffdc3e'; club uuid:='d4427834-5f5f-48ef-bde5-e2dc388ed00b';
 physical uuid:='53637b3a-b553-472f-830d-6e7ede661f6f'; session uuid:='697d9aed-5faa-4a53-a193-2caa4a849e27';
 assignment uuid:='e5991944-e849-4e32-8076-fc1e4432587f'; request uuid:=gen_random_uuid();
BEGIN
 result:=public.operator_perform_swing_v2(actor,club,physical,session,assignment,0,request);
 ASSERT result->>'outcome'='error' AND result->>'detail'='SWING830_INJECTED_ACQUISITION_FAILURE',result::text;
 receipt:=public.get_dealer_manual_swing_receipt_v1(actor,club,physical,session,assignment,0,request);
 ASSERT receipt->>'status'='receipt_found' AND receipt->'response'=result,receipt::text;
 cancellation:=public.cancel_dealer_manual_swing_v1(actor,club,physical,session,assignment,0,request);
 ASSERT cancellation=receipt,'cancellation must preserve the immutable error, not invent cancellation';
 replay:=public.operator_perform_swing_v2(actor,club,physical,session,assignment,0,request);
 ASSERT replay-'idempotent'=result AND replay->>'idempotent'='true',replay::text;
 RAISE NOTICE 'SWING830_NATIVE_ERROR_RECEIPT_CANCEL_AND_REPLAY_MATCH';
END $$;
RESET ROLE;
DO $$ BEGIN
 ASSERT (SELECT current_state='assigned' FROM public.dealer_attendance WHERE id='370628c3-d453-4e0e-8f90-1d9c6827cde8'),
  'SWING830_ERROR_LEFT_OUTGOING_IN_TRANSITION';
 ASSERT (SELECT b.value=f.value FROM swing830_before b CROSS JOIN swing830_business f),'error receipt must not change business facts';
 ASSERT (SELECT count(*) FROM public.dealer_swing_operator_requests)=(SELECT count(*) FROM public.dealer_swing_operator_requests WHERE response IS DISTINCT FROM jsonb_build_object('outcome','error','detail','SWING830_INJECTED_ACQUISITION_FAILURE','sqlstate','P0001'))+1;
END $$;
DROP TRIGGER swing830_fault ON public.dealer_assignments;
SAVEPOINT positive830;
SET LOCAL ROLE authenticated;
DO $$ DECLARE result jsonb; BEGIN
 result:=public.operator_perform_swing_v2('febf2b51-fdb7-42ff-886c-b3bb1fffdc3e','d4427834-5f5f-48ef-bde5-e2dc388ed00b',
  '53637b3a-b553-472f-830d-6e7ede661f6f','697d9aed-5faa-4a53-a193-2caa4a849e27','e5991944-e849-4e32-8076-fc1e4432587f',0,gen_random_uuid());
 ASSERT result->>'outcome'='swung',result::text;
 ASSERT EXISTS(SELECT 1 FROM public.dealer_assignments WHERE id=(result->>'new_assignment_id')::uuid
  AND table_session_id='697d9aed-5faa-4a53-a193-2caa4a849e27' AND status='assigned' AND released_at IS NULL);
 ASSERT EXISTS(SELECT 1 FROM public.dealer_assignments WHERE id='e5991944-e849-4e32-8076-fc1e4432587f' AND status='completed' AND released_at IS NOT NULL);
 RAISE NOTICE 'SWING830_POSITIVE_CANONICAL_HANDOFF_STILL_WORKS';
END $$;
ROLLBACK TO SAVEPOINT positive830;
RESET ROLE;
ROLLBACK;
DO $$ BEGIN
 ASSERT (SELECT b.value=f.value FROM swing830_before b CROSS JOIN swing830_business f);
 ASSERT (SELECT receipts FROM swing830_before)=(SELECT md5(coalesce(jsonb_agg(to_jsonb(r) ORDER BY club_id,request_id)::text,'null')) FROM public.dealer_swing_operator_requests r);
 ASSERT NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='swing830_fault');
 ASSERT EXISTS(SELECT 1 FROM swing830_catalog b JOIN pg_proc p ON p.oid='public.perform_swing(uuid,integer,boolean,integer,integer,integer,uuid,integer)'::regprocedure
  WHERE b.definition=pg_get_functiondef(p.oid) AND b.proowner=p.proowner AND b.proacl IS NOT DISTINCT FROM p.proacl AND b.proconfig IS NOT DISTINCT FROM p.proconfig);
 ASSERT (SELECT auto_swing_enabled=false FROM public.club_settings WHERE club_id='d4427834-5f5f-48ef-bde5-e2dc388ed00b');
END $$;
SELECT 'SWING830_TERMINAL_ERROR_CONTRACT_AUTHENTICATED_NATIVE_FULL_ROLLBACK_PASS';
