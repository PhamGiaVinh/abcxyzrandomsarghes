-- Isolated verification / approved rollback only; no source data is changed.
BEGIN;
DO $rollback$
DECLARE definition text;
 marker constant text:='(SELECT CASE WHEN count(*)=1 THEN min(hp.starting_stack) END FROM public.hand_players hp WHERE hp.hand_id=p.hand_id AND hp.player_id=p_player_id)';
BEGIN
 definition:=replace(pg_get_functiondef('public.get_public_player_hud_history_v1(uuid,uuid,timestamptz,uuid)'::regprocedure),chr(13),'');
 IF md5(definition)<>'4f8894bc8dd9114663ace03f9b3225e3' THEN RAISE EXCEPTION 'HUD history seed rollback preimage differs'; END IF;
 EXECUTE replace(definition,'CASE WHEN proof.public_outcome IS NOT NULL THEN '||marker||' END AS seed',marker||' AS seed');
 IF md5(replace(pg_get_functiondef('public.get_public_player_hud_history_v1(uuid,uuid,timestamptz,uuid)'::regprocedure),chr(13),''))<>'1a9b508726f30b94a830977ef6190f70' THEN RAISE EXCEPTION 'HUD history seed rollback differs'; END IF;
END $rollback$;
COMMIT;
