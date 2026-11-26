-- SOURCE ONLY. No production apply is authorized by this file.
-- Existing caller-bound cashier_club_ids already includes club cashiers and
-- owners. The legacy deals SELECT policy additionally required a global
-- cashier role AND direct ownership, leaving legitimate scoped readers blind.
-- Only SELECT visibility is extended; all mutation/participant/marketplace
-- policies and table grants remain unchanged.
-- ROLLBACK (controlled approval): DROP POLICY "Scoped cashier reads club deals"
-- ON public.staking_deals; preserve all deals/audit/receipts. This removes the
-- new read capability; do not replay financial actions to verify rollback.

BEGIN;
SET LOCAL search_path = '';
DO $policy$
DECLARE
  existing_policy record;
  expected_expression constant text := '((club_id IS NOT NULL) AND public.is_club_cashier(( SELECT auth.uid() AS uid), club_id))';
BEGIN
  SELECT p.polcmd, p.polpermissive, p.polroles,
         pg_catalog.pg_get_expr(p.polqual, p.polrelid) AS expression
    INTO existing_policy
    FROM pg_catalog.pg_policy p
   WHERE p.polrelid = 'public.staking_deals'::pg_catalog.regclass
     AND p.polname = 'Scoped cashier reads club deals';
  IF FOUND THEN
    IF existing_policy.polcmd <> 'r' OR NOT existing_policy.polpermissive
       OR existing_policy.polroles <> ARRAY[('authenticated'::pg_catalog.regrole)::oid]
       OR pg_catalog.regexp_replace(existing_policy.expression, '\s+', '', 'g')
          IS DISTINCT FROM pg_catalog.regexp_replace(expected_expression, '\s+', '', 'g') THEN
      RAISE EXCEPTION 'Scoped cashier staking read policy drift; inspect before apply';
    END IF;
  ELSE
    CREATE POLICY "Scoped cashier reads club deals"
      ON public.staking_deals FOR SELECT TO authenticated
      USING (club_id IS NOT NULL AND public.is_club_cashier((SELECT auth.uid()), club_id));
  END IF;
END;
$policy$;
COMMIT;
