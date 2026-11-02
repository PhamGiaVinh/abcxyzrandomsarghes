-- Exact retained browser journey. Replay/denial checks roll back; no new qualification.
BEGIN;
SET LOCAL statement_timeout='10s';
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c';
 ASSERT host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT (SELECT count(*) FROM public.multi_day_qualification_locks_v1
  WHERE event_id='dbb49f8d-7d47-4c2c-afd9-f57062c9971d'
   AND request_id='bda12f82-26ed-4b89-a13c-3f3862d80df8' AND participation_count=15)=1;
 ASSERT (SELECT sum(carried_stack) FROM public.multi_day_final_participations_v1
  WHERE event_id='dbb49f8d-7d47-4c2c-afd9-f57062c9971d')=300000;
 ASSERT EXISTS(SELECT 1 FROM public.multi_day_final_participations_v1 p JOIN public.chip_bag b ON b.id=p.selected_bag_id
  WHERE p.event_id='dbb49f8d-7d47-4c2c-afd9-f57062c9971d' AND p.player_id='675fe35e-60a8-4452-bb90-e79486d54da6'
   AND p.carried_stack=20100 AND jsonb_array_length(p.source_bags)=2
   AND b.tournament_id='fdf91018-09f3-4cdc-b76a-f688eb216cee' AND b.total_value=20100);
 ASSERT EXISTS(SELECT 1 FROM public.multi_day_nonselected_min_cash_v1 n JOIN public.multi_day_final_participations_v1 p ON p.id=n.participation_id
  WHERE p.event_id='dbb49f8d-7d47-4c2c-afd9-f57062c9971d' AND n.status='PENDING_FUNDING' AND n.amount_vnd=110000
   AND n.source_entry_id='0c1a0382-3437-437d-a5f2-74b8206a8dce');
END $$;
CREATE TEMP TABLE qualification183_before ON COMMIT DROP AS
SELECT jsonb_build_object('lock',(SELECT to_jsonb(l) FROM public.multi_day_qualification_locks_v1 l WHERE event_id='dbb49f8d-7d47-4c2c-afd9-f57062c9971d'),
 'players',(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM public.multi_day_final_participations_v1 p WHERE event_id='dbb49f8d-7d47-4c2c-afd9-f57062c9971d'),
 'cash',(SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM public.cashier_buyin_movements m),
 'prizes',(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM public.tournament_prize_payments p)) snapshot;
SET LOCAL request.jwt.claim.sub='675fe35e-60a8-4452-bb90-e79486d54da6';
SET LOCAL request.jwt.claim.role='authenticated';
SET LOCAL request.jwt.claims='{"sub":"675fe35e-60a8-4452-bb90-e79486d54da6","role":"authenticated"}';
SET LOCAL ROLE authenticated;
DO $$ DECLARE bags uuid[]; response jsonb;
BEGIN
 SELECT array_agg(b.id ORDER BY b.id) INTO bags FROM public.chip_bag b JOIN public.tournaments t ON t.id=b.tournament_id
  WHERE t.event_id='dbb49f8d-7d47-4c2c-afd9-f57062c9971d';
 ASSERT cardinality(bags)=16;
 response:=public.multi_day_lock_qualification_v1('dbb49f8d-7d47-4c2c-afd9-f57062c9971d',bags,
  'd5a8046d7d7d90b17c86aa4a2282463a','bda12f82-26ed-4b89-a13c-3f3862d80df8');
 ASSERT response->>'idempotent'='true' AND response->>'participationCount'='15';
 BEGIN
  PERFORM public.multi_day_lock_qualification_v1('dbb49f8d-7d47-4c2c-afd9-f57062c9971d',bags[1:15],
   'd5a8046d7d7d90b17c86aa4a2282463a','bda12f82-26ed-4b89-a13c-3f3862d80df8');
  RAISE EXCEPTION 'expected_payload_conflict';
 EXCEPTION WHEN unique_violation THEN ASSERT SQLERRM='multi_day_lock_request_conflict',SQLERRM; END;
END $$;
RESET ROLE;
SET LOCAL request.jwt.claim.sub='3add8ca8-34ff-4f52-8b40-a48c192d3aa5';
SET LOCAL request.jwt.claims='{"sub":"3add8ca8-34ff-4f52-8b40-a48c192d3aa5","role":"authenticated"}';
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN
  PERFORM public.multi_day_lock_qualification_v1('dbb49f8d-7d47-4c2c-afd9-f57062c9971d',ARRAY['af211873-6819-4fca-9658-f7b55580a832'::uuid],
   'd5a8046d7d7d90b17c86aa4a2282463a','bda12f82-26ed-4b89-a13c-3f3862d80df8');
  RAISE EXCEPTION 'expected_outsider_denial';
 EXCEPTION WHEN insufficient_privilege THEN ASSERT SQLERRM='multi_day_lock_actor_denied',SQLERRM; END;
END $$;
RESET ROLE;
DO $$ BEGIN
 ASSERT (SELECT snapshot FROM qualification183_before)=jsonb_build_object(
 'lock',(SELECT to_jsonb(l) FROM public.multi_day_qualification_locks_v1 l WHERE event_id='dbb49f8d-7d47-4c2c-afd9-f57062c9971d'),
 'players',(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM public.multi_day_final_participations_v1 p WHERE event_id='dbb49f8d-7d47-4c2c-afd9-f57062c9971d'),
 'cash',(SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM public.cashier_buyin_movements m),
 'prizes',(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM public.tournament_prize_payments p));
 ASSERT (SELECT count(*) FROM public.tournament_entries WHERE tournament_id='4cd3af4d-7e1d-4042-855f-04fb6777e580')=0;
END $$;
SELECT 'LINKED183_QUALIFICATION_REPLAY_CONFLICT_OUTSIDER_CARRY_NO_CASH_DELTA_PASS';
ROLLBACK;
