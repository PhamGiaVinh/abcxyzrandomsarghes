\set ON_ERROR_STOP on
BEGIN READ ONLY;
SET LOCAL statement_timeout='10s';
DO $$ BEGIN
 IF current_database()<>'vinpoker_ops_cash115_qualified_c' OR host(inet_server_addr())<>'127.0.0.1' OR inet_server_port()<>55441 THEN RAISE EXCEPTION 'local363_only';END IF;
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.get_public_tournament_table_history_v2(uuid,uuid,integer,timestamp with time zone,uuid)'::regprocedure)<>'879904dce05ea6d2cadefdd9935e350a' THEN RAISE EXCEPTION 'history363_definition_drift';END IF;
END $$;
SET LOCAL request.jwt.claim.role='anon';
SET LOCAL request.jwt.claims='{"role":"anon"}';
SET LOCAL ROLE anon;
WITH RECURSIVE pages(n,payload) AS (
 SELECT 1,public.get_public_tournament_table_history_v2('4cd3af4d-7e1d-4042-855f-04fb6777e580','8508d715-cd7c-4f1f-bb0d-223d967e355c',5,NULL,NULL)
 UNION ALL
 SELECT n+1,public.get_public_tournament_table_history_v2('4cd3af4d-7e1d-4042-855f-04fb6777e580','8508d715-cd7c-4f1f-bb0d-223d967e355c',5,
  (payload->'nextCursor'->>'createdAt')::timestamptz,(payload->'nextCursor'->>'id')::uuid)
 FROM pages WHERE payload->'nextCursor' IS DISTINCT FROM 'null'::jsonb AND n<10
)
SELECT jsonb_build_object('tour','4cd3af4d-7e1d-4042-855f-04fb6777e580','table','8508d715-cd7c-4f1f-bb0d-223d967e355c',
 'pages',(SELECT jsonb_agg(payload ORDER BY n) FROM pages),
 'all',public.get_public_tournament_table_history_v2('4cd3af4d-7e1d-4042-855f-04fb6777e580','8508d715-cd7c-4f1f-bb0d-223d967e355c',50,NULL,NULL),
 'invalidLimit',public.get_public_tournament_table_history_v2('4cd3af4d-7e1d-4042-855f-04fb6777e580','8508d715-cd7c-4f1f-bb0d-223d967e355c',0,NULL,NULL),
 'partialCursor',public.get_public_tournament_table_history_v2('4cd3af4d-7e1d-4042-855f-04fb6777e580','8508d715-cd7c-4f1f-bb0d-223d967e355c',5,now(),NULL),
 'wrongTable',public.get_public_tournament_table_history_v2('4cd3af4d-7e1d-4042-855f-04fb6777e580','d294f4a4-082b-4efc-a6ca-1f96579ea344',5,NULL,NULL));
ROLLBACK;
