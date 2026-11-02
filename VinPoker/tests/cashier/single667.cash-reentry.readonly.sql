\set ON_ERROR_STOP on
BEGIN READ ONLY;
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 ASSERT (SELECT count(*)=1 AND sum(applied_amount)=100000 FROM public.cashier_buyin_movements WHERE registration_id='7ac99c8b-d9a9-45ef-bc92-6b59f84ae806');
 ASSERT EXISTS(SELECT 1 FROM public.cashier_buyin_movements WHERE id='dfbbaac3-3f7d-42cd-8d5b-fb935ff0eb3a' AND idempotency_key='cash:94f24c36-bcb5-4bbf-98c9-39785924f884');
 ASSERT EXISTS(SELECT 1 FROM public.tournament_entries WHERE id='86dc0814-e2f2-46ee-86f0-a68e9f57d6b7' AND registration_id='7ac99c8b-d9a9-45ef-bc92-6b59f84ae806' AND player_id='e5eded2a-1efc-406f-b794-316a39a20a51' AND entry_no=2 AND status='seated' AND current_stack=20000);
 ASSERT EXISTS(SELECT 1 FROM public.tournament_seats WHERE id='84885ae4-208c-4831-aec2-6015caa0fb53' AND entry_id='86dc0814-e2f2-46ee-86f0-a68e9f57d6b7' AND table_id='4f493b5e-ef25-4e55-bafd-faab24fcade9' AND seat_number=2 AND chip_count=20000 AND is_active);
 ASSERT EXISTS(SELECT 1 FROM public.tournament_entries WHERE id='c08959a4-38f8-4df9-8fd4-033c1bdf8a9e' AND entry_no=1 AND status='busted' AND current_stack=0);
 ASSERT EXISTS(SELECT 1 FROM public.seat_draw_receipts WHERE id='e48c7659-8ccf-49df-bb21-7633ebd6aff6' AND entry_id='86dc0814-e2f2-46ee-86f0-a68e9f57d6b7' AND receipt_code='T31-S2-26A3E3');
 ASSERT (SELECT count(*)=8 AND sum(chip_count)=180000 FROM public.tournament_seats WHERE tournament_id='c367013a-3ed3-48af-ad48-3915acadc50e' AND is_active);
 ASSERT (SELECT count(*)=9 AND sum(applied_amount)=900000 FROM public.cashier_buyin_movements WHERE tournament_id='c367013a-3ed3-48af-ad48-3915acadc50e');
 ASSERT (SELECT count(*)=1 FROM public.notifications WHERE user_id='e5eded2a-1efc-406f-b794-316a39a20a51' AND data->>'registration_id'='7ac99c8b-d9a9-45ef-bc92-6b59f84ae806' AND data->>'receipt_code'='T31-S2-26A3E3');
END $$;
SET LOCAL request.jwt.claim.sub='febf2b51-fdb7-42ff-886c-b3bb1fffdc3e';
SET LOCAL request.jwt.claims='{"sub":"febf2b51-fdb7-42ff-886c-b3bb1fffdc3e","role":"authenticated"}';
SET LOCAL ROLE authenticated;
DO $$ DECLARE intent jsonb:=jsonb_build_object('actor_id','febf2b51-fdb7-42ff-886c-b3bb1fffdc3e','club_id','d4427834-5f5f-48ef-bde5-e2dc388ed00b','tournament_id','c367013a-3ed3-48af-ad48-3915acadc50e','registration_id','7ac99c8b-d9a9-45ef-bc92-6b59f84ae806','amount',100000,'request_id','94f24c36-bcb5-4bbf-98c9-39785924f884'); result jsonb; BEGIN
 result:=public.resolve_cashier_cash_buyin_intent_v1(intent,'read');
 ASSERT result->>'status'='recorded' AND result->'intent'=intent,result::text;
 result:=public.resolve_cashier_cash_buyin_intent_v1(intent||jsonb_build_object('amount',99999),'read');
 ASSERT result->>'error'='IDEMPOTENCY_CONFLICT',result::text;
 -- Deliberately still eight issued denomination stacks: next Chip Master step
 -- must add the ninth; this checkpoint must not claim physical inventory sync.
 result:=public.get_chip_issuance_state_v1('ae128140-48dc-4773-8c96-87a6e0d90219','febf2b51-fdb7-42ff-886c-b3bb1fffdc3e');
 ASSERT result->>'issued_count'='8',result::text;
END $$;
ROLLBACK;
SELECT 'SINGLE667_ONE_CASH_RECEIPT_ENTRY2_SEAT_LOST_RESPONSE_RECOVERY_CHIP_ISSUE_STILL_PENDING_PASS';
