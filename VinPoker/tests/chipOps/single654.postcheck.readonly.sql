\set ON_ERROR_STOP on
BEGIN READ ONLY;
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 ASSERT (SELECT count(*)=1 FROM public.color_up_operation WHERE tournament_id='c367013a-3ed3-48af-ad48-3915acadc50e');
 ASSERT EXISTS(SELECT 1 FROM public.color_up_operation WHERE id='5a34b7bf-4ebc-44f5-a632-296e9846f72f'
  AND idempotency_key='7adebe37-f267-4b9f-a65e-7ab11fc50f01' AND status='reversed' AND removed_count=160 AND target_added=32
  AND value_added=16000 AND value_removed=16000 AND rounding_delta=0);
 ASSERT (SELECT count(*)=4 FROM public.chip_inventory_ledger WHERE tournament_id='c367013a-3ed3-48af-ad48-3915acadc50e');
 ASSERT NOT EXISTS(SELECT denomination_id FROM public.chip_inventory_ledger WHERE tournament_id='c367013a-3ed3-48af-ad48-3915acadc50e' GROUP BY denomination_id HAVING sum(delta_count)<>0);
 ASSERT (SELECT count(*)=2 FROM public.chip_inventory_ledger WHERE ref_id='5a34b7bf-4ebc-44f5-a632-296e9846f72f' AND details='{}'::jsonb);
 ASSERT (SELECT count(*)=2 FROM public.chip_inventory_ledger WHERE ref_id='5a34b7bf-4ebc-44f5-a632-296e9846f72f' AND details='{"reverse":true}'::jsonb);
 ASSERT NOT public.chip_ops_coupling_on('d4427834-5f5f-48ef-bde5-e2dc388ed00b');
END $$;
SET LOCAL request.jwt.claim.sub='febf2b51-fdb7-42ff-886c-b3bb1fffdc3e';
SET LOCAL request.jwt.claims='{"sub":"febf2b51-fdb7-42ff-886c-b3bb1fffdc3e","role":"authenticated"}';
SET LOCAL ROLE authenticated;
DO $$ DECLARE counts jsonb; receipt jsonb; payload jsonb := '{"tournament":"c367013a-3ed3-48af-ad48-3915acadc50e","removed":"7b623bb9-f04f-46f1-a369-9ffbe1665d55","target":"49b9a63c-718d-4dd1-881f-bb5981b209d5","added":32,"level":1}'; BEGIN
 SELECT jsonb_object_agg(denomination_id,current_count) INTO counts FROM public.chip_ops_current_denom_counts('c367013a-3ed3-48af-ad48-3915acadc50e');
 ASSERT counts->>'7b623bb9-f04f-46f1-a369-9ffbe1665d55'='160' AND counts->>'49b9a63c-718d-4dd1-881f-bb5981b209d5'='288';
 receipt:=public.get_chip_color_up_receipt_v1('c367013a-3ed3-48af-ad48-3915acadc50e','color_up','7adebe37-f267-4b9f-a65e-7ab11fc50f01',payload);
 ASSERT receipt->>'status'='committed' AND receipt->'result'->>'color_up_operation_id'='5a34b7bf-4ebc-44f5-a632-296e9846f72f';
 ASSERT public.get_chip_color_up_receipt_v1('c367013a-3ed3-48af-ad48-3915acadc50e','color_up','7adebe37-f267-4b9f-a65e-7ab11fc50f01',payload||'{"added":33}'::jsonb)->>'error'='IDEMPOTENCY_CONFLICT';
END $$;
RESET ROLE;
SET LOCAL request.jwt.claim.sub='675fe35e-60a8-4452-bb90-e79486d54da6';
SET LOCAL request.jwt.claims='{"sub":"675fe35e-60a8-4452-bb90-e79486d54da6","role":"authenticated"}';
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 ASSERT public.get_chip_color_up_receipt_v1('c367013a-3ed3-48af-ad48-3915acadc50e','color_up','7adebe37-f267-4b9f-a65e-7ab11fc50f01','{"tournament":"c367013a-3ed3-48af-ad48-3915acadc50e","removed":"7b623bb9-f04f-46f1-a369-9ffbe1665d55","target":"49b9a63c-718d-4dd1-881f-bb5981b209d5","added":32,"level":1}'::jsonb)->>'error'='Forbidden';
END $$;
ROLLBACK;
SELECT 'SINGLE654_ONE_OPERATION_FOUR_COMPENSATING_LEDGER_ROWS_160K_INVENTORY_RECEIPT_AND_TENANT_PASS';
