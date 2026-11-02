-- Current retained paid journey46cab. No new hand, scope or financial write
-- survives this transaction. This checks supported lifecycle, not resettle math.
BEGIN;
SET LOCAL statement_timeout='10s';
SET LOCAL lock_timeout='2s';
DO $$
DECLARE actor uuid:='675fe35e-60a8-4452-bb90-e79486d54da6';
 tour uuid:='46cab483-91e7-4220-aacf-e17bdf05269c';
 target uuid:='4aa376ee-4a27-4963-9c69-dd0a2cd17abf';
 tt uuid:='d294f4a4-082b-4efc-a6ca-1f96579ea344';
 r jsonb; before_state text; disabled_scope uuid:='318970fa-cbcc-4719-ae24-111db3f7c912';
BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 ASSERT NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname IN('pg_net','pg_cron'));
 ASSERT EXISTS(SELECT 1 FROM public.tournament_hands h JOIN public.tournaments t ON t.id=h.tournament_id
  JOIN public.clubs c ON c.id=t.club_id WHERE h.id=target AND h.tournament_id=tour AND h.hand_number=32
   AND h.source_revision=24 AND h.status='completed' AND NOT h.is_voided AND h.tournament_table_id=tt
   AND c.owner_id=actor AND t.name='Cash identity local TEST' AND t.status='live');
 ASSERT NOT EXISTS(SELECT 1 FROM public.tournament_hands WHERE tournament_id=tour AND status='in_progress' AND NOT is_voided);
 ASSERT NOT EXISTS(SELECT 1 FROM public.tournament_close_report WHERE tournament_id=tour);
 ASSERT (SELECT sum(applied_amount) FROM public.cashier_buyin_movements WHERE tournament_id=tour)=300000;
 ASSERT (SELECT sum(current_stack) FROM public.tournament_entries WHERE tournament_id=tour AND status='seated')=60000;
 ASSERT EXISTS(SELECT 1 FROM public.tracker_correction_uat_scopes WHERE id=disabled_scope AND tournament_id=tour
  AND user_id=actor AND capability='correct_completed_hand' AND NOT enabled AND expires_at IS NULL);
 SELECT md5(jsonb_build_array(
  (SELECT to_jsonb(h) FROM public.tournament_hands h WHERE id=target),
  (SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.hand_actions a WHERE hand_id=target),
  (SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.tracker_floor_alerts a WHERE tournament_id=tour),
  (SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM public.tournament_prize_payments p WHERE tournament_id=tour)
 )::text) INTO before_state;
 GRANT USAGE ON SCHEMA auth TO authenticated;
 PERFORM set_config('request.jwt.claim.sub',actor::text,true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
 PERFORM set_config('role','authenticated',true);
 r:=public.authorize_tracker_completed_hand_correction_uat_v1(tour,target);
 ASSERT r->>'error'='uat_capability_disabled',r::text;
 r:=public.report_tracker_wrong_hand_v1(tour,tt,target,24,gen_random_uuid());
 ASSERT r->>'error'='stale_tracker_context',r::text;
 PERFORM set_config('role','none',true);
 UPDATE public.tracker_correction_uat_scopes SET enabled=true,expires_at=now()+interval '5 minutes' WHERE id=disabled_scope;
 PERFORM set_config('role','authenticated',true);
 r:=public.authorize_tracker_completed_hand_correction_uat_v1(tour,target);
 ASSERT r->>'ok'='true' AND r->>'source_revision'='24' AND r->>'scope'='latest_completed_hand_only',r::text;
 -- Enable report scope too: completed report must still fail on lifecycle,
 -- rather than succeeding merely because an Owner has both capabilities.
 PERFORM set_config('role','none',true);
 INSERT INTO public.tracker_correction_uat_scopes(club_id,tournament_id,tournament_table_id,user_id,capability,enabled,expires_at)
 SELECT club_id,tour,tt,actor,'report_wrong_action',true,now()+interval '5 minutes' FROM public.tournaments WHERE id=tour
 ON CONFLICT DO NOTHING;
 PERFORM set_config('role','authenticated',true);
 r:=public.report_tracker_wrong_hand_v1(tour,tt,target,24,gen_random_uuid());
 ASSERT r->>'error'='stale_tracker_context',r::text;
 r:=public.authorize_tracker_completed_hand_correction_uat_v1(tour,'3b17d706-6efa-4264-80b0-ec296397f6cf');
 ASSERT r->>'error'='later_hand_scope_not_supported',r::text;
 r:=public.authorize_tracker_completed_hand_correction_uat_v1(tour,'97cd26e1-e4e3-4be9-a387-5dbe863a60ef');
 ASSERT r->>'error'='invalid_target_hand',r::text;
 PERFORM set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000099',true);
 PERFORM set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000099","role":"authenticated"}',true);
 r:=public.authorize_tracker_completed_hand_correction_uat_v1(tour,target);
 ASSERT r->>'error'='actor_not_authorized',r::text;
 PERFORM set_config('role','none',true);
 ASSERT before_state=(SELECT md5(jsonb_build_array(
  (SELECT to_jsonb(h) FROM public.tournament_hands h WHERE id=target),
  (SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.hand_actions a WHERE hand_id=target),
  (SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.tracker_floor_alerts a WHERE tournament_id=tour),
  (SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM public.tournament_prize_payments p WHERE tournament_id=tour)
 )::text));
 RAISE NOTICE 'CORRECTION222_CURRENT_COMPLETED_REPORT_DENIED_LATEST_CORRECTION_SCOPE_AND_ACTOR_VERIFIED_NO_HAND_ALERT_PAYMENT_DELTA';
END $$;
ROLLBACK;
