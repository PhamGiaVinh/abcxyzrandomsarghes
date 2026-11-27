-- Payroll storage authority prerequisite for R02 Dealer Control invitations.
-- Generated with Supabase CLI; pending only, NOT authorized for production apply.
-- Exact catalog + helper guard: unknown policies/ACLs/body drift fail closed.
-- No row, salary, receipt, audit event or existing RPC definition is rewritten.
-- A new private adjustment trigger serializes client writes with period approval.
-- ROLLBACK: transaction failure rolls back all ACL/policy changes. After commit,
-- keep safe read/RPC paths and forward-fix. Do NOT restore the permissive PUBLIC
-- policies: they allow a Cashier B actor to approve payroll A via direct UPDATE.
-- Turning the invitation flags OFF does not undo pending invitation acceptance.
BEGIN;
SET LOCAL search_path = pg_catalog, public;
SET LOCAL lock_timeout = '5s';
LOCK TABLE public.payroll_periods, public.dealer_payroll, public.payment_records, public.payroll_adjustments, public.payroll_audit_log IN ACCESS EXCLUSIVE MODE;
DO $preflight$
DECLARE storage_fingerprint text; helper_fingerprint text; guard_fingerprint text;
BEGIN
  SELECT pg_catalog.md5(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
 'table',c.relname,'owner',pg_catalog.pg_get_userbyid(c.relowner),'kind',c.relkind,
 'rls',c.relrowsecurity,'force_rls',c.relforcerowsecurity,
 'acl',(SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('grantee',CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(a.grantee) END,'grantor',pg_catalog.pg_get_userbyid(a.grantor),'privilege',a.privilege_type,'grantable',a.is_grantable) ORDER BY a.grantee::regrole::text,a.privilege_type,a.grantor::regrole::text) FROM pg_catalog.aclexplode(c.relacl) a),
 'columns',(SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('name',a.attname,'type',pg_catalog.format_type(a.atttypid,a.atttypmod),'notnull',a.attnotnull,'acl',a.attacl,'default',pg_catalog.pg_get_expr(d.adbin,d.adrelid)) ORDER BY a.attnum) FROM pg_catalog.pg_attribute a LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped),
 'constraints',(SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('name',k.conname,'definition',pg_catalog.pg_get_constraintdef(k.oid)) ORDER BY k.conname) FROM pg_catalog.pg_constraint k WHERE k.conrelid=c.oid),
 'triggers',(SELECT pg_catalog.jsonb_agg(pg_catalog.pg_get_triggerdef(t.oid) ORDER BY t.tgname) FROM pg_catalog.pg_trigger t WHERE t.tgrelid=c.oid AND NOT t.tgisinternal),
 'policies',(SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('name',p.polname,'command',p.polcmd,'permissive',p.polpermissive,'roles',ARRAY(SELECT CASE WHEN r=0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(r) END FROM pg_catalog.unnest(p.polroles) r ORDER BY 1),'using',pg_catalog.pg_get_expr(p.polqual,p.polrelid),'check',pg_catalog.pg_get_expr(p.polwithcheck,p.polrelid)) ORDER BY p.polname) FROM pg_catalog.pg_policy p WHERE p.polrelid=c.oid)
) ORDER BY c.relname)::text) INTO storage_fingerprint FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=ANY(ARRAY['dealer_payroll','payment_records','payroll_adjustments','payroll_audit_log','payroll_periods']);
  IF storage_fingerprint IS NULL OR storage_fingerprint NOT IN ('74e12a3bc8f4f5cc4abc3a1910307a92', '9ca4fa649a02e7624c831305397ae7d2') THEN
    RAISE EXCEPTION 'payroll_storage_catalog_drift' USING ERRCODE = '55000';
  END IF;
  SELECT pg_catalog.md5(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('identity',p.oid::regprocedure::text,'owner',pg_catalog.pg_get_userbyid(p.proowner),'definition',pg_catalog.pg_get_functiondef(p.oid),'acl',p.proacl::text) ORDER BY p.oid::regprocedure::text)::text) INTO helper_fingerprint FROM pg_catalog.pg_proc p WHERE p.oid IN (SELECT pg_catalog.to_regprocedure('public.'||f) FROM pg_catalog.unnest(ARRAY['has_role(uuid,public.app_role)','is_club_cashier(uuid,uuid)','is_club_accountant(uuid,uuid)']) f);
  IF helper_fingerprint IS DISTINCT FROM 'dd62da07dc4d720445cbf5cbfe01c9e3' THEN
    RAISE EXCEPTION 'payroll_storage_helper_drift' USING ERRCODE = '55000';
  END IF;
  SELECT pg_catalog.md5(pg_catalog.jsonb_build_object('definition',pg_catalog.pg_get_functiondef(p.oid),'owner',pg_catalog.pg_get_userbyid(p.proowner),'acl',p.proacl::text,'security_definer',p.prosecdef,'config',p.proconfig)::text) INTO guard_fingerprint FROM pg_catalog.pg_proc p WHERE p.oid=pg_catalog.to_regprocedure('floor_private.guard_payroll_adjustment_client_write_v1()');
  IF (storage_fingerprint = '74e12a3bc8f4f5cc4abc3a1910307a92' AND guard_fingerprint IS NOT NULL)
     OR (storage_fingerprint = '9ca4fa649a02e7624c831305397ae7d2' AND guard_fingerprint IS DISTINCT FROM '5a9f0ff8e9411a9998318d5d59a95bce') THEN
    RAISE EXCEPTION 'payroll_adjustment_guard_function_drift' USING ERRCODE = '55000';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_namespace n WHERE n.nspname='floor_private'
      AND pg_catalog.pg_get_userbyid(n.nspowner)='postgres'
      AND NOT pg_catalog.has_schema_privilege('authenticated',n.oid,'CREATE')
      AND NOT pg_catalog.has_schema_privilege('anon',n.oid,'CREATE')) THEN
    RAISE EXCEPTION 'payroll_adjustment_private_schema_drift' USING ERRCODE = '55000';
  END IF;
  -- Existing contradictory tenant links need explicit investigation, never backfill.
  IF EXISTS (SELECT 1 FROM public.dealer_payroll dp
      JOIN public.payroll_periods pp ON pp.id = dp.period_id
      JOIN public.dealers d ON d.id = dp.dealer_id
      WHERE dp.club_id <> pp.club_id OR dp.club_id <> d.club_id)
     OR EXISTS (SELECT 1 FROM public.payment_records pr
      JOIN public.payroll_periods pp ON pp.id = pr.period_id
      WHERE pr.club_id <> pp.club_id) THEN
    RAISE EXCEPTION 'payroll_storage_tenant_linkage_drift' USING ERRCODE = '55000';
  END IF;
END
$preflight$;

-- Scope raw payroll reads to canonical club authority. All financial writes stay
-- behind existing caller-bound payroll RPCs, except the existing draft adjustment UI.
REVOKE ALL ON TABLE public.payroll_periods, public.dealer_payroll, public.payment_records, public.payroll_adjustments, public.payroll_audit_log FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.payroll_periods, public.dealer_payroll,
  public.payment_records, public.payroll_adjustments TO authenticated;
GRANT INSERT (payroll_id, adjustment_type, amount_vnd, reason, created_by)
  ON public.payroll_adjustments TO authenticated;
GRANT DELETE ON TABLE public.payroll_adjustments TO authenticated;

DROP POLICY IF EXISTS "Club members can view payroll periods" ON public.payroll_periods;
DROP POLICY IF EXISTS "Service role full access payroll periods" ON public.payroll_periods;
DROP POLICY IF EXISTS "payroll_periods_club_isolation" ON public.payroll_periods;
DROP POLICY IF EXISTS "payroll_periods_select_accountant" ON public.payroll_periods;
DROP POLICY IF EXISTS "payroll_periods_scoped_read_v1" ON public.payroll_periods;
DROP POLICY IF EXISTS "payroll_periods_service_only_v1" ON public.payroll_periods;
CREATE POLICY payroll_periods_service_only_v1 ON public.payroll_periods
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Club members can view dealer payroll" ON public.dealer_payroll;
DROP POLICY IF EXISTS "Service role full access dealer payroll" ON public.dealer_payroll;
DROP POLICY IF EXISTS "payroll_club_isolation" ON public.dealer_payroll;
DROP POLICY IF EXISTS "payroll_select_accountant" ON public.dealer_payroll;
DROP POLICY IF EXISTS "dealer_payroll_scoped_read_v1" ON public.dealer_payroll;
DROP POLICY IF EXISTS "dealer_payroll_service_only_v1" ON public.dealer_payroll;
CREATE POLICY dealer_payroll_service_only_v1 ON public.dealer_payroll
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "payment_records_select" ON public.payment_records;
DROP POLICY IF EXISTS "payment_records_select_accountant" ON public.payment_records;
DROP POLICY IF EXISTS "payment_records_scoped_read_v1" ON public.payment_records;
DROP POLICY IF EXISTS "payment_records_service_only_v1" ON public.payment_records;
CREATE POLICY payment_records_service_only_v1 ON public.payment_records
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Club members can view adjustments" ON public.payroll_adjustments;
DROP POLICY IF EXISTS "Service role full access adjustments" ON public.payroll_adjustments;
DROP POLICY IF EXISTS "payroll_adjustments_delete" ON public.payroll_adjustments;
DROP POLICY IF EXISTS "payroll_adjustments_delete_accountant" ON public.payroll_adjustments;
DROP POLICY IF EXISTS "payroll_adjustments_insert" ON public.payroll_adjustments;
DROP POLICY IF EXISTS "payroll_adjustments_insert_accountant" ON public.payroll_adjustments;
DROP POLICY IF EXISTS "payroll_adjustments_select" ON public.payroll_adjustments;
DROP POLICY IF EXISTS "payroll_adjustments_select_accountant" ON public.payroll_adjustments;
DROP POLICY IF EXISTS "payroll_adjustments_scoped_read_v1" ON public.payroll_adjustments;
DROP POLICY IF EXISTS "payroll_adjustments_draft_insert_v1" ON public.payroll_adjustments;
DROP POLICY IF EXISTS "payroll_adjustments_draft_delete_v1" ON public.payroll_adjustments;
DROP POLICY IF EXISTS "payroll_adjustments_service_only_v1" ON public.payroll_adjustments;
CREATE POLICY payroll_adjustments_service_only_v1 ON public.payroll_adjustments
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "audit_log_club_isolation" ON public.payroll_audit_log;
DROP POLICY IF EXISTS "payroll_audit_log_service_only_v1" ON public.payroll_audit_log;
CREATE POLICY payroll_audit_log_service_only_v1 ON public.payroll_audit_log
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY payroll_periods_scoped_read_v1 ON public.payroll_periods
  FOR SELECT TO authenticated USING (
    public.has_role((SELECT auth.uid()), 'super_admin'::public.app_role)
    OR public.is_club_cashier((SELECT auth.uid()), club_id)
    OR public.is_club_accountant((SELECT auth.uid()), club_id)
  );
CREATE POLICY dealer_payroll_scoped_read_v1 ON public.dealer_payroll
  FOR SELECT TO authenticated USING (
    public.has_role((SELECT auth.uid()), 'super_admin'::public.app_role)
    OR EXISTS (SELECT 1 FROM public.payroll_periods pp
      WHERE pp.id = dealer_payroll.period_id AND pp.club_id = dealer_payroll.club_id)
  );
CREATE POLICY payment_records_scoped_read_v1 ON public.payment_records
  FOR SELECT TO authenticated USING (
    public.has_role((SELECT auth.uid()), 'super_admin'::public.app_role)
    OR EXISTS (SELECT 1 FROM public.payroll_periods pp
      WHERE pp.id = payment_records.period_id AND pp.club_id = payment_records.club_id)
  );
CREATE POLICY payroll_adjustments_scoped_read_v1 ON public.payroll_adjustments
  FOR SELECT TO authenticated USING (
    public.has_role((SELECT auth.uid()), 'super_admin'::public.app_role)
    OR EXISTS (SELECT 1 FROM public.dealer_payroll dp
      WHERE dp.id = payroll_adjustments.payroll_id)
  );
CREATE POLICY payroll_adjustments_draft_insert_v1 ON public.payroll_adjustments
  FOR INSERT TO authenticated WITH CHECK (
    created_by = (SELECT auth.uid()) AND approved_by IS NULL
    AND EXISTS (
      SELECT 1 FROM public.dealer_payroll dp
      JOIN public.payroll_periods pp ON pp.id = dp.period_id AND pp.club_id = dp.club_id
      WHERE dp.id = payroll_adjustments.payroll_id
        AND pp.status IN ('draft', 'rejected')
    )
  );
CREATE POLICY payroll_adjustments_draft_delete_v1 ON public.payroll_adjustments
  FOR DELETE TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.dealer_payroll dp
      JOIN public.payroll_periods pp ON pp.id = dp.period_id AND pp.club_id = dp.club_id
      WHERE dp.id = payroll_adjustments.payroll_id
        AND pp.status IN ('draft', 'rejected')
    )
  );


-- The direct adjustment UI must share the approval RPC's parent-period lock.
-- RLS alone reads a statement snapshot and cannot prevent a concurrent approval.
-- This private trigger has no callable API; no role receives EXECUTE. Existing
-- service/backend writers keep their own authorization and transaction paths.
CREATE OR REPLACE FUNCTION floor_private.guard_payroll_adjustment_client_write_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  actor uuid;
  target_payroll uuid;
  target_club uuid;
  target_status text;
BEGIN
  -- The role setting survives entry into SECURITY DEFINER payroll RPCs.
  -- Only authenticated has the direct INSERT/DELETE grants changed here.
  IF pg_catalog.current_setting('role', true) IS DISTINCT FROM 'authenticated' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  actor := auth.uid();
  IF actor IS NULL THEN
    RAISE EXCEPTION 'payroll_adjustment_actor_required' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'DELETE' THEN target_payroll := OLD.payroll_id;
  ELSIF TG_OP = 'INSERT' THEN target_payroll := NEW.payroll_id;
  ELSE RAISE EXCEPTION 'payroll_adjustment_operation_forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT pp.club_id, pp.status INTO target_club, target_status
  FROM public.dealer_payroll dp
  JOIN public.payroll_periods pp ON pp.id = dp.period_id AND pp.club_id = dp.club_id
  WHERE dp.id = target_payroll
  FOR UPDATE OF pp;
  IF NOT FOUND OR NOT (
      public.has_role(actor, 'super_admin'::public.app_role)
      OR public.is_club_cashier(actor, target_club)
      OR public.is_club_accountant(actor, target_club)
  ) THEN
    RAISE EXCEPTION 'payroll_adjustment_club_forbidden' USING ERRCODE = '42501';
  END IF;
  IF target_status NOT IN ('draft', 'rejected') OR target_status IS NULL THEN
    RAISE EXCEPTION 'payroll_adjustment_period_frozen' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'INSERT' AND (NEW.created_by IS DISTINCT FROM actor OR NEW.approved_by IS NOT NULL) THEN
    RAISE EXCEPTION 'payroll_adjustment_metadata_forbidden' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END
$function$;
REVOKE ALL ON FUNCTION floor_private.guard_payroll_adjustment_client_write_v1()
  FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS payroll_adjustments_period_lock_v1 ON public.payroll_adjustments;
CREATE TRIGGER payroll_adjustments_period_lock_v1
  BEFORE INSERT OR DELETE ON public.payroll_adjustments
  FOR EACH ROW EXECUTE FUNCTION floor_private.guard_payroll_adjustment_client_write_v1();

DO $postcheck$
DECLARE storage_fingerprint text; guard_fingerprint text;
BEGIN
  SELECT pg_catalog.md5(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
 'table',c.relname,'owner',pg_catalog.pg_get_userbyid(c.relowner),'kind',c.relkind,
 'rls',c.relrowsecurity,'force_rls',c.relforcerowsecurity,
 'acl',(SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('grantee',CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(a.grantee) END,'grantor',pg_catalog.pg_get_userbyid(a.grantor),'privilege',a.privilege_type,'grantable',a.is_grantable) ORDER BY a.grantee::regrole::text,a.privilege_type,a.grantor::regrole::text) FROM pg_catalog.aclexplode(c.relacl) a),
 'columns',(SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('name',a.attname,'type',pg_catalog.format_type(a.atttypid,a.atttypmod),'notnull',a.attnotnull,'acl',a.attacl,'default',pg_catalog.pg_get_expr(d.adbin,d.adrelid)) ORDER BY a.attnum) FROM pg_catalog.pg_attribute a LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped),
 'constraints',(SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('name',k.conname,'definition',pg_catalog.pg_get_constraintdef(k.oid)) ORDER BY k.conname) FROM pg_catalog.pg_constraint k WHERE k.conrelid=c.oid),
 'triggers',(SELECT pg_catalog.jsonb_agg(pg_catalog.pg_get_triggerdef(t.oid) ORDER BY t.tgname) FROM pg_catalog.pg_trigger t WHERE t.tgrelid=c.oid AND NOT t.tgisinternal),
 'policies',(SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('name',p.polname,'command',p.polcmd,'permissive',p.polpermissive,'roles',ARRAY(SELECT CASE WHEN r=0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(r) END FROM pg_catalog.unnest(p.polroles) r ORDER BY 1),'using',pg_catalog.pg_get_expr(p.polqual,p.polrelid),'check',pg_catalog.pg_get_expr(p.polwithcheck,p.polrelid)) ORDER BY p.polname) FROM pg_catalog.pg_policy p WHERE p.polrelid=c.oid)
) ORDER BY c.relname)::text) INTO storage_fingerprint FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=ANY(ARRAY['dealer_payroll','payment_records','payroll_adjustments','payroll_audit_log','payroll_periods']);
  IF storage_fingerprint IS DISTINCT FROM '9ca4fa649a02e7624c831305397ae7d2' THEN
    RAISE EXCEPTION 'payroll_storage_postcheck_failed' USING ERRCODE = '55000';
  END IF;
  SELECT pg_catalog.md5(pg_catalog.jsonb_build_object('definition',pg_catalog.pg_get_functiondef(p.oid),'owner',pg_catalog.pg_get_userbyid(p.proowner),'acl',p.proacl::text,'security_definer',p.prosecdef,'config',p.proconfig)::text) INTO guard_fingerprint FROM pg_catalog.pg_proc p WHERE p.oid=pg_catalog.to_regprocedure('floor_private.guard_payroll_adjustment_client_write_v1()');
  IF guard_fingerprint IS DISTINCT FROM '5a9f0ff8e9411a9998318d5d59a95bce' THEN
    RAISE EXCEPTION 'payroll_adjustment_guard_postcheck_failed' USING ERRCODE = '55000';
  END IF;
END
$postcheck$;

COMMIT;
