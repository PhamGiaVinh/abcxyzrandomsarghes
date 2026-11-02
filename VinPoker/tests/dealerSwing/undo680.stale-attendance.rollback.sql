\set ON_ERROR_STOP on
-- Cross-domain boundary: an old web-linked Dealer attendance cannot be reused
-- to manufacture today's Undo assignment. This is NOT positive Undo acceptance.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='15s';
DO $$ DECLARE
 club uuid:='a8e7d1b7-fdaa-45ad-b0a1-f894b6315760';
 actor uuid:='675fe35e-60a8-4452-bb90-e79486d54da6';
 attendance uuid:='592a1d69-3e2c-4a07-aa7a-8a77a7907f5f';
 sess uuid:='ee2b9393-0c96-42f9-8667-7f306edeb9bc';
 physical uuid; before_facts jsonb; after_facts jsonb; r jsonb; rejected boolean:=false;
BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c';
 ASSERT inet_server_addr()='127.0.0.1'::inet AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 ASSERT NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_net');
 ASSERT EXISTS(SELECT 1 FROM public.clubs WHERE id=club AND owner_id=actor);
 ASSERT EXISTS(SELECT 1 FROM public.dealer_attendance a JOIN public.dealers d ON d.id=a.dealer_id
  WHERE a.id=attendance AND a.status='checked_in' AND a.current_state='available'
   AND a.check_out_time IS NULL AND d.user_id=actor AND d.club_id=club
   AND a.shift_date<(statement_timestamp() AT TIME ZONE 'Asia/Bangkok')::date-1);
 ASSERT NOT floor_private.dealer_pool_attendance_matches_v1(
  'e836277e-eb94-4118-87a2-38a4a86eda16',club,statement_timestamp());
 SELECT game_table_id INTO physical FROM public.table_sessions
  WHERE id=sess AND club_id=club AND closed_at IS NULL AND control_mode='tracker' AND control_epoch=12;
 ASSERT physical IS NOT NULL;
 ASSERT NOT EXISTS(SELECT 1 FROM public.dealer_assignments WHERE table_id=physical AND released_at IS NULL
  AND status IN('assigned','on_break','pre_assigned','reserved'));
 SELECT jsonb_build_object('attendance',(SELECT to_jsonb(a) FROM public.dealer_attendance a WHERE id=attendance),
  'assignments',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.dealer_assignments a WHERE club_id=club),
  'receipts',(SELECT jsonb_agg(to_jsonb(receipt_row) ORDER BY request_key) FROM floor_private.dealer_initial_assign_receipts receipt_row)) INTO before_facts;
 PERFORM set_config('request.headers',jsonb_build_object('x-vinpoker-dealer-intent','manual','x-vinpoker-dealer-actor',actor)::text,true);
 PERFORM set_config('request.jwt.claim.role','service_role',true);
 PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);
 PERFORM set_config('role','service_role',true);
 ASSERT NOT EXISTS(SELECT 1 FROM public.get_dealer_pool_eligible_attendance_v1(club,ARRAY[attendance]));
 BEGIN
  r:=public.worker_assign_dealer_to_session_v1(club,physical,sess,attendance,
   statement_timestamp()+interval '45 minutes','undo680-stale-attendance-rollback');
  RAISE EXCEPTION 'stale attendance acquisition must reject, got %',r;
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM<>'DEALER_ACQUISITION_ATTENDANCE_STALE' THEN RAISE; END IF;
  rejected:=true;
 END;
 ASSERT rejected;
 PERFORM set_config('role','none',true);
 SELECT jsonb_build_object('attendance',(SELECT to_jsonb(a) FROM public.dealer_attendance a WHERE id=attendance),
  'assignments',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.dealer_assignments a WHERE club_id=club),
  'receipts',(SELECT jsonb_agg(to_jsonb(receipt_row) ORDER BY request_key) FROM floor_private.dealer_initial_assign_receipts receipt_row)) INTO after_facts;
 ASSERT before_facts IS NOT DISTINCT FROM after_facts,'denied acquisition changed attendance/assignment/receipt';
END $$;
ROLLBACK;
SELECT 'UNDO680_STALE_ATTENDANCE_POOL_AND_COMMIT_DENIED_NO_DELTA_PASS';
