\set ON_ERROR_STOP on
BEGIN READ ONLY;
DO $$ DECLARE reconstructed text; BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 ASSERT EXISTS(SELECT 1 FROM public.dealer_rotation_schedule WHERE id='4ef20172-1278-4395-90a4-d46325c08426' AND assignment_id='808821c8-7611-424e-934a-9ce262af139a' AND in_attendance_id='1f3f1e56-db9d-46b9-9e3b-531845da5802' AND status='announced' AND plan_run_id='b80eeb9a-6d09-4d40-a0ef-c7b7732b5729');
 ASSERT EXISTS(SELECT 1 FROM public.dealer_assignments WHERE id='808821c8-7611-424e-934a-9ce262af139a' AND table_session_id='f60106c2-7ed5-4be3-8512-602b16eddff3' AND status='assigned' AND pre_assigned_attendance_id='1f3f1e56-db9d-46b9-9e3b-531845da5802' AND released_at IS NULL AND swing_due_at='2026-10-24T10:37:45.441+07');
 ASSERT (SELECT count(*)=8 AND sum(chip_count)=160000 FROM public.tournament_seats WHERE tournament_id='c367013a-3ed3-48af-ad48-3915acadc50e' AND is_active);
 ASSERT (SELECT count(*)=8 AND sum(applied_amount)=800000 FROM public.cashier_buyin_movements WHERE tournament_id='c367013a-3ed3-48af-ad48-3915acadc50e');
 -- Read-only reconstruction of the exact pre662 fingerprint. Only intended
 -- dealer4 reservation fields restored in JSON; no historical row is edited.
 SELECT md5(jsonb_build_array(
 (SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM public.cashier_buyin_movements m),
 (SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM public.tournament_prize_payments p),
 (SELECT jsonb_agg(to_jsonb(l) ORDER BY id) FROM public.chip_inventory_ledger l),
 (SELECT jsonb_agg(to_jsonb(l) ORDER BY id) FROM public.chip_bank_ledger l),
 (SELECT jsonb_agg(CASE WHEN a.id='1f3f1e56-db9d-46b9-9e3b-531845da5802' THEN to_jsonb(a)||jsonb_build_object('current_state','available','updated_at',a.created_at,'pre_assigned_at',NULL,'pre_assigned_table_id',NULL) ELSE to_jsonb(a) END ORDER BY id) FROM public.dealer_attendance a),
 (SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.chip_set s WHERE club_id<>'d4427834-5f5f-48ef-bde5-e2dc388ed00b'),
 (SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.stack_template s WHERE club_id<>'d4427834-5f5f-48ef-bde5-e2dc388ed00b')
 )::text) INTO reconstructed;
 ASSERT reconstructed='71779098e31672a7265df4f714b8b5fd',reconstructed;
END $$;
ROLLBACK;
SELECT 'SINGLE662_PLAN_NO_EARLY_HANDOFF_EXACT_FINGERPRINT_RECONSTRUCTION_PASS';
