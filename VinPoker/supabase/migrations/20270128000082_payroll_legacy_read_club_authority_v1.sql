-- Auth-only forward delta. Existing pay formulas, output signatures and history
-- remain byte-for-byte intact behind a caller/club guard. Never replay archives.
-- Recovery: revert the frontend if necessary; do not restore anonymous payroll
-- access as an automatic rollback. Any authority rollback needs owner review.
DO $migration$
DECLARE
  signature text;
  expected_digest text;
  definition text;
  guard text := $guard$
  -- payroll_legacy_read_club_authority_v1
  IF auth.uid() IS NULL OR p_club_id IS NULL OR NOT COALESCE((
    public.has_role(auth.uid(), 'super_admin'::public.app_role)
    OR public.is_club_admin(auth.uid(), p_club_id)
    OR public.is_club_cashier(auth.uid(), p_club_id)
  ), false) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'payroll_club_read_forbidden';
  END IF;
$guard$;
BEGIN
  FOR signature, expected_digest IN SELECT * FROM (VALUES
    ('public.get_dealer_payroll(uuid,date,date)', '900daa5d599dd082ca3afe28aba926f7'),
    ('public.get_shift_payroll_summary(uuid,date)', '9294ceb26ab83cb9b61c45f828f639cc')
  ) AS reviewed(signature, digest) LOOP
    IF to_regprocedure(signature) IS NULL THEN
      RAISE EXCEPTION 'payroll_read_precondition_missing: %', signature;
    END IF;
    definition := pg_get_functiondef(to_regprocedure(signature));
    IF md5(definition) <> expected_digest OR
       (length(definition) - length(replace(definition, E'BEGIN\n  RETURN QUERY', ''))) /
       length(E'BEGIN\n  RETURN QUERY') <> 1 THEN
      RAISE EXCEPTION 'payroll_read_precondition_drift: %', signature;
    END IF;
    -- The digest pins both existing bodies; replace only the unique entry point.
    EXECUTE replace(definition, E'BEGIN\n  RETURN QUERY',
      'BEGIN' || guard || E'\n  RETURN QUERY');
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', signature);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', signature);
  END LOOP;
END;
$migration$;
