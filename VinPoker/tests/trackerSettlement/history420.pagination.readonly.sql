\set ON_ERROR_STOP on
BEGIN READ ONLY;
SET LOCAL statement_timeout='15s';
DO $$ DECLARE expected jsonb; BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 SELECT jsonb_agg(h.id ORDER BY h.created_at DESC,h.id DESC) INTO expected FROM public.tournament_hands h
 WHERE h.tournament_id='4cd3af4d-7e1d-4042-855f-04fb6777e580' AND h.tournament_table_id='8508d715-cd7c-4f1f-bb0d-223d967e355c'
  AND h.status='completed' AND NOT coalesce(h.is_voided,false);
 ASSERT jsonb_array_length(expected)=13,'exact retained Main167 completed hand count drift';
 PERFORM set_config('vinpoker.history420_expected',expected::text,true);
END $$;
SET LOCAL ROLE anon;
DO $$ DECLARE page jsonb;item jsonb;cursor jsonb;seen jsonb:='[]';before_time timestamptz;before_id uuid;
 previous_time timestamptz;previous_id uuid;item_time timestamptz;item_id uuid;pages integer:=0;page_size integer:=3; BEGIN
 LOOP
  page:=public.get_public_tournament_table_history_v2('4cd3af4d-7e1d-4042-855f-04fb6777e580','8508d715-cd7c-4f1f-bb0d-223d967e355c',page_size,before_time,before_id);
  pages:=pages+1;ASSERT pages<=5,'pagination cursor never terminates';
  ASSERT page->>'access'='public' AND NOT(page?'error');
  ASSERT jsonb_array_length(page->'items') BETWEEN 1 AND page_size;
  FOR item IN SELECT value FROM jsonb_array_elements(page->'items') LOOP
   item_id:=(item->>'handId')::uuid;item_time:=(item->>'createdAt')::timestamptz;
   ASSERT NOT seen @> jsonb_build_array(item_id),'duplicate hand across pages';
   IF previous_time IS NOT NULL THEN ASSERT (item_time,item_id)<(previous_time,previous_id),'unstable timestamp/id ordering';END IF;
   seen:=seen||jsonb_build_array(item_id);previous_time:=item_time;previous_id:=item_id;
  END LOOP;
  cursor:=page->'nextCursor';
  EXIT WHEN cursor IS NULL OR cursor='null';
  ASSERT jsonb_array_length(page->'items')=page_size;
  ASSERT (cursor->>'id')::uuid=previous_id AND (cursor->>'createdAt')::timestamptz=previous_time,'cursor is not last returned tuple';
  before_time:=(cursor->>'createdAt')::timestamptz;before_id:=(cursor->>'id')::uuid;
 END LOOP;
 ASSERT pages=5 AND seen=current_setting('vinpoker.history420_expected')::jsonb,'missing/extra/reordered completed hands';
 ASSERT seen->>0='31c2e710-590f-4e82-b8ff-c8e887c5b314';
 page:=public.get_public_tournament_table_history_v2('4cd3af4d-7e1d-4042-855f-04fb6777e580','8508d715-cd7c-4f1f-bb0d-223d967e355c',3,previous_time,previous_id);
 ASSERT page->'items'='[]'::jsonb AND page->'nextCursor'='null'::jsonb,'read past tail must be empty';
 page:=public.get_public_tournament_table_history_v2('4cd3af4d-7e1d-4042-855f-04fb6777e580','8508d715-cd7c-4f1f-bb0d-223d967e355c',3,previous_time,NULL);
 ASSERT page->>'error'='invalid_request';
 page:=public.get_public_tournament_table_history_v2('4cd3af4d-7e1d-4042-855f-04fb6777e580','d294f4a4-082b-4efc-a6ca-1f96579ea344',3,NULL,NULL);
 ASSERT page->>'error'='table_out_of_scope';
 RAISE NOTICE 'HISTORY420_ANON_FIVE_PAGES_ALL13_ONCE_ORDERED_EXACT_CURSOR_TAIL_EMPTY_PARTIAL_CURSOR_SCOPE_DENIED_PASS';
END $$;
ROLLBACK;
