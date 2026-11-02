-- Warm native SQL baseline only, NOT HTTP/UI/hosted latency or load acceptance.
-- Same completed TEST tour; cannot represent an active40-table operating load.
BEGIN READ ONLY;
SET LOCAL statement_timeout='20s';
SET LOCAL request.jwt.claim.sub='a364de8e-06b1-4428-a20d-ac614ec406e5';
SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"a364de8e-06b1-4428-a20d-ac614ec406e5"}';
SET LOCAL ROLE authenticated;
DO $$
DECLARE test record;payload jsonb;started timestamptz;samples numeric[];ordered numeric[];i int;
BEGIN
  ASSERT current_database()='vinpoker_ops_cash115_qualified_c';
  FOR test IN SELECT * FROM (VALUES
    ('Floor','get_floor_tournament_table_inventory_v1',
      $q$SELECT coalesce(jsonb_agg(x),'[]'::jsonb) FROM public.get_floor_tournament_table_inventory_v1('829e61fe-0ac8-4ced-950d-ab76cb8dadc5')x$q$),
    ('Tracker','get_tracker_hand_input_tables_v4',
      $q$SELECT coalesce(jsonb_agg(x),'[]'::jsonb) FROM public.get_tracker_hand_input_tables_v4('829e61fe-0ac8-4ced-950d-ab76cb8dadc5')x$q$),
    ('Swing','get_dealer_swing_health',
      $q$SELECT to_jsonb(public.get_dealer_swing_health(ARRAY['349ecf35-50ba-4c71-a581-15dc45f1cd01'::uuid]))$q$),
    ('Cashier','cashier_tour_worklist_v1',
      $q$SELECT to_jsonb(public.cashier_tour_worklist_v1('349ecf35-50ba-4c71-a581-15dc45f1cd01','829e61fe-0ac8-4ced-950d-ab76cb8dadc5','','all',0,50))$q$),
    ('Chip','get_current_chip_inventory',
      $q$SELECT coalesce(jsonb_agg(x),'[]'::jsonb) FROM public.get_current_chip_inventory('829e61fe-0ac8-4ced-950d-ab76cb8dadc5')x$q$)
  ) AS cases(screen,rpc,statement)
  LOOP
    -- Warmup excluded. Error responses are not counted as fast successful reads.
    EXECUTE test.statement INTO payload;
    ASSERT payload IS NOT NULL AND payload::text NOT LIKE '%"error":%',test.rpc||' returned error';
    samples:=ARRAY[]::numeric[];
    FOR i IN 1..20 LOOP
      started:=clock_timestamp();
      EXECUTE test.statement INTO payload;
      samples:=array_append(samples,round(extract(epoch FROM clock_timestamp()-started)*1000,3));
      ASSERT payload IS NOT NULL AND payload::text NOT LIKE '%"error":%',test.rpc||' returned error';
    END LOOP;
    SELECT array_agg(value ORDER BY value) INTO ordered FROM unnest(samples)value;
    RAISE NOTICE 'R13_NATIVE_SQL_WARM_BASELINE %',jsonb_build_object('screen',test.screen,'rpc',test.rpc,
      'samples_ms',samples,'p95_nearest_rank_ms',ordered[19],'max_ms',ordered[20],
      'count',20,'scope','completed_single_day_TEST','model','PG17_SQL_ONLY_NO_HTTP_NO_BROWSER');
  END LOOP;
END $$;
ROLLBACK;
