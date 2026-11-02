BEGIN READ ONLY;
DO $test$ DECLARE fields text[];covered text[];relation regclass;
BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 SELECT array_agg(DISTINCT match[2] ORDER BY match[2]) INTO fields
 FROM pg_proc p CROSS JOIN LATERAL regexp_matches(p.prosrc,'''([^'']+)'', h\.([a-z_]+)','g') match
 WHERE p.oid='public.get_tracker_historical_display_snapshot(uuid,uuid)'::regprocedure
   AND match[2] NOT IN('id','source_revision');
 ASSERT cardinality(fields)=15;
 SELECT array_agg(a.attname::text ORDER BY a.attname) INTO covered
 FROM pg_trigger t JOIN pg_attribute a ON a.attrelid=t.tgrelid AND a.attnum=ANY(t.tgattr::smallint[])
 WHERE t.tgrelid='public.tournament_hands'::regclass AND t.tgname='trg_tracker_hand_source_revision'
   AND t.tgenabled='O' AND t.tgfoid='floor_private.bump_hand_identity_revision_v1()'::regprocedure;
 ASSERT fields<@covered,'historical hash source field lacks revision trigger';
 FOREACH relation IN ARRAY ARRAY['public.hand_actions'::regclass,'public.hand_players'::regclass] LOOP
  ASSERT EXISTS(SELECT 1 FROM pg_trigger t WHERE t.tgrelid=relation AND t.tgenabled='O'
   AND t.tgfoid='public.tracker_bump_hand_source_revision()'::regprocedure AND (t.tgtype::int&31)=31 AND cardinality(t.tgattr::smallint[])=0);
 END LOOP;
 ASSERT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.tournament_hands'::regclass
  AND tgname='zz_tracker_source_revision_monotonic_v1' AND tgenabled='O'
  AND tgfoid='public._tracker_source_revision_monotonic_v1()'::regprocedure);
 RAISE NOTICE 'REVISION454_15_HASH_FIELDS_COLUMN_TRIGGER_AND_ACTION_PLAYER_ALL_CRUD_ENABLED_PASS';
END $test$;
ROLLBACK;
