-- Retained real browser hands. Native cursor proof only, NOT 20-row browser acceptance.
BEGIN READ ONLY;
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
END $$;
SET LOCAL ROLE anon;
DO $$
DECLARE
 tour constant uuid := '46cab483-91e7-4220-aacf-e17bdf05269c';
 tbl constant uuid := 'd294f4a4-082b-4efc-a6ca-1f96579ea344';
 whole jsonb; page jsonb; cursor_value jsonb; combined jsonb := '[]'; pages integer := 0;
BEGIN
 whole := public.get_public_tournament_table_history_v2(tour,tbl,50,NULL,NULL);
 ASSERT whole->>'access'='public' AND whole->'nextCursor'='null'::jsonb;
 ASSERT jsonb_array_length(whole->'items')=14;
 ASSERT whole#>>'{items,0,handId}'='985238ea-a213-4f59-a0ab-295f25b4ab5b';
 ASSERT whole#>>'{items,0,result,status}'='pending';
 ASSERT NOT ((whole#>'{items,0,result}') ? 'recipients');
 LOOP
  page := public.get_public_tournament_table_history_v2(tour,tbl,3,
   (cursor_value->>'createdAt')::timestamptz,(cursor_value->>'id')::uuid);
  ASSERT page->>'access'='public' AND jsonb_array_length(page->'items') BETWEEN 1 AND 3;
  combined := combined || (page->'items');
  pages := pages + 1;
  ASSERT pages <= 5;
  EXIT WHEN page->'nextCursor'='null'::jsonb;
  ASSERT page->'nextCursor' IS DISTINCT FROM cursor_value;
  cursor_value := page->'nextCursor';
 END LOOP;
 ASSERT pages=5 AND combined=whole->'items';
 ASSERT (SELECT count(*)=count(DISTINCT x->>'handId') FROM jsonb_array_elements(combined) x);
 ASSERT public.get_public_tournament_table_history_v2(tour,tbl,3,now(),NULL)->>'error'='invalid_request';
 ASSERT public.get_public_tournament_table_history_v2(tour,tbl,3,NULL,'985238ea-a213-4f59-a0ab-295f25b4ab5b')->>'error'='invalid_request';
 ASSERT public.get_public_tournament_table_history_v2(tour,'8508d715-cd7c-4f1f-bb0d-223d967e355c',3,NULL,NULL)->>'error'='table_out_of_scope';
 RAISE NOTICE 'HISTORY576_ANON_FIVE_CURSOR_PAGES_MATCH_14_REAL_HANDS_PENDING_NOT_WINNER_PASS';
END $$;
ROLLBACK;

-- Correction between page one and page two: same cursor, current proof only.
BEGIN;
DO $$
DECLARE
 first_page jsonb; before_page jsonb; after_page jsonb; cursor_value jsonb;
 tour constant uuid := '46cab483-91e7-4220-aacf-e17bdf05269c';
 tbl constant uuid := 'd294f4a4-082b-4efc-a6ca-1f96579ea344';
BEGIN
 first_page := public.get_public_tournament_table_history_v2(tour,tbl,1,NULL,NULL);
 cursor_value := first_page->'nextCursor';
 ASSERT first_page#>>'{items,0,handId}'='985238ea-a213-4f59-a0ab-295f25b4ab5b';
 before_page := public.get_public_tournament_table_history_v2(tour,tbl,1,(cursor_value->>'createdAt')::timestamptz,(cursor_value->>'id')::uuid);
 ASSERT before_page#>>'{items,0,handId}'='3787718f-ef28-485d-aef6-342241c6fe40';
 ASSERT before_page#>>'{items,0,result,status}'='verified';
 UPDATE public.tournament_hands SET community_cards='["2c","3d","4h","5s","7c"]'::jsonb
  WHERE id='3787718f-ef28-485d-aef6-342241c6fe40' AND source_revision=15 AND status='completed' AND NOT is_voided;
 ASSERT FOUND;
 SET LOCAL ROLE anon;
 after_page := public.get_public_tournament_table_history_v2(tour,tbl,1,(cursor_value->>'createdAt')::timestamptz,(cursor_value->>'id')::uuid);
 ASSERT after_page#>>'{items,0,handId}'=before_page#>>'{items,0,handId}';
 ASSERT after_page#>>'{items,0,result,status}'='pending';
 ASSERT NOT ((after_page#>'{items,0,result}') ? 'recipients');
 ASSERT after_page->'nextCursor'=before_page->'nextCursor';
 RESET ROLE;
 RAISE NOTICE 'HISTORY576_CORRECTION_BETWEEN_CURSOR_PAGES_SUPPRESSES_OLD_PROOF_PASS_ROLLBACK_REQUIRED';
END $$;
ROLLBACK;
