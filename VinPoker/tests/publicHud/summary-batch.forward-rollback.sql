-- Recovery TEMPLATE. Restore the prior Edge reader before removing this API.
-- Production recovery requires a new approved controlled migration.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $$ BEGIN
 IF md5(replace(pg_get_functiondef('public.get_public_player_hud_summary_batch_v1(uuid,uuid,text[])'::regprocedure),chr(13),''))
  IS DISTINCT FROM 'e090d874e79988a0c6795beb6aff390b'
 THEN RAISE EXCEPTION 'hud_summary_batch_recovery_drift'; END IF;
END $$;
DROP FUNCTION public.get_public_player_hud_summary_batch_v1(uuid,uuid,text[]);
COMMIT;
