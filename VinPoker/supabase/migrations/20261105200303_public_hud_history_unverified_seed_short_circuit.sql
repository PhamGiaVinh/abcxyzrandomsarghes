-- A missing verified outcome cannot expose an ending stack. Skip the extra
-- exact-one starting-stack lookup for that row, retaining the independent raw
-- participant/source gates and all proof validation for verified outcomes.
-- Rollback: guarded reverse in tests/publicHud/history-seed.rollback.sql.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $migration$
DECLARE definition text;
 marker constant text:='(SELECT CASE WHEN count(*)=1 THEN min(hp.starting_stack) END FROM public.hand_players hp WHERE hp.hand_id=p.hand_id AND hp.player_id=p_player_id) AS seed';
BEGIN
 definition:=replace(pg_get_functiondef('public.get_public_player_hud_history_v1(uuid,uuid,timestamptz,uuid)'::regprocedure),chr(13),'');
 IF md5(definition)<>'1a9b508726f30b94a830977ef6190f70' OR array_length(string_to_array(definition,marker),1)<>2 THEN
  RAISE EXCEPTION 'HUD history seed short-circuit preimage differs';
 END IF;
 EXECUTE replace(definition,marker,'CASE WHEN proof.public_outcome IS NOT NULL THEN '||replace(marker,' AS seed','')||' END AS seed');
END $migration$;
COMMIT;
