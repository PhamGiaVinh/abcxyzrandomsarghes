-- CLI-created20261015124117; reserved forward89 after source/live collision check.
-- Preserve clock authorization/status/audit and blind policy. A non-NULL pointer
-- must still resolve to a real level in this tournament before starting.
-- Rollback: reviewed forward restoration of the captured precondition function;
-- never rewrite tournament clock/audit history or fabricate missing levels.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $patch$
DECLARE definition text; anchor text := E'  UPDATE public.tournaments\n  SET status';
BEGIN
 IF (SELECT pg_catalog.md5(pg_catalog.replace(prosrc,chr(13),'')) FROM pg_catalog.pg_proc
     WHERE oid='public.floor_start_tournament_clock(uuid)'::regprocedure)
     IS DISTINCT FROM '5f07aa9dbbc79303ff539643e5193934' THEN
   RAISE EXCEPTION 'CLOCK_START_LEVEL_PRECONDITION_MISMATCH';
 END IF;
 definition := pg_catalog.replace(pg_catalog.pg_get_functiondef('public.floor_start_tournament_clock(uuid)'::regprocedure),chr(13),'');
 IF pg_catalog.strpos(definition,anchor)=0 THEN RAISE EXCEPTION 'CLOCK_START_LEVEL_ANCHOR_MISSING'; END IF;
 definition := pg_catalog.replace(definition,anchor,
 E'  -- Lock the actual selected level until the clock transaction commits.\n'
 || E'  PERFORM 1 FROM public.tournament_levels\n'
 || E'  WHERE tournament_id = p_tournament_id AND level_number = v_level\n'
 || E'  FOR SHARE;\n'
 || E'  IF NOT FOUND THEN\n'
 || E'    RETURN jsonb_build_object(''ok'', false, ''error'', ''invalid_tournament_level'');\n'
 || E'  END IF;\n\n' || anchor);
 EXECUTE definition;
END;
$patch$;
COMMIT;
