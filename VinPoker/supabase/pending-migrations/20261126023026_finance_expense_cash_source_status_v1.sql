-- Read-only status needed by the exact-club Cashier UI. No table grants,
-- policy changes, adoption switches, or monetary writes are introduced.
-- Prerequisite: frozen expense source SQL 34464adca0c8546bae2e7b81dee1fee43dbd50c2c44dc68be00b5fd0102e92bf.
DO $dependency$
BEGIN
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid=to_regprocedure('public.record_cashier_club_expense_v1(uuid,uuid,uuid,public.expense_category,bigint,timestamp with time zone,text,uuid,uuid,text)'))
   IS DISTINCT FROM 'a41e54f43cc11ae1d253ada5f604f5a8' THEN
  RAISE EXCEPTION 'finance_expense_status_requires_exact_source';
 END IF;
END $dependency$;

CREATE FUNCTION public.cashier_expense_source_status_v1(p_club_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); policy public.cashier_tour_settings%ROWTYPE;
BEGIN
 IF actor IS NULL OR NOT public.is_club_cashier(actor,p_club_id) THEN
  RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
 END IF;
 SELECT * INTO policy FROM public.cashier_tour_settings WHERE club_id=p_club_id;
 RETURN jsonb_build_object('club_id',p_club_id,'enabled',coalesce(policy.enabled,false),
  'expense_cash_source_enabled',coalesce(policy.expense_cash_source_enabled,false));
END $$;
REVOKE ALL ON FUNCTION public.cashier_expense_source_status_v1(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.cashier_expense_source_status_v1(uuid) TO authenticated;

-- ROLLBACK before adoption: DROP FUNCTION public.cashier_expense_source_status_v1(uuid).
-- After adoption keep this reader and durable client recovery available until a
-- reviewed forward fix. Never drop source receipts/costs/movements or disable
-- the server source fence as an automatic rollback. No settings are changed here.
