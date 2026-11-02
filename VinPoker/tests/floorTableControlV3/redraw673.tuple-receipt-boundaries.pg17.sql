\set ON_ERROR_STOP on
-- Run inside the isolated candidate transaction, or BEGIN + file + ROLLBACK.
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
END $$;
CREATE TEMP TABLE redraw673_before AS SELECT
 (SELECT jsonb_agg(to_jsonb(e)-'seat_id'-'table_id'-'seat_number'-'updated_at' ORDER BY id) FROM public.tournament_entries e) entry_identity,
 (SELECT jsonb_agg(to_jsonb(c)-'updated_at' ORDER BY tournament_id,player_id,entry_number) FROM public.tournament_chip_counts c) tcc,
 (SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM public.cashier_buyin_movements c) cash,
 (SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM public.chip_inventory_ledger c) inventory,
 (SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM public.chip_bank_ledger c) bank,
 (SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM public.tournament_hands c) hands,
 (SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM public.seat_draw_receipts c WHERE c.entry_id IN(
   SELECT e.id FROM public.tournament_entries e WHERE e.tournament_id='c367013a-3ed3-48af-ad48-3915acadc50e' AND e.status='seated') AND c.status IN('issued','printed')) live_receipts;
SAVEPOINT positive;
UPDATE public.centerpoint_tournament_ops_release SET enabled=true,
 allowed_club_ids=ARRAY['d4427834-5f5f-48ef-bde5-e2dc388ed00b'::uuid] WHERE id;
SET LOCAL request.jwt.claim.sub='febf2b51-fdb7-42ff-886c-b3bb1fffdc3e';
SET LOCAL request.jwt.claim.role='authenticated';
SET LOCAL request.jwt.claims='{"sub":"febf2b51-fdb7-42ff-886c-b3bb1fffdc3e","role":"authenticated"}';
SET LOCAL ROLE authenticated;
DO $$ DECLARE r jsonb; batch uuid; again jsonb; snapshot jsonb; BEGIN
 r:=public.floor_plan_tournament_redraw_v1('c367013a-3ed3-48af-ad48-3915acadc50e',9,
  ARRAY['991b1e8e-da4c-461a-9b39-ddebd7a5d044'::uuid],'381733df-5402-4e27-bb62-536f01abc681');
 ASSERT r->>'ok'='true',r::text;batch:=(r->>'batch_id')::uuid;
 r:=public.floor_apply_tournament_redraw_v1(batch,'381733df-5402-4e27-bb62-536f01abc682');
 ASSERT r->>'ok'='true' AND r->>'player_count'='8',r::text;
 again:=public.floor_apply_tournament_redraw_v1(batch,'381733df-5402-4e27-bb62-536f01abc682');
 ASSERT again=r,'exact retry must return same result';
 again:=public.floor_apply_tournament_redraw_v1(batch,'381733df-5402-4e27-bb62-536f01abc683');
 ASSERT again=r,'applied batch must not reshuffle on another key';
 again:=public.floor_apply_tournament_redraw_v1('381733df-5402-4e27-bb62-536f01abc684','381733df-5402-4e27-bb62-536f01abc682');
 ASSERT again->>'error'='IDEMPOTENCY_CONFLICT',again::text;
 snapshot:=public.get_tracker_roster_snapshot_v2('c367013a-3ed3-48af-ad48-3915acadc50e',
  'c2ce77c0-2b61-4a19-bd43-4752232cc55a','b792f67f-4110-4cf4-bf9f-2bb55a6d4ed5',5);
 ASSERT snapshot->>'ok'='true',snapshot::text;
 ASSERT (SELECT count(*)=8 AND sum((s->'seat'->>'chip_count')::numeric)=180000
  FROM jsonb_array_elements(snapshot->'seats') s WHERE s->'seat'<>'null'::jsonb);
 ASSERT EXISTS(SELECT 1 FROM jsonb_array_elements(snapshot->'seats') s
  WHERE s->'seat'->>'entry_id'='86dc0814-e2f2-46ee-86f0-a68e9f57d6b7' AND s->'seat'->>'entry_number'='2');
 snapshot:=public.get_tracker_roster_snapshot_v2('c367013a-3ed3-48af-ad48-3915acadc50e',
  'c2ce77c0-2b61-4a19-bd43-4752232cc55a','b792f67f-4110-4cf4-bf9f-2bb55a6d4ed5',4);
 ASSERT snapshot->>'ok'='false','pre-redraw Tracker epoch must be rejected';
 snapshot:=public.get_tracker_hand_input_tables_v4('c367013a-3ed3-48af-ad48-3915acadc50e');
 ASSERT jsonb_array_length(snapshot->'tables')=1 AND snapshot->'tables'->0->>'player_count'='8',snapshot::text;
 PERFORM set_config('test.redraw673.batch',batch::text,true);
END $$;
SET LOCAL request.jwt.claim.sub='11111111-1111-4111-8111-111111111111';
SET LOCAL request.jwt.claims='{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
DO $$ DECLARE r jsonb; BEGIN
 r:=public.floor_apply_tournament_redraw_v1(current_setting('test.redraw673.batch')::uuid,'381733df-5402-4e27-bb62-536f01abc685');
 ASSERT r->>'error'='actor_not_allowed',r::text;
END $$;
RESET ROLE;
DO $$ BEGIN
 ASSERT (SELECT count(*)=8 FROM public.tournament_entries e JOIN public.tournament_seats s ON s.id=e.seat_id
  JOIN public.tournament_tables tt ON tt.id=s.tournament_table_id
  WHERE e.tournament_id='c367013a-3ed3-48af-ad48-3915acadc50e' AND e.status='seated'
    AND s.is_active AND s.table_id=tt.id AND e.table_id=tt.game_table_id AND e.seat_number=s.seat_number AND e.current_stack=s.chip_count);
 ASSERT (SELECT count(*)=8 FROM public.seat_draw_receipts r WHERE r.qr_payload->>'redraw_batch_id'=current_setting('test.redraw673.batch') AND r.status='issued');
 ASSERT NOT EXISTS(SELECT 1 FROM redraw673_before b CROSS JOIN LATERAL jsonb_array_elements(b.live_receipts) old
  LEFT JOIN public.seat_draw_receipts r ON r.id=(old->>'id')::uuid WHERE r.status IS DISTINCT FROM 'superseded');
 ASSERT (SELECT entry_identity=(SELECT jsonb_agg(to_jsonb(e)-'seat_id'-'table_id'-'seat_number'-'updated_at' ORDER BY id) FROM public.tournament_entries e)
  AND tcc=(SELECT jsonb_agg(to_jsonb(c)-'updated_at' ORDER BY tournament_id,player_id,entry_number) FROM public.tournament_chip_counts c)
  AND cash=(SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM public.cashier_buyin_movements c)
  AND inventory=(SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM public.chip_inventory_ledger c)
  AND bank=(SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM public.chip_bank_ledger c)
  AND hands=(SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM public.tournament_hands c) FROM redraw673_before);
END $$;
ROLLBACK TO positive;

SAVEPOINT fault_case;
UPDATE public.centerpoint_tournament_ops_release SET enabled=true,
 allowed_club_ids=ARRAY['d4427834-5f5f-48ef-bde5-e2dc388ed00b'::uuid] WHERE id;
SET LOCAL request.jwt.claim.sub='febf2b51-fdb7-42ff-886c-b3bb1fffdc3e';
SET LOCAL request.jwt.claim.role='authenticated';
SET LOCAL request.jwt.claims='{"sub":"febf2b51-fdb7-42ff-886c-b3bb1fffdc3e","role":"authenticated"}';
SET LOCAL ROLE authenticated;
DO $$ DECLARE r jsonb; BEGIN
 r:=public.floor_plan_tournament_redraw_v1('c367013a-3ed3-48af-ad48-3915acadc50e',9,
  ARRAY['991b1e8e-da4c-461a-9b39-ddebd7a5d044'::uuid],'381733df-5402-4e27-bb62-536f01abc686');
 ASSERT r->>'ok'='true',r::text;PERFORM set_config('test.redraw673.batch',r->>'batch_id',true);
END $$;
RESET ROLE;
SAVEPOINT fault_trigger;
CREATE FUNCTION pg_temp.redraw673_receipt_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.tournament_id='c367013a-3ed3-48af-ad48-3915acadc50e' AND NEW.qr_payload->>'reason'='floor_redraw_v1'
 THEN RAISE EXCEPTION 'LOCAL673_RECEIPT_FAULT';END IF;RETURN NEW;
END $$;
CREATE TRIGGER test_redraw673_receipt_fault BEFORE INSERT ON public.seat_draw_receipts
 FOR EACH ROW EXECUTE FUNCTION pg_temp.redraw673_receipt_fault();
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN
  PERFORM public.floor_apply_tournament_redraw_v1(current_setting('test.redraw673.batch')::uuid,'381733df-5402-4e27-bb62-536f01abc687');
  RAISE EXCEPTION '673_EXPECTED_RECEIPT_FAULT';
 EXCEPTION WHEN raise_exception THEN ASSERT SQLERRM='LOCAL673_RECEIPT_FAULT',SQLERRM;END;
END $$;
RESET ROLE;
DO $$ BEGIN
 ASSERT EXISTS(SELECT 1 FROM public.table_sessions WHERE id='f60106c2-7ed5-4be3-8512-602b16eddff3' AND closed_at IS NULL AND revision=2);
 ASSERT (SELECT count(*)=8 AND sum(chip_count)=180000 FROM public.tournament_seats WHERE tournament_id='c367013a-3ed3-48af-ad48-3915acadc50e' AND is_active);
 ASSERT EXISTS(SELECT 1 FROM public.tournament_redraw_batches WHERE id=current_setting('test.redraw673.batch')::uuid AND status='planned');
 ASSERT (SELECT live_receipts=(SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM public.seat_draw_receipts c WHERE c.entry_id IN(
  SELECT e.id FROM public.tournament_entries e WHERE e.tournament_id='c367013a-3ed3-48af-ad48-3915acadc50e' AND e.status='seated') AND c.status IN('issued','printed')) FROM redraw673_before);
END $$;
ROLLBACK TO fault_trigger;
SET LOCAL ROLE authenticated;
DO $$ DECLARE r jsonb; BEGIN
 r:=public.floor_apply_tournament_redraw_v1(current_setting('test.redraw673.batch')::uuid,'381733df-5402-4e27-bb62-536f01abc687');
 ASSERT r->>'ok'='true','same intent retry after fault must succeed';
END $$;
RESET ROLE;
ROLLBACK TO fault_case;
SELECT 'REDRAW673_ENTRY_TUPLE_RECEIPTS_RETRY_CONFLICT_ACTOR_CONSERVATION_FAULT_ROLLBACK_PASS';
