\set ON_ERROR_STOP on
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-000000000033';
DO $$ BEGIN
  BEGIN
    PERFORM public.get_club_pt_wages('00000000-0000-0000-0000-000000000001');
    RAISE EXCEPTION 'baseline_accountant_was_not_denied';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
ROLLBACK;
SELECT 'BASELINE_ACCOUNTANT_DENIED' AS result;
