\set ON_ERROR_STOP on
BEGIN;
SET LOCAL statement_timeout='15s';
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
END $$;
CREATE TEMP TABLE close672_facts AS SELECT
 (SELECT jsonb_agg(to_jsonb(a)-'current_state'-'updated_at'-'pre_assigned_at'-'pre_assigned_table_id' ORDER BY id) FROM public.dealer_attendance a) payroll,
 (SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.cashier_buyin_movements a) cash;
SAVEPOINT ordinary_close;
SET LOCAL request.jwt.claim.sub='febf2b51-fdb7-42ff-886c-b3bb1fffdc3e';
SET LOCAL request.jwt.claim.role='authenticated';
SET LOCAL ROLE authenticated;
DO $$ DECLARE r jsonb; BEGIN
 r:=public.floor_free_sit_player_v1('86dc0814-e2f2-46ee-86f0-a68e9f57d6b7',2,1,20000,'381733df-5402-4e27-bb62-536f01abc676','local672_closure_boundary');
 ASSERT r->>'ok'='true' AND r->>'revision'='3' AND r->>'stack_preserved'='20000',r::text;
 r:=public.close_tournament_table_v4('4f493b5e-ef25-4e55-bafd-faab24fcade9',3,'381733df-5402-4e27-bb62-536f01abc677');
 ASSERT r->>'ok'='true' AND r->>'closed'='true',r::text;
END $$;
RESET ROLE;
DO $$ BEGIN
 ASSERT EXISTS(SELECT 1 FROM public.dealer_rotation_schedule WHERE id='4ef20172-1278-4395-90a4-d46325c08426' AND status='cancelled');
 ASSERT EXISTS(SELECT 1 FROM public.dealer_attendance WHERE id='1f3f1e56-db9d-46b9-9e3b-531845da5802' AND current_state='available' AND pre_assigned_table_id IS NULL);
 ASSERT EXISTS(SELECT 1 FROM public.tournament_entries WHERE id='86dc0814-e2f2-46ee-86f0-a68e9f57d6b7' AND current_stack=20000);
END $$;
ROLLBACK TO ordinary_close;

SAVEPOINT legacy_close;
SET LOCAL request.jwt.claim.sub='febf2b51-fdb7-42ff-886c-b3bb1fffdc3e';
SET LOCAL request.jwt.claim.role='authenticated';
SET LOCAL ROLE authenticated;
DO $$ DECLARE r jsonb; BEGIN
 r:=public.floor_free_sit_player_v1('86dc0814-e2f2-46ee-86f0-a68e9f57d6b7',2,1,20000,'381733df-5402-4e27-bb62-536f01abc676','local672_closure_boundary');
 ASSERT r->>'ok'='true',r::text;
 r:=public.floor_break_table_v3('4f493b5e-ef25-4e55-bafd-faab24fcade9',3,'381733df-5402-4e27-bb62-536f01abc678','fill_lowest_table');
 ASSERT r->>'ok'='true' AND r->>'closed'='true',r::text;
END $$;
RESET ROLE;
DO $$ BEGIN
 ASSERT EXISTS(SELECT 1 FROM public.dealer_rotation_schedule WHERE id='4ef20172-1278-4395-90a4-d46325c08426' AND status='cancelled');
 ASSERT EXISTS(SELECT 1 FROM public.dealer_attendance WHERE id='1f3f1e56-db9d-46b9-9e3b-531845da5802' AND current_state='available' AND pre_assigned_table_id IS NULL);
END $$;
ROLLBACK TO legacy_close;

SAVEPOINT redraw_close;
-- Existing exact-local release-gate test pattern. This activation is isolated
-- to this transaction and restored by ROLLBACK TO redraw_close; not a bypass.
UPDATE public.centerpoint_tournament_ops_release SET enabled=true,
 allowed_club_ids=ARRAY['d4427834-5f5f-48ef-bde5-e2dc388ed00b'::uuid] WHERE id;
SET LOCAL request.jwt.claim.sub='febf2b51-fdb7-42ff-886c-b3bb1fffdc3e';
SET LOCAL request.jwt.claim.role='authenticated';
SET LOCAL ROLE authenticated;
DO $$ DECLARE r jsonb; batch uuid; BEGIN
 r:=public.floor_plan_tournament_redraw_v1('c367013a-3ed3-48af-ad48-3915acadc50e',9,
  ARRAY['991b1e8e-da4c-461a-9b39-ddebd7a5d044'::uuid],'381733df-5402-4e27-bb62-536f01abc679');
 ASSERT r->>'ok'='true',r::text;batch:=(r->>'batch_id')::uuid;
 ASSERT batch IS NOT NULL,r::text;
 r:=public.floor_apply_tournament_redraw_v1(batch,'381733df-5402-4e27-bb62-536f01abc680');
 ASSERT r->>'ok'='true' AND r->>'status'='applied',r::text;
END $$;
RESET ROLE;
DO $$ BEGIN
 ASSERT EXISTS(SELECT 1 FROM public.table_sessions WHERE id='f60106c2-7ed5-4be3-8512-602b16eddff3' AND closed_at IS NOT NULL);
 ASSERT EXISTS(SELECT 1 FROM public.dealer_rotation_schedule WHERE id='4ef20172-1278-4395-90a4-d46325c08426' AND status='cancelled');
 ASSERT EXISTS(SELECT 1 FROM public.dealer_attendance WHERE id='1f3f1e56-db9d-46b9-9e3b-531845da5802' AND current_state='available' AND pre_assigned_table_id IS NULL);
 ASSERT (SELECT count(*)=8 AND sum(chip_count)=180000 FROM public.tournament_seats WHERE tournament_id='c367013a-3ed3-48af-ad48-3915acadc50e' AND is_active AND table_id='c2ce77c0-2b61-4a19-bd43-4752232cc55a');
 ASSERT NOT EXISTS(SELECT 1 FROM public.tournament_entries e WHERE e.tournament_id='c367013a-3ed3-48af-ad48-3915acadc50e' AND e.status='seated'
  AND NOT EXISTS(SELECT 1 FROM public.tournament_seats s WHERE s.id=e.seat_id AND s.entry_id=e.id AND s.is_active)), 'redraw must update entry pointers to the new active seat';
 ASSERT (SELECT count(*)=8 FROM public.seat_draw_receipts r JOIN public.tournament_entries e ON e.id=r.entry_id
  JOIN public.tournament_seats s ON s.id=r.seat_id AND s.entry_id=e.id AND s.is_active
  WHERE e.tournament_id='c367013a-3ed3-48af-ad48-3915acadc50e' AND e.status='seated' AND r.status='issued'
    AND r.qr_payload->>'reason'='floor_redraw_v1'), 'all redraw participants need current seat receipts';
 ASSERT NOT EXISTS(SELECT 1 FROM public.seat_draw_receipts r JOIN public.tournament_entries e ON e.id=r.entry_id
  WHERE e.tournament_id='c367013a-3ed3-48af-ad48-3915acadc50e' AND e.status='seated' AND r.status IN('issued','printed')
    AND NOT EXISTS(SELECT 1 FROM public.tournament_seats s WHERE s.id=r.seat_id AND s.is_active)), 'no live ticket may point to a retired seat';
 ASSERT (SELECT payroll=(SELECT jsonb_agg(to_jsonb(a)-'current_state'-'updated_at'-'pre_assigned_at'-'pre_assigned_table_id' ORDER BY id) FROM public.dealer_attendance a) AND cash=(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.cashier_buyin_movements a) FROM close672_facts);
END $$;
ROLLBACK TO redraw_close;
ROLLBACK;
SELECT 'CLOSE672_ORDINARY_V4_LEGACY_EMPTY_BREAK_REDRAW_CANCEL_RESERVATION_ROLLBACK_PASS';
