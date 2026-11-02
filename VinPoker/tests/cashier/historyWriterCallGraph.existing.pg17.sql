-- LOCAL catalog qualification only. No functions, fixtures or receipts created.
BEGIN READ ONLY;
SET LOCAL statement_timeout='10s';
DO $$
DECLARE audit jsonb; root_count integer; anon_count integer; parsed_wrapper boolean; max_depth integer;
BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND inet_server_port()=55441;
 WITH RECURSIVE f AS MATERIALIZED (
  -- SQL-standard RETURN/BEGIN ATOMIC bodies have empty prosrc. Deparse the
  -- actual stored definition and include their catalog dependencies below.
  SELECT p.oid,p.proname,n.nspname,pg_get_functiondef(p.oid) body,p.prosqlbody IS NOT NULL parsed
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang
  WHERE p.prokind='f' AND n.nspname!~'^pg_' AND n.nspname<>'information_schema' AND l.lanname IN('sql','plpgsql')
 ), edges AS (
  SELECT DISTINCT a.oid caller,b.oid callee FROM f a
  CROSS JOIN LATERAL regexp_matches(a.body,'\m([a-zA-Z_][a-zA-Z_0-9]*)\.([a-zA-Z_][a-zA-Z_0-9]*)\s*\(','g') m
  JOIN f b ON b.nspname=m[1] AND b.proname=m[2]
  UNION
  SELECT d.objid,d.refobjid FROM pg_depend d JOIN f a ON a.oid=d.objid JOIN f b ON b.oid=d.refobjid
  WHERE d.classid='pg_proc'::regclass AND d.refclassid='pg_proc'::regclass
 ), reach AS (
  SELECT oid writer,oid ancestor,ARRAY[oid] path FROM f
  WHERE body ~* '\m(insert\s+into|update|delete\s+from)\s+(public\.)?(tournament_hands|hand_actions|hand_players)\M'
  UNION ALL SELECT r.writer,e.caller,r.path||e.caller FROM reach r JOIN edges e ON e.callee=r.ancestor
  WHERE NOT e.caller=ANY(r.path)
 ), roots AS (
  SELECT f.oid,f.proname,f.nspname,f.parsed,max(cardinality(r.path)-1) depth
  FROM reach r JOIN f ON f.oid=r.ancestor GROUP BY f.oid,f.proname,f.nspname,f.parsed
 )
 SELECT count(*),count(*) FILTER(WHERE has_function_privilege('anon',oid,'EXECUTE')),
  bool_or(nspname='public' AND proname='show_tracker_manual_cards_v1' AND parsed AND depth>=2),max(depth),
  jsonb_agg(jsonb_build_object('signature',oid::regprocedure::text,'depth',depth,'parsed',parsed,
   'bodyMd5',md5(replace(pg_get_functiondef(oid),chr(13),'')),
   'authenticated',has_function_privilege('authenticated',oid,'EXECUTE'),
   'service',has_function_privilege('service_role',oid,'EXECUTE')) ORDER BY oid::regprocedure::text)
 INTO root_count,anon_count,parsed_wrapper,max_depth,audit FROM roots;
 ASSERT parsed_wrapper IS TRUE,'parsed SQL manual-card wrapper absent from writer closure';
 ASSERT root_count>=20 AND max_depth>=2,'writer closure unexpectedly incomplete';
 ASSERT anon_count=0,'anonymous caller reaches a historical-input writer';
 RAISE NOTICE 'HISTORY_WRITER_CALL_GRAPH_PASS roots=% anon=% depth=% digest=%',root_count,anon_count,max_depth,md5(audit::text);
END $$;
-- These invoker helpers are deliberately authenticated-callable. Selecting the
-- delegated Voice branch directly must fail before any hand/auth scope lookup.
SET LOCAL ROLE authenticated;
DO $$
DECLARE delegated boolean; response jsonb;
BEGIN
 FOREACH delegated IN ARRAY ARRAY[true,NULL::boolean] LOOP
  response:=public._tracker_card_board_source_v1(NULL,'[]'::jsonb,'675fe35e-60a8-4452-bb90-e79486d54da6',delegated);
  ASSERT response->>'error'='voice_delegation_required';
  response:=public._tracker_card_hole_source_v1(NULL,'[]'::jsonb,'675fe35e-60a8-4452-bb90-e79486d54da6',delegated);
  ASSERT response->>'error'='voice_delegation_required';
 END LOOP;
 RAISE NOTICE 'HISTORY_WRITER_CALL_GRAPH_SHARED_HELPER_DIRECT_DELEGATION_DENIED_4_PASS';
END $$;
RESET ROLE;
ROLLBACK;
