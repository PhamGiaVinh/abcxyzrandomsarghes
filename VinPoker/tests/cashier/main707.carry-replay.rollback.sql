\set ON_ERROR_STOP on
BEGIN;SET LOCAL statement_timeout='15s';
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 ASSERT EXISTS(SELECT 1 FROM public.tournaments WHERE id='4cd3af4d-7e1d-4042-855f-04fb6777e580' AND event_id='dbb49f8d-7d47-4c2c-afd9-f57062c9971d' AND status='completed');
 ASSERT (SELECT count(*)=15 AND sum(carried_stack)=300000 AND bool_and(policy='SELECT_LARGEST') FROM public.multi_day_final_participations_v1 WHERE event_id='dbb49f8d-7d47-4c2c-afd9-f57062c9971d');
 ASSERT (SELECT count(*)=16 AND count(DISTINCT b->>'bagId')=16 AND sum((b->>'stack')::numeric)=320000
  FROM public.multi_day_final_participations_v1 p CROSS JOIN LATERAL jsonb_array_elements(p.source_bags)b WHERE p.event_id='dbb49f8d-7d47-4c2c-afd9-f57062c9971d');
 ASSERT NOT EXISTS(SELECT 1 FROM public.multi_day_final_participations_v1 p WHERE p.event_id='dbb49f8d-7d47-4c2c-afd9-f57062c9971d' AND (
  p.carried_stack IS DISTINCT FROM (SELECT max((b->>'stack')::bigint) FROM jsonb_array_elements(p.source_bags)b)
  OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p.source_bags)b WHERE (b->>'bagId')::uuid=p.selected_bag_id AND (b->>'stack')::bigint=p.carried_stack)));
 ASSERT NOT EXISTS(SELECT 1 FROM public.multi_day_final_participations_v1 p CROSS JOIN LATERAL jsonb_array_elements(p.source_bags)s
  LEFT JOIN public.chip_bag b ON b.id=(s->>'bagId')::uuid
  LEFT JOIN public.tournament_entries e ON e.id=(s->>'sourceEntryId')::uuid
  WHERE p.event_id='dbb49f8d-7d47-4c2c-afd9-f57062c9971d' AND (
   b.id IS NULL OR e.id IS NULL OR b.player_id<>p.player_id OR e.player_id<>p.player_id OR b.tournament_id<>e.tournament_id
   OR b.tournament_id<>(s->>'flightId')::uuid OR b.multi_day_revision<>(s->>'bagVersion')::integer OR NOT b.sealed
   OR b.stack_value<>(s->>'stack')::bigint));
 ASSERT (SELECT count(*)=15 AND count(*) FILTER(WHERE status='busted')=14 AND sum(current_stack)=300000
  FROM public.tournament_entries WHERE tournament_id='4cd3af4d-7e1d-4042-855f-04fb6777e580');
 ASSERT NOT EXISTS(SELECT 1 FROM public.tournament_seats WHERE tournament_id='4cd3af4d-7e1d-4042-855f-04fb6777e580' AND is_active);
 ASSERT NOT EXISTS(SELECT 1 FROM public.cashier_buyin_movements WHERE tournament_id='4cd3af4d-7e1d-4042-855f-04fb6777e580');
 ASSERT NOT EXISTS(SELECT 1 FROM public.stack_template WHERE tournament_id='4cd3af4d-7e1d-4042-855f-04fb6777e580');
 ASSERT NOT EXISTS(SELECT 1 FROM public.chip_inventory_ledger WHERE tournament_id='4cd3af4d-7e1d-4042-855f-04fb6777e580');
 ASSERT (SELECT count(*)=2 AND bool_and(issued_count=8 AND revision=1) FROM public.stack_template_issuance WHERE stack_template_id IN('0ad0367c-3483-44bd-bc8d-479d7aa745ad','86c51d46-c2dc-4936-bbb1-5b532e87c06f'));
END $$;
CREATE TEMP TABLE main707_before ON COMMIT DROP AS SELECT md5(jsonb_build_array(
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournaments x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_entries x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_seats x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_chip_counts x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.chip_bag x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY stack_template_id) FROM public.stack_template_issuance x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.chip_inventory_ledger x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.chip_bank_ledger x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.cashier_buyin_movements x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_prize_payments x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_hands x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.table_sessions x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_redraw_batches x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.multi_day_final_participations_v1 x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY event_id) FROM public.multi_day_qualification_locks_v1 x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM private.multi_day_initial_draw_applications_v1 x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM private.multi_day_initial_draw_cancellations_v1 x))::text) AS fingerprint;
SET LOCAL request.jwt.claim.sub='675fe35e-60a8-4452-bb90-e79486d54da6';
SET LOCAL request.jwt.claims='{"sub":"675fe35e-60a8-4452-bb90-e79486d54da6","role":"authenticated"}';SET LOCAL ROLE authenticated;
DO $$ DECLARE receipt jsonb;cancelled jsonb;denied boolean:=false;BEGIN
 receipt:=public.multi_day_apply_initial_draw_v1('64b40264-414f-45f2-be65-aabf498b348f','ea0c3827-efaf-4df2-adb2-9e3f79e9a074');
 ASSERT receipt->>'idempotent'='true' AND receipt->>'state'='APPLIED' AND jsonb_array_length(receipt->'seatReceipts')=15;
 ASSERT (SELECT sum((r->>'seedStack')::numeric)=300000 AND bool_and(r->>'denominationIssuance'='NONE' AND (r->>'newBuyInVnd')::numeric=0) FROM jsonb_array_elements(receipt->'seatReceipts')r);
 ASSERT (SELECT array_agg((t->>'tableNumber')::integer ORDER BY (t->>'tableNumber')::integer)=ARRAY[7,8,9] FROM jsonb_array_elements(receipt->'selectedTables')t);
 cancelled:=public.multi_day_cancel_initial_draw_v1('64b40264-414f-45f2-be65-aabf498b348f',gen_random_uuid());
 ASSERT cancelled->>'state'='APPLIED' AND cancelled->'application'->'seatReceipts'=receipt->'seatReceipts';
 BEGIN PERFORM public.multi_day_apply_initial_draw_v1('64b40264-414f-45f2-be65-aabf498b348f',gen_random_uuid());
 EXCEPTION WHEN unique_violation THEN ASSERT SQLERRM='multi_day_initial_draw_already_applied_use_receipt';denied:=true;END;
 ASSERT denied,'new request must not rerun applied D2 seating after terminal';
END $$;
RESET ROLE;
SET LOCAL request.jwt.claim.sub='40b8f243-bf3b-4aaa-962b-db788380207c';
SET LOCAL request.jwt.claims='{"sub":"40b8f243-bf3b-4aaa-962b-db788380207c","role":"authenticated"}';SET LOCAL ROLE authenticated;
DO $$ DECLARE denied boolean:=false;BEGIN
 BEGIN PERFORM public.multi_day_apply_initial_draw_v1('64b40264-414f-45f2-be65-aabf498b348f','ea0c3827-efaf-4df2-adb2-9e3f79e9a074');
 EXCEPTION WHEN insufficient_privilege THEN ASSERT SQLERRM='multi_day_initial_draw_actor_denied';denied:=true;END;ASSERT denied;
END $$;
RESET ROLE;
DO $$ BEGIN ASSERT (SELECT fingerprint FROM main707_before)=md5(jsonb_build_array(
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournaments x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_entries x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_seats x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_chip_counts x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.chip_bag x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY stack_template_id) FROM public.stack_template_issuance x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.chip_inventory_ledger x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.chip_bank_ledger x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.cashier_buyin_movements x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_prize_payments x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_hands x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.table_sessions x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_redraw_batches x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.multi_day_final_participations_v1 x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY event_id) FROM public.multi_day_qualification_locks_v1 x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM private.multi_day_initial_draw_applications_v1 x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM private.multi_day_initial_draw_cancellations_v1 x))::text);END $$;
ROLLBACK;
SELECT 'MAIN707_PER_PLAYER_LARGEST_BAG_LINEAGE_AND_TERMINAL_D2_REPLAY_NO_RESURRECTION_NO_REISSUE_NO_CASH_PASS';
