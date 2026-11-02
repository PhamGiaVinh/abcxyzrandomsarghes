\set ON_ERROR_STOP on
BEGIN READ ONLY;
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 ASSERT EXISTS(SELECT 1 FROM public.tournaments WHERE id='c367013a-3ed3-48af-ad48-3915acadc50e' AND status='completed' AND prize_pool=900000 AND itm_places=2 AND registration_closed_at IS NOT NULL);
 ASSERT (SELECT count(*)=1 FROM public.tournament_payout_runs WHERE tournament_id='c367013a-3ed3-48af-ad48-3915acadc50e');
 ASSERT EXISTS(SELECT 1 FROM public.tournament_payout_runs WHERE id='deb73d84-4bdd-46a2-9b31-527de3b30163' AND tournament_id='c367013a-3ed3-48af-ad48-3915acadc50e'
  AND status='applied' AND entries_snapshot=9 AND prize_pool_snapshot=900000 AND buy_in_snapshot=100000 AND rake_snapshot=0
  AND archetype='DAILY' AND itm_percent=0.15 AND effective_floor=200000 AND rounding_unit=100000 AND itm_places=2);
 ASSERT (SELECT jsonb_agg(jsonb_build_array(position,amount) ORDER BY position)='[[1,700000],[2,200000]]'::jsonb FROM public.tournament_prizes WHERE tournament_id='c367013a-3ed3-48af-ad48-3915acadc50e');
 ASSERT (SELECT count(*)=9 AND sum(applied_amount)=900000 FROM public.cashier_buyin_movements WHERE tournament_id='c367013a-3ed3-48af-ad48-3915acadc50e');
 ASSERT NOT EXISTS(SELECT 1 FROM public.tournament_prize_payments WHERE tournament_id='c367013a-3ed3-48af-ad48-3915acadc50e');
 -- Historical close snapshot is deliberately immutable, not reconciled by payout generation.
 ASSERT EXISTS(SELECT 1 FROM public.tournament_close_report WHERE id='95fc8d98-a056-45f2-9803-d505a58c686e'
  AND entry_count=9 AND buy_in_total=900000 AND cash_in_total=900000 AND club_revenue=0 AND prize_total=0
  AND cashier_balance=900000 AND reconcile_delta=900000 AND NOT reconciled
  AND detail->'official_results'='{"field":8,"status":"finalized","version":1}'::jsonb);
 ASSERT (SELECT jsonb_agg(jsonb_build_array(id,finished_place) ORDER BY finished_place)='[
  ["129884e6-d2e4-4795-ade1-5bb1905e784f",1],["60968a2e-f376-4c4b-a071-f7726b5545dc",2],
  ["0a4c6f87-5495-4caf-ab91-f9499965532a",3],["d887d523-4554-477c-a020-9928e66eff9a",4],
  ["3add262c-4373-4a04-90e1-ee423aaaad32",5],["c530aeb0-175c-44f4-8643-2c30d5dce30b",6],
  ["86dc0814-e2f2-46ee-86f0-a68e9f57d6b7",7],["a5eb86d6-4280-4085-b9a9-2e35b18cca20",8]]'::jsonb
  FROM public.tournament_entries WHERE tournament_id='c367013a-3ed3-48af-ad48-3915acadc50e' AND finished_place IS NOT NULL);
 ASSERT EXISTS(SELECT 1 FROM public.tournament_entries WHERE id='c08959a4-38f8-4df9-8fd4-033c1bdf8a9e' AND entry_no=1 AND status='busted' AND current_stack=0 AND finished_place IS NULL);
 ASSERT EXISTS(SELECT 1 FROM public.tournament_entries WHERE id='129884e6-d2e4-4795-ade1-5bb1905e784f' AND status='registered' AND current_stack=180000 AND table_id IS NULL AND seat_id IS NULL);
 ASSERT NOT EXISTS(SELECT 1 FROM public.tournament_seats WHERE tournament_id='c367013a-3ed3-48af-ad48-3915acadc50e' AND is_active);
 ASSERT NOT EXISTS(SELECT 1 FROM public.table_sessions WHERE tournament_id='c367013a-3ed3-48af-ad48-3915acadc50e' AND closed_at IS NULL);
 ASSERT EXISTS(SELECT 1 FROM public.table_sessions WHERE id='b792f67f-4110-4cf4-bf9f-2bb55a6d4ed5' AND revision=22 AND control_epoch=5 AND closed_at IS NOT NULL);
 ASSERT EXISTS(SELECT 1 FROM public.dealer_assignments WHERE id='e70ae2f2-3aef-40d7-b8b3-37fda915d2fd' AND status='completed' AND released_at IS NOT NULL);
 ASSERT EXISTS(SELECT 1 FROM public.dealer_attendance WHERE id='e03c9a69-7c3d-4431-aa98-a801015dfae5' AND current_state='available' AND check_out_time IS NULL AND last_released_at IS NULL AND total_worked_minutes_today=0);
 ASSERT (SELECT count(*)=10 AND count(DISTINCT h.id)=10 FROM public.tournament_hands h JOIN public.tournament_settlement_outcomes o ON o.hand_id=h.id CROSS JOIN LATERAL public.get_tournament_historical_display_source_hash(h.id) s
  WHERE h.tournament_id='c367013a-3ed3-48af-ad48-3915acadc50e' AND h.status='completed' AND o.status='verified' AND o.verification_scope='historical_display'
  AND o.source_revision=h.source_revision AND o.source_revision=s.source_revision AND o.source_chain_hash=s.source_chain_hash);
 ASSERT NOT EXISTS(SELECT 1 FROM public.club_settings WHERE club_id='d4427834-5f5f-48ef-bde5-e2dc388ed00b' AND auto_swing_enabled);
END $$;
SET LOCAL request.jwt.claim.sub='febf2b51-fdb7-42ff-886c-b3bb1fffdc3e';
SET LOCAL ROLE authenticated;
DO $$ DECLARE recipients jsonb; liability jsonb; BEGIN
 recipients:=public.get_tournament_payout_recipients('c367013a-3ed3-48af-ad48-3915acadc50e');
 ASSERT recipients->>'owedTotal'='900000.00' AND (recipients->>'paidTotal')::numeric=0 AND (recipients->>'paidCount')::integer=0 AND (recipients->>'totalCount')::integer=2;
 ASSERT (SELECT jsonb_agg(jsonb_build_array(p->>'entryId',p->>'recipientName',(p->>'finishedPlace')::integer,(p->>'prizeAmount')::numeric,p->'isPaid') ORDER BY (p->>'finishedPlace')::integer)
  FROM jsonb_array_elements(recipients->'places') p)='[["129884e6-d2e4-4795-ade1-5bb1905e784f","Clean R11 TEST player 1",1,700000,false],["60968a2e-f376-4c4b-a071-f7726b5545dc","Clean R11 TEST player 7",2,200000,false]]'::jsonb;
 liability:=public.get_club_payout_liability_v2('2026-10-01','2026-10-31','d4427834-5f5f-48ef-bde5-e2dc388ed00b');
 ASSERT (liability->>'owedTotal')::numeric=900000 AND (liability->>'paidTotal')::numeric=0 AND (liability->>'outstandingTotal')::numeric=900000;
 ASSERT liability->>'timeZone'='Asia/Ho_Chi_Minh' AND (liability->>'periodEndExclusive')::boolean;
 ASSERT jsonb_array_length(liability->'perTournament')=1 AND liability->'perTournament'->0->>'tournamentId'='c367013a-3ed3-48af-ad48-3915acadc50e';
END $$;
ROLLBACK;
SELECT 'SINGLE699_CANONICAL_APPLIED_ONE_RUN_NAMED700K200K_UNPAID_LIABILITY900K_CLOSE_HISTORY_ENTRIES_CHIPS_DEALER_PRESERVED_PASS';
