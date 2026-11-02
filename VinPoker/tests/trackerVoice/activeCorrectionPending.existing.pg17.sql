-- Negative probe within rollback while the real browser retains its Undo
-- snapshot. Do not send a doomed action from that browser and destroy recovery.
BEGIN;
SET LOCAL lock_timeout='3s';SET LOCAL statement_timeout='15s';
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c';
 ASSERT inet_server_addr()='127.0.0.1'::inet AND inet_server_port()=55441;
 ASSERT NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_net');
END $$;
GRANT USAGE ON SCHEMA auth TO authenticated;
SET LOCAL request.jwt.claim.sub='675fe35e-60a8-4452-bb90-e79486d54da6';
SET LOCAL request.jwt.claim.role='authenticated';
SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"675fe35e-60a8-4452-bb90-e79486d54da6"}';
SET LOCAL ROLE authenticated;
DO $$ DECLARE hand uuid;before_revision bigint;before_actions integer;r jsonb;BEGIN
 SELECT id,source_revision INTO hand,before_revision FROM public.tournament_hands
 WHERE tournament_id='46cab483-91e7-4220-aacf-e17bdf05269c' AND hand_number=28 AND status='in_progress' AND NOT is_voided;
 ASSERT hand IS NOT NULL;
 ASSERT EXISTS(SELECT 1 FROM public.tracker_floor_alerts WHERE hand_id=hand AND correction_required
  AND status IN('open','acknowledged','in_progress'));
 SELECT count(*) INTO before_actions FROM public.hand_actions WHERE hand_id=hand;
 ASSERT before_actions=3;
 ASSERT EXISTS(SELECT 1 FROM public.hand_actions WHERE hand_id=hand AND action_order=3 AND action_type='call');
 BEGIN
  r:=public.record_action(hand,'5f4dd4c4-a9d0-43a9-b523-ab5ec5d3c103','check',4,1,'preflop',0,
   gen_random_uuid()::text,NULL,'675fe35e-60a8-4452-bb90-e79486d54da6');
  ASSERT r->>'error'='tracker_correction_pending',r::text;
 EXCEPTION WHEN raise_exception THEN
  ASSERT SQLERRM='tracker_correction_pending',SQLERRM;
 END;
 ASSERT (SELECT count(*) FROM public.hand_actions WHERE hand_id=hand)=before_actions;
 ASSERT (SELECT source_revision FROM public.tournament_hands WHERE id=hand)=before_revision;
END $$;
ROLLBACK;
