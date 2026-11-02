-- Retained real browser D2 apply + Continue. All probes roll back.
BEGIN;
SET LOCAL statement_timeout='10s';
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c';
 ASSERT host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT (SELECT count(*) FROM public.tournament_entries WHERE tournament_id='4cd3af4d-7e1d-4042-855f-04fb6777e580')=15;
 ASSERT (SELECT sum(current_stack) FROM public.tournament_entries WHERE tournament_id='4cd3af4d-7e1d-4042-855f-04fb6777e580')=300000;
 ASSERT (SELECT count(*) FROM public.tournament_seats WHERE tournament_id='4cd3af4d-7e1d-4042-855f-04fb6777e580' AND is_active)=15;
 ASSERT (SELECT sum(chip_count) FROM public.tournament_chip_counts WHERE tournament_id='4cd3af4d-7e1d-4042-855f-04fb6777e580')=300000;
 ASSERT NOT EXISTS(SELECT 1 FROM public.tournament_seats s JOIN public.tournament_entries e ON e.id=s.entry_id
  WHERE s.tournament_id='4cd3af4d-7e1d-4042-855f-04fb6777e580' AND (s.chip_count<>e.current_stack OR s.player_id<>e.player_id));
 ASSERT NOT EXISTS(SELECT 1 FROM public.cashier_buyin_movements WHERE tournament_id='4cd3af4d-7e1d-4042-855f-04fb6777e580');
 ASSERT NOT EXISTS(SELECT 1 FROM public.tournament_prize_payments WHERE tournament_id='4cd3af4d-7e1d-4042-855f-04fb6777e580');
 ASSERT (SELECT count(*) FROM public.stack_template_issuance WHERE stack_template_id IN('0ad0367c-3483-44bd-bc8d-479d7aa745ad','86c51d46-c2dc-4936-bbb1-5b532e87c06f') AND issued_count=8 AND revision=1)=2;
 ASSERT (SELECT count(*) FROM public.table_sessions WHERE tournament_id='4cd3af4d-7e1d-4042-855f-04fb6777e580'
  AND closed_at IS NULL AND redraw_hold_batch_id IS NULL AND revision=3)=3;
 ASSERT EXISTS(SELECT 1 FROM public.tournament_redraw_batches WHERE id='64b40264-414f-45f2-be65-aabf498b348f'
  AND hold_completed_at IS NOT NULL AND redraw_revision=2 AND NOT clock_was_running);
END $$;
CREATE TEMP TABLE d2_184_before ON COMMIT DROP AS SELECT jsonb_build_object(
 'entries',(SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM public.tournament_entries e WHERE tournament_id='4cd3af4d-7e1d-4042-855f-04fb6777e580'),
 'seats',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.tournament_seats s WHERE tournament_id='4cd3af4d-7e1d-4042-855f-04fb6777e580'),
 'issuance',(SELECT jsonb_agg(to_jsonb(i) ORDER BY stack_template_id) FROM public.stack_template_issuance i),
 'cash',(SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM public.cashier_buyin_movements m)) data;
SET LOCAL request.jwt.claim.sub='675fe35e-60a8-4452-bb90-e79486d54da6';
SET LOCAL request.jwt.claims='{"sub":"675fe35e-60a8-4452-bb90-e79486d54da6","role":"authenticated"}';
SET LOCAL ROLE authenticated;
DO $$ DECLARE r jsonb;
BEGIN
 r:=public.multi_day_apply_initial_draw_v1('64b40264-414f-45f2-be65-aabf498b348f','ea0c3827-efaf-4df2-adb2-9e3f79e9a074');
 ASSERT r->>'idempotent'='true' AND jsonb_array_length(r->'seatReceipts')=15;
 r:=public.floor_continue_tournament_redraw_v1('64b40264-414f-45f2-be65-aabf498b348f',1,'4d540e53-34df-453b-a278-ccc2a04bb1dc');
 ASSERT r->>'ok'='true' AND r->>'redraw_revision'='2' AND r->>'clock_resumed'='false';
 BEGIN
  PERFORM public.multi_day_plan_initial_draw_v1('dbb49f8d-7d47-4c2c-afd9-f57062c9971d',
   ARRAY['8508d715-cd7c-4f1f-bb0d-223d967e355c'::uuid,'e16d00d3-8537-45e1-893c-fc1f574ea17c'::uuid],
   '91ccbf24673a7a198f2fe997a74779b6','4bb75ef6-770c-4b17-96ac-35a4fbed3648');
  RAISE EXCEPTION 'expected_plan_payload_conflict';
 EXCEPTION WHEN unique_violation THEN ASSERT SQLERRM='multi_day_initial_draw_request_conflict',SQLERRM; END;
END $$;
RESET ROLE;
SET LOCAL request.jwt.claim.sub='3add8ca8-34ff-4f52-8b40-a48c192d3aa5';
SET LOCAL request.jwt.claims='{"sub":"3add8ca8-34ff-4f52-8b40-a48c192d3aa5","role":"authenticated"}';
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN
  PERFORM public.multi_day_apply_initial_draw_v1('64b40264-414f-45f2-be65-aabf498b348f','ea0c3827-efaf-4df2-adb2-9e3f79e9a074');
  RAISE EXCEPTION 'expected_outsider_denial';
 EXCEPTION WHEN insufficient_privilege THEN ASSERT SQLERRM='multi_day_initial_draw_actor_denied',SQLERRM; END;
END $$;
RESET ROLE;
SET LOCAL request.jwt.claims='{"role":"anon"}';SET LOCAL ROLE anon;
DO $$ DECLARE r jsonb; BEGIN
 r:=public.get_public_tournament_redraw_v1('4cd3af4d-7e1d-4042-855f-04fb6777e580');
 ASSERT r->>'batch_id' IS NULL AND r->'moves'='[]'::jsonb;
END $$;
RESET ROLE;
DO $$ BEGIN
 ASSERT (SELECT data FROM d2_184_before)=jsonb_build_object(
 'entries',(SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM public.tournament_entries e WHERE tournament_id='4cd3af4d-7e1d-4042-855f-04fb6777e580'),
 'seats',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.tournament_seats s WHERE tournament_id='4cd3af4d-7e1d-4042-855f-04fb6777e580'),
 'issuance',(SELECT jsonb_agg(to_jsonb(i) ORDER BY stack_template_id) FROM public.stack_template_issuance i),
 'cash',(SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM public.cashier_buyin_movements m));
END $$;
SELECT 'LINKED184_D2_APPLY_REPLAY_CONFLICT_OUTSIDER_CONTINUE_CHIP_CASH_INVARIANTS_PASS';
ROLLBACK;
