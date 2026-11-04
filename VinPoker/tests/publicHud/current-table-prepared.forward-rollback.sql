-- Recovery TEMPLATE: use a newly approved controlled migration in production.
-- Restore this layer BEFORE the earlier025/023/022 reader-plan recoveries.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $$ DECLARE item record; BEGIN
 FOR item IN SELECT * FROM spectator_projection_v2.current_table_read_originals_v1 ORDER BY signature LOOP
  IF md5(replace(pg_get_functiondef(item.signature::regprocedure),chr(13),'')) IS DISTINCT FROM item.prepared_definition_hash
   OR md5(item.definition) IS DISTINCT FROM item.original_definition_hash
  THEN RAISE EXCEPTION 'prepared_table_recovery_drift: %',item.signature; END IF;
 END LOOP;
 IF (SELECT count(*) FROM spectator_projection_v2.current_table_read_originals_v1)<>2 THEN RAISE EXCEPTION 'prepared_table_recovery_scope'; END IF;
 FOR item IN SELECT * FROM spectator_projection_v2.current_table_read_originals_v1 ORDER BY signature LOOP
  EXECUTE item.definition;
 END LOOP;
END $$;
DROP FUNCTION spectator_projection_v2.current_table_source_v1(uuid,uuid);
DROP TABLE spectator_projection_v2.current_table_publications_v1;
COMMIT;
