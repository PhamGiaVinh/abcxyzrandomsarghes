\set ON_ERROR_STOP on
BEGIN READ ONLY;
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 ASSERT EXISTS(SELECT 1 FROM public.tournament_registrations WHERE id='7ac99c8b-d9a9-45ef-bc92-6b59f84ae806' AND tournament_id='c367013a-3ed3-48af-ad48-3915acadc50e' AND player_id='e5eded2a-1efc-406f-b794-316a39a20a51' AND status='pending' AND total_pay=100000);
 ASSERT (SELECT count(*)=1 FROM public.tournament_registrations WHERE tournament_id='c367013a-3ed3-48af-ad48-3915acadc50e' AND player_id='e5eded2a-1efc-406f-b794-316a39a20a51' AND status='pending');
 ASSERT (SELECT count(*)=1 FROM public.tournament_entries WHERE tournament_id='c367013a-3ed3-48af-ad48-3915acadc50e' AND player_id='e5eded2a-1efc-406f-b794-316a39a20a51');
 ASSERT EXISTS(SELECT 1 FROM public.tournament_entries WHERE id='c08959a4-38f8-4df9-8fd4-033c1bdf8a9e' AND entry_no=1 AND status='busted' AND current_stack=0);
 ASSERT (SELECT count(*)=7 AND sum(chip_count)=160000 FROM public.tournament_seats WHERE tournament_id='c367013a-3ed3-48af-ad48-3915acadc50e' AND is_active);
 ASSERT (SELECT count(*)=8 AND sum(applied_amount)=800000 FROM public.cashier_buyin_movements WHERE tournament_id='c367013a-3ed3-48af-ad48-3915acadc50e');
 ASSERT (SELECT count(*)=1 FROM public.notifications WHERE user_id='e5eded2a-1efc-406f-b794-316a39a20a51' AND title='Yêu cầu mua lại giải' AND data->>'tournament_id'='c367013a-3ed3-48af-ad48-3915acadc50e' AND data->>'reentry'='true');
 ASSERT EXISTS(SELECT 1 FROM public.tournament_settlement_outcomes o CROSS JOIN LATERAL public.get_tournament_historical_display_source_hash(o.hand_id)s WHERE o.hand_id='a9e63051-3333-45d3-8f76-15ab01bc08aa' AND o.source_revision=33 AND o.status='verified' AND o.verification_scope='historical_display' AND o.source_revision=s.source_revision AND o.source_chain_hash=s.source_chain_hash);
 ASSERT NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname LIKE 'history_worker_%');
END $$;
SET LOCAL ROLE anon;
DO $$ DECLARE page jsonb; BEGIN
 page:=public.get_public_tournament_table_history_v2('c367013a-3ed3-48af-ad48-3915acadc50e','c2ce77c0-2b61-4a19-bd43-4752232cc55a',20,NULL,NULL);
 ASSERT page->>'access'='public' AND jsonb_array_length(page->'items')=3;
 ASSERT page->'items'->0->>'handId'='a9e63051-3333-45d3-8f76-15ab01bc08aa' AND page->'items'->0->'result'->>'status'='verified';
END $$;
ROLLBACK;
SELECT 'SINGLE665_CURRENT_PROOF_ANON_REPLAY_SINGLE666_PENDING_REENTRY_NO_DUPLICATE_OR_UNPAID_ENTRY_PASS';
