-- End only the named canary assignment and temporary UAT scope. Preserve all
-- hand, operation, attendance and payroll evidence; do not invent checkout time.
BEGIN;
SET LOCAL lock_timeout='3s';SET LOCAL statement_timeout='15s';
DO $$ DECLARE r jsonb;BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c';
 ASSERT inet_server_addr()='127.0.0.1'::inet AND inet_server_port()=55441;
 ASSERT NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_net');
 ASSERT EXISTS(SELECT 1 FROM public.tournament_hands WHERE id='3c9e3e32-1855-434b-9e4c-34f651426819'
  AND tournament_id='46cab483-91e7-4220-aacf-e17bdf05269c' AND hand_number=27 AND status='completed'
  AND NOT is_voided AND source_revision=11 AND pot_size=200);
 ASSERT NOT EXISTS(SELECT 1 FROM public.tournament_hands WHERE tournament_id='46cab483-91e7-4220-aacf-e17bdf05269c' AND status='in_progress');
 ASSERT EXISTS(SELECT 1 FROM public.dealers WHERE id='e836277e-eb94-4118-87a2-38a4a86eda16'
  AND club_id='a8e7d1b7-fdaa-45ad-b0a1-f894b6315760' AND user_id='675fe35e-60a8-4452-bb90-e79486d54da6' AND full_name='Undo recovery local TEST dealer');
 ASSERT EXISTS(SELECT 1 FROM public.dealer_assignments WHERE id='7fa013b4-80ef-4afe-add9-aa057121b431'
  AND dealer_id='e836277e-eb94-4118-87a2-38a4a86eda16' AND attendance_id='592a1d69-3e2c-4a07-aa7a-8a77a7907f5f'
  AND table_session_id='ee2b9393-0c96-42f9-8667-7f306edeb9bc' AND released_at IS NULL);
 r:=public.release_dealer_assignments('e836277e-eb94-4118-87a2-38a4a86eda16','592a1d69-3e2c-4a07-aa7a-8a77a7907f5f',now(),'local_undo_canary_complete');
 ASSERT r->>'ok'='true' AND r->>'released_count'='1',r::text;
 IF EXISTS(SELECT 1 FROM public.dealer_attendance WHERE id='592a1d69-3e2c-4a07-aa7a-8a77a7907f5f' AND current_state<>'available') THEN
  r:=public.transition_dealer_state('592a1d69-3e2c-4a07-aa7a-8a77a7907f5f','available','local_undo_canary_complete');
  ASSERT r->>'ok'='true',r::text;
 END IF;
 UPDATE public.tracker_correction_uat_scopes SET enabled=false,updated_at=now()
  WHERE tournament_id='46cab483-91e7-4220-aacf-e17bdf05269c' AND tournament_table_id='d294f4a4-082b-4efc-a6ca-1f96579ea344'
  AND user_id='675fe35e-60a8-4452-bb90-e79486d54da6' AND capability='undo_open_hand';
 ASSERT NOT EXISTS(SELECT 1 FROM public.tracker_correction_uat_scopes WHERE tournament_id='46cab483-91e7-4220-aacf-e17bdf05269c' AND enabled);
 ASSERT NOT EXISTS(SELECT 1 FROM public.dealer_assignments WHERE table_session_id='ee2b9393-0c96-42f9-8667-7f306edeb9bc' AND released_at IS NULL);
 ASSERT EXISTS(SELECT 1 FROM public.club_settings WHERE club_id='a8e7d1b7-fdaa-45ad-b0a1-f894b6315760' AND auto_swing_enabled=false);
 ASSERT (SELECT sum(chip_count) FROM public.tournament_seats WHERE tournament_id='46cab483-91e7-4220-aacf-e17bdf05269c' AND is_active)=60000;
END $$;
COMMIT;
