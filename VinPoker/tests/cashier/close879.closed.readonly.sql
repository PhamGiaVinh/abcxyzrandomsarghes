\set ON_ERROR_STOP on
-- Verify retained synthetic clone evidence; never re-create or close it again.
BEGIN READ ONLY;
SET LOCAL statement_timeout='10s';
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ranking860_local';
 ASSERT host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 ASSERT (SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database())=
  'VINPOKER_RANKING860_OWNED_LOCAL_SOURCE_vinpoker_ops_cash115_qualified_c_HEAD_ef6a26948';
 ASSERT (SELECT package_hash FROM floor_private.ranking860_install_backup)=
  'd786e04b14c42eaeb0832b97ea47f992eacd755ad1e94d9022f6a28920c778bd';
END $$;
SET LOCAL request.jwt.claim.sub='fa879000-0000-4000-8000-000000000010';
SET LOCAL request.jwt.claims='{"sub":"fa879000-0000-4000-8000-000000000010","role":"authenticated"}';
DO $$ DECLARE tour uuid:='fa879000-0000-4000-8000-000000000002';r jsonb;BEGIN
 r:=public.get_tournament_close_readiness_v1(tour);
 ASSERT r->>'ok'='true' AND r->>'already_closed'='true' AND r->>'reconciled'='true',r::text;
 ASSERT (SELECT count(*)=1 AND max(id::text)='7576a40f-41cb-4a51-b1f9-33fc21219695'
  AND max(entry_count)=0 AND max(cash_in_total)=0 AND max(prize_total)=0
  FROM public.tournament_close_report WHERE tournament_id=tour),'879 close snapshot changed';
 ASSERT (SELECT jsonb_object_agg(right(player_id::text,2),finished_place)
  FROM public.tournament_entries WHERE tournament_id=tour)='{"11":3,"12":2,"13":1,"14":4}'::jsonb,
  '879 official ranks differ from manual Floor order';
 ASSERT (SELECT count(*)=1 FROM floor_private.tournament_ranking_reviews296 WHERE tournament_id=tour);
 r:=public.get_tournament_ranking_review_receipt_v1(tour,'2a1aa9ff-78d3-4432-98af-6fbf0154ea17','fa879000-0000-4000-8000-000000000010');
 ASSERT r->>'outcome'='recorded' AND r->>'sourceCurrent'='true'
  AND r->'review'->>'source_hash'='70cf2117ca81d0b8bb46328f46dd86f9',r::text;
 r:=floor_private.felt_official_results_close_status_v1(tour);
 ASSERT r->>'status'='preserved' AND r->>'field'='4',r::text;
END $$;
ROLLBACK;
SELECT 'RANK879_RETAINED_OFFICIAL_MANUAL_ORDER_READONLY_PASS';
