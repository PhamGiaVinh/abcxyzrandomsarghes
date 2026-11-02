\set ON_ERROR_STOP on
BEGIN READ ONLY;
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 ASSERT EXISTS(SELECT 1 FROM public.tournament_hands WHERE id='4f120026-cf38-4db3-bb05-ae6feaabf59a' AND source_revision=19 AND status='completed' AND pot_size=200 AND community_cards='[]'::jsonb);
 ASSERT (SELECT jsonb_agg(jsonb_build_array(seat_number,starting_stack,ending_stack,hole_cards) ORDER BY seat_number)='[[6,20000,20000,[]],[7,20000,19900,[]],[8,20000,20100,["As","Ad"]],[9,20000,20000,[]]]'::jsonb FROM public.hand_players WHERE hand_id='4f120026-cf38-4db3-bb05-ae6feaabf59a');
 ASSERT (SELECT count(*)=5 AND sum(action_amount)=300 FROM public.hand_actions WHERE hand_id='4f120026-cf38-4db3-bb05-ae6feaabf59a');
 ASSERT (SELECT count(*)=8 AND sum(chip_count)=160000 FROM public.tournament_seats WHERE tournament_id='c367013a-3ed3-48af-ad48-3915acadc50e' AND is_active);
 ASSERT (SELECT count(*)=8 AND sum(chip_count)=160000 FROM public.tournament_chip_counts WHERE tournament_id='c367013a-3ed3-48af-ad48-3915acadc50e');
 ASSERT (SELECT count(*)=8 FROM public.tournament_seats s JOIN public.tournament_entries e ON e.id=s.entry_id AND e.tournament_id=s.tournament_id AND e.player_id=s.player_id AND e.entry_no=s.entry_number JOIN public.tournament_chip_counts c ON c.tournament_id=e.tournament_id AND c.player_id=e.player_id AND c.entry_number=e.entry_no WHERE s.tournament_id='c367013a-3ed3-48af-ad48-3915acadc50e' AND s.is_active);
 ASSERT NOT EXISTS(SELECT 1 FROM public.tournament_seats s JOIN public.tournament_entries e ON e.id=s.entry_id JOIN public.tournament_chip_counts c ON c.tournament_id=e.tournament_id AND c.player_id=e.player_id AND c.entry_number=e.entry_no WHERE s.tournament_id='c367013a-3ed3-48af-ad48-3915acadc50e' AND s.is_active AND (s.chip_count<>e.current_stack OR s.chip_count<>c.chip_count));
 ASSERT (SELECT count(*)=8 AND sum(applied_amount)=800000 FROM public.cashier_buyin_movements WHERE tournament_id='c367013a-3ed3-48af-ad48-3915acadc50e');
 ASSERT (SELECT count(*)=1 FROM public.tournament_settlement_outcomes WHERE hand_id='4f120026-cf38-4db3-bb05-ae6feaabf59a' AND source_revision=15 AND verification_scope='historical_display' AND status='stale');
 ASSERT (SELECT count(*)=1 FROM public.tournament_settlement_outcomes o CROSS JOIN LATERAL public.get_tournament_historical_display_source_hash(o.hand_id) s WHERE o.hand_id='4f120026-cf38-4db3-bb05-ae6feaabf59a' AND o.source_revision=19 AND o.source_revision=s.source_revision AND o.source_chain_hash=s.source_chain_hash AND o.verification_scope='historical_display' AND o.status='verified');
 ASSERT (SELECT count(*)=1 FROM public.tournament_settlement_outcomes WHERE hand_id='4f120026-cf38-4db3-bb05-ae6feaabf59a' AND source_revision=19 AND verification_scope='chain' AND status='verified' AND idempotency_key='32cd5536-9f25-47f3-84bf-c5198e89555d');
 ASSERT EXISTS(SELECT 1 FROM public.tracker_correction_uat_scopes WHERE id='0353ced4-dbb7-469b-9423-294b62ba3e84' AND NOT enabled AND expires_at IS NULL);
 ASSERT NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname LIKE 'correction_browser_%' OR rolname LIKE 'history_worker_%');
 ASSERT (SELECT NOT auto_swing_enabled FROM public.club_settings WHERE club_id='d4427834-5f5f-48ef-bde5-e2dc388ed00b');
END $$;
SET LOCAL request.jwt.claim.sub='febf2b51-fdb7-42ff-886c-b3bb1fffdc3e';SET LOCAL request.jwt.claims='{"sub":"febf2b51-fdb7-42ff-886c-b3bb1fffdc3e","role":"authenticated"}';SET LOCAL ROLE authenticated;
DO $$ BEGIN
 ASSERT public.authorize_tracker_completed_hand_correction_uat_v1('c367013a-3ed3-48af-ad48-3915acadc50e','4f120026-cf38-4db3-bb05-ae6feaabf59a')->>'error'='uat_capability_disabled';
END $$;
RESET ROLE;
SET LOCAL request.jwt.claim.sub='675fe35e-60a8-4452-bb90-e79486d54da6';SET LOCAL request.jwt.claims='{"sub":"675fe35e-60a8-4452-bb90-e79486d54da6","role":"authenticated"}';SET LOCAL ROLE authenticated;
DO $$ BEGIN
 ASSERT public.authorize_tracker_completed_hand_correction_uat_v1('c367013a-3ed3-48af-ad48-3915acadc50e','4f120026-cf38-4db3-bb05-ae6feaabf59a')->>'error'='actor_not_authorized';
END $$;
ROLLBACK;
SELECT 'SINGLE648_CURRENT_PROOF_STACKS_SCOPE_CLEANUP_AND_CROSS_CLUB_DENIAL_PASS';
