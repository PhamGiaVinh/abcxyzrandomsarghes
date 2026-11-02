\set ON_ERROR_STOP on
BEGIN READ ONLY;
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 ASSERT (SELECT issued_count=9 AND revision=2 FROM public.stack_template_issuance WHERE stack_template_id='ae128140-48dc-4773-8c96-87a6e0d90219');
 ASSERT (SELECT count(*)=1 FROM floor_private.chip_mutation_receipts WHERE actor_id='febf2b51-fdb7-42ff-886c-b3bb1fffdc3e' AND request_key='e53510c6-b80c-42e2-8bf5-732e408df794' AND operation='issuance_v2' AND result->>'revision'='2');
 ASSERT (SELECT count(*)=8 AND sum(chip_count)=180000 FROM public.tournament_seats WHERE tournament_id='c367013a-3ed3-48af-ad48-3915acadc50e' AND is_active);
 ASSERT (SELECT count(*)=9 AND sum(applied_amount)=900000 FROM public.cashier_buyin_movements WHERE tournament_id='c367013a-3ed3-48af-ad48-3915acadc50e');
 ASSERT EXISTS(SELECT 1 FROM public.tournament_entries WHERE id='c08959a4-38f8-4df9-8fd4-033c1bdf8a9e' AND status='busted' AND current_stack=0);
END $$;
SET LOCAL request.jwt.claim.sub='febf2b51-fdb7-42ff-886c-b3bb1fffdc3e';
SET LOCAL request.jwt.claims='{"sub":"febf2b51-fdb7-42ff-886c-b3bb1fffdc3e","role":"authenticated"}';
SET LOCAL ROLE authenticated;
DO $$ DECLARE r jsonb; BEGIN
 r:=public.get_chip_issuance_receipt_v1('ae128140-48dc-4773-8c96-87a6e0d90219',9,1,'e53510c6-b80c-42e2-8bf5-732e408df794','febf2b51-fdb7-42ff-886c-b3bb1fffdc3e');
 ASSERT r->>'status'='committed' AND r->'result'->>'issued_count'='9' AND r->'result'->>'coupled'='false',r::text;
 r:=public.get_chip_issuance_receipt_v1('ae128140-48dc-4773-8c96-87a6e0d90219',10,1,'e53510c6-b80c-42e2-8bf5-732e408df794','febf2b51-fdb7-42ff-886c-b3bb1fffdc3e');
 ASSERT r->>'error'='IDEMPOTENCY_CONFLICT',r::text;
 r:=public.get_current_chip_inventory('c367013a-3ed3-48af-ad48-3915acadc50e');
 ASSERT r->>'total_value'='180000' AND r->>'issued_total_value'='180000' AND r->>'ledger_delta_value'='0',r::text;
 ASSERT EXISTS(SELECT 1 FROM jsonb_array_elements(r->'denominations') d WHERE d->>'value'='100' AND d->>'current_count'='180');
 ASSERT EXISTS(SELECT 1 FROM jsonb_array_elements(r->'denominations') d WHERE d->>'value'='500' AND d->>'current_count'='324');
END $$;
ROLLBACK;
SELECT 'SINGLE668_ISSUANCE9_RECEIPT_CONFLICT_CASH900K_SEATS180K_PASS';
