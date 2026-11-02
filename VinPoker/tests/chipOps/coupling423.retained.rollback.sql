\set ON_ERROR_STOP on
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 ASSERT NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname IN('pg_net','pg_cron'));
 ASSERT NOT public.chip_ops_coupling_on('a8e7d1b7-fdaa-45ad-b0a1-f894b6315760');
 ASSERT NOT EXISTS(SELECT 1 FROM public.chip_bank WHERE denomination_id IN('e7b5353a-f675-4f9f-9910-94be26189ca7','1a7c0201-025d-4dae-81b7-a7f44cc14021'));
END $$;
CREATE TEMP TABLE chip423_before AS SELECT
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY denomination_id,club_id) FROM public.chip_bank x) banks,
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.chip_bank_ledger x) bank_ledger,
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.chip_inventory_ledger x) inventory_ledger,
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.color_up_operation x) operations,
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY club_id) FROM public.chip_ops_bank_config x) config;
BEGIN;
SET LOCAL statement_timeout='15s';SET LOCAL lock_timeout='2s';
-- TEST backing reserves only, invisible outside this transaction. No fixture,
-- denomination, issuance, paid entry or replacement journey is created.
INSERT INTO public.chip_bank(club_id,denomination_id,on_hand_count) VALUES
 ('a8e7d1b7-fdaa-45ad-b0a1-f894b6315760','e7b5353a-f675-4f9f-9910-94be26189ca7',0),
 ('a8e7d1b7-fdaa-45ad-b0a1-f894b6315760','1a7c0201-025d-4dae-81b7-a7f44cc14021',120);
SET LOCAL request.jwt.claim.sub='675fe35e-60a8-4452-bb90-e79486d54da6';
SET LOCAL ROLE authenticated;
DO $$ DECLARE
 tour uuid:='46cab483-91e7-4220-aacf-e17bdf05269c';club uuid:='a8e7d1b7-fdaa-45ad-b0a1-f894b6315760';
 low uuid:='e7b5353a-f675-4f9f-9910-94be26189ca7';high uuid:='1a7c0201-025d-4dae-81b7-a7f44cc14021';
 key text:=gen_random_uuid()::text;undo_key text:=gen_random_uuid()::text;op uuid;r jsonb;again jsonb;
 original jsonb;cash_before jsonb;version integer;ledger_before jsonb;bank_before jsonb; BEGIN
 original:=public.get_current_chip_inventory(tour);
 ASSERT (original->>'total_value')::bigint=60000 AND original->>'reconciled'='true';
 SELECT jsonb_build_array((SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.cashier_buyin_movements x WHERE tournament_id=tour),
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_entries x WHERE tournament_id=tour),
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_seats x WHERE tournament_id=tour)) INTO cash_before;
 ASSERT public.chip_ops_set_bank_coupling(club,true)->>'status'='ok';
 r:=public.chip_ops_color_up(tour,low,high,120,1,key);
 ASSERT r->>'status'='ok' AND (r->>'rounding_delta')::bigint=0;
 ASSERT (r->>'removed_count')::bigint=600;op:=(r->>'color_up_operation_id')::uuid;
 ASSERT (SELECT on_hand_count=600 FROM public.chip_bank WHERE club_id=club AND denomination_id=low);
 ASSERT (SELECT on_hand_count=0 FROM public.chip_bank WHERE club_id=club AND denomination_id=high);
 ASSERT (SELECT sum(b.on_hand_count*d.value)=60000 FROM public.chip_bank b JOIN public.chip_set_denomination d ON d.id=b.denomination_id WHERE b.club_id=club AND b.denomination_id IN(low,high));
 ASSERT (public.get_current_chip_inventory(tour)->>'total_value')::bigint=60000;
 SELECT jsonb_agg(to_jsonb(x) ORDER BY id) INTO ledger_before FROM public.chip_inventory_ledger x WHERE tournament_id=tour;
 SELECT jsonb_agg(to_jsonb(x) ORDER BY id) INTO bank_before FROM public.chip_bank_ledger x WHERE club_id=club AND ref_id=op;
 ASSERT public.chip_ops_color_up(tour,low,high,120,1,key)=r;
 ASSERT public.chip_ops_color_up(tour,low,high,119,1,key)->>'error'='IDEMPOTENCY_CONFLICT';
 ASSERT ledger_before=(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.chip_inventory_ledger x WHERE tournament_id=tour);
 SELECT b.version INTO version FROM public.chip_bank b WHERE b.club_id=club AND b.denomination_id=low;
 again:=public.chip_ops_bank_adjust_v2(club,low,'xuat',100,tour,version,gen_random_uuid()::text,auth.uid());
 ASSERT again->>'outcome'='applied';
 ASSERT public.chip_ops_reverse_color_up(op,undo_key)->>'error'='BANK_NEGATIVE';
 ASSERT ledger_before=(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.chip_inventory_ledger x WHERE tournament_id=tour),'failed undo changed inventory ledger';
 SELECT b.version INTO version FROM public.chip_bank b WHERE b.club_id=club AND b.denomination_id=low;
 ASSERT public.chip_ops_bank_adjust_v2(club,low,'thu',100,tour,version,gen_random_uuid()::text,auth.uid())->>'outcome'='applied';
 again:=public.chip_ops_reverse_color_up(op,undo_key);
 ASSERT again->>'status'='ok' AND again->>'bank_reversed'='true';
 ASSERT public.chip_ops_reverse_color_up(op,undo_key)=again;
 ASSERT public.get_current_chip_inventory(tour)=original,'undo did not restore exact issued inventory projection';
 ASSERT (SELECT on_hand_count=0 FROM public.chip_bank WHERE club_id=club AND denomination_id=low);
 ASSERT (SELECT on_hand_count=120 FROM public.chip_bank WHERE club_id=club AND denomination_id=high);
 ASSERT NOT EXISTS(SELECT 1 FROM public.chip_bank WHERE club_id=club AND denomination_id IN(low,high) AND on_hand_count<0);
 ASSERT NOT EXISTS(SELECT 1 FROM jsonb_array_elements(ledger_before) old WHERE NOT EXISTS(SELECT 1 FROM public.chip_inventory_ledger x WHERE to_jsonb(x)=old));
 ASSERT NOT EXISTS(SELECT 1 FROM jsonb_array_elements(bank_before) old WHERE NOT EXISTS(SELECT 1 FROM public.chip_bank_ledger x WHERE to_jsonb(x)=old));
 ASSERT cash_before=jsonb_build_array((SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.cashier_buyin_movements x WHERE tournament_id=tour),
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_entries x WHERE tournament_id=tour),
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_seats x WHERE tournament_id=tour));
 RAISE NOTICE 'COUPLING423_ON_COLOR_REPLAY_CONFLICT_BANK_V2_UNDO_DENIAL_REPAIR_UNDO_CONSERVATION_AUDIT_PASS';
END $$;
RESET ROLE;
ROLLBACK;
DO $$ BEGIN
 ASSERT (SELECT banks FROM chip423_before) IS NOT DISTINCT FROM (SELECT jsonb_agg(to_jsonb(x) ORDER BY denomination_id,club_id) FROM public.chip_bank x);
 ASSERT (SELECT bank_ledger FROM chip423_before) IS NOT DISTINCT FROM (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.chip_bank_ledger x);
 ASSERT (SELECT inventory_ledger FROM chip423_before) IS NOT DISTINCT FROM (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.chip_inventory_ledger x);
 ASSERT (SELECT operations FROM chip423_before) IS NOT DISTINCT FROM (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.color_up_operation x);
 ASSERT (SELECT config FROM chip423_before) IS NOT DISTINCT FROM (SELECT jsonb_agg(to_jsonb(x) ORDER BY club_id) FROM public.chip_ops_bank_config x);
 RAISE NOTICE 'COUPLING423_FULL_OUTER_ROLLBACK_BANK_LEDGER_INVENTORY_OPERATIONS_CONFIG_UNCHANGED_PASS';
END $$;
