\set ON_ERROR_STOP on
-- Qualified current-schema fixture; synthetic completion, real authenticated void.
-- Error exits roll back this transaction on connection close.
BEGIN;
DO $$ BEGIN
 IF current_database()<>'vinpoker_ops_card56_overlap_20261011' THEN RAISE EXCEPTION 'wrong_isolated_database'; END IF;
 IF (SELECT count(*) FROM public.hand_players WHERE hand_id='86000000-0000-4000-8000-000000000001')<>2 THEN RAISE EXCEPTION 'fixture_missing'; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','81100000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"81100000-0000-4000-8000-000000000001"}',true);
UPDATE public.hand_players SET ending_stack=CASE WHEN player_id='82000000-0000-4000-8000-000000000001' THEN 10000 ELSE 50000 END
 WHERE hand_id='86000000-0000-4000-8000-000000000001';
UPDATE public.tournament_entries e SET current_stack=hp.ending_stack FROM public.hand_players hp
 WHERE hp.hand_id='86000000-0000-4000-8000-000000000001' AND e.tournament_id=hp.tournament_id AND e.player_id=hp.player_id AND e.entry_no=hp.entry_number;
UPDATE public.tournament_seats s SET chip_count=hp.ending_stack FROM public.hand_players hp
 WHERE hp.hand_id='86000000-0000-4000-8000-000000000001' AND s.tournament_id=hp.tournament_id AND s.player_id=hp.player_id AND s.entry_number=hp.entry_number;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM public.tournament_chip_counts c JOIN public.hand_players hp
 ON c.tournament_id=hp.tournament_id AND c.player_id=hp.player_id AND c.entry_number=hp.entry_number
 WHERE hp.hand_id='86000000-0000-4000-8000-000000000001') THEN RAISE EXCEPTION 'fixture_counts_not_empty'; END IF; END $$;
INSERT INTO public.tournament_chip_counts(tournament_id,player_id,entry_number,chip_count)
 SELECT tournament_id,player_id,entry_number,ending_stack FROM public.hand_players
 WHERE hand_id='86000000-0000-4000-8000-000000000001';
UPDATE public.tournament_hands SET status='completed' WHERE id='86000000-0000-4000-8000-000000000001';
\if :{?test_capacity}
UPDATE public.tournament_tables SET max_seats=1 WHERE id='84000000-0000-4000-8000-000000000001';
\endif
\if :{?test_occupied_seat}
UPDATE public.hand_players SET ending_stack=0,is_eliminated=true WHERE hand_id='86000000-0000-4000-8000-000000000001' AND player_id='82000000-0000-4000-8000-000000000001';
UPDATE public.tournament_seats SET is_active=false,status='busted',chip_count=0 WHERE entry_id='85700000-0000-4000-8000-000000000001';
UPDATE public.tournament_entries SET status='busted',current_stack=0,busted_at=now() WHERE id='85700000-0000-4000-8000-000000000001';
UPDATE public.tournament_chip_counts SET chip_count=0 WHERE player_id='82000000-0000-4000-8000-000000000001' AND tournament_id='85000000-0000-4000-8000-000000000001';
UPDATE public.tournament_seats SET seat_number=1 WHERE entry_id='85700000-0000-4000-8000-000000000002';
UPDATE public.hand_players SET seat_number=1 WHERE hand_id='86000000-0000-4000-8000-000000000001' AND player_id='82000000-0000-4000-8000-000000000002';
\endif
\if :{?test_missing_count}
DELETE FROM public.tournament_chip_counts WHERE tournament_id='85000000-0000-4000-8000-000000000001' AND player_id='82000000-0000-4000-8000-000000000001';
\endif
\if :{?test_close_report}
-- Synthetic ended participation; close every fixture table through the real
-- RPC. Keep close/report guards enabled and assert their blockers are empty.
UPDATE public.tournament_seats SET is_active=false,status='busted' WHERE tournament_id='85000000-0000-4000-8000-000000000001';
-- Known fixture-only legacy assignment880...009 lacks session binding. Use the
-- existing server teardown seam, scoped by its exact attendance, not raw UPDATE.
DO $$ DECLARE r jsonb; BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.dealer_assignments WHERE id='88000000-0000-4000-8000-000000000009'
  AND attendance_id='87500000-0000-4000-8000-000000000004' AND club_id='81000000-0000-4000-8000-000000000001'
  AND table_session_id IS NULL AND released_at IS NULL) THEN RAISE EXCEPTION 'fixture_legacy_assignment_missing'; END IF;
 r:=public.release_dealer_assignments(p_attendance_id:='87500000-0000-4000-8000-000000000004',p_reason:='CV01 isolated fixture teardown');
 IF (r->>'ok')::boolean IS DISTINCT FROM true OR (r->>'released_count')::integer<>1 THEN RAISE EXCEPTION 'fixture_teardown_failed %',r; END IF;
END $$;
CREATE TEMP TABLE completed_void_close_inputs AS SELECT tt.id,s.revision FROM public.tournament_tables tt JOIN public.table_sessions s ON s.id=tt.table_session_id
 WHERE tt.tournament_id='85000000-0000-4000-8000-000000000001' AND tt.status='active';
GRANT SELECT ON completed_void_close_inputs TO authenticated;
SET LOCAL ROLE authenticated;
DO $$ DECLARE t record; r jsonb; BEGIN
 FOR t IN SELECT * FROM completed_void_close_inputs ORDER BY id LOOP
  r:=public.close_tournament_table_v4(t.id,t.revision,gen_random_uuid());
  IF (r->>'ok')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'fixture_close_failed %',r; END IF;
 END LOOP;
END $$;
RESET ROLE;
DO $$ DECLARE blockers jsonb:=floor_private.felt_tournament_close_blockers_v1('85000000-0000-4000-8000-000000000001'); BEGIN IF blockers<>'[]'::jsonb THEN RAISE EXCEPTION 'fixture_close_blockers_remain %',blockers; END IF; END $$;
INSERT INTO public.tournament_close_report(tournament_id) VALUES('85000000-0000-4000-8000-000000000001');
\endif
\if :{?test_payout}
INSERT INTO public.tournament_prize_payments(tournament_id,club_id,finished_place,prize_amount,status,method)
 SELECT id,club_id,1,100,'paid','other' FROM public.tournaments WHERE id='85000000-0000-4000-8000-000000000001';
\endif
\if :{?test_busted_player}
UPDATE public.hand_players SET ending_stack=0,is_eliminated=true WHERE hand_id='86000000-0000-4000-8000-000000000001' AND player_id='82000000-0000-4000-8000-000000000001';
UPDATE public.tournament_seats SET is_active=false,status='busted',chip_count=0 WHERE entry_id='85700000-0000-4000-8000-000000000001';
UPDATE public.tournament_entries SET status='busted',current_stack=0,busted_at=now() WHERE id='85700000-0000-4000-8000-000000000001';
UPDATE public.tournament_chip_counts SET chip_count=0 WHERE player_id='82000000-0000-4000-8000-000000000001' AND tournament_id='85000000-0000-4000-8000-000000000001';
\if :{?test_locked_seat}
INSERT INTO public.table_session_seat_locks(tournament_id,tournament_table_id,table_session_id,seat_number,reason,locked_by)
 VALUES('85000000-0000-4000-8000-000000000001','84000000-0000-4000-8000-000000000001','83500000-0000-4000-8000-000000000001',1,'CV01 TEST','81100000-0000-4000-8000-000000000001');
\endif
\endif
\if :{?test_moved_seat}
UPDATE public.tournament_seats SET seat_number=3 WHERE entry_id='85700000-0000-4000-8000-000000000001';
\endif
\if :{?test_changed_stack}
UPDATE public.tournament_entries SET current_stack=current_stack+1000 WHERE id='85700000-0000-4000-8000-000000000001';
\endif
\if :{?test_closed_session}
UPDATE public.table_sessions SET closed_at=now() WHERE id='83500000-0000-4000-8000-000000000001';
\endif
\if :{?test_reentry}
INSERT INTO public.tournament_entries(tournament_id,player_id,entry_no,source,status,current_stack)
 VALUES('85000000-0000-4000-8000-000000000001','82000000-0000-4000-8000-000000000001',2,'manual','registered',30000);
CREATE TEMP TABLE void_guard_before AS SELECT to_jsonb(h) snapshot FROM public.tournament_hands h WHERE id='86000000-0000-4000-8000-000000000001';
\endif
CREATE TEMP TABLE completed_void_before AS
SELECT 'hand' kind,to_jsonb(h) row_data FROM public.tournament_hands h WHERE id='86000000-0000-4000-8000-000000000001'
UNION ALL SELECT 'entry',to_jsonb(e) FROM public.tournament_entries e WHERE tournament_id='85000000-0000-4000-8000-000000000001'
UNION ALL SELECT 'seat',to_jsonb(s) FROM public.tournament_seats s WHERE tournament_id='85000000-0000-4000-8000-000000000001'
UNION ALL SELECT 'count',to_jsonb(c) FROM public.tournament_chip_counts c WHERE tournament_id='85000000-0000-4000-8000-000000000001';
\if :{?test_foreign_actor}
SELECT set_config('request.jwt.claim.sub','81600000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"81600000-0000-4000-8000-000000000001"}',true);
\endif
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE completed_void_receipt AS SELECT public.void_last_hand('86000000-0000-4000-8000-000000000001') receipt;
RESET ROLE;
CREATE TEMP TABLE completed_void_after AS
SELECT 'hand' kind,to_jsonb(h) row_data FROM public.tournament_hands h WHERE id='86000000-0000-4000-8000-000000000001'
UNION ALL SELECT 'entry',to_jsonb(e) FROM public.tournament_entries e WHERE tournament_id='85000000-0000-4000-8000-000000000001'
UNION ALL SELECT 'seat',to_jsonb(s) FROM public.tournament_seats s WHERE tournament_id='85000000-0000-4000-8000-000000000001'
UNION ALL SELECT 'count',to_jsonb(c) FROM public.tournament_chip_counts c WHERE tournament_id='85000000-0000-4000-8000-000000000001';
DO $$ BEGIN
 IF (SELECT receipt ? 'error' FROM completed_void_receipt) AND EXISTS(
 (SELECT * FROM completed_void_before EXCEPT ALL SELECT * FROM completed_void_after)
 UNION ALL (SELECT * FROM completed_void_after EXCEPT ALL SELECT * FROM completed_void_before)) THEN
 RAISE EXCEPTION 'completed_void_denial_projection_delta'; END IF;
END $$;
\if :{?test_payout}
DO $$ BEGIN
 IF (SELECT receipt->>'error' FROM completed_void_receipt) IS DISTINCT FROM 'void_result_dependency' THEN
  RAISE EXCEPTION 'CV01_completed_void_accepted_payout'; END IF;
END $$;
\else
\if :{?test_capacity}
DO $$ BEGIN
 IF (SELECT receipt->>'error' FROM completed_void_receipt) IS DISTINCT FROM 'void_seat_capacity' THEN
  RAISE EXCEPTION 'CV01_completed_void_accepted_capacity'; END IF;
END $$;
\else
\if :{?test_occupied_seat}
DO $$ BEGIN
 IF (SELECT receipt->>'error' FROM completed_void_receipt) IS DISTINCT FROM 'void_seat_occupied' THEN
  RAISE EXCEPTION 'CV01_completed_void_accepted_occupied_seat'; END IF;
END $$;
\else
\if :{?test_missing_count}
DO $$ BEGIN
 IF (SELECT receipt->>'error' FROM completed_void_receipt) IS DISTINCT FROM 'void_chip_projection_missing' THEN
  RAISE EXCEPTION 'CV01_completed_void_accepted_missing_count'; END IF;
END $$;
\else
\if :{?test_close_report}
DO $$ BEGIN
 IF (SELECT receipt->>'error' FROM completed_void_receipt) IS DISTINCT FROM 'void_result_dependency' THEN
  RAISE EXCEPTION 'CV01_completed_void_accepted_close_report'; END IF;
END $$;
\else
\if :{?test_locked_seat}
DO $$ BEGIN
 IF (SELECT receipt->>'error' FROM completed_void_receipt) IS DISTINCT FROM 'void_seat_locked' THEN
  RAISE EXCEPTION 'CV01_completed_void_accepted_locked_seat'; END IF;
END $$;
\else
\if :{?test_moved_seat}
DO $$ BEGIN
 IF (SELECT receipt->>'error' FROM completed_void_receipt) IS DISTINCT FROM 'void_seat_dependency' THEN
  RAISE EXCEPTION 'CV01_completed_void_accepted_moved_seat'; END IF;
END $$;
\else
\if :{?test_foreign_actor}
DO $$ BEGIN
 IF (SELECT receipt->>'error' FROM completed_void_receipt) IS DISTINCT FROM 'actor_not_allowed' THEN
  RAISE EXCEPTION 'completed_void_foreign_actor_not_denied'; END IF;
END $$;
\else
\if :{?test_changed_stack}
DO $$ BEGIN
 IF (SELECT receipt->>'error' FROM completed_void_receipt) IS DISTINCT FROM 'void_stack_dependency' THEN
  RAISE EXCEPTION 'CV01_completed_void_overwrote_new_stack';
 END IF;
END $$;
\else
\if :{?test_closed_session}
DO $$ BEGIN
 IF (SELECT receipt->>'error' FROM completed_void_receipt) IS DISTINCT FROM 'void_session_mismatch' THEN
  RAISE EXCEPTION 'CV01_completed_void_accepted_closed_session';
 END IF;
END $$;
\else
\if :{?test_reentry}
DO $$ BEGIN
 IF (SELECT receipt->>'error' FROM completed_void_receipt) IS DISTINCT FROM 'void_reentry_dependency' THEN
  RAISE EXCEPTION 'CV01_completed_void_accepted_reentry';
 END IF;
 IF EXISTS(SELECT 1 FROM public.tournament_hands h CROSS JOIN void_guard_before b
  WHERE h.id='86000000-0000-4000-8000-000000000001' AND to_jsonb(h) IS DISTINCT FROM b.snapshot) THEN
  RAISE EXCEPTION 'completed_void_denial_changed_hand';
 END IF;
END $$;
\else
DO $$ BEGIN
 IF (SELECT receipt->>'status' FROM completed_void_receipt) IS DISTINCT FROM 'success' THEN RAISE EXCEPTION 'completed_void_failed'; END IF;
 IF (SELECT count(*) FROM public.hand_players hp JOIN public.tournament_entries e
 ON e.tournament_id=hp.tournament_id AND e.player_id=hp.player_id AND e.entry_no=hp.entry_number
 JOIN public.tournament_seats s ON s.entry_id=e.id JOIN public.tournament_chip_counts c
 ON c.tournament_id=hp.tournament_id AND c.player_id=hp.player_id AND c.entry_number=hp.entry_number
 WHERE hp.hand_id='86000000-0000-4000-8000-000000000001')<>2 THEN
 RAISE EXCEPTION 'completed_void_projection_join_not_complete'; END IF;
 IF EXISTS(SELECT 1 FROM public.hand_players hp JOIN public.tournament_entries e
 ON e.tournament_id=hp.tournament_id AND e.player_id=hp.player_id AND e.entry_no=hp.entry_number
 JOIN public.tournament_seats s ON s.entry_id=e.id JOIN public.tournament_chip_counts c
 ON c.tournament_id=hp.tournament_id AND c.player_id=hp.player_id AND c.entry_number=hp.entry_number
 WHERE hp.hand_id='86000000-0000-4000-8000-000000000001'
 AND (e.current_stack IS DISTINCT FROM hp.starting_stack OR s.chip_count IS DISTINCT FROM hp.starting_stack OR c.chip_count IS DISTINCT FROM hp.starting_stack))
 THEN RAISE EXCEPTION 'CV01_completed_void_projection_mismatch'; END IF;
END $$;
\endif
\endif
\endif
\endif
\endif
\endif
\endif
\if :{?test_busted_player}
\if :{?test_locked_seat}
\else
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.tournament_entries e JOIN public.tournament_seats s ON s.entry_id=e.id
  WHERE e.id='85700000-0000-4000-8000-000000000001' AND e.status='seated' AND e.busted_at IS NULL AND s.is_active AND s.status='active') THEN
  RAISE EXCEPTION 'CV01_completed_void_bust_status_not_restored'; END IF;
END $$;
\endif
\endif
\endif
\endif
\endif
\endif
-- Same hand retry after a known successful commit result is a no-op denial.
-- This is not a durable request-ID receipt or a response-loss UI test.
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE completed_void_replay AS
 SELECT public.void_last_hand('86000000-0000-4000-8000-000000000001') receipt
 WHERE (SELECT receipt->>'status' FROM completed_void_receipt)='success';
RESET ROLE;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM completed_void_replay WHERE receipt->>'error' IS DISTINCT FROM 'Hand already voided') THEN
  RAISE EXCEPTION 'completed_void_replay_not_denied'; END IF;
END $$;
CREATE TEMP TABLE completed_void_after_replay AS
SELECT 'hand' kind,to_jsonb(h) row_data FROM public.tournament_hands h WHERE id='86000000-0000-4000-8000-000000000001'
UNION ALL SELECT 'entry',to_jsonb(e) FROM public.tournament_entries e WHERE tournament_id='85000000-0000-4000-8000-000000000001'
UNION ALL SELECT 'seat',to_jsonb(s) FROM public.tournament_seats s WHERE tournament_id='85000000-0000-4000-8000-000000000001'
UNION ALL SELECT 'count',to_jsonb(c) FROM public.tournament_chip_counts c WHERE tournament_id='85000000-0000-4000-8000-000000000001';
DO $$ BEGIN
 IF EXISTS((SELECT * FROM completed_void_after EXCEPT ALL SELECT * FROM completed_void_after_replay)
 UNION ALL (SELECT * FROM completed_void_after_replay EXCEPT ALL SELECT * FROM completed_void_after)) THEN
  RAISE EXCEPTION 'completed_void_replay_projection_delta'; END IF;
END $$;
ROLLBACK;
\echo COMPLETED_VOID_THREE_PROJECTIONS_PASS
