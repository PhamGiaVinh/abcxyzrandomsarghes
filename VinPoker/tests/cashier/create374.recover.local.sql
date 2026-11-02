\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='10s';
DO $$ DECLARE backup record; BEGIN
 IF current_database()<>'vinpoker_ops_cash115_qualified_c'
 OR host(inet_server_addr()) IS DISTINCT FROM '127.0.0.1' OR inet_server_port()<>55441
 THEN RAISE EXCEPTION 'create374_local_recovery_only'; END IF;
 SELECT * INTO STRICT backup FROM floor_private.tournament_create_release_backup234 WHERE id;
 IF backup.old_md5 IS DISTINCT FROM '341383f50c5c5aa61ca552a0cbcc5d08'
 OR (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.create_tournament_with_levels_v1(uuid,jsonb,jsonb,uuid,uuid)'::regprocedure)
  IS DISTINCT FROM 'e0138e0be86fc4cfdaf325a216a415b7'
 OR EXISTS(SELECT 1 FROM pg_proc WHERE oid='public.create_tournament_with_levels_v1(uuid,jsonb,jsonb,uuid,uuid)'::regprocedure
  AND (proacl IS DISTINCT FROM backup.saved_acl OR pg_get_userbyid(proowner) IS DISTINCT FROM backup.owner_name))
 THEN RAISE EXCEPTION 'create374_recovery_drift'; END IF;
 EXECUTE backup.saved_definition;
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.create_tournament_with_levels_v1(uuid,jsonb,jsonb,uuid,uuid)'::regprocedure)
  IS DISTINCT FROM backup.old_md5 THEN RAISE EXCEPTION 'create374_recovery_unconfirmed'; END IF;
END $$;
-- Preserve private backup, created tournaments, receipts and ledger history.
COMMIT;
