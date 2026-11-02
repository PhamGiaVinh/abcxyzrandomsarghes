\set ON_ERROR_STOP on
CREATE TEMP TABLE bag626_before AS SELECT md5(jsonb_build_array(
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.chip_bag x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY tournament_id,day_number) FROM public.day_close x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.chip_ops_signoff_audit x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.chip_inventory_ledger x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.cashier_buyin_movements x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_prize_payments x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_entries x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_seats x))::text) facts;
BEGIN;
SET LOCAL statement_timeout='15s';SET LOCAL lock_timeout='2s';
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 ASSERT NOT EXISTS(SELECT 1 FROM public.chip_bag WHERE tournament_id='46cab483-91e7-4220-aacf-e17bdf05269c');
 ASSERT NOT EXISTS(SELECT 1 FROM public.day_close WHERE tournament_id='46cab483-91e7-4220-aacf-e17bdf05269c');
END $$;
SET LOCAL request.jwt.claim.sub='675fe35e-60a8-4452-bb90-e79486d54da6';SET LOCAL ROLE authenticated;
DO $$ DECLARE tour uuid:='46cab483-91e7-4220-aacf-e17bdf05269c';r jsonb;p jsonb;bag uuid;first_bag uuid;before_audit bigint;BEGIN
 r:=public.get_bag_tag_state(tour,1);
 ASSERT jsonb_array_length(r->'players')=2 AND (r->'reconciliation'->>'total_expected_value')::bigint=60000;
 FOR p IN SELECT x FROM jsonb_array_elements(r->'players') x LOOP
  r:=public.chip_ops_record_bag(tour,1,(p->>'player_id')::uuid,'BAG626-'||(p->>'seat_number'),NULL,true);
  ASSERT r->>'status'='ok' AND r->>'exact'='true' AND r->>'sealed'='true';
  IF p->>'seat_number'='1' THEN first_bag:=(r->>'chip_bag_id')::uuid;END IF;
 END LOOP;
 r:=public.get_bag_tag_state(tour,1);
 ASSERT (r->'reconciliation'->>'total_expected_value')::bigint=60000;
 ASSERT (r->'reconciliation'->>'total_counted_value')::bigint=60000 AND r->'reconciliation'->>'all_zero'='true';
 ASSERT NOT EXISTS(SELECT 1 FROM jsonb_array_elements(r->'players') x WHERE x->>'table_name' IS DISTINCT FROM 'Paid journey TEST 2');
 ASSERT public.chip_ops_close_day(tour,1,0,false,NULL)->>'status'='ok';
 ASSERT public.chip_ops_unseal_bag(first_bag)->>'error'='REOPEN_FIRST';
 ASSERT public.chip_ops_record_bag(tour,1,'5f4dd4c4-a9d0-43a9-b523-ab5ec5d3c103','BAG626-1',58900,true)->>'error'='DAY_LOCKED';
 SELECT count(*) INTO before_audit FROM public.chip_ops_signoff_audit WHERE tournament_id=tour;
 ASSERT public.chip_ops_close_day(tour,1,0,false,NULL)->>'already_locked'='true';
 ASSERT (SELECT count(*) FROM public.chip_ops_signoff_audit WHERE tournament_id=tour)=before_audit;
 ASSERT public.chip_ops_reopen_day(tour,1,1)->>'status'='ok';
 ASSERT public.chip_ops_unseal_bag(first_bag)->>'status'='ok';
 r:=public.chip_ops_close_day(tour,1,2,false,NULL);
 ASSERT r->>'error'='VARIANCE_NONZERO';
 ASSERT (SELECT status='open' AND version=2 FROM public.day_close WHERE tournament_id=tour AND day_number=1);
 r:=public.chip_ops_record_bag(tour,1,'5f4dd4c4-a9d0-43a9-b523-ab5ec5d3c103','BAG626-1',NULL,true);
 ASSERT r->>'status'='ok' AND (r->>'total_value')::bigint=58900;
 ASSERT public.chip_ops_close_day(tour,1,2,false,NULL)->>'status'='ok';
 ASSERT (SELECT status='locked' AND version=3 AND all_zero AND counted_total_value=60000 FROM public.day_close WHERE tournament_id=tour AND day_number=1);
 ASSERT (SELECT count(*)=2 AND sum(total_value)=60000 AND bool_and(sealed) FROM public.chip_bag WHERE tournament_id=tour);
END $$;
RESET ROLE;
ROLLBACK;
DO $$ BEGIN
 ASSERT (SELECT facts FROM bag626_before)=md5(jsonb_build_array(
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.chip_bag x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY tournament_id,day_number) FROM public.day_close x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.chip_ops_signoff_audit x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.chip_inventory_ledger x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.cashier_buyin_movements x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_prize_payments x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_entries x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_seats x))::text);
END $$;
SELECT 'BAG626_ACTUAL_OWNER_SEAL_RECON_CLOSE_REPLAY_REOPEN_RESEAL_DENIALS_FULL_ROLLBACK_PASS';
