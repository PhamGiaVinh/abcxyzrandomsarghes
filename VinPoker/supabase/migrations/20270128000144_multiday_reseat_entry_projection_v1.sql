-- CLI candidate20261018115729, local forward144, NOT LIVE.
-- Reused seed seat updates do not invoke INSERT-only entry placement sync.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $$
DECLARE target regprocedure:='public.floor_assign_entry_to_seat(uuid,uuid,integer,bigint,uuid)'::regprocedure;
 definition text:=replace(pg_get_functiondef(target),chr(13),'');
 needle text:=$old$      IF NOT FOUND THEN RAISE EXCEPTION 'qualified_final_seat_evidence_missing'; END IF;$old$;
 replacement text:=$new$      IF NOT FOUND THEN RAISE EXCEPTION 'qualified_final_seat_evidence_missing'; END IF;
      UPDATE public.tournament_entries
      SET table_id=v_game_table_id,seat_id=v_seat_id,seat_number=p_seat_number
      WHERE id=v_entry.id AND tournament_id=v_tournament.id AND status='registered';
      IF NOT FOUND THEN RAISE EXCEPTION 'qualified_final_entry_state_changed'; END IF;$new$;
 acl aclitem[];
BEGIN
 SELECT proacl INTO acl FROM pg_proc WHERE oid=target;
 IF current_user<>'postgres' OR (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid=target)<>'930f0fe9c6db76ed4211187580b6f7c4'
  OR length(definition)-length(replace(definition,needle,''))<>length(needle) THEN RAISE EXCEPTION 'd2_projection144_dependency_drift';END IF;
 EXECUTE replace(definition,needle,replacement);
 IF (SELECT proacl FROM pg_proc WHERE oid=target) IS DISTINCT FROM acl THEN RAISE EXCEPTION 'd2_projection144_acl_drift';END IF;
END $$;
COMMIT;
