-- Isolated History98 predecessor qualification only; never a production repair.
-- The card56→voice→finish97 clone lineage starts from a separate schema restore
-- and misses027, which the workflow applied only to its main check-in database.
-- Reinstall only027's pinned public-history delta. Its other functions now have
-- later identity/session changes and must not be replayed from an old migration.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $history98_predecessor$
DECLARE target regprocedure;
 definition text; before_metadata jsonb; after_definition text;
 needle constant text:='p.tracker_big_blind > p.tracker_small_blind';
 replacement constant text:='p.tracker_big_blind >= p.tracker_small_blind';
BEGIN
 IF current_user<>'postgres'
 OR current_database() NOT IN ('vinpoker_ops_history98_ci','vinpoker_ops_history98_rollback','vinpoker_ops_history98_predecessor_20261105','vinpoker_ops_history98_runtime_20261105')
 OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet
 OR inet_server_port() IS DISTINCT FROM 55441
 OR current_setting('server_version_num')::integer NOT BETWEEN 170000 AND 179999
 THEN RAISE EXCEPTION 'history98_owned_local_fixture_required';END IF;
 target:=to_regprocedure('public.get_public_tournament_table_history_v2(uuid,uuid,integer,timestamptz,uuid)');
 IF target IS NULL THEN RAISE EXCEPTION 'history98_predecessor_missing';END IF;
 definition:=replace(pg_get_functiondef(target),chr(13),'');
 RAISE NOTICE 'HISTORY98_LOCAL_PREDECESSOR_HASH %',md5(definition);
 IF md5(definition)<>'ce80ebccd4b57f7c7da375d666a112f9'
 OR (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid=target)<>'5d65f60488da98956103b4f1a1c2a8f5'
 OR (SELECT proowner FROM pg_proc WHERE oid=target)<>'postgres'::regrole
 OR (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1
 THEN RAISE EXCEPTION 'history98_predecessor_definition_drift';END IF;
 SELECT to_jsonb(p)-'prosrc' INTO before_metadata FROM pg_proc p WHERE oid=target;
 after_definition:=replace(definition,needle,replacement);
 -- This is exactly the reviewed public-history expression in immutable027.
 IF md5(after_definition)<>'ce58ef27d2bb7bee89cae93a837ede48'
 THEN RAISE EXCEPTION 'history98_predecessor_postimage_differs';END IF;
 EXECUTE after_definition;
 IF md5(replace(pg_get_functiondef(target),chr(13),''))<>'ce58ef27d2bb7bee89cae93a837ede48'
 OR (SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE p.oid=target) IS DISTINCT FROM before_metadata
 THEN RAISE EXCEPTION 'history98_predecessor_metadata_changed';END IF;
END $history98_predecessor$;
COMMIT;
