-- CLI scaffold20261020100512. Reserved208 in source and isolated local catalog.
-- Explicit valid initial child state, consistent with atomic single-day create91.
-- Do not relax the live-status trigger/default or rewrite existing tournaments.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='15s';
DO $migration$
DECLARE
 target regprocedure:='public.create_tournament_event_with_flights(uuid,text,numeric,integer,integer,integer,text,integer,integer,integer,timestamptz,jsonb,jsonb)'::regprocedure;
 before_row record; after_row record; definition text; patched text;
 final_columns text:='late_reg_close_level, event_id, phase)';
 flight_columns text:='late_reg_close_level, event_id, phase, flight_label)';
 final_values text:='v_event_id, ''final'')';
 flight_values text:='v_event_id, ''flight'', v_label)';
BEGIN
 SELECT p.*,replace(pg_get_functiondef(p.oid),chr(13),'') AS definition INTO STRICT before_row FROM pg_proc p WHERE oid=target;
 definition:=before_row.definition;
 IF current_user<>'postgres' OR md5(definition)<>'c2d49e78213619c3badfc09d5f7bc0b3'
 OR pg_get_userbyid(before_row.proowner)<>'postgres' THEN RAISE EXCEPTION 'main_event208_dependency_drift'; END IF;
 IF cardinality(string_to_array(definition,final_columns))<>2
 OR cardinality(string_to_array(definition,flight_columns))<>2
 OR cardinality(string_to_array(definition,final_values))<>2
 OR cardinality(string_to_array(definition,flight_values))<>2 THEN RAISE EXCEPTION 'main_event208_anchor_drift'; END IF;
 patched:=replace(replace(replace(replace(definition,
  final_columns,'late_reg_close_level, event_id, phase, live_status)'),
  flight_columns,'late_reg_close_level, event_id, phase, flight_label, live_status)'),
  final_values,'v_event_id, ''final'', ''registering'')'),
  flight_values,'v_event_id, ''flight'', v_label, ''registering'')');
 EXECUTE patched;
 SELECT * INTO STRICT after_row FROM pg_proc WHERE oid=target;
 IF after_row.prosrc IS NOT DISTINCT FROM before_row.prosrc OR after_row.proacl IS DISTINCT FROM before_row.proacl
 OR after_row.proowner<>before_row.proowner OR after_row.prosecdef IS DISTINCT FROM before_row.prosecdef
 OR after_row.proconfig IS DISTINCT FROM before_row.proconfig THEN RAISE EXCEPTION 'main_event208_unexpected_metadata_change'; END IF;
END $migration$;
COMMIT;
