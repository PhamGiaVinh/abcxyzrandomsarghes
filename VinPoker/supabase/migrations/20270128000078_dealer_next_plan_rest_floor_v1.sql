-- CLI-created 20261014165242; forward slot78 checked against source/live ledger.
-- Restore: reviewed forward migration replacing GREATEST(15,...) with the
-- original GREATEST(10,...) only after Auto OFF and dependency qualification.
-- No historical rows, assignments, planned times, grants or notifications change.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $repair$
DECLARE original text; corrected text;
BEGIN
 SELECT pg_get_functiondef('public.set_rotation_slot_dealer(uuid,integer,uuid,text)'::regprocedure) INTO original;
 IF md5(original) <> 'd884133e9519953014d776d4af6a82ff' THEN
  RAISE EXCEPTION 'next_plan_rest_definition_drift';
 END IF;
 corrected := replace(original,
  'v_rest_minutes := GREATEST(10, COALESCE(v_rest_minutes, 10));',
  'v_rest_minutes := GREATEST(15, COALESCE(v_rest_minutes, 10));');
 IF corrected = original THEN RAISE EXCEPTION 'next_plan_rest_patch_missing'; END IF;
 corrected := replace(corrected, '-- R1 floor: 10 minutes is the hard minimum', '-- R1 floor: 15 minutes is the hard minimum');
 corrected := replace(corrected, '-- frontend''s Math.max(10, config)', '-- execution hard floor of 15 minutes');
 EXECUTE corrected;
 IF position('v_rest_minutes := GREATEST(15, COALESCE(v_rest_minutes, 10));' IN
  pg_get_functiondef('public.set_rotation_slot_dealer(uuid,integer,uuid,text)'::regprocedure)) = 0 THEN
  RAISE EXCEPTION 'next_plan_rest_postcheck_failed';
 END IF;
END $repair$;
COMMIT;
