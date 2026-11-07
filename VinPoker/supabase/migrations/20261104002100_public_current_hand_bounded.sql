BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='120s';
CREATE INDEX idx_public_hand_live_latest_v1 ON public.tournament_hands(tournament_id,tournament_table_id,table_session_id,created_at DESC,id DESC)
 WHERE status='in_progress' AND NOT coalesce(is_voided,false);
CREATE INDEX idx_public_hand_completed_latest_v1 ON public.tournament_hands(tournament_id,tournament_table_id,table_session_id,created_at DESC,id DESC)
 WHERE status<>'in_progress' AND NOT coalesce(is_voided,false);
DO $bounded$ DECLARE body text; changed text; BEGIN
 body:=replace(pg_get_functiondef('public.get_public_tournament_table_live_or_last_hand_v2(uuid,uuid)'::regprocedure),chr(13),'');
 IF md5(body)<>'25b32e8bc14dde6ae07afc8972a19708' THEN RAISE EXCEPTION 'current_public_hand_contract_drift'; END IF;
 INSERT INTO spectator_projection_v2.compact_generation_originals_v1 VALUES('get_public_tournament_table_live_or_last_hand_v2(uuid,uuid)',body);
 changed:=replace(body,'SELECT th.id, th.created_at, ''live''::text AS display_state, 0 AS priority','(SELECT th.id, th.created_at, ''live''::text AS display_state, 0 AS priority');
 changed:=replace(changed,'SELECT th.id, th.created_at, ''last_completed''::text AS display_state, 1 AS priority','(SELECT th.id, th.created_at, ''last_completed''::text AS display_state, 1 AS priority');
 changed:=regexp_replace(changed,'AND NOT COALESCE\(th\.is_voided, false\)([[:space:]]+)UNION ALL','AND NOT COALESCE(th.is_voided, false) ORDER BY th.created_at DESC,th.id DESC LIMIT 1)\1UNION ALL','g');
 changed:=regexp_replace(changed,'AND NOT COALESCE\(th\.is_voided, false\)([[:space:]]+)\) candidate','AND NOT COALESCE(th.is_voided, false) ORDER BY th.created_at DESC,th.id DESC LIMIT 1)\1) candidate','g');
 IF array_length(string_to_array(changed,'ORDER BY th.created_at DESC,th.id DESC LIMIT 1)'),1)<>3 THEN RAISE EXCEPTION 'current_public_hand_rewrite_missing'; END IF;
 IF position(E'''access'', ''public'',\n      ''tableId''' IN changed)=0 THEN RAISE EXCEPTION 'current_public_generation_marker_missing'; END IF;
 changed:=replace(changed,E'''access'', ''public'',\n      ''tableId''',
  E'''access'', ''public'',\n      ''sourceGeneration'',(SELECT source_revision::text FROM spectator_projection_v2.entity_markers WHERE tournament_id=p_tournament_id AND component=''tables'' AND entity_key=''generation''),\n      ''tableId''');
 EXECUTE changed;
END $bounded$;
COMMIT;
