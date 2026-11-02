-- LOCAL ONLY exact-definition recovery. Keep immutable attendance/receipts.
BEGIN;
SET LOCAL lock_timeout='2s';
DO $$ DECLARE r record; BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c';
 ASSERT inet_server_addr()='127.0.0.1'::inet AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 ASSERT (SELECT count(*) FROM floor_private.pool255_definition_backup)=4;
 FOR r IN SELECT * FROM floor_private.pool255_definition_backup LOOP
  ASSERT md5(replace(pg_get_functiondef(r.signature::regprocedure),chr(13),''))=r.new_digest,'pool255 recovery refuses definition drift';
  ASSERT md5(replace(r.definition,chr(13),''))=r.old_digest,'pool255 saved definition corrupted';
  EXECUTE r.definition;
 END LOOP;
END $$;
DROP FUNCTION floor_private.dealer_pool_attendance_matches_v1(uuid,uuid,timestamptz);
COMMIT;
