-- Exact local retained paid journey. No ledger/issuance changes.
BEGIN;
SET LOCAL statement_timeout='15s';
DO $$ BEGIN
 IF current_database()<>'vinpoker_ops_cash115_qualified_c'
 OR current_setting('data_directory')<>'/tmp/vinpoker-sol-local-20261016-0e79a729/data'
 OR inet_server_port()<>55441 OR EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_net')
 OR NOT EXISTS(SELECT 1 FROM public.tournament_chip_set WHERE tournament_id='46cab483-91e7-4220-aacf-e17bdf05269c' AND chip_set_id='0acdaade-7124-4692-9f7e-264389d79b0f')
 THEN RAISE EXCEPTION 'retained_color_target_local_scope_required';END IF;
END $$;
GRANT USAGE ON SCHEMA auth TO authenticated;
SET LOCAL request.jwt.claim.sub='675fe35e-60a8-4452-bb90-e79486d54da6';
SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"675fe35e-60a8-4452-bb90-e79486d54da6"}';
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE color_target_read AS SELECT public.get_current_chip_inventory('46cab483-91e7-4220-aacf-e17bdf05269c') result;
RESET ROLE;
DO $$ DECLARE r jsonb; BEGIN
 SELECT result INTO r FROM color_target_read;
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(r->'denominations') d
 WHERE d->>'denomination_id'='1a7c0201-025d-4dae-81b7-a7f44cc14021' AND (d->>'value')::bigint=500
 AND (d->>'issued_count_total')::bigint=0 AND (d->>'current_count')::bigint=0)
 THEN RAISE EXCEPTION 'UNISSUED_BOUND_COLOR_TARGET_MISSING: %',r;END IF;
 IF (r->>'total_value')::bigint<>60000 OR (r->>'issued_total_value')::bigint<>60000
 OR r->>'reconciled'<>'true' THEN RAISE EXCEPTION 'color_target_changed_inventory_totals: %',r;END IF;
END $$;
SELECT 'RETAINED_UNISSUED_COLOR_TARGET_VISIBLE_TOTALS_UNCHANGED_PASS';
SET LOCAL request.jwt.claim.sub='533feda3-28c5-4194-bdf3-53a07c41305b';
SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"533feda3-28c5-4194-bdf3-53a07c41305b"}';
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 IF public.get_current_chip_inventory('46cab483-91e7-4220-aacf-e17bdf05269c')->>'error' IS DISTINCT FROM 'Forbidden'
 THEN RAISE EXCEPTION 'chip_target_outsider_read_allowed';END IF;
 BEGIN
  PERFORM * FROM public.chip_ops_current_denom_counts('46cab483-91e7-4220-aacf-e17bdf05269c');
  RAISE EXCEPTION 'chip_target_helper_outsider_read_allowed';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SELECT 'RETAINED_COLOR_TARGET_OUTSIDER_AND_DIRECT_HELPER_DENIED_PASS';
ROLLBACK;
