-- Same paid canary after checkpoint100; only a new canonical assignment after
-- the real15-minute rest boundary, no time override/new Dealer identity.
BEGIN;
SET LOCAL lock_timeout='3s';SET LOCAL statement_timeout='15s';
DO $$ DECLARE actor uuid:='675fe35e-60a8-4452-bb90-e79486d54da6';
 club uuid:='a8e7d1b7-fdaa-45ad-b0a1-f894b6315760';tour uuid:='46cab483-91e7-4220-aacf-e17bdf05269c';
 tbl uuid:='d294f4a4-082b-4efc-a6ca-1f96579ea344';sess uuid:='ee2b9393-0c96-42f9-8667-7f306edeb9bc';r jsonb;
BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c';
 ASSERT inet_server_addr()='127.0.0.1'::inet AND inet_server_port()=55441;
 ASSERT NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_net');
 ASSERT EXISTS(SELECT 1 FROM public.clubs c JOIN public.tournaments t ON t.club_id=c.id
 JOIN public.club_settings cs ON cs.club_id=c.id WHERE c.id=club AND c.owner_id=actor AND t.id=tour
 AND t.name='Cash identity local TEST' AND cs.auto_swing_enabled=false);
 ASSERT (SELECT max(hand_number) FROM public.tournament_hands WHERE tournament_id=tour)=27;
 ASSERT NOT EXISTS(SELECT 1 FROM public.tournament_hands WHERE tournament_id=tour AND status='in_progress');
 ASSERT NOT EXISTS(SELECT 1 FROM public.dealer_assignments WHERE table_session_id=sess AND released_at IS NULL);
 ASSERT EXISTS(SELECT 1 FROM public.dealer_assignments WHERE id='7fa013b4-80ef-4afe-add9-aa057121b431'
  AND dealer_id='e836277e-eb94-4118-87a2-38a4a86eda16' AND released_at<=now()-interval '15 minutes');
 ASSERT EXISTS(SELECT 1 FROM public.dealer_attendance a JOIN public.dealers d ON d.id=a.dealer_id
 WHERE a.id='592a1d69-3e2c-4a07-aa7a-8a77a7907f5f' AND d.id='e836277e-eb94-4118-87a2-38a4a86eda16'
 AND d.user_id=actor AND d.club_id=club AND a.current_state='available' AND a.status='checked_in' AND a.check_out_time IS NULL);
 PERFORM set_config('request.jwt.claim.sub',actor::text,true);
 PERFORM set_config('request.jwt.claim.role','service_role',true);
 PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);
 PERFORM set_config('request.headers',jsonb_build_object('x-vinpoker-dealer-intent','manual','x-vinpoker-dealer-actor',actor)::text,true);
 PERFORM set_config('role','service_role',true);
 r:=public.worker_assign_dealer_to_session_v1(club,'c474ac95-6896-445d-81ba-dd6d752528df',sess,
  '592a1d69-3e2c-4a07-aa7a-8a77a7907f5f',now()+interval '45 minutes','active-correction101:592a1d69-3e2c-4a07-aa7a-8a77a7907f5f');
 ASSERT r->>'outcome'='ok',r::text;
 PERFORM set_config('role','none',true);
 INSERT INTO public.tracker_correction_uat_scopes(club_id,tournament_id,tournament_table_id,user_id,capability,enabled,expires_at)
 VALUES(club,tour,tbl,actor,'report_wrong_action',true,now()+interval '2 hours'),(club,tour,tbl,actor,'undo_open_hand',true,now()+interval '2 hours')
 ON CONFLICT(tournament_id,tournament_table_id,user_id,capability) DO UPDATE SET enabled=true,expires_at=excluded.expires_at,updated_at=now();
END $$;
SELECT jsonb_build_object('assignment',a.id,'restSeconds',extract(epoch FROM(a.assigned_at-old.released_at)),
 'session',a.table_session_id,'auto',cs.auto_swing_enabled)
 FROM public.dealer_assignments a JOIN public.dealer_assignments old ON old.id='7fa013b4-80ef-4afe-add9-aa057121b431'
 JOIN public.club_settings cs ON cs.club_id=a.club_id WHERE a.idempotency_key='active-correction101:592a1d69-3e2c-4a07-aa7a-8a77a7907f5f';
COMMIT;
