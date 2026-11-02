BEGIN;
SET LOCAL statement_timeout='15s';
DO $$
DECLARE tour uuid:='829e61fe-0ac8-4ced-950d-ab76cb8dadc5';
  target uuid:='83d02eb2-8f65-4172-a94f-fa34c322e271'; tbl uuid; expected uuid[]; seen uuid[]:='{}';
  page jsonb; item jsonb; cursor_time timestamptz; cursor_id uuid; calls int:=0; before_revision bigint;
  later_target uuid; later_revision bigint; saw_invalidated_later boolean:=false;
BEGIN
  ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND inet_server_addr()='127.0.0.1'::inet;
  SELECT tournament_table_id,source_revision INTO STRICT tbl,before_revision FROM public.tournament_hands WHERE id=target AND tournament_id=tour AND status='completed';
  SELECT array_agg(id ORDER BY created_at DESC,id DESC) INTO expected FROM public.tournament_hands
    WHERE tournament_id=tour AND tournament_table_id=tbl AND status='completed' AND NOT COALESCE(is_voided,false);
  ASSERT cardinality(expected)>2,'multi-page fixture required';
  SELECT h.id,h.source_revision INTO STRICT later_target,later_revision
    FROM public.tournament_hands h
    WHERE h.id=ANY(expected[3:cardinality(expected)])
      AND EXISTS(SELECT 1 FROM public.tournament_settlement_outcomes o
        WHERE o.hand_id=h.id AND o.source_revision=h.source_revision AND o.status='verified')
    ORDER BY h.created_at,h.id LIMIT 1;
  PERFORM set_config('request.jwt.claims','{"role":"anon"}',true);
  PERFORM set_config('role','anon',true);
  LOOP
    calls:=calls+1;ASSERT calls<=cardinality(expected)+1,'pagination did not terminate';
    page:=public.get_public_tournament_table_history_v2(tour,tbl,2,cursor_time,cursor_id);
    ASSERT page->>'access'='public','fixture is not publicly readable';
    FOR item IN SELECT value FROM jsonb_array_elements(page->'items') LOOP
      ASSERT NOT (item->>'handId')::uuid=ANY(seen),'duplicate hand across keyset pages';
      seen:=array_append(seen,(item->>'handId')::uuid);
      IF item->>'handId'=later_target::text THEN
        ASSERT calls>1,'invalidation target must be beyond initial page';
        ASSERT item->'result'->>'status'='pending','later page retained invalidated proof';
        ASSERT NOT (item->'result' ? 'recipients'),'later page leaked former winner';
        saw_invalidated_later:=true;
      END IF;
    END LOOP;
    EXIT WHEN page->'nextCursor'='null'::jsonb;
    cursor_time:=(page->'nextCursor'->>'createdAt')::timestamptz;
    cursor_id:=(page->'nextCursor'->>'id')::uuid;
    ASSERT cursor_time IS NOT NULL AND cursor_id IS NOT NULL,'malformed cursor';
    IF calls=1 THEN
      -- Change a later-page generation between real anonymous RPC calls.
      -- Same transaction, rollback-only: NOT concurrent/canonical correction proof.
      PERFORM set_config('role','none',true);
      UPDATE public.tournament_hands SET source_revision=source_revision+1 WHERE id=later_target;
      ASSERT (SELECT source_revision FROM public.tournament_hands WHERE id=later_target)=later_revision+1;
      PERFORM set_config('role','anon',true);
    END IF;
  END LOOP;
  ASSERT seen=expected,'keyset pages omitted or reordered completed hands';
  ASSERT saw_invalidated_later,'later-page pending result was not observed';
  PERFORM set_config('role','none',true);
  ASSERT EXISTS(SELECT 1 FROM public.tournament_settlement_outcomes WHERE hand_id=target AND source_revision=before_revision AND status='verified'),'verified target required';
  -- Actual source-generation change between anonymous reads; never committed.
  UPDATE public.tournament_hands SET source_revision=source_revision+1 WHERE id=target;
  PERFORM set_config('role','anon',true);
  page:=public.get_public_tournament_table_history_v2(tour,tbl,50,NULL,NULL);
  SELECT value INTO STRICT item FROM jsonb_array_elements(page->'items') WHERE value->>'handId'=target::text;
  ASSERT item->'result'->>'status'='pending','anonymous history retained corrected proof';
  ASSERT NOT (item->'result' ? 'recipients'),'pending history leaked former winner payload';
  PERFORM set_config('role','none',true);
END $$;
ROLLBACK;
\echo HISTORY_ANON_KEYSET_MID_PAGINATION_AND_REFRESH_INVALIDATION_ROLLBACK_PASS
