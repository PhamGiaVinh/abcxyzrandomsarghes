-- Isolated verification / approved rollback only. Restores the exact prior function.
BEGIN;
DO $rollback$
DECLARE definition text;
BEGIN
 definition:=replace(pg_get_functiondef('public.get_public_player_hud_history_v1(uuid,uuid,timestamptz,uuid)'::regprocedure),chr(13),'');
 IF md5(definition)<>'1a9b508726f30b94a830977ef6190f70' THEN RAISE EXCEPTION 'HUD materialized history rollback preimage differs'; END IF;
 EXECUTE replace(definition,'), amounts AS MATERIALIZED (','), amounts AS (');
 IF md5(replace(pg_get_functiondef('public.get_public_player_hud_history_v1(uuid,uuid,timestamptz,uuid)'::regprocedure),chr(13),''))<>'7fcbf1a0c6ed5da9fedb5d83d699adf4' THEN RAISE EXCEPTION 'HUD history rollback differs'; END IF;
END $rollback$;
COMMIT;
