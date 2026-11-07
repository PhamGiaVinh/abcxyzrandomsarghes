-- Compute the four validated settlement amounts once per bounded history row.
-- The default inline CTE repeats safe_integer calls in both output guards.
-- Source visibility, settlement proof, pagination and unknown stacks are unchanged.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $migration$
DECLARE definition text;
BEGIN
 definition:=replace(pg_get_functiondef('public.get_public_player_hud_history_v1(uuid,uuid,timestamptz,uuid)'::regprocedure),chr(13),'');
 IF md5(definition)<>'7fcbf1a0c6ed5da9fedb5d83d699adf4' THEN
  RAISE EXCEPTION 'HUD history amount materialization preimage differs';
 END IF;
 IF strpos(definition,'), amounts AS (')=0 THEN RAISE EXCEPTION 'HUD history amounts boundary absent'; END IF;
 EXECUTE replace(definition,'), amounts AS (','), amounts AS MATERIALIZED (');
END $migration$;
COMMIT;
