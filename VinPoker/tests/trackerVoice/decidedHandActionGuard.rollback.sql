-- Rehearse only on an owned isolated DB. Production rollback needs the same
-- explicit release scope as the forward migration and an exact postcondition.
BEGIN;
DO $rollback$
DECLARE
  definition text;
  guard text := E'  -- A fold win is already decided. Keep the surviving player live.\n'
    || E'  IF (SELECT count(*) FROM public.hand_players hp\n'
    || E'      WHERE hp.hand_id = p_hand_id AND NOT EXISTS (\n'
    || E'        SELECT 1 FROM public.hand_actions ha\n'
    || E'        WHERE ha.hand_id = p_hand_id AND ha.player_id = hp.player_id\n'
    || E'          AND ha.entry_number = hp.entry_number AND ha.action_type = ''fold''\n'
    || E'      )) <= 1 THEN\n'
    || E'    RETURN jsonb_build_object(''error'', ''tracker_hand_already_decided'', ''trace_id'', p_trace_id);\n'
    || E'  END IF;\n\n';
BEGIN
  IF (SELECT md5(replace(prosrc, chr(13), '')) FROM pg_proc
      WHERE oid = 'public.record_action(uuid,uuid,text,integer,integer,text,integer,text,text,uuid)'::regprocedure)
      IS DISTINCT FROM 'ccf4f55e6826bef6d4fe35dd7b38c30f' THEN
    RAISE EXCEPTION 'tracker_decided_action_rollback_drift';
  END IF;
  definition := replace(pg_get_functiondef(
    'public.record_action(uuid,uuid,text,integer,integer,text,integer,text,text,uuid)'::regprocedure), chr(13), '');
  IF (length(definition) - length(replace(definition, guard, ''))) / length(guard) <> 1 THEN
    RAISE EXCEPTION 'tracker_decided_action_rollback_anchor_drift';
  END IF;
  EXECUTE replace(definition, guard, '');
  IF (SELECT md5(replace(prosrc, chr(13), '')) FROM pg_proc
      WHERE oid = 'public.record_action(uuid,uuid,text,integer,integer,text,integer,text,text,uuid)'::regprocedure)
      IS DISTINCT FROM '1d43b664c671f4dc25d72d624e2c009a' THEN
    RAISE EXCEPTION 'tracker_decided_action_rollback_postcondition_failed';
  END IF;
END;
$rollback$;
COMMIT;
