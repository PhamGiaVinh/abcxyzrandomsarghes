-- Named retained TEST tour only. Canonical check-in/manual-intent assignment;
-- no automatic worker, forced release, time override or real notification.
BEGIN;
SET LOCAL lock_timeout='3s';SET LOCAL statement_timeout='15s';
DO $$ DECLARE actor uuid:='675fe35e-60a8-4452-bb90-e79486d54da6';
 club uuid:='a8e7d1b7-fdaa-45ad-b0a1-f894b6315760';tour uuid:='46cab483-91e7-4220-aacf-e17bdf05269c';
 tbl uuid:='d294f4a4-082b-4efc-a6ca-1f96579ea344';sess uuid:='ee2b9393-0c96-42f9-8667-7f306edeb9bc';
 dealer uuid:=gen_random_uuid();shift uuid:=gen_random_uuid();attendance uuid;physical uuid;r jsonb;
BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c';
 ASSERT inet_server_addr()='127.0.0.1'::inet AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 ASSERT NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_net');
 ASSERT EXISTS(SELECT 1 FROM public.clubs c JOIN public.tournaments t ON t.club_id=c.id
  JOIN public.club_settings cs ON cs.club_id=c.id WHERE c.id=club AND c.owner_id=actor
  AND t.id=tour AND t.name='Cash identity local TEST' AND cs.auto_swing_enabled=false);
 ASSERT NOT EXISTS(SELECT 1 FROM public.tournament_hands WHERE tournament_id=tour AND status='in_progress');
 ASSERT NOT EXISTS(SELECT 1 FROM public.dealers WHERE club_id=club),'dealer fixture already prepared: inspect, do not recreate';
 SELECT game_table_id INTO physical FROM public.tournament_tables WHERE id=tbl AND tournament_id=tour AND table_session_id=sess AND status='active';
 ASSERT physical IS NOT NULL;
 ASSERT EXISTS(SELECT 1 FROM public.table_sessions WHERE id=sess AND closed_at IS NULL AND control_mode='tracker' AND control_epoch=8);
 ASSERT (SELECT count(*) FROM public.tournament_hands WHERE tournament_id=tour)=26;
 INSERT INTO public.dealers(id,club_id,user_id,full_name,status) VALUES(dealer,club,actor,'Undo recovery local TEST dealer','active');
 INSERT INTO public.dealer_shifts(id,club_id,tour_name,start_time,end_time) VALUES(shift,club,'Undo recovery local TEST','00:00','23:59');
 PERFORM set_config('request.jwt.claim.sub',actor::text,true);
 PERFORM set_config('request.jwt.claim.role','authenticated',true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',actor)::text,true);
 PERFORM set_config('role','authenticated',true);
 r:=public.operator_check_in_dealer_v1(dealer,club,shift,gen_random_uuid());
 ASSERT r->>'ok'='true' AND r->>'outcome'='checked_in',r::text;
 PERFORM set_config('role','none',true);
 SELECT id INTO attendance FROM public.dealer_attendance WHERE dealer_id=dealer AND check_out_time IS NULL;
 ASSERT attendance IS NOT NULL;
 -- Same manual-intent headers as the protected control-plane path. Auto OFF
 -- remains authoritative; is_club_dealer_control checks the declared actor.
 PERFORM set_config('request.headers',jsonb_build_object('x-vinpoker-dealer-intent','manual','x-vinpoker-dealer-actor',actor)::text,true);
 PERFORM set_config('request.jwt.claim.role','service_role',true);
 PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);
 PERFORM set_config('role','service_role',true);
 r:=public.worker_assign_dealer_to_session_v1(club,physical,sess,attendance,now()+interval '45 minutes','undo-browser100:'||dealer::text);
 ASSERT r->>'outcome'='ok',r::text;
 PERFORM set_config('role','none',true);
 INSERT INTO public.tracker_correction_uat_scopes(club_id,tournament_id,tournament_table_id,user_id,capability,enabled,expires_at)
 VALUES(club,tour,tbl,actor,'undo_open_hand',true,now()+interval '2 hours');
 ASSERT (SELECT count(*) FROM public.dealer_assignments WHERE table_session_id=sess AND status='assigned' AND released_at IS NULL)=1;
 ASSERT (SELECT auto_swing_enabled FROM public.club_settings WHERE club_id=club)=false;
END $$;
SELECT jsonb_build_object('dealer',d.id,'attendance',a.id,'assignment',da.id,'session',da.table_session_id,
 'auto',cs.auto_swing_enabled,'uatExpires',s.expires_at)
 FROM public.dealers d JOIN public.dealer_attendance a ON a.dealer_id=d.id
 JOIN public.dealer_assignments da ON da.attendance_id=a.id AND da.released_at IS NULL
 JOIN public.club_settings cs ON cs.club_id=d.club_id
 JOIN public.tracker_correction_uat_scopes s ON s.user_id=d.user_id AND s.tournament_table_id='d294f4a4-082b-4efc-a6ca-1f96579ea344' AND s.capability='undo_open_hand'
 WHERE d.club_id='a8e7d1b7-fdaa-45ad-b0a1-f894b6315760' AND d.full_name='Undo recovery local TEST dealer';
COMMIT;
